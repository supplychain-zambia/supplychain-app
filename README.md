# SCSP: Supply Chain Strengthening Platform

Pilot scaffold: Muchinga province. TypeScript monorepo (React PWA, Netlify Functions API, PostgreSQL).

## Layout
- `apps/web` React PWA shell
- `netlify/functions/api.ts` API (Hono): health, `/api/me`, idempotent `/api/sync/events`
- `packages/rules` AMC, months of stock, status, order quantity (SOP rules, with golden tests)
- `packages/schema` Zod schemas shared by client and server
- `db/migrations` versioned SQL, `db/migrate.ts` runner
- `tests/rls.test.ts` proves one district cannot read or write another's data
- `.github/workflows` CI and nightly encrypted backup

## First-time setup
1. `npm install`
2. Copy `.env.example` to `.env` and fill it in (never commit it).
3. `npm run migrate` (uses `DATABASE_URL_DIRECT`).
4. `npm test` (set `TEST_DATABASE_URL` to also run the database tests, against a throwaway database).
5. Local run: `npx netlify dev`.

## Netlify environment variables
`DATABASE_URL` (pooled), `JWT_SECRET` (32+ random characters), `JWT_ISSUER` (optional, default `scsp`).

## GitHub secrets (for the backup workflow)
`DATABASE_URL_DIRECT`, `BACKUP_PASSPHRASE`, `BACKUP_S3_KEY`, `BACKUP_S3_SECRET`, `BACKUP_S3_BUCKET`, `BACKUP_S3_ENDPOINT`.
Set a lifecycle rule on the bucket for retention, and do a restore drill before real data arrives.

## Development tokens
Login is not built yet. For staging only: `JWT_SECRET=... npx tsx scripts/dev-token.ts <userUuid> <role> <scopeOrgUnitUuid>`.

## Not built yet
Login and user management, facility capture UI with offline outbox, balance and rollup views,
reporting calendar, transfers workflow, dashboards, exports, PWA service worker.
