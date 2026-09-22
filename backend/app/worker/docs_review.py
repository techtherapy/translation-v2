"""Durable single-call Docs review jobs. No Google API or manuscript writer is used."""

import asyncio
import math
import os
import secrets
from copy import deepcopy
from datetime import UTC, datetime, timedelta
from decimal import Decimal, InvalidOperation

from arq import create_pool
from arq.connections import RedisSettings
from arq.constants import result_key_prefix
from fastapi import HTTPException
from sqlalchemy import select, update

from app.core.config import get_settings
from app.core.database import async_session
from app.models.docs_review import DocsReviewItem, DocsReviewRun, DocsReviewSnapshot
from app.models.setting import Setting
from app.services.docs_review import repository as repo
from app.services.docs_review.assessment import AssessmentError, assess_snapshot, freeze_completion_options
from app.services.docs_review.prompts import PROMPT_VERSION, build_messages
from app.services.docs_review.sampling import select_audit
from app.services.translation.llm import _ensure_provider_prefix

PROVIDER_KEYS = {
    "anthropic": "ANTHROPIC_API_KEY",
    "openai": "OPENAI_API_KEY",
    "deepseek": "DEEPSEEK_API_KEY",
    "gemini": "GOOGLE_API_KEY",
}
QUEUE_WAIT_SECONDS = 300


def preflight(bundle):
    """Reserve the configured maxima, not an optimistic expected response length."""
    settings = get_settings()
    if "completion_options" not in bundle:
        raise AssessmentError("completion_options_missing")
    if not settings.docs_review_enabled or not settings.docs_review_live_ai:
        raise AssessmentError("live_review_disabled")
    if not bundle["model"] or bundle["provider"] not in PROVIDER_KEYS:
        raise AssessmentError("provider_not_configured")
    if not os.environ.get(PROVIDER_KEYS[bundle["provider"]], "").strip():
        raise AssessmentError("provider_not_configured")
    if (
        not settings.docs_review_account_spend_limit_confirmed
        or not math.isfinite(settings.docs_review_account_spend_limit_usd)
        or settings.docs_review_account_spend_limit_usd <= 0
    ):
        raise AssessmentError("account_spend_limit_required")
    limits = bundle["limits"]
    if not limits or any(limits.get(k) is None for k in ("max_input_tokens", "max_output_tokens", "max_cost_usd")):
        raise AssessmentError("explicit_limits_required")
    if (
        limits["max_input_tokens"] > settings.docs_review_max_input_tokens
        or limits["max_output_tokens"] > settings.docs_review_max_output_tokens
        or not math.isfinite(limits["max_cost_usd"])
        or limits["max_cost_usd"] > settings.docs_review_max_cost_usd
    ):
        raise AssessmentError("pilot_limit_exceeded")
    # A conservative UTF-8 byte bound plus message overhead avoids tokenizer downloads
    # and refuses large chapters without silently truncating source or guidance.
    upper_bound = sum(len(m["content"].encode("utf-8")) for m in bundle["messages"]) + 256
    if upper_bound > limits["max_input_tokens"]:
        raise AssessmentError("input_limit_exceeded")
    price = bundle["price_schedule"]
    if not price or not price.get("id"):
        raise AssessmentError("unknown_price")
    rates = [price.get("input_per_million"), price.get("output_per_million")]
    if any(type(v) not in (int, float) or not math.isfinite(v) or v < 0 for v in rates):
        raise AssessmentError("unknown_price")
    reserve = (limits["max_input_tokens"] * rates[0] + limits["max_output_tokens"] * rates[1]) / 1_000_000
    if reserve > min(limits["max_cost_usd"], settings.docs_review_account_spend_limit_usd):
        raise AssessmentError("cost_limit_exceeded")
    return reserve


async def reserve_pilot_budget(db, amount, frozen_cap):
    """Serialize all pilot reservations, including ambiguous calls, across processes.

    This conservative lifetime ledger is never automatically refunded. The provider's
    separately configured account cap remains authoritative for actual billing.
    """
    if db.bind.dialect.name == "postgresql":
        from sqlalchemy.dialects.postgresql import insert
    else:
        from sqlalchemy.dialects.sqlite import insert
    key = "DOCS_REVIEW_PILOT_RESERVED_USD"
    await db.execute(insert(Setting).values(key=key, value="0").on_conflict_do_nothing(index_elements=["key"]))
    # UPDATE also reserves SQLite's writer lock; FOR UPDATE alone is ignored there.
    await db.execute(update(Setting).where(Setting.key == key).values(value=Setting.value))
    ledger = await db.scalar(select(Setting).where(Setting.key == key).with_for_update())
    try:
        used = Decimal(ledger.value)
        if not used.is_finite() or used < 0:
            raise InvalidOperation
    except InvalidOperation as exc:
        raise AssessmentError("account_budget_unavailable") from exc
    total = used + Decimal(str(amount))
    cap = min(Decimal(str(frozen_cap)), Decimal(str(get_settings().docs_review_account_spend_limit_usd)))
    if total > cap:
        raise AssessmentError("account_budget_exhausted")
    ledger.value = str(total)
    await db.flush()


