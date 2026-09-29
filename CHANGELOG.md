# Changelog

## 0.3.4 – 2026-09-29
Fixes from the code review (`REVIEW_OPUS_5.5_NODOCS.md`, H1–H5):
- **The index is no longer cleared behind the user's back.** After a change of model, document prefix or window
  settings, editing a book, "Index now" or the context menu cleared the whole index. Now indexing pauses
  ("rebuild needed") and only "Rebuild index" (with confirmation) clears it. An empty index takes new settings over.
- The indexer checks the settings before every book, so a change during a run no longer writes vectors of the new
  model into the old index (or orphaned rows after a clear).
- **Search refuses a model mismatch**: semantic/hybrid search on an index built with another model answers 503
  "rebuild the index" instead of meaningless scores; keyword search keeps working.
- A PDF whose file was missing for a while is indexed again when the file comes back (it stayed "failed" before).
- Disabling/updating waits for the plugin to shut down (indexer stopped, database closed; at most 30 s for a running
  embedding request), so two versions no longer write to `seekbook.sqlite` at the same time.

## 0.3.3 – 2026-09-29
- Passages merge at most 3 neighbouring windows (≈ 440 words, `MAX_MERGE_WINDOWS`). Runs of hits grew into passages
  of five pages and more before, which callers sent whole and again in overlapping pieces.

## 0.3.2 – 2026-09-29
- Fix: log lines did not reach the Browser Console; they now go to the console service.

## 0.3.1 – 2026-09-29
- **Logging** like ZotSeek: `[SeekBook:<module>] [INFO] …` in the Browser Console and Zotero's debug output –
  searches (query embedding + scan, keyword part, passages, total time), every REST request with status and time,
  indexing per PDF (pages read, embedding batches, windows).
- README rewritten for users (technical details at the end).

## 0.3.0 – 2026-09-29
- **REST `/seekbook/books`**: books of a library (optionally `itemKeys`) with their document counts and whether they
  are searchable. SeekChat uses it to send indexed books to the index and the others to its keyword reading.

## 0.2.0 – 2026-09-29
- **Chapter boundaries at character level**: each heading (bookmark, printed table of contents, detected heading) is
  located in the cleaned text of its start page, using the bookmark's y position where the PDF has one; windows never
  cross a chapter start, so every window belongs to exactly one chapter. Bookmarks are read up to four levels deep.
  The outline table stores the offset and how it was found (`text` / `position` / `page`).
- **Performance**: search scans in a pool of ChromeWorkers (Zotero's UI stays responsive), vectors per PDF packed into
  one row (`doc_vectors`, one read per PDF), resident vectors kept up to `cacheMB` (default 1024 MB) and larger scopes
  scanned in turns; indexing writes in multi-row batches and sends `embedConcurrency` (default 2) requests at once;
  faster hex decoding.
- **Live status window** for a book (context menu): progress bar while it is indexed, "Reindex" button, updates itself.
- The index layout changed (layout version 2): existing indexes are rebuilt on the next "Index now".

## 0.1.3 – 2026-09-29
- Settings reorganized like ZotSeek: collapsible groups, "Status" first with cards (books, windows, storage), model /
  average / last indexed line, action boxes "Index now" (recommended) and "Rebuild index".
- Item tree column "SeekBook" (like ZotSeek's): ✓ searchable · ◐ partly · ⟳ being indexed · … queued · ✗ failed ·
  ⊘ excluded; shown once on first install.

## 0.1.2 – 2026-09-29
- Context menu for books: "Add to book index" (also with automatic indexing off), "Reindex" (all PDFs of the book,
  also failed ones) and "Book index status …" (state of each PDF, windows, chapter source, live progress, queue position).

## 0.1.1 – 2026-09-29
- Settings: "Allowed remote hosts" as a red caution box below the server, same layout and wording as SeekChat and the ZotSeek fork.
- Settings: model dropdown filled by "Test connection" from the server (/api/tags or /models), embedding models first, others marked; the test also embeds once and reports the dimensions.

## 0.1.0 – 2026-09-29
- M0: plugin skeleton, Docker build, unit tests, E2E harness (Zotero 10.0.3 under Xvfb, mock embedding server).
- M1: all PDFs per book (reading order, duplicates by hash and by containment), running headers/footers, TOC pages,
  chapters (bookmarks → printed TOC → headings → page blocks), page labels, word windows with sentence snapping.
- M2: embedding client (Ollama/OpenAI, host guard, retry), `seekbook.sqlite` (BLOB vectors float32 + int8),
  persistent queue (survives restart, pauses on server outage), notifier (delete/trash, optional auto indexing).
- M3: search (int8 scan → float32 rescoring, BM25, RRF, merged passages), REST `/seekbook/stats|search|pages`,
  JS API; settings pane with status, Index now / Pause / Rebuild.
