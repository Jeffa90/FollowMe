# Legacy import pipeline

```
upload ─► validateUpload (sniff/size/macro/JS/zip-bomb/malware) ─► store IMPORT_SOURCE (immutable) ─► ImportItem(QUEUED)
   └► job import.process ─► extractDocument ─► convertToGuide ─► store IMPORT_IMAGE evidence ─► (live) create draft guide
                                                                   └► (dry run) keep result only
   └► finaliseBatch: near-duplicates, existing-guide similarity, likely-superseded, reconciliation totals
human: review side-by-side ─► fix/flag resolution ─► CONFIRM ─► normal workflow (review → approve → publish)
```

## Extraction (`src/server/import/extract.ts`)
| Type | Method |
|---|---|
| DOCX | mammoth → HTML → cheerio (headings, paragraphs, nested lists with numbers, tables, images in order); headers/footers + `docProps/core.xml` via JSZip |
| PDF | pdfjs (via unpdf) text items → lines (y-clustering), font size/bold → headings, list markers; embedded images via `pdfimages -p`; page renders via `pdftoppm` (kept as visual evidence); **scanned PDFs** → OCR per page |
| PPTX | slide XML: title placeholder → heading, other text → list items; images from slide rels |
| HTML | cheerio after removing `script/style/iframe/object/embed/form`; data-URI images only; external images are **not fetched** |
| Markdown | `marked` lexer; image references not fetched |
| PNG/JPEG | OCR (`OcrProvider`; Tesseract CLI; `OCR_PROVIDER=none` disables) |
Document-control fields (document id, version, effective/review date, owner, author, approver, site, department) are detected in headers, first tables and first paragraphs; **conflicting values are surfaced**, not silently resolved.

## Conversion (`src/server/import/convert.ts`) – rules only, no LLM
- **Never invents facts:** sections not found stay empty and raise `missing-section`; text is carried verbatim (numbering markers stripped; a sentence may be split into title/detail without rewording).
- Section detection by heading synonyms; tables → responsibilities/definitions/troubleshooting/steps; `WARNING:`/`NOTE:` → warning/note steps; nested items appended to parents.
- **Confidence** per step (list-under-procedure 0.9 → bullet 0.7 → paragraph 0.5 → OCR −0.2 → vague language −0.1) and per section; overall confidence.
- **Flags:** vague language, possible decision, numbering gaps/duplicates, duplicate steps, broken step/appendix cross-references, unrecognised sections, unplaced blocks, conflicting control data, contradictory dates, obsolete-looking age (default 24 months), retired systems/transaction codes (org registry + built-ins), legacy approvals dropped, OCR.
- **Images → steps** by document order (0.7), preceding-step fallback (0.45), same-page for PDFs (0.4); unmatched images listed for manual placement. Images are flagged `needsReplacement` when the document is old, low-resolution, or references retired systems – which **blocks submission** until replaced or confirmed accurate.
- **Change summary:** every source block is accounted for as `retained` / `rewritten` / `removed` (with reason) / `uncertain` (test asserts `blocks.length == source blocks`).

## Bulk migration
- `POST /api/imports` (multi-file) or `npm run import:folder -- <dir> --as <author> [--dry-run|--inventory-only]` (authorised folders only; read-only).
- **Dry run:** analyse + report, create no guides; a dry-run item can later be *materialised*.
- Exact duplicates (sha256) → `DUPLICATE`; near-duplicates (≥85%) and similarity to live guides (≥80%) → warnings; same legacy document id with a higher version → *likely superseded*.
- Grouping keys: process / site / system / function / department from metadata mapping + taxonomy.
- **Reconciliation:** `submitted = converted + duplicates + failed + rejected + pending` must balance; CSV exception report (formula-injection safe).
- Sources are never deleted or overwritten; "reject" keeps the source file.

## Limits
Legacy `.doc/.ppt` are rejected with guidance; complex multi-column PDFs, text boxes, and images inside PDFs without text context convert poorly (flagged as uncertain). No SharePoint inventory (adapter designed).
