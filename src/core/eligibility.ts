/**
 * Which items SeekBook indexes: items of type "book", plus any other regular item
 * with at least `minPages` pages (0 = books only). Pages come from the item's
 * "# of Pages" field or from Zotero's full-text index of its PDFs (totalPages).
 */
import { isFileAttachment, isPdf } from './zotero-items';

/** First number of a "# of Pages" field ("312", "xii, 312 S."), or null. */
export function parsePages(v: unknown): number | null {
  const m = /\d+/.exec(String(v ?? ''));
  const n = m ? parseInt(m[0], 10) : 0;
  return n > 0 ? n : null;
}

/** Synchronous part: true for books, page field long enough; false/null otherwise (null = unknown). */
export function qualifiesSync(item: any, minPages: number): boolean | null {
  if (!item?.isRegularItem?.()) return false;
  if (item.itemType === 'book') return true;
  if (minPages <= 0) return false;
  let field: unknown = null;
  try { field = item.getField?.('numPages'); } catch { /* no such field for this type */ }
  const n = parsePages(field);
  return n !== null && n >= minPages ? true : null;
}

/**
 * Book, or long enough. Returns null when the page count is unknown (no field, PDFs not
 * in Zotero's full-text index), so callers can keep items that were indexed before.
 */
export async function qualifies(item: any, minPages: number): Promise<boolean | null> {
  const s = qualifiesSync(item, minPages);
  if (s !== null || minPages <= 0) return s ?? false;
  let known = false;
  for (const id of item.getAttachments?.() || []) {
    const a = Zotero.Items.get(id);
    if (!a || a.deleted || !isFileAttachment(a) || !isPdf(a)) continue;
    const row: any = await (Zotero as any).Fulltext?.getPages?.(a.id);
    const total = Number(row?.total) || 0;
    if (total > 0) known = true;
    if (total >= minPages) return true;
  }
  return known ? false : null;
}
