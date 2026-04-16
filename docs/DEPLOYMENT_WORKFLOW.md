# Deployment Workflow

## Branches & Environments

| Branch | Environment | Auto-deploys to |
|--------|------------|-----------------|
| `main` | Production | Vercel (production) + Railway (production) |
| `staging` | Staging | Vercel (preview) + Railway (staging) |

## How to Develop a New Feature

### 1. Start from staging

```bash
git checkout staging
git pull origin staging
git checkout -b my-feature-name
```

### 2. Write code and commit

Work on your feature, make commits as you go.

### 3. Push and create a PR into staging

```bash
git push -u origin my-feature-name
```

Then create a Pull Request targeting the `staging` branch (not `main`).

### 4. Merge to staging

Merge the PR. This automatically deploys:
- **Frontend** → Vercel preview URL
- **Backend** → Railway staging environment

### 5. Test on staging

Verify everything works on the staging environment. Staging has its own database, so you can't break production.

### 6. Promote to production

Create a PR from `staging → main`. Merge it. This automatically deploys:
- **Frontend** → `translation-mocha-beta.vercel.app` (production)
- **Backend** → `translation-production-c3ad.up.railway.app` (production)

All existing data (translations, books, glossary, etc.) is untouched.

## Rules

- **Never push directly to `main`** — all changes go through `staging` first
- **Never write destructive migrations** — no `DROP TABLE`, `DROP COLUMN`, `DELETE FROM`, or `TRUNCATE` in `_run_migrations()`
- **New database columns must be nullable or have defaults** — so existing rows aren't affected
- **Back up the database before risky deploys** — use Railway's snapshot feature if a migration modifies existing columns

## How Data Stays Safe

Deploying new code does **not** touch the database. Your translations, books, glossary terms, and all other data remain exactly as they are.

The only thing that can change data is **database migrations** — the SQL in `backend/app/core/database.py` `_run_migrations()`. These run automatically when the backend starts up after a deploy.

Safe migrations (add only):
- `ALTER TABLE ... ADD COLUMN` — adds a new column, existing data untouched
- `CREATE TABLE` — creates a new table
- `CREATE INDEX` — adds an index

Dangerous migrations (can lose data):
- `DROP TABLE` — deletes a table and all its data
- `DROP COLUMN` — deletes a column and its data
- `ALTER COLUMN ... TYPE` — can fail or truncate data

## Vercel Environment Variables

The `VITE_API_URL` environment variable controls which backend the frontend talks to:

| Environment | Value |
|------------|-------|
| Production | `https://translation-production-c3ad.up.railway.app` |
| Preview | Railway staging URL |

These are configured in Vercel → Project Settings → Environment Variables, scoped to the appropriate environment (Production vs Preview).
