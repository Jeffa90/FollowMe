# Backlog

Legend: ✅ done & tested · 🟡 partial · ⏳ designed only · ⛔ deferred

## Epic 1 – Foundation
✅ Auth simulation, sessions, CSRF, RBAC · ✅ Org/site/clearance isolation · ✅ Audit hash chain · ✅ Encrypted blob storage · ✅ Postgres queue/worker · ✅ Migrations + seed · ⏳ Entra ID OIDC · ⛔ Row-level security

## Epic 2 – Authoring & editor
✅ Templates (4) · ✅ Structured model · ✅ Step ops (insert/duplicate/merge/split/move/delete) · ✅ Undo/redo/autosave/conflicts · ✅ Annotations (box/arrow/highlight/blur/marker), crop, replace · ✅ Decisions/exceptions/physical/warnings/controls · ✅ Previews desktop/mobile/print · 🟡 Drag-and-drop reorder (buttons only, by design for WCAG 2.5.7) · ⛔ Video steps (links only)

## Epic 3 – Capture
✅ MV3 extension (record/pause/resume/stop, hotkey, banner, badge) · ✅ Screenshot masking + policy exclusions · ✅ Step generation, dedupe, ambiguity flags, regenerate step · ✅ Append recording, compare recording with guide · ⏳ Desktop capture · ⛔ Multi-tab / iframe capture

## Epic 4 – Legacy redevelopment
✅ DOCX/PDF/PPTX/HTML/MD/image(OCR) extraction · ✅ Structuring with confidence & flags · ✅ Side-by-side compare, change summary · ✅ Batches, dry run, dedupe, reconciliation, CSV report · ✅ Folder CLI · ⏳ SharePoint library inventory · 🟡 Legacy `.doc/.ppt` (rejected with guidance)

## Epic 5 – Governance
✅ Lifecycle + immutability · ✅ Single/multi-stage approval · ✅ Segregation of duties · ✅ Urgent correction · ✅ Under review / complete review · ✅ Archive · ✅ Permanent/short links, redirects · ✅ Orphan detection

## Epic 6 – Outputs
✅ DOCX/PDF/HTML/MD/offline ZIP · ✅ QR/short links · ✅ Embed route · ✅ Webhooks · ✅ Edited-export reconciliation (FollowMe DOCX) · ⏳ SharePoint/Teams apps · ⏳ Side-panel

## Epic 7 – Library & search
✅ FTS + synonyms/acronyms + filters · ✅ Favourites/recents/related-by-context · ✅ Failed-search report · ⏳ Vector adapter

## Epic 8 – AI
✅ Provider interface (local, Anthropic, OpenAI-compatible) · ✅ Policy gate · ✅ Grounded Q&A · ✅ Suggestions (missing checks, terms, rewrite, OCR mismatch, quiz, FAQ, summary) · 🟡 Translation/role views (external provider only; mock-tested)

## Epic 9 – Health, analytics, training, blocks, maps
✅ 20+ explainable rules · ✅ Recommendations · ✅ Analytics (aggregate) · ✅ Acknowledge/quiz/sign-off/report · ✅ Reusable blocks with impact · 🟡 Process maps (structured, no diagram)

## Next (post-MVP)
1. Entra ID OIDC + group→role mapping · 2. SharePoint/Teams embedding app + Graph sync · 3. Desktop capture design spike · 4. pgvector adapter · 5. RLS · 6. Shared rate-limit store · 7. Email/Teams notifications · 8. Manual accessibility audit with assistive technology
