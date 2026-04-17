"""Tests for Phase 1 knowledge-base CRUD (ContentType, StyleRule, GoldenExample)."""
from __future__ import annotations

from httpx import AsyncClient

from tests.conftest import auth_header


# ----- ContentType -----

async def test_content_type_crud(client: AsyncClient, admin_token: str):
    resp = await client.get("/api/knowledge/content-types", headers=auth_header(admin_token))
    assert resp.status_code == 200
    assert resp.json() == []

    resp = await client.post(
        "/api/knowledge/content-types",
        headers=auth_header(admin_token),
        json={"name": "dharma talk", "description": "Buddhist teaching discourse"},
    )
    assert resp.status_code == 201
    ct = resp.json()
    assert ct["name"] == "dharma talk"
    assert ct["revision"] == 1
    assert ct["is_active"] is True
    ct_id = ct["id"]

    resp = await client.patch(
        f"/api/knowledge/content-types/{ct_id}",
        headers=auth_header(admin_token),
        json={"description": "updated desc"},
    )
    assert resp.status_code == 200
    updated = resp.json()
    assert updated["description"] == "updated desc"
    assert updated["revision"] == 2, "revision should bump on description edit"

    # No-op update should NOT bump revision
    resp = await client.patch(
        f"/api/knowledge/content-types/{ct_id}",
        headers=auth_header(admin_token),
        json={"description": "updated desc"},
    )
    assert resp.status_code == 200
    assert resp.json()["revision"] == 2

    resp = await client.delete(f"/api/knowledge/content-types/{ct_id}", headers=auth_header(admin_token))
    assert resp.status_code == 204

    # After soft-delete, default list omits it but include_inactive returns it.
    resp = await client.get("/api/knowledge/content-types", headers=auth_header(admin_token))
    assert resp.json() == []
    resp = await client.get(
        "/api/knowledge/content-types?include_inactive=true", headers=auth_header(admin_token)
    )
    assert len(resp.json()) == 1
    assert resp.json()[0]["is_active"] is False


async def test_content_type_name_unique(client: AsyncClient, admin_token: str):
    payload = {"name": "meditation", "description": ""}
    resp = await client.post("/api/knowledge/content-types", headers=auth_header(admin_token), json=payload)
    assert resp.status_code == 201

    resp = await client.post("/api/knowledge/content-types", headers=auth_header(admin_token), json=payload)
    assert resp.status_code == 409


async def test_knowledge_requires_authentication(client: AsyncClient):
    resp = await client.get("/api/knowledge/content-types")
    assert resp.status_code == 401


async def test_knowledge_create_forbidden_for_reviewer(client: AsyncClient, reviewer_token: str):
    resp = await client.post(
        "/api/knowledge/content-types",
        headers=auth_header(reviewer_token),
        json={"name": "x", "description": ""},
    )
    assert resp.status_code == 403


# ----- StyleRule -----

async def test_style_rule_crud_and_revision_bump(client: AsyncClient, admin_token: str, seed_data):
    resp = await client.post(
        "/api/knowledge/style-rules",
        headers=auth_header(admin_token),
        json={
            "content": "Preserve the author's self-deprecating humor; do not flatten to formal register.",
            "category": "style",
            "language_id": seed_data["en"].id,
            "priority": 10,
        },
    )
    assert resp.status_code == 201
    rule = resp.json()
    assert rule["revision"] == 1
    assert rule["priority"] == 10
    rule_id = rule["id"]

    # Content edit bumps revision
    resp = await client.patch(
        f"/api/knowledge/style-rules/{rule_id}",
        headers=auth_header(admin_token),
        json={"content": "Preserve the author's self-deprecating humor in English translations."},
    )
    assert resp.json()["revision"] == 2

    # Priority-only edit does NOT bump revision (priority is ordering, not content)
    resp = await client.patch(
        f"/api/knowledge/style-rules/{rule_id}",
        headers=auth_header(admin_token),
        json={"priority": 5},
    )
    assert resp.json()["revision"] == 2
    assert resp.json()["priority"] == 5


async def test_style_rule_filtering_by_language(client: AsyncClient, admin_token: str, seed_data):
    await client.post(
        "/api/knowledge/style-rules",
        headers=auth_header(admin_token),
        json={"content": "english only", "language_id": seed_data["en"].id},
    )
    await client.post(
        "/api/knowledge/style-rules",
        headers=auth_header(admin_token),
        json={"content": "chinese only", "language_id": seed_data["zh"].id},
    )
    await client.post(
        "/api/knowledge/style-rules",
        headers=auth_header(admin_token),
        json={"content": "universal"},  # no language_id → applies to all
    )

    resp = await client.get(
        f"/api/knowledge/style-rules?language_id={seed_data['en'].id}",
        headers=auth_header(admin_token),
    )
    rules = resp.json()
    contents = {r["content"] for r in rules}
    assert contents == {"english only", "universal"}


# ----- GoldenExample -----

async def test_golden_example_crud(client: AsyncClient, admin_token: str, seed_data):
    resp = await client.post(
        "/api/knowledge/golden-examples",
        headers=auth_header(admin_token),
        json={
            "source_text": "師尊說：",
            "translated_text": "Grand Master said:",
            "language_id": seed_data["en"].id,
            "notes": "Standard opening for dharma talks.",
        },
    )
    assert resp.status_code == 201
    ex = resp.json()
    assert ex["revision"] == 1
    ex_id = ex["id"]

    # Edit translated_text bumps revision
    resp = await client.patch(
        f"/api/knowledge/golden-examples/{ex_id}",
        headers=auth_header(admin_token),
        json={"translated_text": "The Grand Master said:"},
    )
    assert resp.json()["revision"] == 2
    assert resp.json()["translated_text"] == "The Grand Master said:"

    # Confirming (confirmed_by) does not bump revision (metadata only)
    resp = await client.patch(
        f"/api/knowledge/golden-examples/{ex_id}",
        headers=auth_header(admin_token),
        json={"confirmed_by": 1},
    )
    assert resp.json()["revision"] == 2


async def test_golden_example_requires_language(client: AsyncClient, admin_token: str):
    resp = await client.post(
        "/api/knowledge/golden-examples",
        headers=auth_header(admin_token),
        json={"source_text": "x", "translated_text": "y"},
    )
    assert resp.status_code == 422
