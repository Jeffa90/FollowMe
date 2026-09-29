// Generates openapi.yaml from the actual route files so documentation cannot silently drift (a test re-derives and compares).
import fs from "node:fs";
import path from "node:path";

const root = path.resolve("src/app/api");
export function scanRoutes(): { path: string; methods: string[]; file: string }[] {
  const out: { path: string; methods: string[]; file: string }[] = [];
  const walk = (d: string) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name === "route.ts") {
        const src = fs.readFileSync(p, "utf8");
        const methods = [...src.matchAll(/export const (GET|POST|PUT|PATCH|DELETE)\b/g)].map((m) => m[1]);
        const rel = "/api/" + path.relative(root, path.dirname(p)).split(path.sep).map((s) => s.replace(/^\[(.+)\]$/, "{$1}")).filter(Boolean).join("/");
        out.push({ path: rel.replace(/\/$/, ""), methods, file: path.relative(process.cwd(), p) });
      }
    }
  };
  walk(root);
  return out.sort((a, b) => a.path.localeCompare(b.path));
}

const S: Record<string, string> = {
  "POST /api/auth/login": "Local role-simulation sign-in (disabled unless AUTH_MODE=local)", "POST /api/auth/logout": "Sign out and revoke the session", "GET /api/auth/dev-users": "List simulation users (local mode only)",
  "POST /api/auth/token": "Issue a scoped, revocable capture token (session only)", "GET /api/me": "Current user and roles",
  "GET /api/guides": "Workspace: guides in progress visible to the caller", "POST /api/guides": "Create a guide (draft) from a template", "GET /api/guides/{id}": "Guide with readable versions",
  "PATCH /api/guides/{id}/metadata": "Update governance metadata (owner, backup, review frequency, classification...)", "POST /api/guides/{id}/revisions": "Start a revision (or urgent correction) of a published guide",
  "POST /api/guides/{id}/lifecycle": "Mark under review, complete review, or archive", "GET /api/guides/{id}/compare": "Compare two versions", "GET /api/guides/{id}/feedback": "List feedback (owners; submitter identity is never returned)",
  "POST /api/guides/{id}/feedback": "Rate a guide or report it outdated/unclear/broken", "PATCH /api/guides/{id}/feedback": "Acknowledge or resolve feedback", "POST /api/guides/{id}/favourite": "Toggle favourite",
  "GET /api/guides/{id}/qr": "QR code (SVG) for the short link", "POST /api/guides/{id}/reconcile": "Analyse an edited export (multipart) or create a draft from accepted edits (JSON)",
  "GET /api/versions/{id}": "Version content and decisions", "PUT /api/versions/{id}/content": "Autosave content (optimistic concurrency by rev; only editable states)", "POST /api/versions/{id}/workflow": "Submit, review, approve, publish, discard",
  "GET /api/versions/{id}/health": "Run and return explainable health findings", "GET /api/versions/{id}/export": "Controlled export: format=docx|pdf|html|md|zip", "GET /api/versions/{id}/suggestions": "List suggestions (rules/AI) for a draft",
  "POST /api/versions/{id}/ai": "Generate suggestions (task=suggest_missing|terms|rewrite_step|mismatch|quiz|faq|summary|translate)", "GET /api/versions/{id}/steps/{stepId}/image": "Step screenshot with annotations and burned-in redaction",
  "POST /api/versions/{id}/steps/{stepId}/regenerate": "Propose regenerated wording from the original recording evidence", "GET /api/versions/{id}/training": "Knowledge-quiz questions (answers not included)", "POST /api/versions/{id}/training": "Mark read, acknowledge, submit quiz, or record a competency sign-off",
  "POST /api/health/{id}": "Accept or reopen a health finding exception", "POST /api/recommendations/{id}": "Accept or dismiss a review recommendation (never edits content)", "POST /api/suggestions/{id}": "Accept or reject a suggestion (explicit human decision)",
  "POST /api/assets": "Upload an image or attachment (multipart)", "GET /api/assets/{id}": "Download a file the caller may read", "POST /api/assets/{id}/crop": "Crop into a new asset; the original is untouched",
  "GET /api/capture/policy": "Capture policy for the extension (token scope: capture)", "GET /api/capture/sessions": "List own recordings", "POST /api/capture/sessions": "Start a recording session (token scope: capture)",
  "GET /api/capture/sessions/{id}": "Recording evidence", "PATCH /api/capture/sessions/{id}": "Pause, resume or stop", "DELETE /api/capture/sessions/{id}": "Discard a recording", "POST /api/capture/sessions/{id}/events": "Append one captured event (values/keystrokes never stored)",
  "POST /api/capture/sessions/{id}/generate": "Generate a draft guide from the recording", "POST /api/capture/sessions/{id}/append": "Insert recorded steps into an existing draft", "POST /api/capture/sessions/{id}/compare": "Compare a recording with an existing guide; optionally file a recommendation",
  "GET /api/search": "Full-text search of published guides with filters and synonyms", "GET /api/context/suggest": "Guides associated with a URL / SAP transaction (future side panel)", "POST /api/ask": "Ask a question; answers cite guide and step or say none exists",
  "GET /api/imports": "Own import batches and files", "POST /api/imports": "Upload documents (multipart): individual or batch, optional dry run", "GET /api/imports/{id}": "Import review data (source blocks, conversion, flags)",
  "POST /api/imports/{id}": "Confirm, reject, retry, materialise a dry run, assign an image, compare with a guide", "GET /api/imports/batches/{id}": "Batch with reconciliation totals", "GET /api/imports/batches/{id}/report": "Exception report (CSV)",
  "GET /api/blocks": "List reusable blocks", "POST /api/blocks": "Create a reusable block", "GET /api/blocks/{id}": "Block with affected guides (impact)", "PUT /api/blocks/{id}": "Revise a block (requires impact acknowledgement; files review recommendations)",
  "GET /api/maps": "List process maps", "POST /api/maps": "Create a process map draft", "GET /api/maps/{id}": "Process map with resolved guide references", "PUT /api/maps/{id}": "Edit a draft map", "POST /api/maps/{id}": "Validate and publish a map",
  "GET /api/analytics": "Aggregate process analytics (no per-person data)", "GET /api/audit": "Audit trail (or ?verify=1 to verify the hash chain)", "GET /api/notifications": "Own notifications", "POST /api/notifications": "Mark all as read",
  "GET /api/admin/users": "List users", "PATCH /api/admin/users": "Update roles, clearance or active state", "GET /api/admin/settings": "AI, capture and retention policy", "PUT /api/admin/settings": "Update policies and legal hold",
  "GET /api/admin/registry": "Synonyms, retired references, taxonomy, workflows, templates, tokens, webhooks", "POST /api/admin/registry": "Add a registry entry", "PUT /api/admin/registry": "Update a template definition", "DELETE /api/admin/registry": "Revoke an API token",
  "POST /api/admin/webhooks": "Create a signed webhook subscription (SSRF-guarded)", "POST /api/admin/health-scan": "Run an organisation health scan now",
};
const TAGS = (p: string) => (p.split("/")[2] ?? "misc");
const TOKEN_OK = new Set(["GET /api/me", "GET /api/capture/policy", "POST /api/capture/sessions", "PATCH /api/capture/sessions/{id}", "POST /api/capture/sessions/{id}/events"]);
const PUBLIC = new Set(["POST /api/auth/login", "GET /api/auth/dev-users"]);
const MULTIPART = new Set(["POST /api/assets", "POST /api/imports", "POST /api/guides/{id}/reconcile"]);
const BINARY = new Set(["GET /api/assets/{id}", "GET /api/versions/{id}/export", "GET /api/versions/{id}/steps/{stepId}/image", "GET /api/guides/{id}/qr", "GET /api/imports/batches/{id}/report"]);

