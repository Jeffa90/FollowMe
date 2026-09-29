# Implementation status

_Last updated at the end of the MVP build._ Detailed per-requirement status: `requirements-traceability.md`.

## Definition of Done checklist
| Item | Status | Evidence |
|---|---|---|
| Runs locally with documented commands | ✅ | README quick start; `scripts/e2e-server.ts` executes clean DB → migrate → seed → build → start on every e2e run |
| Migrations and seed work | ✅ | 2 migrations apply to an empty DB (CI + e2e); seed runs the real workflow for 7 guides |
| Create, capture, import, edit, review, approve, publish, search, export | ✅ | Journeys A–F (Playwright) + service tests |
| Legacy Word and PDF → structured drafts | ✅ | `tests/import-extract.test.ts`, `tests/import.test.ts`, Journey B |
| Published versions immutable | ✅ | service check + DB trigger tests (`lifecycle.test.ts`) |
| Content is organisation-owned | ✅ | `orgId` on every table; cross-org 404 matrix (`security.test.ts`) |
| Server-side permissions enforced | ✅ | RBAC-over-HTTP + segregation tests |
| Audit events recorded | ✅ | hash chain verified in tests and on the Audit page |
| Critical end-to-end tests pass | ✅ | 16 Playwright tests, 0 failures (see `test-report.md`) |
| Known limitations documented honestly | ✅ | `known-limitations.md` |
| Another developer can clone and run | ✅ | verified by cloning the repository into a clean directory and running install → migrate → seed → typecheck → tests (see `test-report.md`) |

## MVP requirements (the 18 items)
1 Local auth & role simulation ✅ · 2 Organisation-owned library ✅ · 3 Manual authoring ✅ · 4 Browser capture prototype ✅ · 5 Automatic steps & screenshots ✅ · 6 Visual editing & redaction ✅ · 7 DOCX & PDF import ✅ · 8 Structured conversion with confidence flags ✅ · 9 Side-by-side comparison ✅ · 10 Review/approval/publication ✅ · 11 Version history & audit ✅ · 12 Live links ✅ · 13 Search ✅ · 14 Word & PDF export ✅ · 15 Feedback & outdated reports ✅ · 16 Owner & review-date dashboards ✅ · 17 Seed content ✅ · 18 Automated tests for critical journeys ✅

## Beyond the MVP list (implemented + tested)
Health engine (20+ explainable rules, exceptions) · recommendations · orphan detection · duplicates · reusable blocks with impact analysis · training/competency · analytics · AI assistant + suggestions with policy gate · webhooks · retention/legal hold · bulk import (dry run, reconciliation, CSV) · folder CLI · edited-export reconciliation · process maps (structured) · admin console · OpenAPI (generated + contract-tested).

## Phase reports
### Phase 1–3 (Discovery, Architecture, UX)
Completed: docs under `docs/01-discovery`, `02-architecture`, `03-ux`. Tested: n/a (design docs are checked against code by review; contract-style tests exist for OpenAPI). Deferred: none. Concern: integrations are design-only.
### Phase 4 (Setup) – completed: Next 16/Prisma 7/PG16, migrations with triggers, seed, Vitest+Playwright harnesses, Docker/CI files. Failed along the way: interactive `prisma migrate dev` hangs in non-TTY (used `migrate deploy`). Deferred: Docker/CI execution.
### Phase 5 (Vertical slices) – completed: foundation → lifecycle → capture/extension → import → exports → AI/health/analytics/admin → process maps. Bugs found by tests and fixed: audit hash instability across JSONB round-trip; password leaking via URL query string (now stripped); lost events when a click navigates (pending-event map); process-map reachability loop; re-generation of discarded recordings; editor inline components losing focus (found by lint, regression-tested).
### Phase 6 (Validation) – 91 Vitest + 16 Playwright tests, typecheck and lint clean (0 errors). See `test-report.md`.

## Next implementation action
Entra ID OIDC (`AUTH_MODE=entra`): callback route, user provisioning from claims, group→role mapping table, then the SharePoint/Teams embedding app and an S3/MinIO integration test.
