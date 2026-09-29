# Deployment

## Local (developer)
See `README.md`: `npm ci`, `.env`, PostgreSQL 16, `npx prisma migrate deploy`, `npm run db:seed`, `npm run dev` (jobs run inline) or `npm run worker`.

## Docker Compose (demo)
`docker compose up --build` → `db` (Postgres 16), `web` (`prisma migrate deploy && next start`), `worker`. Profiles: `s3` (MinIO), `clamav`. The compose file sets `DEMO_MODE=true` (local login); **never expose it**.
Seed: `docker compose run --rm web npm run db:seed`.

## Production shape (recommended)
| Concern | Choice |
|---|---|
| Runtime | 2+ web replicas + 1..n workers, same image |
| DB | Managed PostgreSQL 16 (encryption at rest, PITR); apply migrations with `prisma migrate deploy` in the release pipeline |
| Blob | S3-compatible or **Azure Blob** (adapter is design-only; implement `BlobStore` – 4 methods) with server-side encryption; keep `ASSET_ENCRYPTION_KEY` for app-level AES-GCM |
| TLS | terminate at ingress; set `APP_BASE_URL` to the https URL (used in control blocks, QR codes, exports) |
| Identity | `AUTH_MODE=entra` (adapter to be built); `DEMO_MODE` unset |
| Secrets | Key Vault / secret manager injecting env vars; rotate `SESSION_SECRET` (invalidates sessions) |
| Malware scanning | `MALWARE_SCANNER=clamav` + `CLAMAV_HOST` |
| Rate limits | replace `src/server/ratelimit.ts` with a shared store before scaling out |
| Residency | choose region for DB + blob; `Organization.dataRegion` is a label shown to admins |
| Backups | DB PITR + blob versioning; audit table is append-only but must be backed up |

## Configuration reference
`.env.example` documents every variable; `src/server/env.ts` validates them at start-up (fails fast).

## Migrations
`prisma/migrations/`: `init` (tables) and `search_and_immutability` (generated `tsvector`, GIN index, immutability/append-only triggers). CI runs `migrate deploy` against an empty DB then `prisma/seed.ts`.
