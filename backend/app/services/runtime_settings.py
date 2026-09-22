"""Shared process settings hydration for web and worker startup."""

import os

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.setting import Setting


def _apply_to_env(key: str, value: str) -> None:
    """Push a setting into the process environment so LiteLLM picks it up."""
    if value:
        os.environ[key] = value
    elif key in os.environ:
        del os.environ[key]


async def load_settings_into_env(db: AsyncSession) -> None:
    """Called on startup to hydrate os.environ from the DB."""
    result = await db.execute(select(Setting))
    for setting in result.scalars().all():
        if setting.value:
            _apply_to_env(setting.key, setting.value)
