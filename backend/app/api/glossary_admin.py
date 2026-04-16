from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.core.database import get_db
from app.core.security import get_current_user
from app.core.permissions import require_permission
from app.models.user import User
from app.models.glossary import GlossaryCategory, GlossaryProject
from app.schemas.glossary import (
    GlossaryCategoryCreate, GlossaryCategoryUpdate, GlossaryCategoryResponse,
    GlossaryProjectCreate, GlossaryProjectUpdate, GlossaryProjectResponse,
)

router = APIRouter()


# ── Categories ──────────────────────────────────────────────

@router.get("/categories", response_model=list[GlossaryCategoryResponse])
async def list_categories(
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    result = await db.execute(
        select(GlossaryCategory).order_by(GlossaryCategory.sort_order)
    )
    return result.scalars().all()


@router.post("/categories", response_model=GlossaryCategoryResponse)
async def create_category(
    data: GlossaryCategoryCreate,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_permission("glossary.manage_structure")),
):
    # Check for duplicate key
    existing = await db.execute(
        select(GlossaryCategory).where(GlossaryCategory.key == data.key)
    )
    if existing.scalar_one_or_none():
        raise HTTPException(status_code=409, detail=f"Category '{data.key}' already exists")

    cat = GlossaryCategory(
        key=data.key,
        label=data.label,
        color=data.color,
        sort_order=data.sort_order,
        is_builtin=False,
    )
    db.add(cat)
    await db.flush()
    await db.refresh(cat)
    return cat


@router.patch("/categories/{key}", response_model=GlossaryCategoryResponse)
async def update_category(
    key: str,
    data: GlossaryCategoryUpdate,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_permission("glossary.manage_structure")),
):
    result = await db.execute(
        select(GlossaryCategory).where(GlossaryCategory.key == key)
    )
    cat = result.scalar_one_or_none()
    if not cat:
        raise HTTPException(status_code=404, detail="Category not found")

    update_data = data.model_dump(exclude_unset=True)
    for k, v in update_data.items():
        setattr(cat, k, v)

    await db.flush()
    await db.refresh(cat)
    return cat


@router.delete("/categories/{key}")
async def delete_category(
    key: str,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_permission("glossary.manage_structure")),
):
    result = await db.execute(
        select(GlossaryCategory).where(GlossaryCategory.key == key)
    )
    cat = result.scalar_one_or_none()
    if not cat:
        raise HTTPException(status_code=404, detail="Category not found")

    await db.delete(cat)
    return {"ok": True}


# ── Projects ────────────────────────────────────────────────

@router.get("/projects", response_model=list[GlossaryProjectResponse])
async def list_projects(
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    result = await db.execute(
        select(GlossaryProject).order_by(GlossaryProject.name)
    )
    return result.scalars().all()


@router.post("/projects", response_model=GlossaryProjectResponse)
async def create_project(
    data: GlossaryProjectCreate,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_permission("glossary.manage_structure")),
):
    existing = await db.execute(
        select(GlossaryProject).where(GlossaryProject.name == data.name)
    )
    if existing.scalar_one_or_none():
        raise HTTPException(status_code=409, detail=f"Project '{data.name}' already exists")

    project = GlossaryProject(
        name=data.name,
        description=data.description,
        is_active=data.is_active,
    )
    db.add(project)
    await db.flush()
    await db.refresh(project)
    return project


@router.patch("/projects/{project_id}", response_model=GlossaryProjectResponse)
async def update_project(
    project_id: int,
    data: GlossaryProjectUpdate,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_permission("glossary.manage_structure")),
):
    result = await db.execute(
        select(GlossaryProject).where(GlossaryProject.id == project_id)
    )
    project = result.scalar_one_or_none()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    update_data = data.model_dump(exclude_unset=True)

    # Check unique name if being changed
    if "name" in update_data and update_data["name"] != project.name:
        dup = await db.execute(
            select(GlossaryProject).where(GlossaryProject.name == update_data["name"])
        )
        if dup.scalar_one_or_none():
            raise HTTPException(status_code=409, detail=f"Project '{update_data['name']}' already exists")

    for k, v in update_data.items():
        setattr(project, k, v)

    await db.flush()
    await db.refresh(project)
    return project


@router.delete("/projects/{project_id}")
async def delete_project(
    project_id: int,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_permission("glossary.manage_structure")),
):
    result = await db.execute(
        select(GlossaryProject).where(GlossaryProject.id == project_id)
    )
    project = result.scalar_one_or_none()
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    await db.delete(project)
    return {"ok": True}
