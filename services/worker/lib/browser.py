"""
Playwright browser utilities for web scraping
"""

from typing import Optional
from playwright.sync_api import sync_playwright, Browser, Page
from bs4 import BeautifulSoup
import re


class WebBrowser:
    def __init__(self):
        self.playwright = None
        self.browser: Optional[Browser] = None

    def __enter__(self):
        self.playwright = sync_playwright().start()
        self.browser = self.playwright.chromium.launch(headless=True)
        return self

    def __exit__(self, exc_type, exc_val, exc_tb):
        if self.browser:
            self.browser.close()
        if self.playwright:
            self.playwright.stop()

    def fetch_page(self, url: str, wait_for: str = "networkidle") -> dict:
        """Fetch a page and extract content."""
        if not self.browser:
            raise RuntimeError("Browser not started")

        page = self.browser.new_page()
        try:
            page.goto(url, wait_until=wait_for, timeout=30000)

            # Extract content
            html = page.content()
            title = page.title()

            # Parse with BeautifulSoup
            soup = BeautifulSoup(html, "lxml")

            # Remove script and style elements
            for element in soup(["script", "style", "nav", "footer", "header", "aside"]):
                element.decompose()

            # Extract text
            text = soup.get_text(separator="\n", strip=True)
            text = re.sub(r'\n{3,}', '\n\n', text)  # Remove excessive newlines

            # Extract links
            links = []
            for link in soup.find_all("a", href=True):
                href = link["href"]
                if href.startswith("http"):
                    links.append({
                        "url": href,
                        "text": link.get_text(strip=True)[:100]
                    })

            # Extract metadata
            meta = {}
            for tag in soup.find_all("meta"):
                name = tag.get("name") or tag.get("property")
                content = tag.get("content")
                if name and content:
                    meta[name] = content

            return {
                "url": url,
                "title": title,
                "text": text[:50000],  # Limit text size
                "links": links[:50],  # Limit links
                "meta": meta,
            }
        except Exception as e:
            return {
                "url": url,
                "title": "",
                "text": "",
                "links": [],
                "meta": {},
                "error": str(e),
            }
        finally:
            page.close()

    def search_ddg(self, query: str, max_results: int = 10) -> list[dict]:
        """Search DuckDuckGo and return results."""
        if not self.browser:
            raise RuntimeError("Browser not started")

        page = self.browser.new_page()
        results = []

        try:
            # Navigate to DuckDuckGo
            search_url = f"https://duckduckgo.com/?q={query.replace(' ', '+')}&t=h_"
            page.goto(search_url, wait_until="networkidle", timeout=30000)

            # Wait for results
            page.wait_for_selector("article[data-testid='result']", timeout=10000)

            # Extract results
            articles = page.query_selector_all("article[data-testid='result']")

            for article in articles[:max_results]:
                try:
                    link = article.query_selector("a[data-testid='result-title-a']")
                    snippet_el = article.query_selector("span[data-result='snippet']")

                    if link:
                        results.append({
                            "title": link.inner_text(),
                            "url": link.get_attribute("href"),
                            "snippet": snippet_el.inner_text() if snippet_el else "",
                        })
                except Exception:
                    continue

        except Exception as e:
            print(f"DuckDuckGo search failed: {e}")
        finally:
            page.close()

        return results
