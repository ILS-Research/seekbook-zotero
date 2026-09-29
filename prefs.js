// SeekBook default preferences (extensions.zotero.seekbook.*).

// Embedding server. "ollama" (native /api/embed) or "openai" (any OpenAI-compatible /v1/embeddings).
pref("extensions.zotero.seekbook.provider", "ollama");
// Ollama: server root, e.g. https://ollama.example.local; OpenAI-compatible: base including /v1.
pref("extensions.zotero.seekbook.baseUrl", "http://127.0.0.1:11434");
pref("extensions.zotero.seekbook.apiKey", "");
// Decision E1 (28.09.2026): qwen3-embedding, full dimension, no truncation.
pref("extensions.zotero.seekbook.model", "qwen3-embedding:8b");
// Query side in the model's instruction format; documents get docPrefix (empty for qwen3).
pref("extensions.zotero.seekbook.queryPrefix", "Instruct: Given a search query, retrieve relevant passages from books that answer the query\nQuery: ");
pref("extensions.zotero.seekbook.docPrefix", "");
// Comma-separated host names that may serve embeddings in addition to this computer.
// Hosts listed here receive the full text of all indexed books.
pref("extensions.zotero.seekbook.allowedRemoteHosts", "");
// Windows: words per window and step between window starts (changing either rebuilds the index).
pref("extensions.zotero.seekbook.chunkWords", 200);
pref("extensions.zotero.seekbook.strideWords", 120);
// Texts per embedding request, and requests in flight at the same time while indexing.
pref("extensions.zotero.seekbook.batchSize", 32);
pref("extensions.zotero.seekbook.embedConcurrency", 2);
// Memory for int8 vectors kept ready for searching, in MB (4096 dims: ~4.5 MB per 1000 windows).
pref("extensions.zotero.seekbook.cacheMB", 1024);
// Tag on a book or a single attachment that keeps it out of the index.
pref("extensions.zotero.seekbook.excludeTag", "seekbook-exclude");
// Libraries to index: "" = all, else comma-separated library keys ("user", "group:123").
pref("extensions.zotero.seekbook.libraries", "");
// Index new or changed books automatically (decision E5: off by default because of server load).
pref("extensions.zotero.seekbook.autoIndex", false);
// When a whole-book PDF contains a chapter PDF: "whole" keeps the whole book, "parts" keeps the chapters.
pref("extensions.zotero.seekbook.preferDuplicates", "whole");
// REST endpoints /seekbook/* on Zotero's local server for other plugins and agents.
pref("extensions.zotero.seekbook.apiEnabled", true);
// UI language: "" = follow Zotero, or "en" / "de".
pref("extensions.zotero.seekbook.locale", "");
