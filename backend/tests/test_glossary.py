"""Tests for glossary CRUD endpoints."""

import pytest
from httpx import AsyncClient
from tests.conftest import auth_header


async def test_list_terms_empty(client: AsyncClient, admin_token: str):
    resp = await client.get("/api/glossary", headers=auth_header(admin_token))
    assert resp.status_code == 200
    body = resp.json()
    assert body["terms"] == []
    assert body["total"] == 0


async def test_create_and_get_term(client: AsyncClient, admin_token: str):
    headers = auth_header(admin_token)

    # Create
    resp = await client.post(
        "/api/glossary",
        json={
            "source_term": "般若",
            "category": "dharma_concept",
            "sanskrit_pali": "prajñā",
            "translations": [
                {"language_id": 1, "translated_term": "wisdom", "is_preferred": True, "notes": ""}
            ],
        },
        headers=headers,
    )
    assert resp.status_code == 200
    term = resp.json()
    assert term["source_term"] == "般若"
    assert term["category"] == "dharma_concept"
    term_id = term["id"]

    # List
    resp = await client.get("/api/glossary", headers=headers)
    body = resp.json()
    assert body["total"] == 1
    assert body["terms"][0]["id"] == term_id

    # Get single
    resp = await client.get(f"/api/glossary/{term_id}", headers=headers)
    assert resp.status_code == 200
    assert resp.json()["sanskrit_pali"] == "prajñā"


async def test_update_term(client: AsyncClient, admin_token: str):
    headers = auth_header(admin_token)

    resp = await client.post(
        "/api/glossary",
        json={"source_term": "菩薩", "category": "deity_buddha"},
        headers=headers,
    )
    term_id = resp.json()["id"]

    resp = await client.patch(
        f"/api/glossary/{term_id}",
        json={"sanskrit_pali": "bodhisattva"},
        headers=headers,
    )
    assert resp.status_code == 200
    assert resp.json()["sanskrit_pali"] == "bodhisattva"


async def test_delete_term(client: AsyncClient, admin_token: str):
    headers = auth_header(admin_token)

    resp = await client.post(
        "/api/glossary",
        json={"source_term": "臨時", "category": "general"},
        headers=headers,
    )
    term_id = resp.json()["id"]

    resp = await client.delete(f"/api/glossary/{term_id}", headers=headers)
    assert resp.status_code == 200

    resp = await client.get(f"/api/glossary/{term_id}", headers=headers)
    assert resp.status_code == 404


async def test_search_terms(client: AsyncClient, admin_token: str):
    headers = auth_header(admin_token)

    await client.post(
        "/api/glossary",
        json={"source_term": "阿彌陀佛", "category": "deity_buddha"},
        headers=headers,
    )
    await client.post(
        "/api/glossary",
        json={"source_term": "觀世音", "category": "deity_buddha"},
        headers=headers,
    )

    resp = await client.get("/api/glossary", params={"search": "阿彌"}, headers=headers)
    body = resp.json()
    assert body["total"] == 1
    assert body["terms"][0]["source_term"] == "阿彌陀佛"


async def test_unauthenticated_access(client: AsyncClient):
    resp = await client.get("/api/glossary")
    assert resp.status_code == 401
