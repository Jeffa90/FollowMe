# Integration design

Status: **designed only** unless marked. Nothing here should be presented as working.

## Microsoft Entra ID (architecture)
- OIDC authorization-code + PKCE against the tenant; ID token `oid`/`tid` → `User` (create on first login when the tenant matches `Organization`); group/app-role claims → `Role[]` (mapping table in admin), `clearance`/site from groups.
- Replace `POST /api/auth/login` with `/api/auth/callback`; keep the same session/CSRF machinery. `AUTH_MODE=entra` already disables the local picker and is required in production.
- Deprovisioning: SCIM or nightly Graph sync sets `User.active=false` (revokes sessions/tokens; orphan scan already reacts).

## Microsoft Graph / SharePoint / Teams
- **Publication sync:** subscribe to the `guide.published` / `guide.archived` webhooks (**implemented**, HMAC-signed) → Power Automate flow or a small function writes a link/PDF to a SharePoint list/library (Graph `driveItem` upload) – *controlled copy with the live-source warning*.
- **Embedding:** `/embed/g/{docId}` (**implemented**) is a chromeless read-only view whose CSP allows framing by `*.sharepoint.com` / Teams only. Production SSO inside an iframe requires Entra silent auth (`prompt=none`) or `SameSite=None; Secure` cookies – *not implemented*.
- **Teams tab / message extension:** static tab pointing at `/embed`; search-based message extension calling `/api/search` with an app token. Not built.
- **Library inventory for migration:** Graph `drive/root/children` walk producing the same `createImports` call as the folder CLI. Not built.

## Power Automate / webhooks (implemented)
Events `guide.published`, `guide.archived` (and `guide.review_recommended` reserved). Headers: `x-followme-event`, `x-followme-timestamp`, `x-followme-signature = sha256=HMAC(secret, "<ts>.<body>")`. Retries with exponential backoff (5 attempts); SSRF guard on target URLs.

## Email notifications
In-app notifications are implemented (`Notification`). Email/Teams delivery = adapter over the same `notify()` call (SMTP or Graph `sendMail`); not built.

## Learning management systems
Competency and acknowledgement records (`Acknowledgement`, `QuizAttempt`, `CompetencySignoff`) are the source; an LMS adapter would push xAPI statements or SCORM-lite completions on those events. Not built. Reporting is aggregate-only by design.

## Enterprise AI services
Azure OpenAI / Anthropic on a private endpoint fit `AiProvider` (`OpenAiCompatibleProvider` targets Azure-style deployments via `AI_BASE_URL`). Content stays subject to `gate()`.

## Application-aware guidance (side panel) – design
- A Chromium **side panel** extension (separate from capture, no recording) reads the active tab URL only when the user opens the panel, calls `GET /api/context/suggest?url=…&sapTransaction=…` (**implemented endpoint**, matches guides' `websites`, `urlPatterns`, `sapTransactions`, `applications`, permission-filtered), and lists relevant *published* guides with deep links/QR.
- SAP GUI: a scripting/UIA helper can send the current transaction code to the same endpoint.
- Privacy: no page content leaves the browser; URL is matched server-side and not stored.
