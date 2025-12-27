"""
Security guardrails - secret detection and PII scanning
"""

import re
from typing import Optional


# Common secret patterns
SECRET_PATTERNS = [
    # API keys
    (r'(?i)(api[_-]?key|apikey)["\']?\s*[:=]\s*["\']?([a-zA-Z0-9_\-]{20,})', "API Key"),
    (r'(?i)(secret|token)["\']?\s*[:=]\s*["\']?([a-zA-Z0-9_\-]{20,})', "Secret/Token"),

    # AWS
    (r'AKIA[0-9A-Z]{16}', "AWS Access Key ID"),
    (r'(?i)aws[_-]?secret[_-]?access[_-]?key["\']?\s*[:=]\s*["\']?([a-zA-Z0-9/+=]{40})', "AWS Secret Key"),

    # GitHub
    (r'ghp_[a-zA-Z0-9]{36}', "GitHub Personal Access Token"),
    (r'github_pat_[a-zA-Z0-9]{22}_[a-zA-Z0-9]{59}', "GitHub Fine-grained PAT"),
    (r'gho_[a-zA-Z0-9]{36}', "GitHub OAuth Token"),

    # OpenAI
    (r'sk-[a-zA-Z0-9]{48}', "OpenAI API Key"),

    # Anthropic
    (r'sk-ant-[a-zA-Z0-9\-]{40,}', "Anthropic API Key"),

    # Stripe
    (r'sk_live_[a-zA-Z0-9]{24,}', "Stripe Secret Key"),
    (r'pk_live_[a-zA-Z0-9]{24,}', "Stripe Publishable Key"),

    # Private keys
    (r'-----BEGIN (?:RSA |EC |DSA )?PRIVATE KEY-----', "Private Key"),
    (r'-----BEGIN OPENSSH PRIVATE KEY-----', "OpenSSH Private Key"),

    # Database URLs
    (r'(?i)(postgres|mysql|mongodb)://[^\s"\']+:[^\s"\']+@', "Database URL with credentials"),

    # Generic high entropy (potential secrets)
    (r'(?i)(password|passwd|pwd)["\']?\s*[:=]\s*["\']?([^\s"\']{8,})', "Password"),
]


def scan_for_secrets(text: str) -> list[dict]:
    """Scan text for potential secrets."""
    findings = []

    for pattern, secret_type in SECRET_PATTERNS:
        matches = re.finditer(pattern, text)
        for match in matches:
            findings.append({
                "type": secret_type,
                "match": match.group()[:50] + "..." if len(match.group()) > 50 else match.group(),
                "position": match.start(),
            })

    return findings


def has_secrets(text: str) -> bool:
    """Quick check if text contains secrets."""
    return len(scan_for_secrets(text)) > 0


def redact_secrets(text: str) -> str:
    """Redact detected secrets from text."""
    for pattern, _ in SECRET_PATTERNS:
        text = re.sub(pattern, "[REDACTED]", text)
    return text


# High entropy detection
def calculate_entropy(text: str) -> float:
    """Calculate Shannon entropy of a string."""
    if not text:
        return 0.0

    from collections import Counter
    import math

    counter = Counter(text)
    length = len(text)

    entropy = 0.0
    for count in counter.values():
        probability = count / length
        entropy -= probability * math.log2(probability)

    return entropy


def is_high_entropy(text: str, threshold: float = 4.5) -> bool:
    """Check if a string has high entropy (likely a secret)."""
    if len(text) < 16:
        return False
    return calculate_entropy(text) > threshold


# Allowlist for outbound payloads
ALLOWED_OUTBOUND_FIELDS = {
    "url",
    "title",
    "description",
    "summary",
    "findings",
    "decision",
    "type",
    "label",
    "content",
    "text",
    "query",
    "host",
    "tags",
}


def sanitize_outbound_payload(payload: dict) -> dict:
    """Remove non-allowlisted fields from outbound payloads."""
    sanitized = {}
    for key, value in payload.items():
        if key.lower() in ALLOWED_OUTBOUND_FIELDS:
            if isinstance(value, str):
                sanitized[key] = redact_secrets(value)
            elif isinstance(value, dict):
                sanitized[key] = sanitize_outbound_payload(value)
            elif isinstance(value, list):
                sanitized[key] = [
                    sanitize_outbound_payload(v) if isinstance(v, dict)
                    else redact_secrets(v) if isinstance(v, str)
                    else v
                    for v in value
                ]
            else:
                sanitized[key] = value
    return sanitized


class GuardedOutput:
    """Context manager for guarded output generation."""

    def __init__(self, strict: bool = True):
        self.strict = strict
        self.findings = []

    def check(self, text: str, source: str = "unknown") -> str:
        """Check text for secrets and optionally redact."""
        secrets = scan_for_secrets(text)
        if secrets:
            self.findings.extend([{**s, "source": source} for s in secrets])
            if self.strict:
                return redact_secrets(text)
        return text

    def has_violations(self) -> bool:
        return len(self.findings) > 0

    def get_report(self) -> dict:
        return {
            "violations": len(self.findings),
            "findings": self.findings,
        }
