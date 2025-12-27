"""
Ollama client for LLM inference
"""

import os
import json
from typing import Optional, Any
import httpx

OLLAMA_URL = os.getenv("OLLAMA_URL", "http://ollama:11434")
OLLAMA_MODEL = os.getenv("OLLAMA_MODEL", "qwen2.5:7b")


class OllamaClient:
    def __init__(self, base_url: str = OLLAMA_URL, model: str = OLLAMA_MODEL):
        self.base_url = base_url
        self.model = model
        self.client = httpx.Client(timeout=120.0)

    def generate(
        self,
        prompt: str,
        system: Optional[str] = None,
        temperature: float = 0.7,
        max_tokens: int = 2048,
        json_mode: bool = False,
    ) -> str:
        """Generate text completion."""
        payload = {
            "model": self.model,
            "prompt": prompt,
            "stream": False,
            "options": {
                "temperature": temperature,
                "num_predict": max_tokens,
            },
        }

        if system:
            payload["system"] = system

        if json_mode:
            payload["format"] = "json"

        resp = self.client.post(f"{self.base_url}/api/generate", json=payload)
        resp.raise_for_status()
        return resp.json()["response"]

    def generate_json(
        self,
        prompt: str,
        system: Optional[str] = None,
        temperature: float = 0.3,
    ) -> dict:
        """Generate and parse JSON response."""
        response = self.generate(
            prompt=prompt,
            system=system,
            temperature=temperature,
            json_mode=True,
        )

        try:
            return json.loads(response)
        except json.JSONDecodeError:
            # Try to extract JSON from response
            import re
            match = re.search(r'\{.*\}', response, re.DOTALL)
            if match:
                return json.loads(match.group())
            raise ValueError(f"Failed to parse JSON from response: {response[:200]}")

    def chat(
        self,
        messages: list[dict],
        temperature: float = 0.7,
        max_tokens: int = 2048,
    ) -> str:
        """Chat completion with message history."""
        payload = {
            "model": self.model,
            "messages": messages,
            "stream": False,
            "options": {
                "temperature": temperature,
                "num_predict": max_tokens,
            },
        }

        resp = self.client.post(f"{self.base_url}/api/chat", json=payload)
        resp.raise_for_status()
        return resp.json()["message"]["content"]

    def is_available(self) -> bool:
        """Check if Ollama is available and model is loaded."""
        try:
            resp = self.client.get(f"{self.base_url}/api/tags")
            resp.raise_for_status()
            models = [m["name"] for m in resp.json().get("models", [])]
            return self.model in models or any(self.model.split(":")[0] in m for m in models)
        except Exception:
            return False

    def close(self):
        self.client.close()
