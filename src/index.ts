/**
 * SeekBook: full-text index for books in Zotero, served over a local REST API.
 * Entry point; bootstrap.js calls startup()/shutdown().
 */
import { Indexer } from './core/indexer';
import { API_VERSION, registerEndpoints, statsPayload, unregisterEndpoints } from './core/rest';
import { search, vectorCache, type SearchOptions } from './core/search';
import { Store } from './core/store';
import { libraryKeyOf } from './core/zotero-items';
import { readPrefs } from './prefs';
import { onPrefsLoad } from './ui/preferences';
import { addLegacyMenu, registerMenus, removeLegacyMenu, unregisterMenus } from './ui/context-menu';
import { formatBookStatus } from './core/book-status';
import { t } from './i18n';
import { ItemColumn } from './ui/item-column';
import { log, logError } from './util/log';

const FTL = 'seekbook-main.ftl';

/** Delay before changed books are picked up (a new attachment brings several notifier events). */
const NOTIFY_DELAY_MS = 5000;

class SeekBookPlugin {
  readonly apiVersion = API_VERSION;
  info = { id: '', version: '', rootURI: '' };
  store = new Store();
  indexer = new Indexer(this.store);
  column = new ItemColumn(this.store, () => this.indexer.progress.bookPk);
  private offColumn: (() => void) | null = null;
  private observerID: string | null = null;
  private pendingItems = new Set<number>();
  private notifyTimer: Promise<void> | null = null;
  private stopped = false;
  paneID: string | null = null;

  async startup(info: { id: string; version: string; rootURI: string }): Promise<void> {
    this.info = info;
    this.stopped = false;
    await this.store.open();
    this.applyApiPref();
    registerMenus(info.id, `${info.rootURI}content/icons/seekbook.svg`, {
      isKnown: (item) => this.store.knownBooks.has(`${libraryKeyOf(item.libraryID)}/${item.key}`),
      index: async (items, force) => { await this.indexer.indexBooks(items, force); },
      showStatus: (item) => this.showBookStatus(item),
    });
    for (const win of Zotero.getMainWindows()) this.onMainWindowLoad(win);
    await this.column.register(info.id);
    this.offColumn = this.indexer.onChange(() => void this.column.reload());
    this.observerID = Zotero.Notifier.registerObserver({ notify: this.notify }, ['item'], 'seekbook');
    try {
      this.paneID = await Zotero.PreferencePanes.register({
        pluginID: info.id,
        src: `${info.rootURI}content/preferences.xhtml`,
        label: 'SeekBook',
        image: `${info.rootURI}content/icons/seekbook.svg`,
      });
    } catch (e) {
      logError(e);
    }
    // Resume an interrupted queue (status survives restarts).
    if ((await this.store.queued()).length && readPrefs().model) void this.indexer.run();
    log(`started ${info.version}`);
  }

  async shutdown(): Promise<void> {
    this.stopped = true;
    if (this.observerID) Zotero.Notifier.unregisterObserver(this.observerID);
    this.observerID = null;
    if (this.paneID) Zotero.PreferencePanes.unregister?.(this.paneID);
    this.paneID = null;
    unregisterEndpoints();
    unregisterMenus();
    this.offColumn?.();
    this.offColumn = null;
    await this.column.unregister();
    for (const win of Zotero.getMainWindows()) this.onMainWindowUnload(win);
    await this.indexer.stop();
    vectorCache.invalidate();
    await this.store.close();
  }

  onMainWindowLoad(win: any): void {
    try {
      win.MozXULElement?.insertFTLIfNeeded(FTL);
      addLegacyMenu(win);
    } catch (e) {
      logError(e);
    }
  }

  onMainWindowUnload(win: any): void {
    removeLegacyMenu(win);
    win.document.querySelector(`link[href="${FTL}"]`)?.remove();
  }

  /** Status text of one book (context menu "Indexstatus"). */
  async bookStatusText(item: any): Promise<string> {
    const lib = libraryKeyOf(item.libraryID);
    const book = lib ? await this.store.bookByKey(lib, item.key) : null;
    const docs = book ? await this.store.documents(book.bookPk) : null;
    let booksAhead = 0;
    if (book) {
      const queuedBooks = Array.from(new Set((await this.store.queued()).map((d) => d.bookPk)));
      const current = this.indexer.progress.bookPk;
      booksAhead = queuedBooks.filter((pk) => pk < book.bookPk && pk !== current).length;
    }
    const tag = readPrefs().excludeTag;
    return formatBookStatus({
      title: String(item.getField?.('title') || ''),
      docs,
      chunks: book ? await this.store.chunkCounts(book.bookPk) : new Map(),
      progress: this.indexer.progress,
      bookPk: book?.bookPk ?? null,
      booksAhead,
      excludedTag: !!tag && (item.getTags?.() || []).some((x: any) => x.tag === tag),
      notABook: item.itemType !== 'book',
    });
  }

