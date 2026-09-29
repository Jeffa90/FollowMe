# Requirements traceability

Status legend: ✅ implemented **and tested** · 🟡 partial (limitation stated) · ⏳ designed only (no code) · ⛔ not implemented.
Test abbreviations: **L**=`tests/lifecycle.test.ts` **S**=`tests/security.test.ts` **I**=`tests/import.test.ts` **X**=`tests/import-extract.test.ts` **E**=`tests/export.test.ts` **A**=`tests/ai.test.ts` **H**=`tests/health.test.ts` **P**=`tests/platform.test.ts` **C**=`tests/capture.test.ts` **G**=`tests/stepgen.test.ts` **U**=`tests/units.test.ts` **XT**=`tests/extension.test.ts` **O**=`tests/openapi.test.ts`; e2e: **JA**=`e2e/journey-a.spec.ts` **J**=`e2e/journeys.spec.ts` **ED**=`e2e/editor.spec.ts` **AX**=`e2e/a11y.spec.ts`. Docs paths are under `docs/`.

## Principles
| # | Requirement | Status | Source | Tests | Notes |
|---|---|---|---|---|---|
| P1 | One authoritative structured source per guide | ✅ | `src/lib/guide-schema.ts`, `services/guides.ts` | L, E | exports are generated from it |
| P2 | Content belongs to the organisation | ✅ | `orgId` everywhere; owner is a governed role, not creator | S (cross-org) | |
| P3 | Published versions immutable | ✅ | `guides.ts`, migration trigger | L (service + SQL) | superuser can disable triggers |
| P4 | Editing published → new draft | ✅ | `startRevision` | L, J (Journey C) | |
| P5 | AI never approves/publishes | ✅ | AI writes only `AiSuggestion`; no AI path to workflow | A (nothing approved after injection), L | structural |
| P6 | Imported content untrusted until human confirms | ✅ | `importConfirmed`, `import.unconfirmed` blocker | I, J (Journey B) | |
| P7 | Draft never in end-user search | ✅ | index only live versions | L, A, S | |
| P8 | Analytics don't rank people | ✅ | `services/analytics.ts` | P (asserts no user data/keys) | |
| P9 | Works without AI | ✅ | local rules default; `gate()` | A (kill switch, search still works) | |
| P10 | No claims for unimplemented functionality | ✅ | this document + `known-limitations.md` | — | |

## Roles & RBAC
| Requirement | Status | Source | Tests |
|---|---|---|---|
| 8 roles (author, process owner, reviewer/SME, approver, publisher, learner, admin, auditor) | ✅ | `src/lib/roles.ts`, `seed.ts` | L, S |
| Server-side RBAC / least privilege | ✅ | `authz.ts`, services | S (RBAC over HTTP), L |

## 1. Process capture
| Requirement | Status | Source | Tests | Limitations |
|---|---|---|---|---|
| Chromium extension prototype | ✅ | `extension/` | JA (real extension in Chromium), XT | Chromium only |
| Start / pause / resume / stop | ✅ | `background.js`, `popup.js` | JA (via service-worker hooks) | popup UI itself not automated |
| Meaningful selections, navigation, page changes | ✅ | `content.js`, `background.js` (`webNavigation`) | JA | single tab |
| Screenshots + action metadata | ✅ | `capture.ts` `recordEvent` | JA, C, S | |
| Avoid duplicate, loading-screen, low-value actions | ✅ | `src/lib/stepgen.ts` | G | |
| Add missed steps by recording again | ✅ | `appendSessionToVersion`, capture UI | C | |
| Clear recording indicator | 🟡 | REC/II badge + on-page banner | JA asserts badge | banner in closed shadow DOM not asserted |
| Immediate pause hotkey | 🟡 | `chrome.commands` Alt+Shift+P | JA tests same `pause()` | key chord not automatable in headless |
| Exclude restricted applications and domains | ✅ (domains) / ⏳ (apps) | `capturePolicy`, `hostRestricted` (server + ext) | S, XT, U | `restrictedApps` reserved for desktop capture |
| Never hidden monitoring | ✅ | visible banner/badge; per-session start; single tab | JA | |
| Never store passwords or raw keystrokes | ✅ | no key listeners; values dropped; length omitted for sensitive; URL query stripped | JA (secrets absent from stored evidence), S, XT | |
| Desktop capture architecture documented | ✅ doc / ⛔ code | `02-architecture/capture-design.md` | — | **not implemented** |

