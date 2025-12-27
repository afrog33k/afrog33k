"""
Tests for the guardrails module - secret detection and sanitization
"""

import pytest
from lib.guardrails import (
    scan_for_secrets,
    has_secrets,
    redact_secrets,
    calculate_entropy,
    is_high_entropy,
    sanitize_outbound_payload,
    GuardedOutput,
)


class TestSecretDetection:
    """Tests for secret pattern detection."""

    def test_detect_aws_access_key(self):
        """Should detect AWS access key IDs."""
        text = "AWS_ACCESS_KEY=AKIAIOSFODNN7EXAMPLE"
        findings = scan_for_secrets(text)
        assert len(findings) >= 1
        assert any("AWS" in f["type"] for f in findings)

    def test_detect_github_pat(self):
        """Should detect GitHub personal access tokens."""
        text = "token: ghp_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
        findings = scan_for_secrets(text)
        assert len(findings) >= 1
        assert any("GitHub" in f["type"] for f in findings)

    def test_detect_openai_key(self):
        """Should detect OpenAI API keys."""
        text = "OPENAI_API_KEY=sk-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
        findings = scan_for_secrets(text)
        assert len(findings) >= 1
        assert any("OpenAI" in f["type"] for f in findings)

    def test_detect_anthropic_key(self):
        """Should detect Anthropic API keys."""
        text = "ANTHROPIC_API_KEY=sk-ant-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
        findings = scan_for_secrets(text)
        assert len(findings) >= 1
        assert any("Anthropic" in f["type"] for f in findings)

    def test_detect_stripe_key(self):
        """Should detect Stripe secret keys."""
        # Using placeholder pattern to avoid triggering GitHub's secret scanner
        text = "stripe_key = 'sk_test_" + "x" * 24 + "'"
        findings = scan_for_secrets(text)
        assert len(findings) >= 1
        assert any("Stripe" in f["type"] for f in findings)

    def test_detect_private_key(self):
        """Should detect private key headers."""
        text = "-----BEGIN RSA PRIVATE KEY-----\nMIIE..."
        findings = scan_for_secrets(text)
        assert len(findings) >= 1
        assert any("Private Key" in f["type"] for f in findings)

    def test_detect_database_url(self):
        """Should detect database URLs with credentials."""
        text = "DATABASE_URL=postgres://user:password123@localhost:5432/db"
        findings = scan_for_secrets(text)
        assert len(findings) >= 1
        assert any("Database" in f["type"] for f in findings)

    def test_no_false_positives_on_normal_text(self):
        """Should not flag normal text as secrets."""
        text = "The quick brown fox jumps over the lazy dog. This is normal content."
        findings = scan_for_secrets(text)
        assert len(findings) == 0

    def test_has_secrets_returns_bool(self):
        """has_secrets should return boolean."""
        assert has_secrets("api_key=sk-xxxxxxxxxxxxxxxxxxxx") == True
        assert has_secrets("Hello world") == False


class TestSecretRedaction:
    """Tests for secret redaction."""

    def test_redact_api_key(self):
        """Should redact API keys."""
        text = "Use this key: sk-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
        redacted = redact_secrets(text)
        assert "sk-" not in redacted
        assert "[REDACTED]" in redacted

    def test_redact_preserves_surrounding_text(self):
        """Redaction should preserve non-secret text."""
        text = "Config: api_key = AKIAIOSFODNN7EXAMPLE and name = test"
        redacted = redact_secrets(text)
        assert "Config:" in redacted
        assert "name = test" in redacted

    def test_redact_multiple_secrets(self):
        """Should redact multiple secrets in same text."""
        text = """
        AWS_KEY=AKIAIOSFODNN7EXAMPLE
        GITHUB_TOKEN=ghp_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
        """
        redacted = redact_secrets(text)
        assert redacted.count("[REDACTED]") >= 2


class TestEntropyCalculation:
    """Tests for entropy-based secret detection."""

    def test_low_entropy_text(self):
        """Simple repetitive text should have low entropy."""
        text = "aaaaaaaaaaaaaaaa"
        entropy = calculate_entropy(text)
        assert entropy < 2.0

    def test_high_entropy_text(self):
        """Random-looking text should have high entropy."""
        text = "aB3$kL9@mN7&pQ2"
        entropy = calculate_entropy(text)
        assert entropy > 3.5

    def test_is_high_entropy_detection(self):
        """Should identify high entropy strings."""
        assert is_high_entropy("aB3$kL9@mN7&pQ2xY8#") == True
        assert is_high_entropy("hello") == False
        assert is_high_entropy("short") == False  # Too short

    def test_empty_string_entropy(self):
        """Empty string should have zero entropy."""
        assert calculate_entropy("") == 0.0


class TestPayloadSanitization:
    """Tests for outbound payload sanitization."""

    def test_sanitize_removes_unknown_fields(self):
        """Should remove non-allowlisted fields."""
        payload = {
            "url": "https://example.com",
            "title": "Test",
            "password": "secret123",
            "internal_id": "abc123"
        }
        sanitized = sanitize_outbound_payload(payload)
        assert "url" in sanitized
        assert "title" in sanitized
        assert "password" not in sanitized
        assert "internal_id" not in sanitized

    def test_sanitize_redacts_secrets_in_allowed_fields(self):
        """Should redact secrets even in allowed fields."""
        payload = {
            "content": "Use key: sk-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
        }
        sanitized = sanitize_outbound_payload(payload)
        assert "sk-" not in sanitized["content"]

    def test_sanitize_nested_dict(self):
        """Should handle nested dictionaries."""
        payload = {
            "title": "Test",
            "meta": {
                "url": "https://example.com",
                "secret": "password"
            }
        }
        sanitized = sanitize_outbound_payload(payload)
        assert "title" in sanitized
        # Nested dict should also be filtered

    def test_sanitize_list_values(self):
        """Should handle list values."""
        payload = {
            "tags": ["python", "api", "test"]
        }
        sanitized = sanitize_outbound_payload(payload)
        assert sanitized["tags"] == ["python", "api", "test"]


class TestGuardedOutput:
    """Tests for GuardedOutput context manager."""

    def test_guarded_output_checks_text(self):
        """GuardedOutput should track violations."""
        guard = GuardedOutput(strict=True)
        result = guard.check("key: sk-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx", "test")
        assert "[REDACTED]" in result
        assert guard.has_violations()

    def test_guarded_output_report(self):
        """Should generate violation report."""
        guard = GuardedOutput(strict=True)
        guard.check("AKIAIOSFODNN7EXAMPLE", "source1")
        guard.check("ghp_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx", "source2")

        report = guard.get_report()
        assert report["violations"] >= 2
        assert len(report["findings"]) >= 2

    def test_non_strict_mode(self):
        """Non-strict mode should not redact but still track."""
        guard = GuardedOutput(strict=False)
        original = "key: sk-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
        result = guard.check(original, "test")
        # In non-strict, original is returned but violations tracked
        assert guard.has_violations()

    def test_clean_text_no_violations(self):
        """Clean text should have no violations."""
        guard = GuardedOutput(strict=True)
        guard.check("This is clean text", "test")
        assert not guard.has_violations()
