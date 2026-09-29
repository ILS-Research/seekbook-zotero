/**
 * Copied from SeekChat. Reads the outline (bookmarks) and page labels straight from the PDF file with the pdf.js
 * that ships with Zotero's reader. Independent of an open reader tab: Zotero
 * 10's reader only loads the outline while its sidebar shows the outline view.
 *
 * pdf.js needs DOM and Worker APIs, which the plugin sandbox lacks, so the
 * module is imported into Zotero's main window (a privileged document).
 */
import { MAX_DEPTH, type ReaderOutlineItem } from './outline';

const PDFJS_URL = 'resource://zotero/reader/pdf/build/pdf.mjs';
const PDFJS_WORKER_URL = 'resource://zotero/reader/pdf/build/pdf.worker.mjs';

let pdfjsPromise: Promise<any> | null = null;

function loadPdfjs(): Promise<any> {
  if (!pdfjsPromise) {
    const win = Zotero.getMainWindow();
    pdfjsPromise = (win.eval(`import(${JSON.stringify(PDFJS_URL)})`) as Promise<any>).then((mod) => {
      mod.GlobalWorkerOptions.workerSrc = PDFJS_WORKER_URL;
      return mod;
    });
    // A failed load is not cached, so the next call retries.
    pdfjsPromise.catch(() => { pdfjsPromise = null; });
  }
  return pdfjsPromise;
}

/**
 * Page index (0-based, -1 if unknown) and vertical position of an outline
 * destination: `top` 0 = top edge of the page, 1 = bottom, null if the
 * destination has no y coordinate (/Fit, /FitV …).
 */
async function locate(doc: any, dest: unknown): Promise<{ pageIndex: number; top: number | null }> {
  try {
    const explicit = typeof dest === 'string' ? await doc.getDestination(dest) : dest;
    if (!Array.isArray(explicit) || !explicit.length) return { pageIndex: -1, top: null };
    const ref = explicit[0];
    const pageIndex = typeof ref === 'number' ? ref : await doc.getPageIndex(ref);
    // [ref, {name: 'XYZ'}, left, top, zoom] · [ref, {name: 'FitH' | 'FitBH'}, top]
    const kind = explicit[1]?.name;
    const y = kind === 'XYZ' ? explicit[3] : kind === 'FitH' || kind === 'FitBH' ? explicit[2] : null;
    if (typeof y !== 'number') return { pageIndex, top: null };
    const view: number[] = (await doc.getPage(pageIndex + 1)).view;
    const height = view[3] - view[1];
    return { pageIndex, top: height > 0 ? Math.min(1, Math.max(0, (view[3] - y) / height)) : null };
  } catch {
    return { pageIndex: -1, top: null };
  }
}

async function convert(doc: any, items: any[] | null, depth: number): Promise<ReaderOutlineItem[]> {
  const out: ReaderOutlineItem[] = [];
  for (const it of items || []) {
    out.push({
      title: String(it.title || ''),
      location: { position: await locate(doc, it.dest) },
      // MAX_DEPTH levels plus one spare for a single root entry that gets unwrapped.
      items: depth < MAX_DEPTH ? await convert(doc, it.items, depth + 1) : [],
    });
  }
  return out;
}

export interface PdfStructure {
  /** Bookmarks in the reader's item shape; [] if the PDF has none. */
  outline: ReaderOutlineItem[];
  /** Printed page label per physical page (index 0 = page 1); null if the PDF defines none. */
  labels: (string | null)[] | null;
}

/** Outline and page labels of a PDF attachment, read in one pass over the file. */
export async function readPdfStructure(attachment: any): Promise<PdfStructure> {
  const path = await attachment.getFilePathAsync();
  if (!path) return { outline: [], labels: null };
  const win = Zotero.getMainWindow();
  const bytes: Uint8Array = await win.IOUtils.read(path);
  const pdfjs = await loadPdfjs();
  const task = pdfjs.getDocument({ data: bytes, isEvalSupported: false });
  const doc = await task.promise;
  try {
    let labels: (string | null)[] | null = null;
    try {
      const raw = await doc.getPageLabels();
      labels = Array.isArray(raw) ? raw.map((l: unknown) => (typeof l === 'string' && l ? l : null)) : null;
    } catch {
      // broken /PageLabels: physical pages only
    }
    return { outline: await convert(doc, await doc.getOutline(), 0), labels };
  } finally {
    await task.destroy();
  }
}
