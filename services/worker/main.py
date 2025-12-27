"""
Ronald-GI Agent Worker
Main entry point for the autonomous research worker
"""

import os
import time
import signal
import sys
from typing import Optional

from lib.api_client import ApiClient
from lib.ollama_client import OllamaClient
from lib.embedder_client import EmbedderClient
from flows.ideation import create_ideation_flow
from flows.research import create_research_flow
from flows.synthesis import create_synthesis_flow

# Configuration
POLL_INTERVAL = int(os.getenv("POLL_INTERVAL", "30"))
MAX_REPORTS_PER_CYCLE = int(os.getenv("MAX_REPORTS_PER_CYCLE", "3"))


class Worker:
    def __init__(self):
        self.api = ApiClient()
        self.ollama = OllamaClient()
        self.embedder = EmbedderClient()
        self.running = True

    def wait_for_services(self, timeout: int = 300):
        """Wait for dependent services to become available."""
        start = time.time()
        print("Waiting for services...")

        while time.time() - start < timeout:
            ollama_ok = self.ollama.is_available()
            embedder_ok = self.embedder.is_available()

            if ollama_ok and embedder_ok:
                print("All services available")
                return True

            status = []
            status.append(f"Ollama: {'ready' if ollama_ok else 'waiting'}")
            status.append(f"Embedder: {'ready' if embedder_ok else 'waiting'}")
            print(f"  {', '.join(status)}")

            time.sleep(5)

        print("Timeout waiting for services")
        return False

    def run_cycle(self) -> int:
        """Run one research cycle. Returns number of reports generated."""
        reports_generated = 0

        try:
            # 1. Ideation - choose what to research
            print("Running ideation...")
            ideation_flow = create_ideation_flow(self.api, self.embedder)
            candidate = ideation_flow.run(None)

            if not candidate:
                print("No candidates to research")
                return 0

            print(f"Selected candidate: {candidate.get('type')} - {candidate.get('id', candidate.get('url', ''))[:50]}")

            # 2. Research - fetch and extract
            print("Researching...")
            research_flow = create_research_flow(self.api, self.ollama, self.embedder)
            research_data = research_flow.run(candidate)

            if not research_data or not research_data.get("pages"):
                print("No research data extracted")
                return 0

            # 3. Synthesis - generate report
            print("Synthesizing report...")
            synthesis_flow = create_synthesis_flow(self.api, self.ollama)
            result = synthesis_flow.run(research_data)

            if result and result.get("report_id"):
                print(f"Created report: {result['report_id']} (promoted: {result.get('promoted', False)})")
                reports_generated = 1

        except Exception as e:
            print(f"Error in cycle: {e}")
            import traceback
            traceback.print_exc()

        return reports_generated

    def run(self):
        """Main worker loop."""
        print("Ronald-GI Worker starting...")

        # Wait for services
        if not self.wait_for_services():
            print("Failed to connect to required services")
            sys.exit(1)

        print(f"Starting main loop (poll interval: {POLL_INTERVAL}s)")

        while self.running:
            try:
                # Check for job queue items first
                job = self.api.claim_job()

                if job:
                    print(f"Processing job: {job['id']} ({job['job_type']})")
                    try:
                        # Handle different job types
                        if job["job_type"] == "ideation":
                            # Force ideation cycle
                            self.run_cycle()
                        elif job["job_type"] == "research":
                            # Research specific target
                            self.run_cycle()
                        elif job["job_type"] == "synthesis":
                            # Re-synthesize
                            pass
                        elif job["job_type"] == "meta":
                            # Meta updates (preference weights, etc.)
                            pass

                        self.api.complete_job(job["id"])
                    except Exception as e:
                        self.api.fail_job(job["id"], str(e))
                else:
                    # No jobs, run autonomous cycle
                    reports = self.run_cycle()

                    if reports == 0:
                        # Nothing to do, wait longer
                        print(f"No work done, sleeping {POLL_INTERVAL}s...")
                        time.sleep(POLL_INTERVAL)
                    else:
                        # Did work, short pause before next
                        time.sleep(5)

            except KeyboardInterrupt:
                break
            except Exception as e:
                print(f"Worker error: {e}")
                time.sleep(POLL_INTERVAL)

        self.cleanup()

    def cleanup(self):
        """Clean up resources."""
        print("Worker shutting down...")
        self.api.close()
        self.ollama.close()
        self.embedder.close()

    def stop(self):
        """Signal the worker to stop."""
        self.running = False


def main():
    worker = Worker()

    # Handle signals
    def signal_handler(sig, frame):
        print("\nReceived shutdown signal")
        worker.stop()

    signal.signal(signal.SIGINT, signal_handler)
    signal.signal(signal.SIGTERM, signal_handler)

    worker.run()


if __name__ == "__main__":
    main()
