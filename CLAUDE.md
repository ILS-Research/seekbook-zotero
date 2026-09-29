# SeekBook (Zotero plugin)

Full-text index for **books** (item type `book`, every PDF attachment) in Zotero 7–10: overlapping word windows,
embeddings from a self-hosted server (Ollama `/api/embed` or OpenAI-compatible `/v1/embeddings`) plus BM25, fused
with RRF. No search UI of its own: other plugins (SeekChat, optionally ZotSeek) use the **REST API** on Zotero's
local server. Plan and status: `../ideas-seekbook.md` (German) — keep it updated when scope or decisions change.
Settings pane texts are English with a German translation (`t()` in `src/i18n.ts`, add keys to both tables).

## Commands

The host has no usable Node. **Everything runs in Docker** via the scripts (`docker` or `sudo docker`, caller's uid).

| Task | Command | Log |
|---|---|---|
| Deps, unit tests, typecheck, build, `dist/seekbook-<v>.xpi` | `./build.sh` | `logs/build.log` |
| Unit tests only | `./build.sh test` | `logs/build.log` |
| E2E run (real Zotero 10.0.3 under Xvfb + mock embedding server) | `./e2e/run.sh` | `logs/e2e.log`, `e2e/out/` |
| Publish built xpi to the portal downloads | `scripts/publish.py ../zotero_selfhost_src/data/downloads` | |

- Run scripts with output discarded and read the log tail: `./e2e/run.sh >/dev/null 2>&1; tail -20 logs/e2e.log`.
- Version only in `package.json`; `manifest.json` keeps `0.0.0` and is stamped at build.
- `update_url` → `<portal>/downloads/seekbook/updates.json` (see SeekChat's CLAUDE.md for the portal).
- Git repo on branch `master`. After each prompt: bump the patch version, build, commit, tag `v<version>`.

## Layout

| Path | Purpose |
|---|---|
| `bootstrap.js`, `src/index.ts` | Plugin object `Zotero.SeekBook` (startup: store, endpoints, notifier, prefs pane, resume queue; JS API `search/stats/isIndexed`) |
| `src/prefs.ts`, `prefs.js` | Typed prefs `extensions.zotero.seekbook.*` |
| `src/core/text/` | Pure text preparation: `clean.ts` (running headers/footers, TOC pages, empty pages), `outline.ts` + `pdf-outline.ts` (copied from SeekChat, plus printed TOC as source `'toc'`, page labels), `windows.ts` (word windows, sentence snapping, page mapping), `prepare.ts` (per PDF pipeline, reading order, duplicates), `tokenize.ts` (SeekChat's tokenizer/`searchKey`) |
| `src/core/embed/` | `client.ts` (embedding HTTP with host guard, retry/backoff), `vectors.ts` (normalize, int8, cosine) |
| `src/core/store.ts` | `seekbook.sqlite` on its own `Zotero.DBConnection`: books, documents (= queue), chunks, terms (BM25), pages, page_labels, outline |
| `src/core/indexer.ts` | Scan (books, PDFs, hashes, exclude tag), persistent queue, per-book processing (duplicates, embeddings) |
| `src/core/ranking.ts`, `src/core/search.ts` | BM25, RRF (k = 60), passage merging; int8 scan → float32 rescoring, vector LRU cache |
| `src/core/rest.ts` | `/seekbook/stats`, `/seekbook/search`, `/seekbook/pages` |
| `src/ui/preferences.ts`, `content/preferences.xhtml` | Settings pane with status and Index/Pause/Rebuild |
| `src/ui/context-menu.ts`, `src/core/book-status.ts`, `locale/*/seekbook-main.ftl` | Item context menu for books (add, reindex, status dialog); MenuManager on Zotero 8+, DOM fallback on 7; labels via Fluent |
| `test/*.test.ts` | Unit tests (Node runner); `test/fixtures/seekchat-parse.ts` is a copy of SeekChat's `parseSearchResponse` |
| `test/e2e/` | Harness + scenarios in real Zotero; `e2e/mock-embed.mjs` (hashed bag-of-words vectors, `/__fail` outage switch), `e2e/make-pdf.mjs` (fixtures) |

## Pitfalls

- **Independent of ZotSeek and SeekChat**: no imports, no reading other plugins' databases; REST is the contract.
- **Zotero's SQLite has no FTS5** (measured in E2E, decision E3) → own `terms` table + BM25 in JS.
- **Zotero's query layer cannot bind byte arrays** (arrays are flattened into several parameters). Vectors go in as
  hex text through `unhex(?)` and come out via `hex(col)`; they are stored as real BLOBs (`meta.vector_encoding = hex`,
  base64 TEXT as fallback for SQLite < 3.41).
- Zotero row proxies are fine for small queries (`store.query`); for bulk vector loads use `store.queryArrays`
  (`onRow` + `getResultByIndex`; `mozIStorageRow` has no column names).
- Running-header detection masks digits; test texts must vary in words (`test/fixtures/text.ts`), otherwise whole
  pages look like one header.
- Bootstrap sandbox lacks `AbortController`, `TextDecoder`, sometimes `fetch`, and `setTimeout`: use `src/util/env.ts`
  and `Zotero.Promise.delay`.
- `Zotero.Prefs.get/set(key, true)` means global (no `extensions.zotero.` prefix) — use the default.
- Requests to Zotero's local server need `Zotero-Allowed-Request: 1`.
- Page numbers are physical and 1-based **per PDF**; every search hit carries its `attachmentKey`.
- Index config (provider, model, window sizes, doc prefix) lives in `meta.index_config`; a change clears the index
  on the next scan (`needsRebuild` in `/seekbook/stats`).
- Search runs on the main thread (brute force over int8, yields per document); a ChromeWorker is a later step.

## E2E

- `e2e/out/results.json`, `zotero.log` (grep `SeekBook`), `prep-report.json` (fixture preparation),
  `env-report.json` (FTS5, vector encoding), `assets-report.json` (real PDFs from `test/assets/`, git-ignored).
- The harness runs once even though a scenario restarts the plugin (`test/e2e/entry.ts`).
