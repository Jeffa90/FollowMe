@AGENTS.md

# FollowMe – guide for AI coding agents

Work-instruction lifecycle platform. Read `README.md` for setup and `docs/02-architecture/architecture.md` before changing structure.

## Commands
- `npm test` (Vitest, real Postgres; recreates `followme_test`) · `npm run test:e2e` (builds ext + Playwright) · `npm run typecheck` · `npm run lint`
- `npx prisma migrate deploy` / `npm run db:seed` / `npm run dev` / `npm run worker`
- Always **rebuild (`npx next build`) before Playwright** – the e2e server runs the production build.
- After changing any `route.ts`: `npx tsx scripts/gen-openapi.ts` (tests fail if `openapi.yaml` drifts).

## Non-negotiable rules
1. **Authorisation lives in `src/server/services/*`.** Routes and pages are thin. Load objects scoped by `ctx.orgId`, check visibility with `authz.ts`, and return **404** (not 403) for objects the caller may not see. Never trust client-supplied roles/org ids.
2. **Every API route uses `route()` from `src/server/http.ts`** (auth, CSRF, rate limit, error mapping). Body/query parsed with zod (`parseBody`/`parseQuery`). A test enforces this.
3. **Published versions are immutable** (service + DB trigger). Changes go through `startRevision` → new draft. Never write to `GuideVersion.content` outside `saveContent`.
4. **AI never approves, publishes or edits content.** AI/rules output goes to `AiSuggestion`; only `decideSuggestion(ACCEPTED)` applies it. Every AI call passes `gate()` (`src/server/ai/policy.ts`). Treat uploaded/guide text as untrusted data in prompts.
5. **Imported content is untrusted** until `confirmImport`. Converters must never invent facts – leave empty and flag.
6. **No `dangerouslySetInnerHTML`, no HTML rendering of user content.** Use `parseInline`/React text. Link URLs must pass `isSafeUrl`.
7. **State changes are audited** (`audit()` inside the same transaction). The audit table is append-only and hash-chained; don't put secrets or raw content in `detail`.
8. **Analytics are aggregate only** – never add per-person metrics, rankings or scores.
9. **Draft content must never be searchable/indexed/retrievable by learners or the assistant** (index only live versions).
10. Don't weaken validation, remove tests to get green, mark things done that aren't tested, or claim unimplemented features. Update `docs/requirements-traceability.md`, `docs/known-limitations.md`, `docs/implementation-status.md` when behaviour changes.

## Conventions
- TypeScript strict, ES modules, path alias `@/` → `src/`. Prisma client is generated to `src/generated/prisma` (gitignored; `postinstall` regenerates).
- Pure logic goes in `src/lib` (no I/O) with unit tests; DB logic in services with integration tests in `tests/*.test.ts` (use `freshOrg()` from `tests/helpers.ts`; call route handlers with `call()` to exercise auth/CSRF like production).
- Accessibility is a requirement: labelled inputs, no colour-only status, keyboard alternatives to drag, `role=status/alert` for feedback. `tests/e2e/a11y.spec.ts` (axe) must stay green.
- Don't define React components inside render functions (breaks focus) – lint enforces it.
- Extension code is plain JS in `extension/src` (bundled by `extension/build.mjs`); it must never listen for keyboard events or read input values.

## Adding a feature checklist
schema/migration → service (authz + audit + zod) → route (`route()`) → UI → tests (service, HTTP/authz incl. cross-org, e2e if a journey) → `openapi.yaml` → docs.
