"""Smoke test for the /health endpoint."""

import pytest
from httpx import ASGITransport, AsyncClient


@pytest.fixture()
async def bare_client():
    """Client without DB seed — just enough to hit /health."""
    from app.main import app

    async with AsyncClient(
        transport=ASGITransport(app=app),
        base_url="http://test",
    ) as ac:
        yield ac


async def test_health(bare_client: AsyncClient):
    resp = await bare_client.get("/health")
    assert resp.status_code == 200
    assert resp.json() == {"status": "ok"}
