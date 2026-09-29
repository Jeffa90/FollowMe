# Decision log (ADRs)

| # | Decision | Context / alternatives | Consequences |
|---|---|---|---|
| 001 | **Single Next.js app** as UI + API boundary, domain logic in `src/server/services` | Separate Node API service; NestJS | One deployable, shared types; authorisation centralised in services so any caller is safe. A separate API service can be extracted later because routes are thin. |
| 002 | **Prisma 7 + PostgreSQL 16**, raw SQL only for FTS, triggers, job claim | ORM-free SQL; Drizzle | Type-safe access; invariants as SQL triggers in migrations. Prisma 7 requires `@prisma/adapter-pg` and `prisma.config.ts`; generated client is gitignored. |
| 003 | **Immutability enforced in DB triggers** in addition to services | Service-only enforcement | Survives application bugs and ad-hoc SQL; tested by attempting `UPDATE` (fails). Superusers can still disable triggers (ops control). |
| 004 | **Postgres-backed job queue** (`SKIP LOCKED`) instead of Redis/BullMQ | pg-boss, Redis | No extra infra; transactional enqueue; adequate for import/webhooks/scans. Not for very high throughput. |
| 005 | **Hash-chained, append-only audit** | Plain table | Tamper evidence + verification UI; per-org advisory lock serialises writers (throughput cap acceptable). |
| 006 | **Content-addressed assets, evidence vs content rows** | Copy blobs; mutate in place | Editing never touches evidence; dedupe; DB guard blocks asset mutation. Blob deletion only for unshared keys (retention). |
| 007 | **Server-side flattened images for readers** (burned-in blur) | Client-side overlays | Redaction cannot be bypassed by fetching the raw asset; raw assets restricted to editors/auditors. |
| 008 | **Local deterministic provider is the default AI**; external providers optional behind `gate()` | LLM-first | Product works offline; no data leaves by default; external needs explicit policy + no-training confirmation. |
| 009 | **Rules-based legacy conversion (no LLM)** | LLM structuring | Predictable, verbatim, testable; "never invent" is enforceable. Lower recall on messy docs – mitigated by flags + human confirmation. |
| 010 | **Postgres FTS with synonym expansion** for search and retrieval; vector adapter deferred | pgvector, external search | One datastore, permission filters in SQL. Semantic recall limited. |
| 011 | **MV3 extension bundled with esbuild**; content script is a classic IIFE; background is an ES module | webpack/Vite plugins | Tiny build. Events flow content → background with a pending map to survive navigation (found by e2e testing). |
| 012 | **Only origin+path URLs are ever stored** (extension and server) | Store full URLs | Query strings leaked a password in early testing (GET form). Trade-off: SPA fragment routes are lost. |
| 013 | **Only trusted (`isTrusted`) DOM events are recorded** | Record everything | Pages can't forge steps. Consequence: synthetic test events are ignored (e2e uses real keyboard input). |
| 014 | **Local auth is a first-class dev mode but blocked in production** (`DEMO_MODE` escape hatch, loud warning) | Always require OIDC | Easy dev/e2e; cannot ship accidentally. |
| 015 | **CSRF via Origin check + HMAC double-submit**; bearer tokens scoped and only on opted-in routes | SameSite only | Defence in depth; extension doesn't need cookies. |
| 016 | **Own CSS design tokens + native elements** instead of a component library | Radix/MUI/shadcn | Fewer dependencies, full control of a11y; more manual work. |
| 017 | **Reader access = live version only**; historical via `/g/{id}/v/{n}` for authorised roles, redirect otherwise | Always show requested version | Users can't act on superseded instructions by mistake. |
| 018 | **Health findings are advice**; recommendations only change *status* when a human accepts (→ UNDER_REVIEW) | Auto-withdraw stale guides | Required by "never automatically rewrite, withdraw or republish". |
| 019 | **Approval segregation by author + contributors** (tracked on every save) | Author only | Anyone who edited cannot approve; urgent corrections use a designated author distinct from the initiator. |
| 020 | **Edited-export reconciliation limited to FollowMe DOCX** with control marker | Diff arbitrary Word files | Deterministic and auditable; arbitrary files use Import. |
| 021 | **No row-level security** in MVP | Postgres RLS per org | Isolation is enforced in services and tested; RLS is a hardening item (needs per-transaction `SET`). |
| 022 | **In-memory rate limiter** | Redis | Simple; per-instance only (documented). |
| 023 | **TypeScript 5.9 (not 7), Vitest 5, Next 16 with `proxy.ts`** | Latest majors | Chosen for ecosystem stability; Next 16 renamed middleware → proxy (used for CSP nonces). |
