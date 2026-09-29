# Capture design

## Browser extension (implemented prototype) – `extension/`
Manifest V3, esbuild-bundled to `extension/dist` (`npm run ext:build`). Load unpacked in Chrome/Edge.

**Design rules:** never hidden · never keystrokes · never passwords · one tab · policy-driven exclusions · server is the authority.

| Concern | Implementation |
|---|---|
| Start/pause/resume/stop | popup + `chrome.commands` hotkey **Alt+Shift+P** (local state flips first, then the server is told) |
| Visible indicator | badge `REC`/`II` + closed-shadow-DOM banner with Pause/Stop buttons (announced via `role=status`) |
| Events | `pointerdown`+`click` (confirmed pair), `change`, `submit`, navigation (`webNavigation`). **No** `keydown/keypress/input` listeners |
| Trusted input only | handlers ignore `event.isTrusted === false` (pages cannot forge steps) |
| Target description | tag, role, accessible name, label, input type, select option *label*, checked, id/testid, structural selector hint, rect, viewport. Values are never read; text-input **length only**, omitted for sensitive fields |
| Screenshots | `captureVisibleTab` only when the active tab **is** the recorded tab; sensitive elements + admin selectors + regex text matches are masked with an overlay *before* capture |
| URLs | only `origin+pathname` is ever sent/stored (query and fragment stripped in extension and server) |
| Restricted domains/apps | policy pulled from `/api/capture/policy`; navigating onto one auto-pauses; server rejects the event (422 `restricted_domain`) and pauses the session |
| Reliability | events registered with the background synchronously; screenshot merged when it arrives; 2.5 s timeout flush; retries with backoff; idempotent by `(session, seq)` |
| Auth | scoped bearer token (`capture`), created from the web UI, expiring/revocable |

**Server:** `src/server/services/capture.ts` (ingest, redaction of text, evidence storage), `src/lib/stepgen.ts` (rules-based step generation), `POST /api/capture/sessions/:id/generate|append|compare`.

**Step generation** (`stepgen.ts`): action-oriented text per event type; drops duplicates, double clicks, loading screens, unnamed generic clicks, click-into-field merged with its entry, consequences of a click (navigation); flags ambiguous/redundant/sensitive steps; highlights the target rectangle; suggests (never inserts) warnings and validation checks; proposes title/purpose/audience/prerequisites/expected result **with low confidence markers**; per-step regeneration from stored evidence.

**Known prototype limits:** single tab; no iframes/shadow DOM/canvas; screenshot is taken at pointer-down (page state may already be changing); no video; SPA fragments dropped with the URL query; Chromium only.

## Desktop capture (design only – NOT implemented)
Goal: same evidence model, different collector.
1. **Collector:** Windows agent (.NET, UI Automation) recording foreground-window changes and UIA invoke/selection events with element name/control type/automation id (no keystroke hooks; password edits detected via `IsPassword`).
2. **Screenshots:** per-window capture (Windows Graphics Capture), masked via UIA-provided element rectangles for password/redaction-selector matches before persistence.
3. **Transport:** same `/api/capture/sessions/*` contract (bearer token, `CapturedEvent` schema) – the server needs **no changes** beyond new `target` fields (`automationId`, `controlType`, `processName`).
4. **Policy:** restricted apps by process name/window title (already in `capturePolicy.restrictedApps`), visible tray indicator, global hotkey, MDM-deployed and code-signed.
5. **Risks:** anti-cheat/DRM windows, elevated processes (UIPI), remote-desktop scenarios, DPI scaling.
Nothing above is built; do not treat desktop capture as available.
