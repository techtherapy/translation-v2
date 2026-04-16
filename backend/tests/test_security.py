"""Tests for security utilities (password hashing, JWT tokens)."""

import pytest
from fastapi import HTTPException
from app.core.security import hash_password, verify_password, create_access_token, decode_token


def test_password_hash_and_verify():
    hashed = hash_password("my-secret")
    assert hashed != "my-secret"
    assert verify_password("my-secret", hashed)


def test_password_wrong():
    hashed = hash_password("correct")
    assert not verify_password("wrong", hashed)


def test_create_and_decode_token():
    token = create_access_token({"sub": "42"})
    payload = decode_token(token)
    assert payload["sub"] == "42"
    assert "exp" in payload


def test_decode_invalid_token():
    with pytest.raises(HTTPException) as exc_info:
        decode_token("not.a.valid.token")
    assert exc_info.value.status_code == 401
