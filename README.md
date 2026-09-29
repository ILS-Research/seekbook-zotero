# SeekBook

Zotero 7–10 plugin that builds a full-text index for books (semantic + keyword) and serves it to other plugins
over Zotero's local HTTP server. Built for SeekChat; ZotSeek can mix in book results via a provider interface.

- Indexes every PDF attachment of items of type *Book* (whole book, chapter PDFs, appendices); chapter PDFs contained
  in a whole-book PDF are marked as duplicates.
- Removes running headers/footers and table-of-contents pages; windows of 200 words (step 120) know their chapter
  (PDF bookmarks, printed table of contents, detected headings) and printed page label.
- Embeddings from Ollama (`/api/embed`) or an OpenAI-compatible server; remote hosts only after explicit allow-listing.
- Exclude a book or a single PDF with the tag `seekbook-exclude`.

## REST (127.0.0.1:23119, header `Zotero-Allowed-Request: 1`)

| Endpoint | Parameters |
|---|---|
| `GET /seekbook/stats` | – |
| `GET /seekbook/search` | `q`, `topK` (1–100), `libraryKey`, `mode` (`hybrid`/`semantic`/`keyword`), `minSimilarity`, `itemKeys`, `attachmentKeys`, `expand` (`none`/`page`) |
| `GET /seekbook/pages` | `libraryKey`, `attachmentKey` + `pages` (`45`, `10-12`, max. 10) — or `itemKey` + `pageLabel` |

Search results use the shape of ZotSeek's `/zotseek/search` (`granularity=passages`); `matchedChunk` additionally
has `pageEnd`, `pageLabel`, `chapter`, `chapterSource`, `attachmentKey`, `attachmentTitle`, `chunkIndex`.

JS: `Zotero.SeekBook.search(q, opts)`, `.stats()`, `.isIndexed(libraryKey, itemKey)`, `.apiVersion`.

Build and tests: see `CLAUDE.md`.
