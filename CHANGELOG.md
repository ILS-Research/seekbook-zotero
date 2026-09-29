# Changelog

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
