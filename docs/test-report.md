# Test report

Environment: Linux container, Node 22, PostgreSQL 16, Chromium 141 (Playwright's pre-installed build), no Docker daemon.
Last full run: 2026-09-29, on a **fresh clone** of the branch (`git clone` → `npm ci` → empty database → `db:migrate` → `db:seed`).

| Check | Result |
|---|---|
| `npm ci` | 723 packages installed; `prisma generate` runs from `postinstall` |
| `npx tsc --noEmit` | 0 errors |
| `npm run lint` | 0 errors, 19 warnings (unused directives / minor style; budget in `package.json` is 200) |
| `prisma migrate deploy` on an empty database | both migrations apply (schema, triggers, generated FTS column) |
| `npm run db:seed` | organisation, 13 users, 7 guides taken through the real workflow |
| `npm test` (Vitest, real PostgreSQL) | **97 / 97 passed**, 13 files |
| `npm run build` | compiles; production guard still refuses `AUTH_MODE=local` at runtime without `DEMO_MODE` (verified: every request returns 500 with the refusal message) |
| `npm run test:e2e` (Playwright, production build, real extension in Chromium) | **16 / 16 passed** |

## Vitest (integration tests call the service layer against real PostgreSQL; the database is recreated per run)

| File | Tests | What it proves |
|---|---:|---|
| `lifecycle.test.ts` | 9 | states and transitions, immutability of published versions (also at DB level via triggers), segregation of duties, multi-stage approval, urgent correction, revise-without-overwrite, supersede/archive, audit hash chain |
| `security.test.ts` | 14 | cross-organisation access returns 404 (BOLA), role checks, CSRF/Origin, bearer-token scope and revocation, upload validation (type, size, content sniffing), asset encryption, evidence vs content assets, login rate limit, production auth guard, redaction of captured data |
| `import.test.ts` | 4 | legacy DOCX/PDF → structured draft, uncertain content is flagged and must be confirmed, batch reconciliation, exceptions CSV |
| `import-extract.test.ts` | 8 | DOCX, PDF, PPTX, HTML, Markdown, image/OCR extraction and conversion rules on generated fixtures |
| `export.test.ts` | 7 | Word/PDF/HTML/Markdown exports contain control block, version, source and QR; uncontrolled-copy marking; edited-export reconciliation |
| `ai.test.ts` | 13 | policy gate (org/team/template/classification/external), grounding and citation validation, "no approved answer", prompt-injection content stays untrusted, suggestions never change content until accepted, provider failure handling |
| `health.test.ts` | 6 | overdue/outdated/retired-reference/inactive-owner rules produce recommendations without changing approved content; de-duplication |
| `platform.test.ts` | 7 | job queue, webhooks (HMAC, SSRF guard), retention sweep, blocks, training/competency, analytics aggregation thresholds, storage drivers |
| `capture.test.ts` | 6 | session state machine (pause/resume/stop/discard), discarded recordings cannot generate guides, event ingestion is idempotent per seq, recording-vs-guide comparison |
| `stepgen.test.ts` | 4 | step generation rules (merge, drop noise, navigation, sensitive fields) |
| `extension.test.ts` | 6 | descriptor never reads values, sensitive-field detection, URL reduction, restricted domains (jsdom) |
| `units.test.ts` | 10 | schema, numbering, step operations, undo/redo history, comparison, inline markup, safe URLs |
| `openapi.test.ts` | 3 | every route is in `openapi.yaml` and the file is regenerated from the route table |

## Playwright (browser, production build, seeded database)

| Spec | Tests | Notes |
|---|---:|---|
| `journey-a.spec.ts` | 1 | **Journey A** with the real extension loaded in Chromium: token, record (pause/resume, password and card entry, real trusted keyboard input), evidence contains no typed values, generate draft, edit, review, approve, publish, search |
| `journeys.spec.ts` | 5 | **Journeys B–F**: legacy DOCX import and screenshot replacement; revise a published guide; controlled Word+PDF export; assistant answer with citation / no-answer; overdue guide recommendation |
| `editor.spec.ts` | 3 | add/duplicate/split/merge/move/delete, undo/redo + autosave, annotation and redaction (readers receive burned-in blur), previews |
| `a11y.spec.ts` | 6 | axe WCAG 2.2 A/AA on about 25 screens in light and dark, skip link, focus visibility, 320 px reflow |
| `smoke.spec.ts` | 1 | learner sign-in, search, read |

## Defects found by testing, and their fixes

| Found by | Defect | Fix |
|---|---|---|
| Journey A (intermittent, roughly 1 in 4 runs, then 0 in 12 after the fix) | Two events whose screenshots completed together were both given the same `seq` by the extension; the server treats a repeated seq as a retried upload, so one recorded step was **silently lost** | Atomic, serialised sequence allocation in `extension/src/background.js` |
| Clean-clone check | `src/server/storage/` had never been committed: an unanchored `storage/` line in `.gitignore` ignored it, so a fresh clone did not compile although the working tree did | anchored to `/storage/`, module committed |
| Clean-clone check | `npm run build` failed with `AUTH_MODE=local` because the production guard also ran during page-data collection | guard skipped only while `NEXT_PHASE=phase-production-build`; still enforced at runtime (tested) |
| ESLint | Editor lost focus on every keystroke in step titles (component defined inside a component) | component hoisted; regression test in `editor.spec.ts` |
| Capture tests | A stopped recording could not be discarded; a discarded one could still generate a guide | state machine and guards in `services/capture.ts`, tests in `capture.test.ts` |
| Capture tests | Recording-vs-guide comparison reported every step as changed because screenshots always differ | comparison ignores images |
| Accessibility suite | horizontal scroll at 320 px on some screens | layout CSS fixed (`globals.css`); the suite runs in CI |

No test was removed, skipped or weakened to obtain a passing run.

## Not tested (see `known-limitations.md`)

- **Docker Compose** and the **CI workflow** are written but were never executed here (no Docker daemon, no runner). The clean-clone sequence above is what CI does.
- **S3/MinIO driver** is unit-tested against a fake client only; not run against a real S3-compatible service. Azure Blob is a design only.
- **Anthropic and OpenAI-compatible providers** are tested with mocked HTTP only. **No claim is made about their answer quality**; the default provider is the deterministic local one, and answer accuracy on real content has not been measured.
- **Entra ID sign-in** is not implemented (architecture only); the tested login is the local role simulation.
- **Desktop application capture**, Firefox/Safari extensions, and installing the extension via enterprise policy are out of scope and untested.
- **Word rendering fidelity**: DOCX is validated structurally and by re-parsing, not opened in Microsoft Word. PDF was inspected by text extraction, not visually against a design.
- **Scanned documents**: OCR is exercised on generated images only; accuracy on real scans is unknown and always flagged as uncertain.
- **Screen-reader testing** by a person, load/performance testing, penetration testing and ClamAV (optional compose profile) have not been done. axe finds only a subset of accessibility problems.
- Only Chromium was used for browser tests.
