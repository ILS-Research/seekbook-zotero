# Changelog

## 0.1.0 – 2026-09-29
- M0: plugin skeleton, Docker build, unit tests, E2E harness (Zotero 10.0.3 under Xvfb, mock embedding server).
- M1: all PDFs per book (reading order, duplicates by hash and by containment), running headers/footers, TOC pages,
  chapters (bookmarks → printed TOC → headings → page blocks), page labels, word windows with sentence snapping.
- M2: embedding client (Ollama/OpenAI, host guard, retry), `seekbook.sqlite` (BLOB vectors float32 + int8),
  persistent queue (survives restart, pauses on server outage), notifier (delete/trash, optional auto indexing).
- M3: search (int8 scan → float32 rescoring, BM25, RRF, merged passages), REST `/seekbook/stats|search|pages`,
  JS API; settings pane with status, Index now / Pause / Rebuild.
