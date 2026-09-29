# Known limitations (honest list)

Nothing below is hidden behind UI. If a capability is not listed as implemented in `requirements-traceability.md`, assume it is **not** available.

## Not implemented (designed only or deferred)
1. **Microsoft Entra ID sign-in.** Only local role simulation exists (blocked in production without `DEMO_MODE=true`). OIDC flow, group→role mapping and SCIM/Graph deprovisioning are design-only (`docs/02-architecture/integrations.md`).
2. **SharePoint / Teams / Graph / Power Automate / LMS / email adapters.** Available today: signed webhooks, `/embed/g/{id}` (frame-allow-listed), `/api/context/suggest`, in-app notifications. Embedding inside SharePoint additionally needs SSO in the iframe (SameSite/Entra silent auth) – not built.
3. **Desktop capture.** Design only (`docs/02-architecture/capture-design.md`). Do not claim it.
4. **Side-panel client** for application-aware guidance: the matching endpoint exists; the extension panel does not.
5. **Azure Blob adapter**; the S3 adapter is implemented but **untested against a real S3/MinIO** (no service available in the sandbox).
6. **Vector search.** Retrieval is Postgres FTS + synonyms only.
7. **Row-level security** in PostgreSQL. Isolation is enforced in services and tested, but a bug in a new query could bypass it.
8. **Role-specific views**, real **translation** (needs an external provider; mock-tested only), email/Teams notifications, reassessment reminders, training reports *by role* (by guide/team/site only), review-date filter in the library UI (API supports it), auto-suggested related guides (authors add related procedures manually).
9. **Editor:** no drag-and-drop reordering (buttons, by design), no attachment picker UI (attachments exist in the model/API/access control), no video steps (links only).
10. **Process maps** are structured lists with a readable linked flow – no graphical diagram/swimlane rendering.

## Verified only partially
- **External AI providers** (Anthropic, OpenAI-compatible) are verified against **mocked HTTP only**. No accuracy, latency or safety claims are made about any live model. Prompt-injection resistance is demonstrated for the deterministic path and for schema/citation validation of model output, not for model behaviour.
- **Accessibility:** WCAG 2.2 AA is the *target*. Automated axe checks pass on ~25 screens (light + dark, 320 px reflow, keyboard skip link). Automated tools detect only part of WCAG; **no manual screen-reader / voice-control audit has been done** and no conformance claim is made.
- **Docker Compose and the GitHub Actions workflow** were written but not executed in the authoring sandbox (no Docker daemon, no runner). The equivalent steps (clean DB → migrate → seed → build → start → e2e) are exercised by `scripts/e2e-server.ts`.
- **Extension hotkey (Alt+Shift+P)** handler and the popup UI are implemented but the key chord/popup are not driven by automated tests (Chromium headless cannot press extension commands). The same pause/resume functions are tested through the extension's service worker; badge state is asserted. The on-page banner uses a *closed* shadow root, so tests cannot query it.
- **Legacy conversion quality** was tested on synthetic DOCX/PDF/PPTX/HTML/MD/PNG documents generated in the test suite. Real-world libraries will contain layouts (text boxes, multi-column PDFs, embedded objects) that convert poorly; the design response is flags + mandatory human confirmation, not accuracy.
- **OCR** uses the Tesseract CLI; accuracy depends on scan quality. The screenshot-vs-text mismatch check is a heuristic prompt to look, not a verdict.

## Capture prototype limits
Single recorded tab; no iframes/shadow-DOM/canvas targets; screenshot taken at pointer-down so fast page transitions may show the next state; SPA hash routes are lost with URL query/fragment stripping; masking only covers password/card/OTP-style fields, administrator selectors and regex text matches (emails, card numbers, NI numbers by default) – **screenshots must still be reviewed by a person**; Chromium only.

## Security / operations
- Built-in malware scanning is signature-based (EICAR + dangerous document features) – **not an antivirus**; use ClamAV (`MALWARE_SCANNER=clamav`) or an enterprise scanner.
- Rate limiting is in-memory per instance.
- Application-level encryption protects stored assets (AES-256-GCM); database encryption at rest, TLS termination, backups and key rotation are deployment responsibilities.
- Data residency is a label plus deployment choice; the application does not enforce region.
- `DEMO_MODE=true` disables real authentication. Never use it for real data.
- Postgres superusers can disable triggers; hash-chaining detects, but does not prevent, tampering by a database administrator.
- Retention deletes analytics logs and abandoned raw captures only; published content and imported source documents are never deleted automatically. Blob deletion covers local/S3 stores.
- PDF export uses DejaVu Sans when installed (Docker image installs it); otherwise Helvetica with unsupported characters replaced by `?`.

## Product behaviour to be aware of
- Edited-export reconciliation applies only to FollowMe-generated DOCX files (control marker), compares purpose/scope/audience/expected result and numbered procedure text, and never handles images/tables/added/removed steps automatically (they are listed for manual handling).
- Import: legacy `.doc`/`.ppt` are rejected (save as OOXML); PDFs containing JavaScript/launch actions are rejected.
- Search filter UI exposes site/process/owner/system/category/status; results are permission-filtered so counts differ per user by design.
- Batch metadata mapping to the taxonomy is exact-match (site name/code, department label/code).