async def create_queue():
    return await create_pool(RedisSettings.from_dsn(get_settings().redis_url))


async def reconcile_run(db, run):
    """Turn lost dispatches into visible retries and lost paid calls into terminal interruptions."""
    now = datetime.now(UTC)
    for previous, state, code in (
        ("queued", "pending_enqueue", "queue_confirmation_expired"),
        ("running", "interrupted", "provider_completion_unknown"),
    ):
        await db.execute(
            update(DocsReviewRun)
            .where(
                DocsReviewRun.id == run.id,
                DocsReviewRun.status == previous,
                DocsReviewRun.lease_expires_at <= now,
            )
            .values(status=state, error_code=code, lease_expires_at=None)
            .execution_options(synchronize_session=False)
        )
    await db.commit()
    await db.refresh(run)
    return run


async def enqueue_run(db, run, *, queue=None):
    await reconcile_run(db, run)
    if run.status != "pending_enqueue":
        return run
    own_queue = queue is None
    try:
        queue = queue or await create_queue()
        job_id = "docs-review:" + run.id
        job = await queue.enqueue_job("review_docs_snapshot", run.id, _job_id=job_id)
        if job is None and await queue.exists(result_key_prefix + job_id):
            # A pre-lease failure can leave a retained ARQ result while the DB run
            # is still retryable. The DB owns completion evidence, so evict only
            # this redundant terminal cache entry and retry the same job ID.
            await queue.delete(result_key_prefix + job_id)
            job = await queue.enqueue_job("review_docs_snapshot", run.id, _job_id=job_id)
    except Exception:
        # A dispatch could have reached Redis despite a lost response. Worker acquisition
        # is conditional, so retrying this deterministic ID cannot cause another call.
        await db.execute(
            update(DocsReviewRun)
            .where(
                DocsReviewRun.id == run.id,
                DocsReviewRun.status == "pending_enqueue",
            )
            .values(error_code="queue_unavailable")
            .execution_options(synchronize_session=False)
        )
    else:
        await db.execute(
            update(DocsReviewRun)
            .where(
                DocsReviewRun.id == run.id,
                DocsReviewRun.status == "pending_enqueue",
            )
            .values(
                status="queued" if job is not None else "pending_enqueue",
                error_code=None if job is not None else "queue_delivery_unconfirmed",
                lease_expires_at=(datetime.now(UTC) + timedelta(seconds=QUEUE_WAIT_SECONDS))
                if job is not None
                else None,
            )
            .execution_options(synchronize_session=False)
        )
    finally:
        await db.commit()
        if own_queue and queue is not None:
            await queue.aclose()
    await db.refresh(run)
    return run


async def create_live_run(db, owner_id, project_id, request, *, queue=None):
    project = await repo.get_project(db, owner_id, project_id, lock=True)
    if not get_settings().docs_review_live_ai:
        raise HTTPException(409, "Live review is disabled")
    existing = await repo._retry(db, DocsReviewRun, project_id, request.model_dump())
    if existing is not None:
        return await reconcile_run(db, existing)
    snapshot = await repo.get_record(db, owner_id, project_id, DocsReviewSnapshot, request.snapshot_id)
    if snapshot.suggestions_pending:
        raise HTTPException(409, "Resolve native suggestions before starting a review")
    model = _ensure_provider_prefix(request.model) if request.model else None
    provider = (
        model.split("/", 1)[0]
        if model and "/" in model
        else ("openai" if model and model.startswith(("gpt-", "o1", "o3", "o4", "chatgpt-")) else None)
    )
    bundle = dict(
        source_text=project.source_text,
        source_language=project.source_language,
        target_language=project.target_language,
        target_blocks=deepcopy(snapshot.blocks),
        guidance=[g.model_dump() for g in request.guidance],
        model=model,
        provider=provider,
        limits=request.limits.model_dump() if request.limits else None,
        price_schedule=deepcopy(get_settings().docs_review_price_schedules.get(model)),
        prompt_version=PROMPT_VERSION,
        audit_seed=secrets.randbits(53),
        audit_count=3,
        account_spend_limit_usd=get_settings().docs_review_account_spend_limit_usd,
    )
    bundle["messages"] = build_messages(bundle)
    bundle["completion_options"] = freeze_completion_options(bundle)
    run = await repo.create_run(db, owner_id, project_id, request, input_bundle=bundle)
    try:
        preflight(bundle)
    except AssessmentError as exc:
        run.status, run.error_code, run.usage = "failed", exc.code, {"provider_calls": 0}
    else:
        run.status = "pending_enqueue"
    # Commit the frozen record before any queue operation.
    await db.commit()
    return await enqueue_run(db, run, queue=queue) if run.status == "pending_enqueue" else run


def stored_result(run):
    return {"run_id": run.id, "status": run.status, "validated_result": deepcopy(run.validated_result)}


