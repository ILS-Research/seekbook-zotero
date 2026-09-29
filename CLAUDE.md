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
| `src/core/text/` | Pure text preparation: `clean.ts` (running headers/footers, TOC pages, empty pages), `outline.ts` + `pdf-outline.ts` (copied from SeekChat, plus printed TOC as source `'toc'`, page labels), `chapters.ts` (headings located at character level, y position of bookmarks), `windows.ts` (word windows cut at chapter starts, sentence snapping, page mapping), `prepare.ts` (per PDF pipeline, reading order, duplicates), `tokenize.ts` (SeekChat's tokenizer/`searchKey`) |
| `src/core/embed/` | `client.ts` (embedding HTTP with host guard, retry/backoff), `vectors.ts` (normalize, int8, cosine) |
| `src/core/store.ts` | `seekbook.sqlite` on its own `Zotero.DBConnection`: books, documents (= queue), chunks, terms (BM25), doc_vectors (packed int8 per PDF), pages, page_labels, outline (with `char_start`, `how`); multi-row batched writes; schema migration in `migrate()` |
| `src/core/indexer.ts` | Scan (books, PDFs, hashes, exclude tag), persistent queue, per-book processing (duplicates, embeddings) |
| `src/core/ranking.ts`, `src/core/search.ts` | BM25, RRF (k = 60), passage merging; int8 candidates → float32 rescoring |
| `src/core/scan.ts`, `src/core/scan-pool.ts`, `src/worker/search-worker.ts` | int8 scan; pool of ChromeWorkers holding resident PDF vectors (LRU up to `cacheMB`, oversized scopes in turns, in-process fallback); the worker is its own bundle `content/scripts/search-worker.js` |
| `src/core/rest.ts` | `/seekbook/stats`, `/seekbook/search`, `/seekbook/pages` |
| `src/ui/preferences.ts`, `content/preferences.xhtml` | Settings pane with status and Index/Pause/Rebuild |
| `src/ui/context-menu.ts`, `src/core/book-status.ts`, `locale/*/seekbook-main.ftl` | Item context menu for books (add, reindex, status); MenuManager on Zotero 8+, DOM fallback on 7; labels via Fluent |
| `src/ui/status-window.ts`, `content/bookStatus.xhtml` | Live status window per book (indexer change events + 2 s poll, progress bar, Reindex) |
| `src/ui/item-column.ts`, `src/core/book-state.ts` | Item tree column "SeekBook" (glyph per book from an in-memory state map, reloaded on indexer changes) |
| `src/util/log.ts` | `logger(module)`: `[SeekBook:<module>] [LEVEL] …` to Browser Console + `Zotero.debug`, `time()` for durations (search, REST, indexer use it) |
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
- **Only `Indexer.rebuild()` clears the index.** `checkConfig()` returns false when model/prefix/windows differ
  from `meta.index_config` (non-empty index): scan, context menu, notifier and the queue then stop; search refuses
  semantic/hybrid when `documents.model_id` differs from the current model.
- Embedding requests take the run's `AbortSignal` (`Indexer.abort`); `pause()`/`stop()` abort them. A stopped doc goes
  back to `queued`. `store.writeDocument` only marks `ready` if `content_hash` still matches (file changed meanwhile).
- Requests to Zotero's local server need `Zotero-Allowed-Request: 1`.
- Page numbers are physical and 1-based **per PDF**; every search hit carries its `attachmentKey`.
- Index config (provider, model, window sizes, doc prefix) lives in `meta.index_config`; a change pauses indexing
  until "Rebuild index" (`needsRebuild` in `/seekbook/stats`).
- Search scans run in ChromeWorkers (`chrome://seekbook/content/scripts/search-worker.js`); typed arrays are
  transferred, so a buffer is unusable on the sending side afterwards (`query.slice()` per worker).
- Changes to windowing or chapters must raise `LAYOUT_VERSION` (indexer.ts): it is part of `index_config`, so old
  indexes wait for a rebuild instead of mixing layouts.
- Zotero's `queryAsync` wants `LIKE ?` with a bound value, and its row proxies cannot be `JSON.stringify`-ed.

## E2E

- `e2e/out/results.json`, `zotero.log` (grep `SeekBook`), `prep-report.json` (fixture preparation),
  `env-report.json` (FTS5, vector encoding), `assets-report.json` (real PDFs from `test/assets/`, git-ignored),
  `chapters-report.json` (outline offsets and window chapters of the fixture), `perf-report.json` (8 × 1000 windows at
  4096 dims: write, cold/warm search, worker vs. in-process scan, UI gaps). Timeout default 600 s.
- The harness runs once even though a scenario restarts the plugin (`test/e2e/entry.ts`).

## Code-Review

- `REVIEW_OPUS_5.5_NODOCS.md` (29.09.2026): Review of v0.3.3 based on the source code only (no docs). Findings H1–H6, M1–M10 and low-priority items (H1–H5 fixed in 0.3.4, M1/M3–M5/M7–M10 in 0.3.5); check it before larger changes to the indexer, store, scan pool or REST.
