/** Text of the "Book index status" dialog for one book. Pure apart from t(), unit-tested. */
import { t, type Key } from '../i18n';
import type { Progress } from './indexer';
import type { DocRow } from './store';

export interface BookStatusInput {
  title: string;
  /** null: the book is not in the index. */
  docs: DocRow[] | null;
  chunks: Map<number, number>;
  progress: Progress;
  bookPk: number | null;
  /** Books waiting before this one (0 = next / current). */
  booksAhead: number;
  excludedTag: boolean;
  notABook: boolean;
}

const STATUS_KEY: Record<string, Key> = {
  queued: 'status.queued', indexing: 'status.indexing', ready: 'status.ready', failed: 'status.failed',
  excluded: 'status.excluded', duplicate: 'status.duplicate',
};

export function formatBookStatus(s: BookStatusInput): string {
  const lines = [s.title || t('status.untitled'), ''];
  if (s.notABook) return [...lines, t('status.notABook')].join('\n');
  if (!s.docs) {
    lines.push(t(s.excludedTag ? 'status.excludedBook' : 'status.notIndexed'));
    return lines.join('\n');
  }
  const ready = s.docs.filter((d) => d.status === 'ready').length;
  const waiting = s.docs.filter((d) => d.status === 'queued' || d.status === 'indexing').length;
  const current = s.progress.running && s.progress.bookPk === s.bookPk;
  if (current) lines.push(t('status.runningNow'));
  else if (waiting) lines.push(s.progress.running ? t('status.waiting', { n: s.booksAhead }) : t('status.waitingStopped'));
  else lines.push(t('status.summary', { ready, total: s.docs.length }));
  lines.push('');
  const byPk = new Map(s.docs.map((d) => [d.docPk, d]));
  for (const d of s.docs) {
    let line = `• ${d.attachmentTitle || d.fileName || d.attachmentKey}: ${t(STATUS_KEY[d.status] ?? 'status.queued')}`;
    if (d.status === 'ready') {
      line += ' – ' + t('status.readyDetail', { pages: d.pages ?? '?', windows: s.chunks.get(d.docPk) ?? 0, outline: t(`outline.${d.outlineSource || 'blocks'}` as Key) });
    } else if (d.status === 'indexing' && current && s.progress.attachmentKey === d.attachmentKey) {
      line += ' – ' + t('status.progress', { chunk: s.progress.chunk, chunks: s.progress.chunks });
    } else if (d.status === 'duplicate' && d.duplicateOf) {
      const of = byPk.get(d.duplicateOf);
      line += ' – ' + t('status.duplicateOf', { title: of?.attachmentTitle || of?.fileName || '?' });
    } else if (d.error) {
      line += ` – ${d.error}`;
    }
    lines.push(line);
  }
  if (s.progress.lastError && waiting) lines.push('', t('prefs.lastError', { message: s.progress.lastError }));
  return lines.join('\n');
}
