"""Web and worker startup must hydrate the same DB credentials as settings writes."""

import os

from sqlalchemy.ext.asyncio import async_sessionmaker

from app.models.setting import Setting


async def test_startup_hydration_is_shared_by_web_and_worker(db_session, monkeypatch):
    from app import main
    from app.services import runtime_settings
    from app.worker.config import WorkerSettings

    factory = async_sessionmaker(db_session.bind, expire_on_commit=False)
    monkeypatch.setattr(main, "async_session", factory)
    db_session.add_all(
        [
            Setting(key="ANTHROPIC_API_KEY", value="fake-startup-key"),
            Setting(key="CHINESE_FONT", value="test-font"),
            Setting(key="EMPTY_TEST_SETTING", value=""),
        ]
    )
    await db_session.commit()
    monkeypatch.setenv("ANTHROPIC_API_KEY", "old")
    monkeypatch.setenv("CHINESE_FONT", "old")
    monkeypatch.setenv("EMPTY_TEST_SETTING", "preserved-existing-behavior")
    await main._load_settings()
    assert os.environ["ANTHROPIC_API_KEY"] == "fake-startup-key"
    assert os.environ["CHINESE_FONT"] == "test-font"
    assert os.environ["EMPTY_TEST_SETTING"] == "preserved-existing-behavior"
    monkeypatch.setenv("ANTHROPIC_API_KEY", "old")
    await WorkerSettings.on_startup({"session_factory": factory})
    assert os.environ["ANTHROPIC_API_KEY"] == "fake-startup-key"
    runtime_settings._apply_to_env("ANTHROPIC_API_KEY", "")
    assert "ANTHROPIC_API_KEY" not in os.environ


async def test_settings_writer_preserves_masking_clear_unknown_and_admin_rules(
    client, admin_token, reviewer_token, monkeypatch
):
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)
    auth = {"Authorization": "Bearer " + admin_token}

    async def put(value):
        return await client.put(
            "/api/settings",
            headers=auth,
            json={"settings": [{"key": "OPENAI_API_KEY", "value": value}, {"key": "IGNORED_FAKE_KEY", "value": "no"}]},
        )

    saved = await put("fake-test-key")
    assert saved.status_code == 200
    assert os.environ["OPENAI_API_KEY"] == "fake-test-key"
    assert "IGNORED_FAKE_KEY" not in os.environ
    assert "fake-test-key" not in saved.text
    await put("••••unchanged")
    assert os.environ["OPENAI_API_KEY"] == "fake-test-key"
    await put("")
    assert "OPENAI_API_KEY" not in os.environ
    denied = await client.put(
        "/api/settings",
        headers={"Authorization": "Bearer " + reviewer_token},
        json={"settings": [{"key": "OPENAI_API_KEY", "value": "no"}]},
    )
    assert denied.status_code == 403