  async showBookStatus(item: any): Promise<void> {
    Services.prompt.alert(Zotero.getMainWindow(), t('status.dialogTitle'), await this.bookStatusText(item));
  }

  applyApiPref(): void {
    if (readPrefs().apiEnabled) registerEndpoints(this.store, this.indexer);
    else unregisterEndpoints();
  }

  private notify = (event: string, type: string, ids: (number | string)[], extra: any): void => {
    if (type !== 'item' || this.stopped) return;
    if (event === 'delete') {
      // Deleted items are gone from Zotero.Items; extra has library and key.
      for (const id of ids) {
        const d = extra?.[id];
        const lib = d?.libraryID !== undefined ? libraryKeyOf(d.libraryID) : null;
        if (lib && d.key) void this.forget(lib, d.key).catch(logError);
      }
      return;
    }
    if (!['add', 'modify', 'trash', 'refresh'].includes(event)) return;
    for (const id of ids) this.pendingItems.add(Number(id));
    if (!this.notifyTimer) {
      this.notifyTimer = Zotero.Promise.delay(NOTIFY_DELAY_MS).then(() => this.flushNotifications()).catch(logError)
        .finally(() => { this.notifyTimer = null; });
    }
  };

  /** A deleted item: a book (drop it) or an attachment of a book (drop that PDF). */
  private async forget(libraryKey: string, key: string): Promise<void> {
    const book = await this.store.bookByKey(libraryKey, key);
    if (book) {
      await this.indexer.removeBook(book.bookPk);
      void this.column.reload();
      return;
    }
    const doc = await this.store.documentByKey(libraryKey, key);
    if (doc) {
      vectorCache.invalidate(doc.docPk);
      await this.store.deleteDocument(doc.docPk);
    }
    void this.column.reload();
  }

  async flushNotifications(): Promise<void> {
    const ids = Array.from(this.pendingItems);
    this.pendingItems.clear();
    const books = new Map<number, any>();
    for (const id of ids) {
      const item = Zotero.Items.get(id);
      if (!item) continue;
      const book = item.isAttachment?.() ? item.parentItem : item;
      if (!book) continue;
      const lib = libraryKeyOf(book.libraryID);
      // Known books are always kept in sync (trash, removed PDF); new ones only with automatic indexing.
      const known = lib ? await this.store.bookByKey(lib, book.key) : null;
      if (known || (readPrefs().autoIndex && book.itemType === 'book')) books.set(book.id, book);
    }
    if (!books.size) return;
    await this.indexer.checkConfig();
    for (const book of books.values()) await this.indexer.syncBook(book);
    void this.column.reload();
    if (readPrefs().autoIndex && (await this.store.queued()).length) void this.indexer.run();
  }

  onPrefsLoad = (win: Window): void => {
    onPrefsLoad(win, {
      counts: () => this.store.counts(),
      details: async () => {
        let bytes: number | null = null;
        try {
          bytes = (await Zotero.getMainWindow().IOUtils.stat(Zotero.DataDirectory.getDatabase('seekbook'))).size ?? null;
        } catch {
          // file not there yet
        }
        const last = (await this.store.query('SELECT MAX(indexed_at) AS t FROM documents'))[0]?.t ?? null;
        return { bytes, model: (await this.store.getMeta('dims')) ? `${readPrefs().model} · ${await this.store.getMeta('dims')}d` : readPrefs().model, lastIndexed: last };
      },
      failed: async () => {
        const rows = await this.store.query(
          `SELECT b.title, d.attachment_title, d.error FROM documents d JOIN books b ON b.book_pk = d.book_pk
           WHERE d.status = 'failed' ORDER BY b.title LIMIT 100`);
        return rows.map((r) => ({ title: [r.title, r.attachment_title].filter(Boolean).join(' – '), error: r.error || '' }));
      },
      progress: () => this.indexer.progress,
      needsRebuild: () => this.indexer.needsRebuild(),
      indexNow: () => void this.indexer.indexNow().catch(logError),
      pause: () => this.indexer.pause(),
      rebuild: () => void this.indexer.rebuild().catch(logError),
      onChange: (fn) => this.indexer.onChange(fn),
      apiChanged: () => this.applyApiPref(),
    });
  };

  // JS interface for plugins in the same process (same shapes as REST; REST stays the contract).

  async search(q: string, opts: SearchOptions = {}): Promise<{ query: string; mode: string; source: 'seekbook'; apiVersion: number; results: unknown[] }> {
    const results = await search(this.store, q, opts);
    return { query: q, mode: opts.mode ?? 'hybrid', source: 'seekbook', apiVersion: API_VERSION, results };
  }

  stats(): Promise<Record<string, unknown>> {
    return statsPayload(this.store, this.indexer);
  }

  async isIndexed(libraryKey: string, itemKey: string): Promise<boolean> {
    const book = await this.store.bookByKey(libraryKey, itemKey);
    if (!book) return false;
    return (await this.store.documents(book.bookPk)).some((d) => d.status === 'ready');
  }
}

Zotero.SeekBook = new SeekBookPlugin();
