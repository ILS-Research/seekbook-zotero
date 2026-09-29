/**
 * "Book index status" window: one per book, redrawn live while it is open
 * (on every indexer change, throttled, and every 2 s as a safety net), with a
 * progress bar while the book is being indexed and a "Reindex" button.
 */
import { t } from '../i18n';
import { logError } from '../util/log';

const URL = 'chrome://seekbook/content/bookStatus.xhtml';
const REDRAW_MS = 250;
const POLL_MS = 2000;

export interface StatusBackend {
  text(item: any): Promise<string>;
  /** Progress of this book's current PDF, or null when it is not being indexed. */
  progress(item: any): { chunk: number; chunks: number } | null;
  onChange(fn: () => void): () => void;
  reindex(item: any): Promise<void>;
}

export class StatusWindows {
  private open = new Map<number, any>();

  constructor(private backend: StatusBackend) {}

  show(item: any): any {
    const existing = this.open.get(item.id);
    if (existing && !existing.closed) {
      existing.focus();
      return existing;
    }
    const win = Zotero.getMainWindow().openDialog(URL, `seekbook-status-${item.id}`, 'chrome,resizable,centerscreen,dialog=no', { itemID: item.id });
    this.open.set(item.id, win);
    return win;
  }

  /** Called by the window's onload. */
  onLoad(win: any): void {
    const itemID = win.arguments?.[0]?.itemID;
    const item = itemID && Zotero.Items.get(itemID);
    if (!item) return;
    const doc = win.document;
    doc.title = t('status.dialogTitle');
    const body = doc.getElementById('seekbook-status-body');
    const updated = doc.getElementById('seekbook-status-updated');
    const reindex = doc.getElementById('seekbook-status-reindex');
    const close = doc.getElementById('seekbook-status-close');
    reindex.textContent = t('status.reindexButton');
    close.textContent = t('common.close');
    close.addEventListener('click', () => win.close());
    reindex.addEventListener('click', () => {
      this.backend.reindex(item).catch(logError);
      schedule();
    });

    let pending = false;
    let alive = true;
    const draw = async () => {
      pending = false;
      if (!alive || win.closed) return;
      try {
        const text = await this.backend.text(item);
        const p = this.backend.progress(item);
        const [title, , ...rest] = text.split('\n');
        const h = doc.createElementNS('http://www.w3.org/1999/xhtml', 'div');
        h.className = 'title';
        h.textContent = title;
        const pre = doc.createElementNS('http://www.w3.org/1999/xhtml', 'div');
        pre.textContent = rest.join('\n');
        const parts: any[] = [h, pre];
        if (p && p.chunks) {
          const bar = doc.createElementNS('http://www.w3.org/1999/xhtml', 'progress');
          bar.max = p.chunks;
          bar.value = p.chunk;
          const line = doc.createElementNS('http://www.w3.org/1999/xhtml', 'div');
          line.className = 'headline';
          line.append(t('status.progress', { chunk: p.chunk, chunks: p.chunks }), bar);
          parts.splice(1, 0, line);
        }
        body.replaceChildren(...parts);
        updated.textContent = t('status.updated', { time: new Date().toLocaleTimeString() });
      } catch (e) {
        logError(e);
      }
    };
    const schedule = () => {
      if (pending) return;
      pending = true;
      void Zotero.Promise.delay(REDRAW_MS).then(draw);
    };
    const off = this.backend.onChange(schedule);
    const poll = async () => {
      while (alive && !win.closed) {
        await Zotero.Promise.delay(POLL_MS);
        schedule();
      }
    };
    win.addEventListener('unload', () => {
      alive = false;
      off();
      if (this.open.get(itemID) === win) this.open.delete(itemID);
    });
    void draw();
    void poll();
  }

  closeAll(): void {
    for (const w of this.open.values()) if (!w.closed) w.close();
    this.open.clear();
  }
}
