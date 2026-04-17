"""Phase 1 knowledge-base CRUD: ContentType, StyleRule, GoldenExample.

Mounted under /api/knowledge. Three nested routers — one per entity — keep
the URL surface flat and predictable:

    GET/POST       /api/knowledge/content-types
    GET/PATCH/DEL  /api/knowledge/content-types/{id}
    GET/POST       /api/knowledge/style-rules
    GET/PATCH/DEL  /api/knowledge/style-rules/{id}
    GET/POST       /api/knowledge/golden-examples
    GET/PATCH/DEL  /api/knowledge/golden-examples/{id}

Permissions (matches existing glossary pattern):
- GET: any authenticated user
- POST/PATCH/DELETE: admin or translator (senior-translator-authored knowledge)

Per the amended 2026-04-11 spec, every update bumps `revision` by 1 and is
treated as a NEW logical version of the entity. Historical
`PipelineSegmentResult.evidence_snapshot` references the pre-update revision,
which remains resolvable because rows are never hard-deleted via the API
(delete sets is_active=false).
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.security import get_current_user, require_role
from app.models.knowledge import ContentType, GoldenExample, StyleRule
from app.models.user import User
from app.schemas.knowledge import (
    ContentTypeCreate,
    ContentTypeResponse,
    ContentTypeUpdate,
    GoldenExampleCreate,
    GoldenExampleResponse,
    GoldenExampleUpdate,
    StyleRuleCreate,
    StyleRuleResponse,
    StyleRuleUpdate,
)

router = APIRouter()


# ----- ContentType -----

content_type_router = APIRouter()


@content_type_router.get("", response_model=list[ContentTypeResponse])
async def list_content_types(
    include_inactive: bool = False,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    q = select(ContentType).order_by(ContentType.name)
    if not include_inactive:
        q = q.where(ContentType.is_active.is_(True))
    result = await db.execute(q)
    return result.scalars().all()


@content_type_router.post("", response_model=ContentTypeResponse, status_code=201)
async def create_content_type(
    data: ContentTypeCreate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_role("admin", "translator")),
):
    existing = await db.execute(select(ContentType).where(ContentType.name == data.name))
    if existing.scalar_one_or_none():
        raise HTTPException(status_code=409, detail="Content type with that name already exists")
    row = ContentType(name=data.name, description=data.description, created_by=user.id)
    db.add(row)
    await db.flush()
    await db.refresh(row)
    return row


@content_type_router.patch("/{content_type_id}", response_model=ContentTypeResponse)
async def update_content_type(
    content_type_id: int,
    data: ContentTypeUpdate,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_role("admin", "translator")),
):
    result = await db.execute(select(ContentType).where(ContentType.id == content_type_id))
    row = result.scalar_one_or_none()
    if row is None:
        raise HTTPException(status_code=404, detail="Content type not found")

    updates = data.model_dump(exclude_unset=True)
    # Bump revision only if a content-bearing field actually changed.
    content_bearing = {"name", "description"}
    if any(k in updates and getattr(row, k) != v for k, v in updates.items() if k in content_bearing):
        row.revision += 1
    for key, value in updates.items():
        setattr(row, key, value)
    await db.flush()
    await db.refresh(row)
    return row


@content_type_router.delete("/{content_type_id}", status_code=204)
async def deactivate_content_type(
    content_type_id: int,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_role("admin", "translator")),
):
    # Soft-delete only — historical evidence_snapshot references must remain resolvable.
    result = await db.execute(select(ContentType).where(ContentType.id == content_type_id))
    row = result.scalar_one_or_none()
    if row is None:
        raise HTTPException(status_code=404, detail="Content type not found")
    row.is_active = False
    await db.flush()
    return None


# ----- StyleRule -----

style_rule_router = APIRouter()


@style_rule_router.get("", response_model=list[StyleRuleResponse])
async def list_style_rules(
    language_id: int | None = None,
    content_type_id: int | None = None,
    include_inactive: bool = False,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    q = select(StyleRule).order_by(StyleRule.priority, StyleRule.id)
    if not include_inactive:
        q = q.where(StyleRule.is_active.is_(True))
    if language_id is not None:
        q = q.where((StyleRule.language_id == language_id) | (StyleRule.language_id.is_(None)))
    if content_type_id is not None:
        q = q.where((StyleRule.content_type_id == content_type_id) | (StyleRule.content_type_id.is_(None)))
    result = await db.execute(q)
    return result.scalars().all()


@style_rule_router.post("", response_model=StyleRuleResponse, status_code=201)
async def create_style_rule(
    data: StyleRuleCreate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_role("admin", "translator")),
):
    row = StyleRule(**data.model_dump(), created_by=user.id)
    db.add(row)
    await db.flush()
    await db.refresh(row)
    return row


@style_rule_router.patch("/{rule_id}", response_model=StyleRuleResponse)
async def update_style_rule(
    rule_id: int,
    data: StyleRuleUpdate,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_role("admin", "translator")),
):
    result = await db.execute(select(StyleRule).where(StyleRule.id == rule_id))
    row = result.scalar_one_or_none()
    if row is None:
        raise HTTPException(status_code=404, detail="Style rule not found")

    updates = data.model_dump(exclude_unset=True)
    content_bearing = {"content", "category", "content_type_id", "language_id"}
    if any(k in updates and getattr(row, k) != v for k, v in updates.items() if k in content_bearing):
        row.revision += 1
    for key, value in updates.items():
        setattr(row, key, value)
    await db.flush()
    await db.refresh(row)
    return row


@style_rule_router.delete("/{rule_id}", status_code=204)
async def deactivate_style_rule(
    rule_id: int,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_role("admin", "translator")),
):
    result = await db.execute(select(StyleRule).where(StyleRule.id == rule_id))
    row = result.scalar_one_or_none()
    if row is None:
        raise HTTPException(status_code=404, detail="Style rule not found")
    row.is_active = False
    await db.flush()
    return None


# ----- GoldenExample -----

golden_example_router = APIRouter()


@golden_example_router.get("", response_model=list[GoldenExampleResponse])
async def list_golden_examples(
    language_id: int | None = None,
    content_type_id: int | None = None,
    include_inactive: bool = False,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    q = select(GoldenExample).order_by(GoldenExample.id)
    if not include_inactive:
        q = q.where(GoldenExample.is_active.is_(True))
    if language_id is not None:
        q = q.where(GoldenExample.language_id == language_id)
    if content_type_id is not None:
        q = q.where((GoldenExample.content_type_id == content_type_id) | (GoldenExample.content_type_id.is_(None)))
    result = await db.execute(q)
    return result.scalars().all()


@golden_example_router.post("", response_model=GoldenExampleResponse, status_code=201)
async def create_golden_example(
    data: GoldenExampleCreate,
    db: AsyncSession = Depends(get_db),
    user: User = Depends(require_role("admin", "translator")),
):
    row = GoldenExample(**data.model_dump(), nominated_by=user.id)
    db.add(row)
    await db.flush()
    await db.refresh(row)
    return row


@golden_example_router.patch("/{example_id}", response_model=GoldenExampleResponse)
async def update_golden_example(
    example_id: int,
    data: GoldenExampleUpdate,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_role("admin", "translator")),
):
    result = await db.execute(select(GoldenExample).where(GoldenExample.id == example_id))
    row = result.scalar_one_or_none()
    if row is None:
        raise HTTPException(status_code=404, detail="Golden example not found")

    updates = data.model_dump(exclude_unset=True)
    content_bearing = {"source_text", "translated_text", "notes"}
    if any(k in updates and getattr(row, k) != v for k, v in updates.items() if k in content_bearing):
        row.revision += 1
    for key, value in updates.items():
        setattr(row, key, value)
    await db.flush()
    await db.refresh(row)
    return row


@golden_example_router.delete("/{example_id}", status_code=204)
async def deactivate_golden_example(
    example_id: int,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_role("admin", "translator")),
):
    result = await db.execute(select(GoldenExample).where(GoldenExample.id == example_id))
    row = result.scalar_one_or_none()
    if row is None:
        raise HTTPException(status_code=404, detail="Golden example not found")
    row.is_active = False
    await db.flush()
    return None


router.include_router(content_type_router, prefix="/content-types", tags=["knowledge"])
router.include_router(style_rule_router, prefix="/style-rules", tags=["knowledge"])
router.include_router(golden_example_router, prefix="/golden-examples", tags=["knowledge"])
