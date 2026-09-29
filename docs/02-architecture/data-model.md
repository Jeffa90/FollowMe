# Data model

Source of truth: `prisma/schema.prisma` (+ SQL triggers in `prisma/migrations/20260929061600_search_and_immutability`).

## Identity & tenancy
`Organization` (policies as validated JSON: `aiPolicy`, `capturePolicy`, `retentionPolicy`, `legalHold`, `dataRegion`) → `Site`, `Team`, `User` (roles[], `clearance`, site scope), `Session` (revocable), `ApiToken` (hashed, scoped, expiring).

## Guide identity vs versions
- **`Guide`** – stable identity: `documentId` (WI-0001), `shortCode`, template, workflow, governance metadata (owner, backup owner, escalation, review frequency, classification, criticality, site, systems, SAP transactions, URL patterns…), `liveVersionId`, `orphanedSince`, `legalHold`.
- **`GuideVersion`** – the immutable unit: `content` (JSONB, schema in `src/lib/guide-schema.ts`), `contentHash` (sha256 of canonical JSON), `status`, `rev` (optimistic concurrency), `authorId` + `contributorIds` (segregation), `submissionCycle`, `source` (MANUAL/CAPTURE/IMPORT/REVISION/URGENT_CORRECTION/RECONCILIATION), `importConfirmed`, `controlSnapshot` (approvals/dates frozen at publish), dates, `supersededByNumber`.
- **`ApprovalDecision`** – append-only (person, name, phase, stage, decision, comment, time, cycle).
- **Statuses:** `DRAFT → IN_REVIEW ⇄ CHANGES_REQUESTED → READY_FOR_APPROVAL → APPROVED → PUBLISHED ⇄ UNDER_REVIEW → SUPERSEDED → ARCHIVED`. `PUBLISHED` and `UNDER_REVIEW` are both *live*.

### Database-enforced invariants
| Rule | Mechanism |
|---|---|
| No content/hash/number/author change once a version leaves DRAFT/CHANGES_REQUESTED | trigger `followme_guide_version_guard` |
| Control record (snapshot, publish time, effective date, summary, label) frozen after publication | same trigger |
| Only legal status transitions after approval | same trigger |
| Non-draft versions cannot be deleted | same trigger |
| `AuditEvent`, `ApprovalDecision` are append-only | trigger `followme_append_only` |
| `Asset` bytes/type/purpose immutable | trigger `followme_asset_guard` |

## Content model (`GuideContent`)
Sections (purpose, scope, audience, responsibilities, prerequisites, permissions, equipment, PPE, hazards, training, quality/regulatory/policy requirements, expected result, validation checks, troubleshooting, related, attachments, acronyms, competency) + `steps[]`.
`Step`: `kind` (action, note, tip, warning, control, expected, physical, decision, exception, block), `title`, `text` (limited inline markup `**bold**`/`` `code` ``), `image` (asset id, alt, annotations[], source asset, needsReplacement), `links[]`, `origin` (manual/capture/import/ai + evidence event id, source block ids, confidence, flags, provider), `decision` (branches with nested steps), `exception`, `physical`, `blockRef` (snapshot of a reusable block).

## Evidence vs content
| Evidence (immutable) | Editable content |
|---|---|
| `CaptureSession`/`CaptureEvent`, `Asset(purpose=EVIDENCE)`; `ImportItem.extracted`, `Asset(IMPORT_SOURCE, IMPORT_IMAGE)` | `GuideVersion.content`, `Asset(purpose=CONTENT)` |
A CONTENT asset is a new row pointing at the same content-addressed blob (`copyAssetAsContent`), so editing/cropping never touches evidence.

## Other tables
`Template`, `Workflow` (stages JSON), `TaxonomyTerm`, `Synonym` (SYNONYM/ACRONYM), `RetiredReference`, `SearchChunk` (generated `tsv`), `SearchLog`/`ViewEvent` (no user column), `Favourite`, `RecentView`, `Notification`, `Feedback`, `ReviewRecommendation`, `HealthFinding`, `ContentBlock(+Version)`, `ProcessMap`, `AiSuggestion`, `AiQuestion`, `Acknowledgement`, `QuizAttempt`, `CompetencySignoff`, `ImportBatch`/`ImportItem`, `ExportRecord`, `WebhookSubscription`/`WebhookDelivery`, `Job`, `AuditEvent` (per-org `seq`, `prevHash`, `hash`).

## Audit chain
`hash = sha256(prevHash | canonical({orgId, seq, at, actorId, action, entityType, entityId, summary, detail}))`, written under a per-org advisory lock; verified by `verifyAuditChain` (UI: Audit page, API: `/api/audit?verify=1`).
