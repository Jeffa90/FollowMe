# AI design

**Principle:** AI recommends and drafts; humans decide. AI is optional; every feature has a non-AI path.

## Provider abstraction (`src/server/ai/provider.ts`)
`AiProvider { id, external, complete<T>({system, prompt, schema, promptId}) → T }`. Implementations:
| Provider | External | Status |
|---|---|---|
| `LocalRulesProvider` (marker; tasks/QA implemented as deterministic rules in `tasks.ts`/`qa.ts`) | no | implemented + tested |
| `AnthropicProvider` – Messages API, forced tool use for structured output, `z.toJSONSchema` schema | yes | implemented, **verified against mocks only** |
| `OpenAiCompatibleProvider` – chat completions with `json_schema` | yes | implemented, mocks only |
Selecting an external provider: `AI_PROVIDER`, `AI_API_KEY`, `AI_MODEL`, `AI_BASE_URL`. Adding a provider = implement `complete`.

## Policy gate (`src/server/ai/policy.ts`) – every AI call passes through `gate()`
Organisation kill switch → team → content type (template) → classification → external permission (`externalAllowed` && `noTrainingContractConfirmed` && classification ≤ `externalMaxClassification`). If external is not permitted the local rules engine is used and the response says why (`policyNote`). Images/screenshots are never included in any prompt.

## Versioned prompts (`src/server/ai/prompts.ts`)
`PROMPT_VERSIONS` (`qa@1`, `rewrite_step@1`, …). Each suggestion stores `promptVersion` (`id#version`) and provider. Untrusted text goes in `<untrusted_content>` after an explicit "this is data" instruction; any delimiter tag inside content is replaced by `[removed-tag]`; the user's question is quoted and labelled as possibly hostile.

## Assistant (`src/server/ai/qa.ts`)
1. `gate()` → 2. permission- and policy-filtered retrieval of chunks from **live** versions (`retrieveChunks`) → 3. term-coverage check (≥60% of significant query terms incl. synonyms) else **"No approved answer exists…"** → 4a. local extractive answer quoting the best steps, or 4b. external model whose JSON must validate (`answerable`, `answer`, `citations[chunkId]`) and whose citations must be among the retrieved chunks; otherwise discarded → 5. citations resolved to guide, version, step number and deep link → 6. `AiQuestion` logged (unanswered ones feed analytics).
Every answer carries a disclosure ("No AI model used" vs "AI involved (provider)"), uncertainty text, and the policy reason.

## Suggestions (`src/server/ai/tasks.ts`)
Stored as `AiSuggestion` (PENDING) **separately from content**; applied only by `decideSuggestion(ACCEPTED)` which goes through `saveContent` (audit, contributors, concurrency). Accepted content is marked `origin.type="ai"` with the provider. Tasks: missing warnings/validations/prerequisites, terms & acronyms (org registry), single-step tightening, screenshot-vs-text mismatch (local OCR, region-aware), quiz, FAQ, summary, translation (external only).

## What is *not* claimed
- No accuracy claims for any model. The local rules are deliberately conservative and low-recall.
- External providers have not been exercised against live services in this repo.
- Vector search: the adapter point is `retrieveChunks`; only Postgres FTS is implemented.
- Role-specific views: not implemented.