## 2. Intelligent step generation
| Requirement | Status | Source | Tests |
|---|---|---|---|
| Numbered editable steps, action-oriented text | ✅ | `stepgen.ts`, `numberSteps` | G, U |
| Likely application/screen/interaction area | ✅ | `appNameFrom`, target rect | G |
| Suggest title, purpose, audience, prerequisites, expected result | ✅ (marked low confidence) | `generateFromEvents` | G |
| Highlight relevant screenshot area | ✅ | `highlight()` annotation | G, C |
| Detect redundant/ambiguous steps | ✅ | flags `redundant`/`ambiguous` | G |
| Suggest warnings, notes, validation checks | ✅ (as suggestions, never auto-inserted) | `GeneratedSuggestion` → `AiSuggestion(rules)` | G, C |
| Regenerate individual steps | ✅ | `regenerateStep` | C |
| Preserve original evidence separately | ✅ | evidence vs content assets | C |

## 3. Visual guide editor
| Requirement | Status | Source | Tests |
|---|---|---|---|
| Reorder, insert, duplicate, merge, split, delete | ✅ (buttons; no drag) | `step-ops.ts`, `StepList.tsx` | U, ED |
| Crop, replace, annotate screenshots | ✅ | `AnnotationDialog.tsx`, `cropAsset`, `imaging.ts` | C, ED, J (replace) |
| Arrows, boxes, blur, highlights, numbered markers | ✅ | same | ED, E (blur burned in) |
| Notes, tips, warnings, controls, expected results | ✅ | step kinds | ED, E |
| Decision points, alternate paths, exceptions | ✅ | `decision`/`exception` steps | ED, U |
| Physical/offline steps | ✅ | `physical` kind (safety template, seed) | U, seed |
| Links, attachments, related instructions | 🟡 | links + related ✅ (`isSafeUrl`, health); attachments: model/API/access ✅, **no editor picker** | U, S | attachment UI missing |
| Preview desktop, mobile, print | ✅ | `Editor.tsx` | ED, AX |
| Undo, redo, autosave | ✅ | `History`, autosave + optimistic concurrency | U, ED |
| WCAG 2.2 AA target | 🟡 | tokens, patterns | AX (axe) | no manual AT audit |

## 4. Legacy work-instruction redevelopment
| Requirement | Status | Source | Tests |
|---|---|---|---|
| DOCX, PDF, PPTX, images/scans, HTML, Markdown | ✅ | `import/extract.ts`, `ocr.ts` | X (all types), I |
| Original preserved as immutable source evidence | ✅ | `IMPORT_SOURCE` asset + DB guard | I |
| Extract text, headings, tables, images, metadata, document-control fields | ✅ | `extract.ts` | X |
| Detect purpose, scope, responsibilities, prerequisites, steps, warnings, approvals | ✅ | `convert.ts` | X |
| Associate images with likely steps | ✅ | `convert.ts` associations | X, I |
| Convert to structured guide model | ✅ | `convert.ts`, `imports.ts` | X, I, J |
| Confidence & uncertainty by section/step | ✅ | `sectionConfidence`, step confidence, flags | X, J |
| Flag missing, contradictory, duplicate, obsolete-looking info | ✅ | flags list in `import-pipeline.md` | X |
| Identify screenshots requiring replacement | ✅ | `needsReplacement` + blocker | X, I, J |
| Never invent missing facts | ✅ | verbatim rules | X (missing purpose stays empty) |
| Human confirmation before review/publication | ✅ | `confirmImport`, blocker | I, J |
| Side-by-side old vs new | ✅ | `/imports/[id]` | J |
| Change summary (retained/rewritten/removed/uncertain) | ✅ | `changeSummary` (every block accounted) | X, J |
| Compare a new recording with the older instruction | ✅ | `compareSessionWithGuide` | C |
| Bulk: inventory authorised libraries | 🟡 | folder CLI + batch upload | I | SharePoint inventory ⏳ |
| Bulk: duplicates & superseded versions | ✅ | `finaliseBatchIfDone` | I |
| Bulk: group by process/site/system/function | ✅ | `groupKeys`, batch page | I |
| Bulk: map legacy metadata to taxonomy | 🟡 | exact match on site/department | X | no fuzzy mapping |
| Dry runs, batches, reconciliation, exception reports | ✅ | `reconcileBatch`, CSV | I |
| Never delete/overwrite sources | ✅ | no delete path; reject keeps source | I |

