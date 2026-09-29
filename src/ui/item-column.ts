/**
 * "SeekBook" column in the item tree (like ZotSeek's): one glyph per book,
 * see GLYPHS in core/book-state.ts. Zotero asks for cells synchronously, so the
 * states of all books live in memory; they are reloaded with one query whenever
 * the index changes (debounced), then the tree is repainted.
 */
import { bookState, GLYPHS, type BookState } from '../core/book-state';
import type { Store } from '../core/store';
import { libraryKeyOf } from '../core/zotero-items';
import { logError } from '../util/log';

export const COLUMN_KEY = 'seekbook-index-status';

export class ItemColumn {
  private states = new Map<string, BookState>();
  private registered: string | null = null;
  private reloading: Promise<void> | null = null;
  private again = false;

  constructor(private store: Store, private currentBook: () => number | null) {}

  stateOf(item: any): BookState | null {
    if (!item?.isRegularItem?.() || item.itemType !== 'book') return null;
    return this.states.get(`${libraryKeyOf(item.libraryID)}/${item.key}`) ?? null;
  }

  cellText(item: any): string {
    const s = this.stateOf(item);
    return s ? GLYPHS[s] : '';
  }

  async register(pluginID: string): Promise<void> {
    const itm = Zotero.ItemTreeManager;
    if (!itm?.registerColumns) return;
    await this.reload();
    try {
      const key = await itm.registerColumns({
        dataKey: COLUMN_KEY,
        label: 'SeekBook',
        pluginID,
        dataProvider: (item: any) => this.cellText(item),
        zoteroPersist: ['width', 'hidden', 'sortDirection'],
        width: '40',
        staticWidth: true,
        enabledTreeIDs: ['main'],
      });
      const flat = Array.isArray(key) ? key : [key];
      this.registered = flat.find(Boolean) || null;
      // First install: show the column once (like ZotSeek); afterwards Zotero remembers the user's choice.
      if (this.registered && !Zotero.Prefs.get('seekbook.columnShown')) {
        if (await this.showOnce()) Zotero.Prefs.set('seekbook.columnShown', true);
      }
    } catch (e) {
      logError(e);
    }
  }

  async unregister(): Promise<void> {
    if (this.registered) await Zotero.ItemTreeManager?.unregisterColumns?.(this.registered);
    this.registered = null;
  }

  /** Reloads all book states (coalesces calls while one runs), then repaints. */
  reload(): Promise<void> {
    if (this.reloading) {
      this.again = true;
      return this.reloading;
    }
    this.reloading = (async () => {
      do {
        this.again = false;
        await Zotero.Promise.delay(200);
        if (!this.store.isOpen) break;
        const rows = await this.store.query(
          'SELECT b.book_pk, b.library_key, b.item_key, d.status FROM books b JOIN documents d ON d.book_pk = b.book_pk');
        const byBook = new Map<number, { key: string; statuses: string[] }>();
        for (const r of rows) {
          const e = byBook.get(r.book_pk) || { key: `${r.library_key}/${r.item_key}`, statuses: [] };
          e.statuses.push(r.status);
          byBook.set(r.book_pk, e);
        }
        const current = this.currentBook();
        const next = new Map<string, BookState>();
        for (const [pk, e] of byBook) {
          const s = bookState(e.statuses, pk === current);
          if (s) next.set(e.key, s);
        }
        this.states = next;
        this.repaint();
      } while (this.again);
    })().catch(logError).finally(() => { this.reloading = null; });
    return this.reloading;
  }

  /** Unhides the column in the main item tree; the tree's column list can lag behind registration. */
  private async showOnce(): Promise<boolean> {
    for (let attempt = 0; attempt < 10; attempt++) {
      try {
        const columns = Zotero.getMainWindow()?.ZoteroPane?.itemsView?.tree?._columns;
        const arr = columns?.getAsArray?.();
        const idx = arr ? arr.findIndex((c: any) => String(c.dataKey || '').includes(COLUMN_KEY)) : -1;
        if (idx >= 0) {
          if (arr[idx].hidden) columns.toggleHidden(idx);
          return !columns.getAsArray()[idx].hidden;
        }
      } catch {
        // tree not ready yet
      }
      await Zotero.Promise.delay(300);
    }
    return false;
  }

  private repaint(): void {
    for (const win of Zotero.getMainWindows?.() || []) {
      try {
        win.ZoteroPane?.itemsView?.tree?.invalidate?.();
      } catch {
        // tree not ready
      }
    }
  }
}