async def review_docs_snapshot(ctx, run_id):
    factory = ctx.get("session_factory", async_session)
    async with factory() as db:
        run = await db.get(DocsReviewRun, run_id)
        if run is None:
            return {"run_id": run_id, "status": "not_found"}
        await reconcile_run(db, run)
        if run.mode != "live" or run.status not in {"queued", "pending_enqueue"}:
            return stored_result(run)
        try:
            reserved = preflight(run.input_bundle)
        except AssessmentError as exc:
            await db.execute(
                update(DocsReviewRun)
                .where(
                    DocsReviewRun.id == run_id,
                    DocsReviewRun.status.in_(["queued", "pending_enqueue"]),
                )
                .values(status="failed", error_code=exc.code, usage={"provider_calls": 0}, lease_expires_at=None)
                .execution_options(synchronize_session=False)
            )
            await db.commit()
            await db.refresh(run)
            return stored_result(run)
        lease = datetime.now(UTC) + timedelta(seconds=run.input_bundle["completion_options"]["timeout"] + 60)
        usage = {"reserved_cost_usd": reserved, "provider_calls": 1}
        acquired = await db.execute(
            update(DocsReviewRun)
            .where(
                DocsReviewRun.id == run_id,
                DocsReviewRun.status.in_(["queued", "pending_enqueue"]),
            )
            .values(status="running", error_code=None, lease_expires_at=lease, usage=usage)
            .execution_options(synchronize_session=False)
        )
        if not acquired.rowcount:
            await db.commit()
            await db.refresh(run)
            return stored_result(run)
        try:
            await reserve_pilot_budget(db, reserved, run.input_bundle["account_spend_limit_usd"])
        except AssessmentError as exc:
            await db.execute(
                update(DocsReviewRun)
                .where(DocsReviewRun.id == run_id)
                .values(
                    status="failed",
                    error_code=exc.code,
                    lease_expires_at=None,
                    usage={"provider_calls": 0},
                )
                .execution_options(synchronize_session=False)
            )
            await db.commit()
            await db.refresh(run)
            return stored_result(run)
        await db.commit()
        bundle = deepcopy(run.input_bundle)
    # No transaction is held open across the external call.
    items, raw, result, error, status = [], None, None, None, "succeeded"
    try:
        response = await assess_snapshot(bundle, ctx.get("completion_client"))
        raw, result = response["raw_response"], response["validated_result"]
        usage.update(response["usage"])
        findings = result["findings"]
        flagged = {s["block_id"] for f in findings for s in f["target_spans"]}
        blocks = {b["block_id"]: b["text"] for b in bundle["target_blocks"] if b["text"].strip()}
        population = sorted(set(blocks) - flagged)
        sampled = select_audit(population, flagged, bundle["audit_count"], bundle["audit_seed"])
        result["audit"] = dict(
            population=population,
            seed=bundle["audit_seed"],
            requested_count=bundle["audit_count"],
            count=len(sampled),
            selected_ids=sampled,
        )
        result["unflagged_status"] = "unreviewed"
        items = [dict(kind="finding", **f) for f in findings]
        items.extend(
            dict(
                kind="audit",
                category=None,
                proposed_severity=None,
                source_spans=[dict(block_id="source", quote=bundle["source_text"], occurrence=0)],
                target_spans=[dict(block_id=bid, quote=blocks[bid], occurrence=0)],
                explanation="Random audit: compare this passage with the full source chapter. Still unreviewed.",
                evidence_ids=[],
                proposed_correction=None,
            )
            for bid in sampled
        )
    except AssessmentError as exc:
        raw, error = exc.raw_response, exc.code
        usage.update(exc.usage)
        status = "interrupted" if exc.ambiguous else "failed"
    except asyncio.CancelledError:
        status, error = "interrupted", "provider_completion_unknown"
    async with factory() as db:
        # Final write is a compare-and-set on the paid-call lease. A reader may already
        # have interrupted this run; late output must never resurrect it.
        saved = await db.execute(
            update(DocsReviewRun)
            .where(
                DocsReviewRun.id == run_id,
                DocsReviewRun.status == "running",
                DocsReviewRun.lease_expires_at == lease,
                DocsReviewRun.lease_expires_at > datetime.now(UTC),
            )
            .values(
                status=status,
                error_code=error,
                lease_expires_at=None,
                raw_response=raw,
                validated_result=result,
                usage=usage,
            )
            .execution_options(synchronize_session=False)
        )
        if saved.rowcount:
            db.add_all(DocsReviewItem(run_id=run_id, **item) for item in items)
        await db.commit()
        stored = await db.get(DocsReviewRun, run_id)
        await reconcile_run(db, stored)
        if not saved.rowcount and raw is not None:
            # Retain late evidence privately without changing an interrupted outcome,
            # attaching findings, or touching the checkpoint being reviewed.
            await db.execute(
                update(DocsReviewRun)
                .where(
                    DocsReviewRun.id == run_id,
                    DocsReviewRun.status == "interrupted",
                    DocsReviewRun.raw_response.is_(None),
                )
                .values(raw_response=raw, usage={**usage, "late_response": True})
                .execution_options(synchronize_session=False)
            )
            await db.commit()
            await db.refresh(stored)
        return stored_result(stored)
