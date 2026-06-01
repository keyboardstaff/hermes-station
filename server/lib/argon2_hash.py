"""Argon2id wrapper — lazy import so argon2-cffi isn't required at module load."""

from __future__ import annotations


def hash_password(plain: str) -> str:
    from argon2 import PasswordHasher
    return PasswordHasher().hash(plain)


def verify_password(hashed: str, plain: str) -> bool:
    """Constant-time verify; returns False on mismatch and on malformed/empty inputs."""
    if not hashed or not plain:
        return False
    from argon2 import PasswordHasher
    from argon2.exceptions import InvalidHashError, VerifyMismatchError
    try:
        return PasswordHasher().verify(hashed, plain)
    except (VerifyMismatchError, InvalidHashError):
        return False
    except Exception:
        return False
