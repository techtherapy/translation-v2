"""Tests for role-based permission enforcement."""

import pytest
from tests.conftest import auth_header


@pytest.mark.anyio
async def test_translator_cannot_create_book(client, translator_token):
    """Translator should not have books.create permission by default."""
    resp = await client.post(
        "/api/books",
        json={"title_source": "測試", "title_translated": "Test"},
        headers=auth_header(translator_token),
    )
    assert resp.status_code == 403


@pytest.mark.anyio
async def test_translator_cannot_delete_glossary_term(client, admin_token, translator_token):
    """Translator should not have glossary.delete permission by default."""
    # First create a term as admin
    create_resp = await client.post(
        "/api/glossary",
        json={"source_term": "佛", "translations": []},
        headers=auth_header(admin_token),
    )
    assert create_resp.status_code == 200
    term_id = create_resp.json()["id"]

    # Translator tries to delete
    resp = await client.delete(
        f"/api/glossary/{term_id}",
        headers=auth_header(translator_token),
    )
    assert resp.status_code == 403


@pytest.mark.anyio
async def test_translator_can_create_glossary_term(client, translator_token):
    """Translator should have glossary.create permission by default."""
    resp = await client.post(
        "/api/glossary",
        json={"source_term": "法", "translations": []},
        headers=auth_header(translator_token),
    )
    assert resp.status_code == 200


@pytest.mark.anyio
async def test_reviewer_cannot_create_book(client, reviewer_token):
    """Reviewer should not have books.create permission."""
    resp = await client.post(
        "/api/books",
        json={"title_source": "測試", "title_translated": "Test"},
        headers=auth_header(reviewer_token),
    )
    assert resp.status_code == 403


@pytest.mark.anyio
async def test_reviewer_cannot_create_glossary_term(client, reviewer_token):
    """Reviewer should not have glossary.create permission by default."""
    resp = await client.post(
        "/api/glossary",
        json={"source_term": "僧", "translations": []},
        headers=auth_header(reviewer_token),
    )
    assert resp.status_code == 403


@pytest.mark.anyio
async def test_admin_can_create_book(client, admin_token):
    """Admin should have all permissions."""
    resp = await client.post(
        "/api/books",
        json={"title_source": "測試書", "title_translated": "Test Book"},
        headers=auth_header(admin_token),
    )
    assert resp.status_code == 200


@pytest.mark.anyio
async def test_admin_can_read_permissions(client, admin_token):
    """Admin can read the permissions configuration."""
    resp = await client.get(
        "/api/settings/permissions",
        headers=auth_header(admin_token),
    )
    assert resp.status_code == 200
    data = resp.json()
    assert "groups" in data
    assert "role_permissions" in data
    assert "admin" in data["role_permissions"]


@pytest.mark.anyio
async def test_translator_can_read_permissions(client, translator_token):
    """All authenticated users can read permissions (for frontend UI)."""
    resp = await client.get(
        "/api/settings/permissions",
        headers=auth_header(translator_token),
    )
    assert resp.status_code == 200


@pytest.mark.anyio
async def test_admin_can_update_permissions(client, admin_token):
    """Admin can update role permissions."""
    resp = await client.put(
        "/api/settings/permissions",
        json={
            "role_permissions": {
                "admin": [],  # Will be overridden to all
                "translator": ["books.create", "glossary.create", "translations.edit"],
                "reviewer": ["translations.edit"],
            }
        },
        headers=auth_header(admin_token),
    )
    assert resp.status_code == 200
    data = resp.json()
    # Admin should still have all permissions
    assert "books.create" in data["role_permissions"]["admin"]
    # Translator should have the updated permissions
    assert "books.create" in data["role_permissions"]["translator"]


@pytest.mark.anyio
async def test_translator_cannot_update_permissions(client, translator_token):
    """Only admin can update permissions."""
    resp = await client.put(
        "/api/settings/permissions",
        json={
            "role_permissions": {
                "translator": ["books.create", "books.delete"],
            }
        },
        headers=auth_header(translator_token),
    )
    assert resp.status_code == 403


@pytest.mark.anyio
async def test_password_change_success(client, translator_token):
    """User can change their own password with correct current password."""
    resp = await client.post(
        "/api/auth/change-password",
        json={"current_password": "translator", "new_password": "newpass123"},
        headers=auth_header(translator_token),
    )
    assert resp.status_code == 200
    assert resp.json()["ok"] is True


@pytest.mark.anyio
async def test_password_change_wrong_current(client, translator_token):
    """Password change fails with wrong current password."""
    resp = await client.post(
        "/api/auth/change-password",
        json={"current_password": "wrongpassword", "new_password": "newpass123"},
        headers=auth_header(translator_token),
    )
    assert resp.status_code == 401


@pytest.mark.anyio
async def test_admin_can_reset_user_password(client, admin_token, seed_data):
    """Admin can reset another user's password."""
    translator_id = seed_data["translator"].id
    resp = await client.post(
        f"/api/auth/users/{translator_id}/reset-password",
        json={"new_password": "resetpass123"},
        headers=auth_header(admin_token),
    )
    assert resp.status_code == 200
    assert resp.json()["ok"] is True


@pytest.mark.anyio
async def test_self_deactivation_prevented(client, admin_token, seed_data):
    """Admin cannot deactivate their own account."""
    admin_id = seed_data["admin"].id
    resp = await client.patch(
        f"/api/auth/users/{admin_id}",
        json={"is_active": False},
        headers=auth_header(admin_token),
    )
    assert resp.status_code == 400
    assert "own account" in resp.json()["detail"]
