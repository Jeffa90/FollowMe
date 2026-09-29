# UX design (Phase 3)

## Information architecture
- **Everyone:** Home (role-aware) · Library · Ask · Process maps · Training · Notifications
- **Authors:** Workspace (new guide, drafts) · Capture · Import · Reusable blocks
- **Reviewers/Approvers/Publishers:** Review queue
- **Owners/Admins/Auditors/Publishers:** Owners & reviews · Analytics
- **Admins:** Administration · **Auditors/Admins:** Audit
- **Guide (contextual):** live view `/g/{id}` · guided view `/g/{id}/guided` · historical `/g/{id}/v/{n}` · short link `/s/{code}` · embed `/embed/g/{id}` · governance `/guides/{id}` · editor `/guides/{id}/edit` · compare `/guides/{id}/compare`

## Screen inventory (all implemented)
Login (role picker) · Home · Library/search · Guide view · Guided view · Historical/redirect · Ask · Training · Notifications · Workspace · Editor (details, procedure, results, side panel: outline, suggestions, quality checks; previews desktop/mobile/print; annotation dialog) · Governance (actions, health, metadata, history, approvals, feedback, recommendations, audit, reconcile) · Version compare · Capture list/detail · Import list / review (side by side) / batch (reconciliation) · Review queue · Owner dashboard · Analytics · Blocks · Process maps · Admin · Audit.

## Key flows
1. **Record → guide:** extension REC → stop → `/captures/{id}` (evidence, preview of what will be generated, dropped events with reasons) → Generate → editor.
2. **Import → guide:** upload → conversion progress → side-by-side (source blocks coloured by outcome ↔ converted steps with confidence and flags) → confirm → editor/governance.
3. **Review:** queue → governance page → decision with comment → next stage → publish.
4. **Use:** search/ask → guide (banner, control block) → step deep links → feedback / outdated report → owner dashboard.

## Design tokens (`src/app/globals.css`)
CSS custom properties, light + dark palettes. Text ≥ 4.5:1, UI ≥ 3:1 (axe verifies computed contrast on every screen in both schemes). Primary teal `#0f766e` (light) / `#2dd4bf` (dark); danger, warn, ok, info pairs have text + background + border tokens. Spacing 8/16 px scale; radius 10 px; focus ring 3 px `--focus`; `prefers-reduced-motion` respected; print stylesheet hides chrome and avoids splitting steps.

## Accessibility patterns (WCAG 2.2 AA *target*)
- Skip link; landmarks (`header`, `nav aria-label`, `main`); one `h1` per page; `lang="en-GB"`.
- Every input has a visible label; errors in `role="alert"`, successes/progress in `role="status"`/`aria-live`.
- Status is never colour alone: badges carry text; findings carry severity text.
- **No dragging required (2.5.7):** step reorder = up/down buttons; annotations drawn by drag *or* two clicks, and adjusted with numeric fields.
- Keyboard: all actions are buttons/links; undo/redo shortcuts (Ctrl+Z/Y) outside text fields; guided view uses ←/→; dialogs are native `<dialog>` (focus trapped, Esc closes).
- Targets ≥ 24 px (2.5.8); reflow verified at 320 px (1.4.10); images have alt text (and a health finding when missing).
- Tables have captions/headers; toolbars have labels.
**Evidence:** `tests/e2e/a11y.spec.ts` runs axe (WCAG 2.0/2.1/2.2 A+AA rules) on ~25 screens in light and dark, plus keyboard and reflow checks. **Automated checks find roughly a third of WCAG issues; a manual audit with assistive technology is still required before claiming conformance** (see known limitations).
