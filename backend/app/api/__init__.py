from fastapi import APIRouter

from app.api.auth import router as auth_router
from app.api.books import router as books_router
from app.api.glossary import router as glossary_router
from app.api.glossary_admin import router as glossary_admin_router
from app.api.translate import router as translate_router
from app.api.tm import router as tm_router
from app.api.languages import router as languages_router
from app.api.settings import router as settings_router
from app.api.qa import router as qa_router
from app.api.book_translations import router as book_translations_router
from app.api.comments import router as comments_router

api_router = APIRouter(prefix="/api")

api_router.include_router(auth_router, prefix="/auth", tags=["auth"])
api_router.include_router(languages_router, prefix="/languages", tags=["languages"])
api_router.include_router(books_router, prefix="/books", tags=["books"])
api_router.include_router(book_translations_router, prefix="/book-translations", tags=["book-translations"])
api_router.include_router(glossary_admin_router, prefix="/glossary", tags=["glossary-admin"])
api_router.include_router(glossary_router, prefix="/glossary", tags=["glossary"])
api_router.include_router(translate_router, prefix="/translate", tags=["translate"])
api_router.include_router(tm_router, prefix="/tm", tags=["translation-memory"])
api_router.include_router(settings_router, prefix="/settings", tags=["settings"])
api_router.include_router(qa_router, prefix="/qa", tags=["qa"])
api_router.include_router(comments_router, prefix="/comments", tags=["comments"])
