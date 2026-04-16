"""Quality-assurance endpoints."""

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.security import get_current_user
from app.models.user import User
from app.schemas.qa import GlossaryCheckRequest, GlossaryCheckResponse, QAIssue
from app.services.qa.glossary_consistency import check_glossary_consistency

router = APIRouter()


@router.post("/glossary-check", response_model=GlossaryCheckResponse)
async def glossary_check(
    data: GlossaryCheckRequest,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    """Check glossary consistency for a segment's translation."""
    issues = await check_glossary_consistency(
        data.source_text,
        data.translated_text,
        data.language_id,
        db,
    )
    return GlossaryCheckResponse(
        issues=[QAIssue(**i) for i in issues],
    )
