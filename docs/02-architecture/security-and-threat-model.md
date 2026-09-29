# Security architecture and threat model

## Controls implemented (with evidence)
| Control | Implementation | Test |
|---|---|---|
| Server-side RBAC & least privilege | `authz.ts` + per-service role checks; UI hides but never grants | `tests/security.test.ts`, `lifecycle.test.ts` |
| Org / site / classification isolation | `guideScope()`, `canSeeGuide`, search/retrieval SQL filters | cross-org 404 matrix, `ai.test.ts` permission tests |
| Segregation of duties | authors/contributors cannot review/approve; author cannot publish; urgent initiator ≠ author | `lifecycle.test.ts` |
| CSRF | Origin check + HMAC(session id) double-submit token; bearer tokens exempt but scoped | `security.test.ts` |
| Session security | JWT (HS256) with server-side revocable session row, HttpOnly + SameSite=Lax (+Secure in prod) | `security.test.ts`, `platform.test.ts` |
| XSS | React escaping; no `dangerouslySetInnerHTML`; safe inline-markup parser; URL scheme allow-list; strict CSP with per-request nonce (`proxy.ts`); exports escape all text; assets served `nosniff` + `sandbox` CSP | `units`, `export`, `security` tests |
| Injection | Prisma parameterisation; the two raw SQL builders use `Prisma.sql` with bound values and sanitised tsquery tokens | search tests |
| Uploads | magic-byte allow-list, extension/content match, size caps, macro/JS rejection, OOXML zip-bomb limits, scanner interface (EICAR built-in; ClamAV INSTREAM adapter) | `import.test.ts`, `security.test.ts` |
| Rate limiting | in-memory sliding window per user/IP and route | `security.test.ts` (login → 429) |
| Encryption in transit / at rest | TLS terminated at the reverse proxy (HSTS header set in production); AES-256-GCM envelope for stored assets; DB/disk encryption is a deployment control | `security.test.ts` (ciphertext + tamper detection) |
| Secrets | environment only (`env.ts` validates); no secrets in repo; webhook secrets shown once | — |
| Audit | append-only, hash-chained; exports, AI decisions, admin changes included | `lifecycle`, `platform` |
| Malicious extension input | server re-validates every event: kill switch, restricted domains, whitelisted target fields (values dropped), URL query/fragment stripped, text redaction patterns, size/count limits | `security.test.ts` |
| Redaction | capture-time masking (password/card/OTP/admin selectors/regex), manual blur annotation **burned in** for readers, sensitive-content health finding | `export.test.ts`, `journey-a` |
| SSRF | webhook URL guard (https, no credentials, DNS → private/loopback/link-local refused); import never fetches external images; no `redirect: follow` | `platform.test.ts` |
| Kill switches | capture (`capturePolicy.enabled`), AI (`aiPolicy.enabled`), external AI, per-team/type/classification | `security`, `ai` tests |
| Retention / legal hold | `retention.sweep` job, org legal hold suspends deletion | `platform.test.ts` |

## Threat model (STRIDE-oriented, per required area)
| Threat | Attack | Mitigation | Residual risk |
|---|---|---|---|
| **Sensitive screen capture** | Recording a payroll/banking page; passwords or PANs in screenshots; secrets in URLs | Restricted domains block start and auto-pause; masks before screenshot; URLs reduced to origin+path; server re-checks; sensitive flag; human review; kill switch | Masking is heuristic: canvas/iframes/PDF viewers and text not matching patterns are not masked. Authors must review screenshots. |
| **Malicious uploads** | Macro docs, JS-in-PDF, polyglots, zip bombs, EICAR, SVG script, extension spoofing | See uploads row; imported HTML is parsed not rendered; images re-encoded when rendered | No real AV unless ClamAV is deployed; DOCX parsing libraries could have their own CVEs |
| **Prompt injection** | Instructions inside imported docs, guide text, or user questions | Rules-based import (no LLM); local extractive answers; for LLMs: delimiters + tag stripping + schema + citation grounding + no tools | Semantic manipulation of an LLM answer that still cites a real chunk is possible; disclosure + verify-at-step mitigates |
| **Cross-user information leakage** | Learner asks about another site's/classified guide; search/AI leaking drafts | Permission-aware retrieval in SQL; drafts never indexed; tests for site + classification | Chunk text of a guide the user *can* see is shown verbatim (by design) |
| **Broken object-level authorisation** | Guessing ids across orgs/roles | 404 for unknown/cross-org; every service loads with org scope and checks visibility; matrix test over each object type | New endpoints must follow the pattern; `openapi.test.ts` enforces `route()` wrapper use |
| **Unauthorised publication** | Author publishes own work; approver bypass; direct SQL edits | Role + segregation checks; publish requires APPROVED; DB trigger blocks illegal transitions/content edits; audit | A DB superuser can disable triggers (operational control) |
| **Export leakage** | Exporting drafts/restricted content; uncontrolled copies circulating | Export uses read authorisation; drafts get DRAFT banner; every export is recorded + audited; control block + live-source warning; redaction burned in | Once downloaded, a file is outside control (documented as *uncontrolled*) |
| **Compromised browser extension / token** | Stolen capture token; malicious page forging events | Token: scoped to `capture`, expiring, revocable, hashed, cannot mint tokens, cannot read guides; events accepted only from `isTrusted` DOM events; server rejects restricted domains/values | A stolen token can upload junk recordings until revoked (rate limited) |
| **Unsafe embedded content** | `javascript:` links, `<script>` in text, third-party frames | URL scheme allow-list on save *and* render; no HTML rendering; CSP `frame-src 'none'`; embed route framed only by SharePoint/Teams ancestors | Video is link-only in MVP (no third-party embeds) |
| **Tampering with history** | Editing audit or published content | Append-only triggers + hash chain + immutability triggers | Chain proves tampering, does not prevent DB-level deletion of whole tables by a superuser |
| **Denial of service** | Huge uploads, huge content, many requests | Body/file size limits, zod max lengths, step/asset caps, rate limits, import block caps | In-memory rate limiter is per instance |

## Secure-by-default configuration
- `AUTH_MODE=local` refuses to start when `NODE_ENV=production` unless `DEMO_MODE=true` (loudly warned).
- External AI is off; even when configured it needs `externalAllowed` **and** `noTrainingContractConfirmed`, and classification ≤ `externalMaxClassification`. Screenshots are never sent (the prompts contain text only; OCR mismatch check runs locally).
- Capture default policy masks emails, card numbers and UK NI numbers.

## Reviewing changes
Checklist for new endpoints: uses `route()`; loads via a service that scopes by `orgId`; returns 404 for invisible objects; validates with zod; records audit for state changes; adds a cross-org test.
