"""Tests for authentication endpoints."""

import pytest
from httpx import AsyncClient
from tests.conftest import auth_header


async def test_login_success(client: AsyncClient):
    resp = await client.post(
        "/api/auth/login",
        data={"username": "admin", "password": "admin"},
    )
    assert resp.status_code == 200
    body = resp.json()
    assert "access_token" in body
    assert body["token_type"] == "bearer"


async def test_login_wrong_password(client: AsyncClient):
    resp = await client.post(
        "/api/auth/login",
        data={"username": "admin", "password": "wrong"},
    )
    assert resp.status_code == 401


async def test_login_nonexistent_user(client: AsyncClient):
    resp = await client.post(
        "/api/auth/login",
        data={"username": "nobody", "password": "nope"},
    )
    assert resp.status_code == 401


async def test_me_authenticated(client: AsyncClient, admin_token: str):
    resp = await client.get("/api/auth/me", headers=auth_header(admin_token))
    assert resp.status_code == 200
    body = resp.json()
    assert body["username"] == "admin"
    assert body["role"] == "admin"


async def test_me_unauthenticated(client: AsyncClient):
    resp = await client.get("/api/auth/me")
    assert resp.status_code == 401


async def test_create_user_as_admin(client: AsyncClient, admin_token: str):
    resp = await client.post(
        "/api/auth/users",
        json={
            "username": "reviewer1",
            "email": "reviewer1@test.com",
            "password": "pass123",
            "full_name": "Reviewer One",
            "role": "reviewer",
        },
        headers=auth_header(admin_token),
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["username"] == "reviewer1"
    assert body["role"] == "reviewer"


async def test_create_user_as_translator_forbidden(client: AsyncClient, translator_token: str):
    resp = await client.post(
        "/api/auth/users",
        json={
            "username": "hacker",
            "email": "hacker@test.com",
            "password": "pass",
            "full_name": "Hacker",
            "role": "admin",
        },
        headers=auth_header(translator_token),
    )
    assert resp.status_code == 403
