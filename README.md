# SeekBook – search inside your books in Zotero

Zotero is great for papers, but books are different: hundreds of pages, split into chapter PDFs, with running
headers and a table of contents that gets in the way of every search. **SeekBook builds a full-text index for the
books in your library** – by meaning *and* by keyword – and knows for every passage **which chapter** it is in and
**which printed page number** it has.

You use it through other plugins:

- **SeekChat** – ask questions about your books and get answers that cite chapter and page.
- **ZotSeek (ILS version)** – book passages appear directly in ZotSeek’s search results.

Works with Zotero 7, 8, 9 and 10 (recommended: 10). The embeddings come from a model server **you** run
(Ollama or OpenAI-compatible); your books never leave your infrastructure unless you allow a server.

---

## What SeekBook does for you

- **Whole books, all PDFs:** a book with one PDF per chapter, plus appendices, is indexed as one book. A chapter PDF
  that is already contained in the whole-book PDF is recognised and not indexed twice.
- **Clean text:** running headers and footers, page numbers and table-of-contents pages are removed before indexing.
- **Chapters:** from PDF bookmarks, the printed table of contents or detected headings – every passage belongs to
  exactly one chapter.
- **Printed page numbers:** “page 25” means what is printed on the page, while links still open the right PDF page.
- **Fast:** searching runs in the background, Zotero stays responsive even with large collections.
- **You decide what goes in:** tag a book or a single PDF with `seekbook-exclude` to keep it out.

## Install

1. Download the latest `seekbook-<version>.xpi` (ILS: from the internal download portal).
2. Zotero → **Tools → Plugins** → gear icon → **Install Plugin From File…**
3. Updates come automatically afterwards.

## Set up

**Settings → SeekBook**

1. The status at the top shows how many books are indexed and what is waiting.
2. Choose the embedding server (Ollama or OpenAI-compatible) and a model; a server that is not on your own computer
   must be added to the **allowed remote hosts** – it receives the full text of all indexed books.
3. Click **Index now**. Indexing a book takes a while; you can keep working.
4. Keep **Access for other plugins** switched on, and Zotero’s local HTTP server (Settings → Advanced), so SeekChat
   and ZotSeek can use the index.

## Day to day

- **Right-click a book:** *Add to book index*, *Reindex*, *Index status of the book …* (a window that updates live
  while the book is indexed).
- **Column “SeekBook”** in the item list shows each book’s state at a glance.
- New books are indexed when you click *Index now* (automatic indexing can be switched on in the settings).
  Deleted books leave the index by themselves.

## When something goes wrong

Zotero → **Tools → Developer → Browser Console** (or Help → Debug Output Logging), filter by `[SeekBook`.
Indexing (pages read, embedding batches, windows written), every search (query embedding and scan, keyword part,
passages found) and every request from other plugins are logged with their duration.

---

## For developers

<details>
<summary>REST API (127.0.0.1:23119, header <code>Zotero-Allowed-Request: 1</code>)</summary>

| Endpoint | Parameters |
|---|---|
| `GET /seekbook/stats` | – |
| `GET /seekbook/search` | `q`, `topK` (1–100), `libraryKey`, `mode` (`hybrid`/`semantic`/`keyword`), `minSimilarity`, `itemKeys`, `attachmentKeys`, `expand` (`none`/`page`) |
| `GET /seekbook/pages` | `libraryKey`, `attachmentKey` + `pages` (`45`, `10-12`, max. 10) — or `itemKey` + `pageLabel` |
| `GET /seekbook/books` | `libraryKey`, `itemKeys` (optional): per book `readyDocuments`, `queuedDocuments`, `failedDocuments`, `totalDocuments`, `searchable` |

Search results use the shape of ZotSeek’s `/zotseek/search` (`granularity=passages`); `matchedChunk` additionally
has `pageEnd`, `pageLabel`, `chapter`, `chapterSource`, `attachmentKey`, `attachmentTitle`, `chunkIndex`.
Only local origins are accepted.

JS (same process): `Zotero.SeekBook.search(q, opts)`, `.stats()`, `.isIndexed(libraryKey, itemKey)`, `.apiVersion`.

</details>

<details>
<summary>How it works</summary>

- Windows of 200 words (step 120) that never cross a chapter start; chapter starts located at character level.
- Own SQLite database (`seekbook.sqlite`), vectors as float32 plus int8 packed per PDF; BM25 keyword index in its
  own table (Zotero’s SQLite has no FTS5).
- Search: int8 scan in a ChromeWorker pool, float32 re-ranking of the top candidates, fusion of semantic and
  keyword ranks (RRF, k = 60), neighbouring windows merged into passages.
- Logging: `src/util/log.ts` (`[SeekBook:<module>] [LEVEL] …`).

</details>

<details>
<summary>Build and tests</summary>

```
./build.sh          # npm install, unit tests, typecheck, build, dist/seekbook-<version>.xpi
./build.sh test     # unit tests only
./e2e/run.sh        # real Zotero 10 under Xvfb with a mock embedding server
```

Version only in `package.json`. Logs: `logs/build.log`, `logs/e2e.log`, `e2e/out/`. Details: `CLAUDE.md`,
`CHANGELOG.md`.

</details>
