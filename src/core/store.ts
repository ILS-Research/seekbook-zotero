/**
 * seekbook.sqlite: SeekBook's own database in the Zotero data directory, on
 * its own connection (not ATTACHed to zotero.sqlite, so Zotero's maintenance
 * never drops it). Deleting the file means a full rebuild.
 *
 * Vectors are BLOBs, passed in and out as hex text through SQLite's unhex()/hex()
 * (Zotero's query layer cannot bind byte arrays); without unhex() (SQLite < 3.41)
 * base64 TEXT. Checked once at open, kept in meta.vector_encoding.
 */
import { base64ToBytes, bytesToBase64, bytesToHex, hexToBytes } from '../util/base64';
import { log } from '../util/log';

export const SCHEMA_VERSION = 1;
export const DB_NAME = 'seekbook';

export type DocStatus = 'queued' | 'indexing' | 'ready' | 'failed' | 'excluded' | 'duplicate';

export interface BookRow {
  bookPk: number;
  libraryKey: string;
  itemKey: string;
  title: string;
  authors: string[];
  year: number | null;
  language: string;
}

export interface DocRow {
  docPk: number;
  bookPk: number;
  attachmentKey: string;
  attachmentTitle: string;
  fileName: string;
  sortOrder: number;
  pages: number | null;
  contentHash: string;
  duplicateOf: number | null;
  modelId: string;
  status: DocStatus;
  error: string | null;
  indexedAt: number | null;
  outlineSource: string | null;
}

export interface ChunkInsert {
  idx: number;
  pageStart: number;
  pageEnd: number;
  charStart: number;
  charEnd: number;
  chapter: string;
  text: string;
  embedding: Uint8Array;
  embeddingQ: Uint8Array;
  scale: number;
  /** term → frequency, for BM25. */
  terms: Map<string, number>;
  nterms: number;
}

