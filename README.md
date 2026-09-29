# FollowMe

A governed **work-instruction lifecycle platform**: capture → draft → enhance → review → approve → publish → use → monitor → update.

- **Capture** a browser process with a Chromium extension and get an editable step-by-step guide.
- **Redevelop legacy instructions** (Word, PDF, PowerPoint, HTML, Markdown, scans) into a structured, governed format – with confidence flags and mandatory human confirmation.
- **Govern**: immutable published versions, single/multi-stage approval, segregation of duties, urgent corrections, hash-chained audit trail.
- **Distribute**: live links, guided view, Word/PDF/HTML/Markdown/offline exports with control blocks, embed route, signed webhooks.
- **Use**: full-text search with synonyms, an assistant that answers *only* from approved, authorised content and always cites guide + step.
- **Maintain**: explainable health checks, overdue/outdated/orphan detection → review *recommendations* (never automatic edits), aggregate analytics (never people scoring).

> **Honesty note.** This is an MVP. `docs/requirements-traceability.md` lists every requirement with its real status (implemented+tested / partial / designed only), and `docs/known-limitations.md` lists what is *not* done (Entra ID login, SharePoint/Teams adapters, desktop capture, live-LLM verification, manual accessibility audit …).

## Quick start (local)

Requirements: Node 22, PostgreSQL 16, (for full import/export fidelity) `poppler-utils`, `tesseract-ocr`, `fonts-dejavu-core`.

```bash
git clone <repo> && cd FollowMe
npm ci                              # also runs `prisma generate`
cp .env.example .env                # edit DATABASE_URL if needed (dev needs nothing else)
createdb followme                   # or any empty database matching DATABASE_URL
npm run db:migrate                  # prisma migrate deploy
npm run db:seed                     # fictional org, 13 users, demo guides taken through the real workflow
npm run dev                         # http://localhost:3000  (background jobs run inline)
# production-style: npm run build && DEMO_MODE=true npm start   and, separately:   npm run worker
#   (`npm start` refuses AUTH_MODE=local unless DEMO_MODE=true; real deployments use AUTH_MODE=entra)
```

Sign in with the **role picker** on `/login` (local simulation – dev only). Useful users: `alice` (author), `olivia` (process owner), `rita` (reviewer), `alan` (approver), `pat` (publisher), `lena` (learner, Manchester), `leo` (learner, Leeds), `ada` (admin), `aud` (auditor).

### Docker
```bash
docker compose up --build           # db + web + worker on http://localhost:3000
docker compose run --rm web npm run db:seed
```
(`DEMO_MODE=true` in the compose file enables the local login. Never expose it.) *Not exercised in the authoring sandbox (no Docker daemon); the CI workflow builds it from source instead.*

### Try the capture extension
```bash
npm run ext:build                   # → extension/dist
```
Chrome/Edge → `chrome://extensions` → Developer mode → **Load unpacked** → `extension/dist`. In FollowMe open **Capture**, create a token, paste URL + token in the extension popup, open `/demo/expenses`, press **Start recording** (red REC badge + on-page banner; **Alt+Shift+P** pauses), click through, **Stop** → review evidence → *Generate draft guide*.

### Import legacy documents
UI: **Import** (single, batch, dry run). CLI for an authorised folder (read-only):
`npm run import:folder -- ./legacy-docs --as alice@contoso.example --dry-run`

## Commands
| Command | What |
|---|---|
| `npm test` | Vitest: unit, integration (real PostgreSQL `followme_test`, recreated automatically), security, AI-grounding/injection, import, export, capture |
| `npm run test:e2e` | builds the extension, then Playwright (fresh DB + seed + `next start` on :3100): journeys A–F, editor, accessibility (axe WCAG 2.2 AA) |
| `npm run typecheck` / `npm run lint` | TypeScript / ESLint |
| `npx tsx scripts/gen-openapi.ts` | regenerate `openapi.yaml` (a test fails if it drifts from the routes) |
| `npm run db:reset` | drop, migrate, seed the dev database |

Environment variables: see `.env.example` (validated at start-up by `src/server/env.ts`).

## Repository map
```
src/lib/            pure shared code: guide schema, step ops, compare, step generation, policy, templates
src/server/         services (authz lives here), ai/, import/, export/, storage/, jobs, audit, session, http wrapper
src/app/            Next.js pages (server components) and api/**/route.ts
src/components/     editor, guide rendering, governance UI
extension/          MV3 capture extension (src → dist via esbuild)
prisma/             schema, migrations (incl. immutability triggers), seed
tests/              vitest suites; tests/e2e Playwright specs
docs/               discovery, architecture, UX, decision log, traceability, limitations, test report
scripts/            worker, folder import CLI, OpenAPI generator, e2e server
```

## Documentation
`docs/01-discovery` (brief, personas, journeys, assumptions, risks, backlog) · `docs/02-architecture` (architecture, data model, security & threat model, AI, capture, import, integrations, deployment) · `docs/03-ux` · `docs/implementation-status.md` · `docs/requirements-traceability.md` · `docs/known-limitations.md` · `docs/test-report.md` · `docs/decision-log.md` · `openapi.yaml`.
