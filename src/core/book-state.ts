/** One glyph per book for the item tree column, from the states of its PDFs. Pure, unit-tested. */

export type BookState = 'ready' | 'partial' | 'working' | 'queued' | 'failed' | 'excluded';

export const GLYPHS: Record<BookState, string> = {
  ready: '✓',     // every PDF searchable (duplicates count as covered)
  partial: '◐',   // some PDFs searchable, others failed or waiting
  working: '⟳',   // being indexed right now
  queued: '…',    // waiting in the queue, nothing searchable yet
  failed: '✗',    // nothing searchable, at least one PDF failed
  excluded: '⊘',  // excluded by tag / no PDF
};

/** `statuses`: status of every PDF of the book; `current`: the indexer works on this book. */
export function bookState(statuses: string[], current = false): BookState | null {
  if (!statuses.length) return null;
  const n = (s: string) => statuses.filter((x) => x === s).length;
  const ready = n('ready');
  const covered = ready + n('duplicate');
  const waiting = n('queued') + n('indexing');
  if (current && waiting) return 'working';
  if (ready && covered + n('excluded') === statuses.length) return 'ready';
  if (ready) return 'partial';
  if (waiting) return 'queued';
  if (n('failed')) return 'failed';
  return 'excluded';
}