export interface DocContent {
  chunks: ChunkInsert[];
  pages: { page: number; text: string }[];
  labels: (string | null)[] | null;
  outline: { id: string; parent: string; title: string; pageStart: number; pageEnd: number; depth: number }[];
  outlineSource: string;
  pageCount: number;
}

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT)`,
  `CREATE TABLE IF NOT EXISTS books (
    book_pk INTEGER PRIMARY KEY,
    library_key TEXT NOT NULL,
    item_key TEXT NOT NULL,
    title TEXT, authors TEXT, year INTEGER, language TEXT,
    UNIQUE(library_key, item_key))`,
  `CREATE TABLE IF NOT EXISTS documents (
    doc_pk INTEGER PRIMARY KEY,
    book_pk INTEGER NOT NULL,
    attachment_key TEXT NOT NULL,
    attachment_title TEXT, file_name TEXT,
    sort_order INTEGER NOT NULL DEFAULT 0,
    pages INTEGER,
    content_hash TEXT NOT NULL DEFAULT '',
    duplicate_of INTEGER,
    model_id TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL,
    error TEXT, indexed_at INTEGER,
    outline_source TEXT,
    UNIQUE(book_pk, attachment_key))`,
  `CREATE TABLE IF NOT EXISTS chunks (
    chunk_pk INTEGER PRIMARY KEY,
    doc_pk INTEGER NOT NULL,
    idx INTEGER NOT NULL,
    page_start INTEGER NOT NULL, page_end INTEGER NOT NULL,
    char_start INTEGER, char_end INTEGER,
    chapter TEXT,
    text TEXT NOT NULL,
    embedding NOT NULL,
    embedding_q NOT NULL,
    scale REAL NOT NULL,
    nterms INTEGER NOT NULL DEFAULT 0)`,
  `CREATE INDEX IF NOT EXISTS chunks_doc ON chunks(doc_pk, idx)`,
  `CREATE TABLE IF NOT EXISTS terms (term TEXT NOT NULL, chunk_pk INTEGER NOT NULL, tf INTEGER NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS terms_term ON terms(term)`,
  `CREATE INDEX IF NOT EXISTS terms_chunk ON terms(chunk_pk)`,
  `CREATE TABLE IF NOT EXISTS page_labels (doc_pk INTEGER, page INTEGER, label TEXT, PRIMARY KEY(doc_pk, page))`,
  `CREATE TABLE IF NOT EXISTS pages (doc_pk INTEGER, page INTEGER, text TEXT, PRIMARY KEY(doc_pk, page))`,
  `CREATE TABLE IF NOT EXISTS outline (
    doc_pk INTEGER, node_id TEXT, parent_id TEXT, title TEXT,
    page_start INTEGER, page_end INTEGER, depth INTEGER, source TEXT,
    PRIMARY KEY(doc_pk, node_id))`,
];

function docFromRow(r: any): DocRow {
  return {
    docPk: r.doc_pk,
    bookPk: r.book_pk,
    attachmentKey: r.attachment_key,
    attachmentTitle: r.attachment_title || '',
    fileName: r.file_name || '',
    sortOrder: r.sort_order,
    pages: r.pages ?? null,
    contentHash: r.content_hash,
    duplicateOf: r.duplicate_of ?? null,
    modelId: r.model_id,
    status: r.status,
    error: r.error ?? null,
    indexedAt: r.indexed_at ?? null,
    outlineSource: r.outline_source ?? null,
  };
}

function bookFromRow(r: any): BookRow {
  let authors: string[] = [];
  try { authors = JSON.parse(r.authors || '[]'); } catch { /* old row */ }
  return {
    bookPk: r.book_pk, libraryKey: r.library_key, itemKey: r.item_key, title: r.title || '',
    authors, year: r.year ?? null, language: r.language || '',
  };
}

/** Rows as Zotero returns them (proxies with column names as properties). */
async function rows(db: any, sql: string, params: unknown[] = []): Promise<any[]> {
  return (await db.queryAsync(sql, params)) || [];
}

/** Rows as arrays by column index, without per-row proxies (bulk loads of vectors). */
async function arrays(db: any, sql: string, params: unknown[] = []): Promise<unknown[][]> {
  const out: unknown[][] = [];
  await db.queryAsync(sql, params, {
    onRow: (row: any) => {
      const r: unknown[] = [];
      for (let i = 0; i < row.numEntries; i++) r.push(row.getResultByIndex(i));
      out.push(r);
    },
  });
  return out;
}

export class Store {
  private db: any;
  /** 'hex': BLOB columns via unhex()/hex(); 'base64': TEXT columns. */
  encoding: 'hex' | 'base64' = 'hex';
  /** "libraryKey/itemKey" of every book in the index, for synchronous checks (context menu). */
  knownBooks = new Set<string>();

  /** `path`: full path or database name in the Zotero data directory. */
  async open(path: string = DB_NAME): Promise<void> {
    this.db = new Zotero.DBConnection(path);
    for (const sql of SCHEMA) await this.db.queryAsync(sql);
    const version = await this.getMeta('schema_version');
    if (!version) await this.setMeta('schema_version', String(SCHEMA_VERSION));
    let encoding = await this.getMeta('vector_encoding');
    if (!encoding) {
      encoding = (await this.probeHex()) ? 'hex' : 'base64';
      await this.setMeta('vector_encoding', encoding);
    }
    this.encoding = encoding === 'hex' ? 'hex' : 'base64';
    this.knownBooks = new Set((await rows(this.db, 'SELECT library_key, item_key FROM books')).map((r) => `${r.library_key}/${r.item_key}`));
    log(`store open (${path}), vectors as ${encoding}`);
  }

  /** Does SQLite have unhex() (3.41+), and do bytes survive the round trip? */
  private async probeHex(): Promise<boolean> {
    try {
      return (await this.db.valueQueryAsync("SELECT hex(unhex('00017F80FF03'))")) === '00017F80FF03';
    } catch (e) {
      log(`unhex() not available, vectors as base64: ${e}`);
      return false;
    }
  }

  async close(): Promise<void> {
    if (this.db) await this.db.closeDatabase(true);
    this.db = null;
  }

  get isOpen(): boolean {
    return !!this.db;
  }

  encodeVector(bytes: Uint8Array): string {
    return this.encoding === 'hex' ? bytesToHex(bytes) : bytesToBase64(bytes);
  }

  /** SQL for a vector parameter placeholder. */
  get vectorParam(): string {
    return this.encoding === 'hex' ? 'unhex(?)' : '?';
  }

  /** SQL that selects a vector column as text. */
  vectorColumn(column: string): string {
    return this.encoding === 'hex' ? `hex(${column})` : column;
  }

  decodeVector(value: unknown): Uint8Array {
    if (typeof value !== 'string') throw new Error('vector column is not text');
    return this.encoding === 'hex' ? hexToBytes(value) : base64ToBytes(value);
  }

  transaction<T>(fn: () => Promise<T>): Promise<T> {
    return this.db.executeTransaction(fn);
  }

  query(sql: string, params: unknown[] = []): Promise<any[]> {
    return rows(this.db, sql, params);
  }

  queryArrays(sql: string, params: unknown[] = []): Promise<unknown[][]> {
    return arrays(this.db, sql, params);
  }

  async getMeta(key: string): Promise<string | null> {
    const r = await rows(this.db, 'SELECT value FROM meta WHERE key = ?', [key]);
    return r.length ? r[0].value : null;
  }

  async setMeta(key: string, value: string): Promise<void> {
    await this.db.queryAsync('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)', [key, value]);
  }

  // Books

  async upsertBook(b: Omit<BookRow, 'bookPk'>): Promise<number> {
    await this.db.queryAsync(
      `INSERT INTO books (library_key, item_key, title, authors, year, language) VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(library_key, item_key) DO UPDATE SET title = excluded.title, authors = excluded.authors,
         year = excluded.year, language = excluded.language`,
      [b.libraryKey, b.itemKey, b.title, JSON.stringify(b.authors), b.year, b.language],
    );
    const r = await rows(this.db, 'SELECT book_pk FROM books WHERE library_key = ? AND item_key = ?', [b.libraryKey, b.itemKey]);
    this.knownBooks.add(`${b.libraryKey}/${b.itemKey}`);
    return r[0].book_pk;
  }

  async books(): Promise<BookRow[]> {
    return (await rows(this.db, 'SELECT * FROM books ORDER BY book_pk')).map(bookFromRow);
  }

  async bookByKey(libraryKey: string, itemKey: string): Promise<BookRow | null> {
    const r = await rows(this.db, 'SELECT * FROM books WHERE library_key = ? AND item_key = ?', [libraryKey, itemKey]);
    return r.length ? bookFromRow(r[0]) : null;
  }

  async bookByPk(bookPk: number): Promise<BookRow | null> {
    const r = await rows(this.db, 'SELECT * FROM books WHERE book_pk = ?', [bookPk]);
    return r.length ? bookFromRow(r[0]) : null;
  }

  async deleteBook(bookPk: number): Promise<void> {
    const book = await this.bookByPk(bookPk);
    if (book) this.knownBooks.delete(`${book.libraryKey}/${book.itemKey}`);
    await this.transaction(async () => {
      for (const d of await this.documents(bookPk)) await this.deleteDocumentRows(d.docPk);
      await this.db.queryAsync('DELETE FROM books WHERE book_pk = ?', [bookPk]);
    });
  }

  // Documents

  async documents(bookPk?: number): Promise<DocRow[]> {
    const r = bookPk === undefined
      ? await rows(this.db, 'SELECT * FROM documents ORDER BY book_pk, sort_order')
      : await rows(this.db, 'SELECT * FROM documents WHERE book_pk = ? ORDER BY sort_order', [bookPk]);
    return r.map(docFromRow);
  }

  async documentByKey(libraryKey: string, attachmentKey: string): Promise<DocRow | null> {
    const r = await rows(this.db,
      `SELECT d.* FROM documents d JOIN books b ON b.book_pk = d.book_pk WHERE b.library_key = ? AND d.attachment_key = ?`,
      [libraryKey, attachmentKey]);
    return r.length ? docFromRow(r[0]) : null;
  }

  async documentByPk(docPk: number): Promise<DocRow | null> {
    const r = await rows(this.db, 'SELECT * FROM documents WHERE doc_pk = ?', [docPk]);
    return r.length ? docFromRow(r[0]) : null;
  }

  async upsertDocument(d: {
    bookPk: number; attachmentKey: string; attachmentTitle: string; fileName: string; sortOrder: number;
  }): Promise<DocRow> {
    await this.db.queryAsync(
      `INSERT INTO documents (book_pk, attachment_key, attachment_title, file_name, sort_order, status)
       VALUES (?, ?, ?, ?, ?, 'queued')
       ON CONFLICT(book_pk, attachment_key) DO UPDATE SET attachment_title = excluded.attachment_title,
         file_name = excluded.file_name, sort_order = excluded.sort_order`,
      [d.bookPk, d.attachmentKey, d.attachmentTitle, d.fileName, d.sortOrder],
    );
    const r = await rows(this.db, 'SELECT * FROM documents WHERE book_pk = ? AND attachment_key = ?', [d.bookPk, d.attachmentKey]);
    return docFromRow(r[0]);
  }

  async setStatus(docPk: number, status: DocStatus, fields: { error?: string | null; duplicateOf?: number | null; contentHash?: string } = {}): Promise<void> {
    const sets = ['status = ?'];
    const params: unknown[] = [status];
    if (fields.error !== undefined) { sets.push('error = ?'); params.push(fields.error); }
    if (fields.duplicateOf !== undefined) { sets.push('duplicate_of = ?'); params.push(fields.duplicateOf); }
    if (fields.contentHash !== undefined) { sets.push('content_hash = ?'); params.push(fields.contentHash); }
    params.push(docPk);
    await this.db.queryAsync(`UPDATE documents SET ${sets.join(', ')} WHERE doc_pk = ?`, params);
  }

  /** Documents waiting for the indexer, in book and reading order. */
  async queued(): Promise<DocRow[]> {
    return (await rows(this.db, `SELECT * FROM documents WHERE status IN ('queued', 'indexing') ORDER BY book_pk, sort_order`)).map(docFromRow);
  }

  private async deleteDocumentContent(docPk: number): Promise<void> {
    await this.db.queryAsync('DELETE FROM terms WHERE chunk_pk IN (SELECT chunk_pk FROM chunks WHERE doc_pk = ?)', [docPk]);
    for (const table of ['chunks', 'pages', 'page_labels', 'outline']) {
      await this.db.queryAsync(`DELETE FROM ${table} WHERE doc_pk = ?`, [docPk]);
    }
  }

  private async deleteDocumentRows(docPk: number): Promise<void> {
    await this.deleteDocumentContent(docPk);
    await this.db.queryAsync('UPDATE documents SET duplicate_of = NULL WHERE duplicate_of = ?', [docPk]);
    await this.db.queryAsync('DELETE FROM documents WHERE doc_pk = ?', [docPk]);
  }

  async deleteDocument(docPk: number): Promise<void> {
    await this.transaction(() => this.deleteDocumentRows(docPk));
  }

  async clearContent(docPk: number): Promise<void> {
    await this.transaction(() => this.deleteDocumentContent(docPk));
  }

  /** Replaces all content of a document in one transaction and marks it ready. */
  async writeDocument(docPk: number, contentHash: string, modelId: string, c: DocContent): Promise<void> {
    await this.transaction(async () => {
      await this.deleteDocumentContent(docPk);
      for (const ch of c.chunks) {
        await this.db.queryAsync(
          `INSERT INTO chunks (doc_pk, idx, page_start, page_end, char_start, char_end, chapter, text, embedding, embedding_q, scale, nterms)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ${this.vectorParam}, ${this.vectorParam}, ?, ?)`,
          [docPk, ch.idx, ch.pageStart, ch.pageEnd, ch.charStart, ch.charEnd, ch.chapter, ch.text,
            this.encodeVector(ch.embedding), this.encodeVector(ch.embeddingQ), ch.scale, ch.nterms],
        );
        const chunkPk = await this.db.valueQueryAsync('SELECT last_insert_rowid()');
        // One statement per 200 terms (SQLite's parameter limit is far above 600).
        const entries = [...ch.terms];
        for (let i = 0; i < entries.length; i += 200) {
          const part = entries.slice(i, i + 200);
          await this.db.queryAsync(
            `INSERT INTO terms (term, chunk_pk, tf) VALUES ${part.map(() => '(?, ?, ?)').join(', ')}`,
            part.flatMap(([term, tf]) => [term, chunkPk, tf]),
          );
        }
      }
      for (const p of c.pages) {
        await this.db.queryAsync('INSERT INTO pages (doc_pk, page, text) VALUES (?, ?, ?)', [docPk, p.page, p.text]);
      }
      for (let i = 0; i < (c.labels?.length || 0); i++) {
        const label = c.labels![i];
        if (label) await this.db.queryAsync('INSERT INTO page_labels (doc_pk, page, label) VALUES (?, ?, ?)', [docPk, i + 1, label]);
      }
      for (const o of c.outline) {
        await this.db.queryAsync(
          'INSERT INTO outline (doc_pk, node_id, parent_id, title, page_start, page_end, depth, source) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
          [docPk, o.id, o.parent, o.title, o.pageStart, o.pageEnd, o.depth, c.outlineSource],
        );
      }
      await this.db.queryAsync(
        `UPDATE documents SET status = 'ready', error = NULL, duplicate_of = NULL, content_hash = ?, model_id = ?,
           pages = ?, indexed_at = ?, outline_source = ? WHERE doc_pk = ?`,
        [contentHash, modelId, c.pageCount, Date.now(), c.outlineSource, docPk],
      );
    });
  }

  // Lookups for search and /pages

  async chunkCounts(bookPk: number): Promise<Map<number, number>> {
    const r = await rows(this.db,
      'SELECT c.doc_pk, COUNT(*) AS n FROM chunks c JOIN documents d ON d.doc_pk = c.doc_pk WHERE d.book_pk = ? GROUP BY c.doc_pk', [bookPk]);
    return new Map(r.map((x) => [x.doc_pk, x.n]));
  }

  async pageLabels(docPk: number): Promise<Map<number, string>> {
    const r = await rows(this.db, 'SELECT page, label FROM page_labels WHERE doc_pk = ?', [docPk]);
    return new Map(r.map((x) => [x.page, x.label]));
  }

  async pages(docPk: number, from: number, to: number): Promise<{ page: number; text: string }[]> {
    return rows(this.db, 'SELECT page, text FROM pages WHERE doc_pk = ? AND page BETWEEN ? AND ? ORDER BY page', [docPk, from, to]);
  }

  /** Documents (ready) of a book whose page labels include `label`. */
  async docsWithLabel(bookPk: number, label: string): Promise<{ docPk: number; page: number }[]> {
    const r = await rows(this.db,
      `SELECT l.doc_pk, l.page FROM page_labels l JOIN documents d ON d.doc_pk = l.doc_pk
       WHERE d.book_pk = ? AND d.status = 'ready' AND lower(l.label) = lower(?) ORDER BY d.sort_order`, [bookPk, label]);
    return r.map((x) => ({ docPk: x.doc_pk, page: x.page }));
  }

  async counts(): Promise<Record<string, number>> {
    const out: Record<string, number> = {};
    for (const r of await rows(this.db, 'SELECT status, COUNT(*) AS n FROM documents GROUP BY status')) out[r.status] = r.n;
    out.books = (await this.db.valueQueryAsync(
      `SELECT COUNT(DISTINCT book_pk) FROM documents WHERE status = 'ready'`)) || 0;
    out.chunks = (await this.db.valueQueryAsync('SELECT COUNT(*) FROM chunks')) || 0;
    return out;
  }

  /** Drops every book, document and chunk (model or window settings changed). */
  async clearAll(): Promise<void> {
    this.knownBooks.clear();
    await this.transaction(async () => {
      for (const table of ['terms', 'chunks', 'pages', 'page_labels', 'outline', 'documents', 'books']) {
        await this.db.queryAsync(`DELETE FROM ${table}`);
      }
    });
  }

  /** Is FTS5 compiled into Zotero's SQLite? (decision E3, reported in /seekbook/stats) */
  async hasFts5(): Promise<boolean> {
    try {
      await this.db.queryAsync('CREATE VIRTUAL TABLE temp.fts5_probe USING fts5(x)');
      await this.db.queryAsync('DROP TABLE temp.fts5_probe');
      return true;
    } catch {
      return false;
    }
  }
}
