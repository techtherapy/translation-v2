# ARQ worker (spike)

Proof-of-concept background-job worker for the future translation pipeline.
This answers Appendix C item 1 of the 2026-04-11 spec by demonstration:
**ARQ is the default choice** because the stack already runs async FastAPI
with Redis, and ARQ is the lightest async-native option that does not
require a second stack for sync workers.

## Running locally

```bash
# Terminal 1: redis (docker-compose provides this)
docker compose up redis

# Terminal 2: arq worker
cd backend
arq app.worker.config.WorkerSettings
```

## Enqueuing a job

```python
from arq.connections import create_pool
from app.worker.config import _redis_settings

pool = await create_pool(_redis_settings())
job = await pool.enqueue_job("translate_chapter_spike", chapter_id=1, language_id=1)
result = await job.result(timeout=60)  # wait up to 60s
```

## Deployment

Railway runs a single web service. A separate service will need to be added
to run the worker (same Dockerfile, different start command:
`arq app.worker.config.WorkerSettings`).

## Next steps (Phase 2, not this spike)

- Replace `translate_chapter_spike` with a real pipeline task that wires
  up layered context assembly, LLM call via LiteLLM, self-assessment, and
  `PipelineSegmentResult` write-back.
- Add idempotency: `PipelineRun.status` transitions, segment-level
  checkpointing, resume-from-last-completed-segment on worker crash.
- Add cancellation: check `PipelineRun.status == 'cancelled'` between
  segments and exit cleanly.
