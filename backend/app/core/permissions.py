"""Role-based permission system with configurable permissions per role.

Permissions are stored as JSON in the settings table under key ROLE_PERMISSIONS.
Admin role always has all permissions (safety net).
"""

import json

from fastapi import Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.core.database import get_db
from app.core.security import get_current_user

# All valid permission keys
PERMISSION_KEYS = [
    "books.create",
    "books.edit",
    "books.delete",
    "books.import",
    "segments.split_merge",
    "glossary.create",
    "glossary.edit",
    "glossary.delete",
    "glossary.import",
    "glossary.ai",
    "glossary.manage_structure",
    "translations.ai_translate",
    "translations.edit",
    "tm.seed",
    "settings.manage",
    "users.manage",
]

# Permission groups for the admin UI
PERMISSION_GROUPS = [
    {
        "name": "Books",
        "permissions": [
            {"key": "books.create", "label": "Create books"},
            {"key": "books.edit", "label": "Edit book metadata"},
            {"key": "books.delete", "label": "Delete books"},
            {"key": "books.import", "label": "Import DOCX content"},
        ],
    },
    {
        "name": "Segments",
        "permissions": [
            {"key": "segments.split_merge", "label": "Split and merge segments"},
        ],
    },
    {
        "name": "Glossary",
        "permissions": [
            {"key": "glossary.create", "label": "Create terms"},
            {"key": "glossary.edit", "label": "Edit terms"},
            {"key": "glossary.delete", "label": "Delete terms"},
            {"key": "glossary.import", "label": "CSV import"},
            {"key": "glossary.ai", "label": "AI autocomplete"},
            {"key": "glossary.manage_structure", "label": "Manage categories and projects"},
        ],
    },
    {
        "name": "Translations",
        "permissions": [
            {"key": "translations.ai_translate", "label": "Trigger AI translation"},
            {"key": "translations.edit", "label": "Edit translations"},
        ],
    },
    {
        "name": "Translation Memory",
        "permissions": [
            {"key": "tm.seed", "label": "Seed translation memory"},
        ],
    },
    {
        "name": "System",
        "permissions": [
            {"key": "settings.manage", "label": "Access settings"},
            {"key": "users.manage", "label": "Manage users"},
        ],
    },
]

# Default permissions per role (used when no DB entry exists)
DEFAULT_ROLE_PERMISSIONS: dict[str, list[str]] = {
    "admin": list(PERMISSION_KEYS),  # all permissions
    "translator": [
        "glossary.create",
        "glossary.edit",
        "glossary.ai",
        "translations.ai_translate",
        "translations.edit",
    ],
    "reviewer": [
        "translations.edit",
    ],
}

ROLE_PERMISSIONS_KEY = "ROLE_PERMISSIONS"


async def get_role_permissions(db: AsyncSession) -> dict[str, list[str]]:
    """Load role permissions from DB, falling back to defaults."""
    from app.models.setting import Setting

    result = await db.execute(
        select(Setting).where(Setting.key == ROLE_PERMISSIONS_KEY)
    )
    setting = result.scalar_one_or_none()

    if setting and setting.value:
        try:
            perms = json.loads(setting.value)
            # Ensure admin always has all permissions
            perms["admin"] = list(PERMISSION_KEYS)
            return perms
        except (json.JSONDecodeError, TypeError):
            pass

    return dict(DEFAULT_ROLE_PERMISSIONS)


def require_permission(*permissions: str):
    """FastAPI dependency that checks if the current user's role has
    any of the required permissions. Admin always passes."""

    async def permission_checker(
        current_user=Depends(get_current_user),
        db: AsyncSession = Depends(get_db),
    ):
        # Admin always has all permissions
        if current_user.role == "admin":
            return current_user

        role_perms = await get_role_permissions(db)
        user_perms = role_perms.get(current_user.role, [])

        if not any(p in user_perms for p in permissions):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Insufficient permissions",
            )

        return current_user

    return permission_checker