## 5. Work-instruction structure
| Requirement | Status | Source | Tests |
|---|---|---|---|
| Configurable templates (SAP, administrative, safety, general) | ✅ | `lib/templates.ts`, admin JSON editor | C |
| Metadata: doc id, owners, taxonomy, systems, SAP tcodes, sites, classification, criticality | ✅ | `Guide` columns, MetadataForm | L, S |
| Sections: prerequisites, permissions, equipment, PPE, hazards, training, quality/regulatory/policy, steps, decisions, exceptions, troubleshooting, expected result, validation, related, attachments | ✅ (attachments 🟡) | `GuideContent` | E, ED |
| Effective/review date, version, status, approval history, revision summary | ✅ | `GuideVersion.controlSnapshot` | L, E |
| Competency & acknowledgement requirements | ✅ | `competency` | P |

## 6. Governance & document control
| Requirement | Status | Source | Tests |
|---|---|---|---|
| Lifecycle Draft…Archived | ✅ | `guides.ts`, trigger | L |
| Only published in normal library | ✅ | search index/live filter | L, S |
| Every status change audited | ✅ | `audit()` in tx | L |
| Approval records person/date/decision/comment | ✅ | `ApprovalDecision` | L |
| Configurable single/multi-stage approval | ✅ | `Workflow.stages` | L |
| Author cannot approve own guide | ✅ | `assertSegregation` | L |
| Permanent links to current published version | ✅ | `/g/{doc}`, `/s/{code}` | J |
| Auditors access historical versions | ✅ | `canReadVersion` | L, J |
| Superseded redirect to current | ✅ | `/g/{doc}/v/{n}` | J (Journey C) |
| Urgent correction controlled + audited | ✅ | `startRevision(urgent)` | L |
| Owner, backup, review frequency, escalation required | ✅ | blocking health rules | H, L |
| Orphaned guides detected/reported | ✅ | `runOrgHealthScan` | H |
| Org-controlled repository | ✅ | org DB + blob store | S |

## 7. Controlled outputs & SharePoint
| Requirement | Status | Source | Tests | Limitations |
|---|---|---|---|---|
| Secure live links, read-only published views | ✅ | `/g/*` | J | |
| Embed in SharePoint/Teams/intranet | 🟡 | `/embed/g/*` + CSP allow-list | S (headers) | iframe SSO not built; no SharePoint/Teams app |
| Word, PDF, HTML, Markdown export | ✅ | `export/*` | E, J | |
| Guided one-step-at-a-time view | ✅ | `/g/*/guided` | AX, J | |
| Controlled printing | ✅ | print stylesheet, control banner | ED (print preview) | |
| Offline packages | ✅ | `toOfflineZip` | E | |
| API and webhook publication events | ✅ | `openapi.yaml`, `webhooks.ts` | O, P | |
| Every export includes id, version, publication date, export timestamp, source ref, warning | ✅ | `ControlBlock` | E, J | |
| Exports are not masters; edited export → compare + reconcile + approval | 🟡 | `reconcile.ts` | E | FollowMe DOCX only |

