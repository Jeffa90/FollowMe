# FollowMe – product brief (Phase 1: Discovery)

## 1. Interpretation
FollowMe is a **work-instruction lifecycle platform**, not a screenshot recorder:

`Capture → Draft → Enhance → Review → Approve → Publish → Use → Monitor → Update`

One **authoritative structured source** exists per guide (`GuideVersion.content`, validated by `src/lib/guide-schema.ts`). Browser capture, legacy import and manual authoring all produce that same model. Governance, search, exports, the assistant, health checks and analytics all read from it. Word/PDF/HTML/Markdown files are *generated representations*, never masters.

## 2. Principles (each is enforced in code, not policy text)
| Principle | Where enforced |
|---|---|
| Published versions are immutable | service layer (`saveContent` rejects) **and** a PostgreSQL trigger (`followme_guide_version_guard`) |
| Editing a published guide creates a new draft | `startRevision` (live version untouched; tested in Journey C) |
| AI never approves or publishes | AI code paths only write `AiSuggestion` rows; workflow functions have no AI entry point |
| Imported content is untrusted until confirmed | `GuideVersion.importConfirmed=false` → blocking health finding `import.unconfirmed` |
| Draft content never appears in normal search | search index only holds LIVE versions (`reindexGuide`) |
| Analytics never rank people | `analytics.ts` has no person-level data; a test asserts no user id/name appears |
| Works without AI | default provider is deterministic local rules; kill switch tested |
| Content belongs to the organisation | every table has `orgId`; no per-user ownership of guides |
| No unimplemented claims | `docs/requirements-traceability.md`, `docs/known-limitations.md` |

## 3. Personas
| Persona | Goal | Pain today | FollowMe surface |
|---|---|---|---|
| **Alice, Author** (process analyst) | Capture a process in minutes and publish a good guide | Screenshots + Word take hours; layout drift | Extension, editor, import, AI/rule suggestions |
| **Olivia, Process owner** | Keep guides accurate; know what is overdue | Nobody knows which docs are stale; owners leave | Owner dashboard, health findings, recommendations, orphan detection |
| **Rita, Reviewer / SME** | Check accuracy quickly | Reviews by email, no history | Review queue, side-by-side compare, decisions with comments |
| **Alan, Approver** | Approve with evidence, segregation of duties | Rubber-stamping own team's work | Multi-stage approval routes, author exclusion |
| **Pat, Publisher / document controller** | Publish and control versions, fix urgent errors | Uncontrolled copies, no audit | Publish, urgent correction, controlled exports, audit trail |
| **Lena, Learner** | Find the right current instruction, follow it | Outdated PDFs, unclear steps | Library, guided view, assistant, feedback |
| **Ada, Administrator** | Configure roles, policy, kill switches | Shadow tools, no data control | Admin console, AI/capture policy, retention, webhooks |
| **Aud, Auditor** | Prove what was approved when and by whom | Reconstructing history | Hash-chained audit, historical versions |

## 4. User journeys (acceptance journeys A–F are automated end to end)
- **A. Record → publish:** extension records a browser process → server stores evidence → steps generated → author edits → review → approve → publish → learner finds it.
- **B. Legacy redevelopment:** upload DOCX/PDF → structured draft with confidence + flags → side-by-side compare → human confirms → replace obsolete screenshot → publish.
- **C. Revision:** revise a published guide; v1 stays intact; learners see v1 until v2 is published; superseded link redirects; auditor reads history.
- **D. Controlled export:** Word/PDF carrying document ID, version, publication date, export timestamp, live source, "check live source" warning.
- **E. Ask:** answers cite guide + step from authorised published content, or state no approved answer exists.
- **F. Health:** overdue / retired-reference / outdated-report guides get *recommendations*; approved content is never changed automatically.

## 5. Key assumptions (recorded, not asked – none is blocking)
1. Single organisation per deployment for the MVP; the schema is multi-tenant (`orgId` everywhere) and isolation is tested with two organisations.
2. Microsoft Entra ID is the production identity provider. The MVP ships **local role simulation** (`AUTH_MODE=local`, blocked in production unless `DEMO_MODE=true`). The OIDC adapter is designed (docs/02-architecture/integrations.md), not built.
3. PostgreSQL 16 is available; a Postgres-backed queue is acceptable at MVP scale (ADR-004).
4. Chromium (Chrome/Edge) is the capture target. Desktop capture is a later phase and is **not implemented**.
5. AI is optional. The default provider needs no network. External providers need explicit policy + a confirmed no-training contract.
6. English UI/content for MVP (`lang="en-GB"`); translation is an AI-provider feature only.
7. Screenshots may contain sensitive data; automatic masking is best-effort and human review remains mandatory.
8. Data residency is a configuration label + deployment choice (region of DB/blob), not enforced by the app.

## 6. Major risks
| Risk | Likelihood / impact | Mitigation in this repo | Residual |
|---|---|---|---|
| Sensitive data in screenshots | High / High | Capture-time masking of password/card/OTP fields, admin selectors and regex patterns; URLs stripped to origin+path; burned-in blur; sensitive-content health finding; human review | Masking cannot see everything (canvas, images, iframes) |
| Malicious uploads | Med / High | Magic-byte sniffing, size caps, macro/JS rejection, zip-bomb limits, scanner interface (EICAR built-in, ClamAV adapter) | Built-in scanner is **not** an AV engine |
| Prompt injection | Med / Med | Delimited untrusted content, schema-validated output, citation grounding, no tools/actions for AI, local-first | LLM behaviour not tested against a live model |
| Legacy conversion accuracy | High / Med | Rules-based only, verbatim carry-over, confidence + flags, mandatory human confirmation, change summary | Free-form documents convert poorly; flagged, not fixed |
| Cross-tenant / BOLA leakage | Low / Very high | Central authz predicates, 404-on-unknown, cross-org tests on every object type | No DB row-level security (documented) |
| Capture fidelity in complex apps | High / Med | Prototype scope stated; events only from trusted input; single-tab | Shadow DOM, iframes, canvas apps not supported |
| Over-claiming | Med / High | Traceability + limitations docs; tests are the source of truth | — |

## 7. MVP scope
**In (implemented and tested):** the 18 MVP items and journeys A–F (see `docs/requirements-traceability.md`), plus health engine, reusable blocks, training/competency, webhooks, retention, process maps, edited-export reconciliation and bulk-import dry runs.
**Designed only / deferred:** Entra ID login, SharePoint/Teams/Graph/Power Automate/LMS/email adapters, desktop capture, Azure Blob adapter, vector search, graphical process diagrams, side-panel client, real translation, row-level security. See `docs/known-limitations.md`.

## 8. Acceptance criteria
See "MVP ACCEPTANCE JOURNEYS" in the brief; each maps to a Playwright spec (`tests/e2e/journey-a.spec.ts`, `tests/e2e/journeys.spec.ts`) **and** a service-level test (`tests/*.test.ts`). The Definition of Done checklist is tracked in `docs/implementation-status.md`.
