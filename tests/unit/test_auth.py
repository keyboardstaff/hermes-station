"""Auth helpers — argon2 round-trip + localhost trust model."""

from __future__ import annotations

from server.lib.argon2_hash import hash_password, verify_password


def test_argon2_roundtrip() -> None:
    pw = "correct horse battery staple"
    h = hash_password(pw)
    assert h.startswith("$argon2id$") or h.startswith("$argon2")
    assert verify_password(h, pw)


def test_argon2_rejects_wrong_password() -> None:
    h = hash_password("foo")
    assert not verify_password(h, "bar")


def test_argon2_rejects_empty_inputs() -> None:
    assert not verify_password("", "x")
    assert not verify_password("x", "")
    assert not verify_password("", "")


def test_argon2_rejects_malformed_hash() -> None:
    assert not verify_password("not-an-argon2-hash", "anything")
