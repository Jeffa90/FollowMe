# Architecture (Phase 2)

## Context
```
 Browser extension (MV3) ──bearer token(capture)──┐
 Web UI (Next.js App Router, React 19) ──cookie+CSRF──┤
 Integrations (webhooks out; SharePoint/Teams/Power Automate designed) │
                                                       ▼
                       ┌──────────────── Next.js (Node runtime) ────────────────┐
                       │ proxy.ts: CSP nonce, framing, security headers          │
                       │ src/app/api/**/route.ts → route(): authN, CSRF, rate    │
                       │        limit, zod validation, error mapping             │
                       │ src/app/(app)/** server components call services        │
                       │ src/server/services/*  ← ALL authorisation lives here   │
                       └──────┬──────────────────────┬──────────────┬───────────┘
                              │ Prisma 7 (pg adapter) │ BlobStore     │ Job queue
                              ▼                       ▼               ▼
                       PostgreSQL 16          local disk | S3        `Job` table (SKIP LOCKED)
                       (FTS, triggers)        (+AES-256-GCM)         worker: npm run worker
```

## Layers and rules
1. **`src/lib/*`** – pure, isomorphic code: guide schema (zod), step operations, comparison, step generation, policy helpers, templates. No I/O. Unit-tested.
2. **`src/server/services/*`** – domain services. *Every* function takes a `Ctx` (user, org, roles, clearance, sites) and enforces permission itself. Route handlers and server components are thin callers, so a new UI cannot bypass authorisation.
3. **`src/server/authz.ts`** – central predicates: `guideScope()` (Prisma filter for org/clearance/site), `canReadVersion`, `canEditContent`, `isOwnerOrAdmin`. Unknown and cross-org objects both return **404**.
4. **`src/server/http.ts`** – `route()` wrapper: session cookie *or* scoped bearer token (only on endpoints that opt in), Origin check + HMAC double-submit CSRF for cookie sessions, per-user rate limiting, zod error mapping, `Cache-Control: no-store`. A test asserts every route module uses it.
5. **PostgreSQL** is the system of record, and also enforces the invariants that must survive application bugs: immutable published versions, append-only audit/decisions, immutable assets (triggers in `prisma/migrations/*_search_and_immutability`).
6. **Async work** (`src/server/jobs.ts`): `import.process`, `webhook.deliver`, `health.scan`, `retention.sweep`. `JOBS_INLINE=true` (dev) drains in-process; production runs `npm run worker`.

## Key flows
- **Publish:** `publishVersion` (one transaction): snapshot control record (approvals, dates, owner) → supersede previous live version → set `Guide.liveVersionId` → reindex search chunks → create urgent follow-up recommendation if needed → audit → notify; then emit webhook.
- **Read a guide:** `/g/{docId}` resolves the guide's *current live version*; historical/superseded numbers redirect unless the viewer is authorised for history.
- **Images:** raw assets are never served to learners. Readers get `/api/versions/:id/steps/:stepId/image`, rendered server-side with annotations and **burned-in blur** (sharp).
- **Search:** `SearchChunk` rows exist only for live versions; a generated `tsvector` (title weight A, text B) + synonym expansion; permission filters are part of the SQL.
- **Assistant:** retrieval from the same chunks (permission + AI-policy filtered) → local extractive answer or external model → grounding validation → citations → logged for analytics.

## Technology decisions (see `docs/decision-log.md`)
Next.js 16 / React 19 / TypeScript 5.9 · Prisma 7 with `@prisma/adapter-pg` · PostgreSQL 16 · sharp · docx · pdfkit · mammoth · unpdf (pdfjs) · poppler + Tesseract (CLI) · jose · zod 4 · Vitest 5 · Playwright · axe-core · esbuild (extension).

## Deployment shapes
Single container image runs web or worker (`docker-compose.yml`). Object storage: local disk (encrypted) or S3-compatible. See `deployment.md`.

## Non-functional posture
- **Availability:** stateless web; scale-out needs a shared rate-limit store (currently in-memory – limitation).
- **Observability:** request ids on every response/audit event; structured errors. No metrics stack in the MVP.
- **Performance:** FTS with GIN index; images rendered once and cached in memory (LRU-ish); import/exports are in-process (worker for import).