export function build(): string {
  const L: string[] = [
    "openapi: 3.1.0", "info:", "  title: FollowMe API", "  version: 0.1.0",
    "  description: |", "    Work-instruction lifecycle platform API. Every operation is authorised server-side (role, organisation, site and classification).", "    Cookie-session requests that change state require the X-CSRF-Token header (double-submit). Browser-extension requests use scoped bearer tokens.",
    "    This file is GENERATED by scripts/gen-openapi.ts from the route files and verified by tests/openapi.test.ts.",
    "servers:", "  - url: http://localhost:3000",
    "components:", "  securitySchemes:", "    cookieAuth: { type: apiKey, in: cookie, name: fm_session }", "    csrfToken: { type: apiKey, in: header, name: X-CSRF-Token }", "    bearerToken: { type: http, scheme: bearer, description: 'Scoped API token (fmt_...), e.g. scope capture' }",
    "  schemas:", "    Error:", "      type: object", "      properties:", "        error:", "          type: object", "          properties: { code: { type: string }, message: { type: string }, requestId: { type: string }, details: {} }",
    "  responses:", "    Unauthorized: { description: Authentication required, content: { application/json: { schema: { $ref: '#/components/schemas/Error' } } } }", "    Forbidden: { description: Not permitted (role, segregation of duties, CSRF), content: { application/json: { schema: { $ref: '#/components/schemas/Error' } } } }",
    "    NotFound: { description: Not found or not visible to the caller (cross-organisation objects are indistinguishable from missing ones), content: { application/json: { schema: { $ref: '#/components/schemas/Error' } } } }",
    "    Invalid: { description: Validation failed or business rule violated, content: { application/json: { schema: { $ref: '#/components/schemas/Error' } } } }", "    Conflict: { description: State conflict (e.g. immutable version, stale rev), content: { application/json: { schema: { $ref: '#/components/schemas/Error' } } } }", "    TooMany: { description: Rate limited, content: { application/json: { schema: { $ref: '#/components/schemas/Error' } } } }",
    "paths:",
  ];
  for (const r of scanRoutes()) {
    L.push(`  ${JSON.stringify(r.path).replace(/"/g, "'")}:`);
    const params = [...r.path.matchAll(/\{(\w+)\}/g)].map((m) => m[1]);
    for (const m of r.methods) {
      const key = `${m} ${r.path}`;
      L.push(`    ${m.toLowerCase()}:`, `      summary: ${JSON.stringify(S[key] ?? `${m} ${r.path}`)}`, `      tags: [${TAGS(r.path)}]`, `      operationId: ${m.toLowerCase()}${r.path.replace(/[^a-zA-Z0-9]+(.)/g, (_x, c: string) => c.toUpperCase())}`);
      if (PUBLIC.has(key)) L.push("      security: []");
      else if (TOKEN_OK.has(key)) L.push("      security:", "        - cookieAuth: []", "          csrfToken: []", "        - bearerToken: []");
      else L.push("      security:", "        - cookieAuth: []", "          csrfToken: []");
      if (params.length) L.push("      parameters:", ...params.map((p) => `        - { name: ${p}, in: path, required: true, schema: { type: string } }`));
      if (m !== "GET") L.push("      requestBody:", "        content:", MULTIPART.has(key) ? "          multipart/form-data: { schema: { type: object } }" : "          application/json: { schema: { type: object } }");
      L.push("      responses:", `        '200': { description: OK${BINARY.has(key) ? ", binary content" : ""} }`, "        '400': { description: Invalid input (schema validation) }", "        '401': { $ref: '#/components/responses/Unauthorized' }", "        '403': { $ref: '#/components/responses/Forbidden' }", "        '404': { $ref: '#/components/responses/NotFound' }");
      if (m !== "GET") L.push("        '409': { $ref: '#/components/responses/Conflict' }", "        '422': { $ref: '#/components/responses/Invalid' }");
      L.push("        '429': { $ref: '#/components/responses/TooMany' }");
    }
  }
  return L.join("\n") + "\n";
}

if (process.argv[1]?.endsWith("gen-openapi.ts")) { fs.writeFileSync("openapi.yaml", build()); console.log("openapi.yaml written"); }