## 8. Library, search, in-context guidance
| Requirement | Status | Source | Tests |
|---|---|---|---|
| Full-text search over titles, metadata, steps | ✅ | `services/search.ts` | L, J |
| Filters: status, site, process, owner, system, category, review date | 🟡 | API all; UI omits review-date | S |
| Taxonomy, synonyms, acronyms | ✅ | `Synonym`, admin | J (synonym "purchase order") |
| Favourites, recents | ✅ | `library.ts` | — (covered by home page e2e/a11y only) |
| Related guides | 🟡 | author-defined related; context match | — | no auto-suggested related |
| Role-based landing pages | ✅ | `dashboard.ts`, home | AX |
| Direct step links, QR/short links | ✅ | `#step-id`, `/s/`, QR route | J |
| Search analytics & failed-search report | ✅ | `SearchLog`, analytics | P |
| Associate guides with apps/domains/URL patterns/SAP transactions/business roles | 🟡 | metadata + `suggestForContext` | — | business roles stored, not matched |
| Side-panel design | ✅ doc (client ⛔) | `integrations.md`, `/api/context/suggest` | — | |

## 9. AI assistant
| Requirement | Status | Source | Tests | Limitations |
|---|---|---|---|---|
| Provider-independent, structured outputs, versioned prompts | ✅ | `ai/provider.ts`, `prompts.ts` | A | |
| Rewrite in plain language | 🟡 | local tightening + LLM path | A (mock) | local rewrite is mechanical |
| Standardise terms / define acronyms | ✅ | `localTerms` | A | |
| Suggest missing prerequisites/validations/warnings | ✅ | `localSuggestMissing` | A | |
| Compare versions / recording vs guide | ✅ (deterministic, not AI) | `compare.ts` | U, C | |
| Text vs screenshot mismatch | ✅ heuristic (OCR) | `localMismatch` | A | OCR-limited |
| Summaries, FAQs, knowledge checks | ✅ rule-based | `tasks.ts` | A | low sophistication |
| Suggest translations / role-specific views | 🟡 / ⛔ | translation via external provider only | — | role views not built |
| Answer only from published, authorised content; cite guide+step | ✅ | `qa.ts` | A, J | |
| State when no approved answer exists | ✅ | `NO_ANSWER` | A, J | |
| Respect permissions | ✅ | SQL-filtered retrieval | A, J | |
| Uploaded documents untrusted; ignore embedded instructions | ✅ | rules import; delimiters | X, A | |
| Suggestions separate; explicit human acceptance | ✅ | `AiSuggestion`, `decideSuggestion` | A | |
| Display AI involvement and uncertainty | ✅ | disclosure fields, UI badges | A, J | |
| Disable by org/team/content type/classification | ✅ | `gate()` + admin UI | A | |
| No screenshots/sensitive content externally unless permitted | ✅ | prompts text-only; classification cap | A | |
| No training on org content w/o contract | ✅ (gate requires confirmation flag) | `noTrainingContractConfirmed` | A | contractual check is a human attestation |

## 10. Content health
| Rule | Status | Rule id(s) |
|---|---|---|
| Broken links / missing attachments | 🟡 | `link.unsafe.*`, `link.related_missing.*`, `attachment.missing*` — external URLs not fetched |
| Unassigned / inactive owners | ✅ | `governance.owner_missing`, `owner_inactive`, `backup_owner_missing` |
| Overdue reviews | ✅ | `review.overdue` |
| Retired systems / transaction codes | ✅ | `retired.*` |
| Changed buttons/fields/URLs/screens | 🟡 | via recording comparison → `RECORDING_MISMATCH` recommendation |
| Duplicates / near-duplicates | ✅ | `duplicate.near.*` |
| Low ratings, repeated outdated reports | ✅ | `feedback.low_rating`, `feedback.outdated_reports` |
| Missing purpose/scope/prerequisites/expected result | ✅ | `template.required.*`, `content.section_missing.*` |
| Undefined acronyms | ✅ | `acronym.undefined` |
| Missing alt text | ✅ | `image.alt_missing` |
| Sensitive info in screenshots | 🟡 | `image.sensitive` (from capture flags) |
| Missing approval route / change summary | ✅ | `approval.route_missing`, `change_summary.missing` |
| Classification blocking/warning/suggestion/accepted exception | ✅ | `FindingSeverity`, exception flow |
| Explainable assessment; never auto-modifies approved content | ✅ | `assess()`, recommendations only |
Tests: H (Journey F, exceptions), X/I (import flags), J.

## 11. Reusable content & process maps
| Requirement | Status | Tests | Notes |
|---|---|---|---|
| Governed reusable blocks (warnings, safety, privacy, prerequisites, approvals, definitions, escalation) | ✅ | H | |
| Show affected guides before change; require reapproval where appropriate | ✅ | H | published guides keep approved wording; recommendation + owner notification |
| Assemble task guides into end-to-end process (triggers, I/O, roles, handoffs, decisions, exceptions, controls, related guides/policies/forms) | 🟡 | P | structured list view; no diagram |

## 12. Training & competency
| Requirement | Status | Tests |
|---|---|---|
| Mark as read, required acknowledgement | ✅ | P |
| Knowledge quiz, practical checklist, trainer/supervisor sign-off | ✅ | P |
| Completion and reassessment dates | 🟡 (dates stored; no reminders) | P |
| Reporting by guide, team, site | ✅ (role ⛔), aggregate only | P |
| Opening a guide ≠ competency | ✅ | P |

## 13. Security & privacy
| Requirement | Status | Tests / notes |
|---|---|---|
| Entra ID integration architecture | ⏳ | `integrations.md` |
| Local role simulation | ✅ | S (blocked in production) |
| Server-side authz; org/site isolation | ✅ | S, A |
| Encryption in transit / at rest | 🟡 | at rest ✅ AES-GCM (S); transit = deployment TLS + HSTS header |
| Audit logging | ✅ | L, P |
| Secret management | 🟡 | env-validated; vault integration is deployment |
| Malware & file-type validation | ✅ (built-in scanner ≠ AV) | I, S |
| Rate limiting, input validation | ✅ (in-memory limiter) | S |
| Injection, XSS, CSRF protection | ✅ | S, U, E |
| Permission-aware retrieval | ✅ | A |
| Manual, automatic, admin-enforced redaction | ✅ | JA, E, XT |
| Restricted domains/apps | ✅ domains / ⏳ apps | S |
| Retention, legal hold, configurable residency | ✅ retention & hold / 🟡 residency label | P |
| Capture & external-AI kill switches | ✅ | S, A |
| Threat model (9 areas) | ✅ | `security-and-threat-model.md` |

## 14. Analytics
Guide views/use ✅ · search success & failed ✅ · feedback & outdated reports ✅ · guides approaching/overdue review ✅ · publication cycle time ✅ · legacy conversion status ✅ · import acceptance/exceptions ✅ · duplicate content ✅ · unanswered questions ✅ · completion/competency (aggregate) ✅ — tests **P**. No rankings/scores ✅ (P asserts).

## Technology & delivery
| Item | Status | Notes |
|---|---|---|
| Next.js/React/TypeScript | ✅ | |
| Accessible responsive component system | 🟡 | hand-built tokens/patterns, no library |
| Node API boundary; OpenAPI | ✅ | `openapi.yaml` generated + tested (O) |
| PostgreSQL + Prisma; migrations | ✅ | |
| S3-compatible dev storage / Azure Blob adapter | 🟡 / ⏳ | local encrypted store ✅; S3 code untested vs real S3; Azure design only |
| Queue-based workers | ✅ | Postgres queue (P, I) |
| Provider-independent AI; vector adapter | ✅ / ⏳ | vector = extension point only |
| Chromium extension | ✅ | |
| DOCX/PDF parsing; OCR abstraction; Word/PDF generation | ✅ | X, E |
| Docker Compose; CI workflow | 🟡 | written, not executed in sandbox |
| Playwright, unit, integration, security, accessibility tests | ✅ | 91 + 16 tests |
| Integration adapters (Entra, Graph, SharePoint, Teams, Power Automate, email, LMS, enterprise AI) | ⏳ (webhooks ✅, AI provider interface ✅) | `integrations.md` |

## MVP items and acceptance journeys
MVP 1–18: ✅ (see `implementation-status.md`). Journeys **A** (JA + L), **B** (J + I + X), **C** (J + L), **D** (J + E), **E** (J + A), **F** (J + H): ✅ all automated.
