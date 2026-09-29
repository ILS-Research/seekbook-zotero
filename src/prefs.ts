/** Typed access to extensions.zotero.seekbook.* (defaults in prefs.js). */

export type Provider = 'ollama' | 'openai';

export interface SeekBookPrefs {
  provider: Provider;
  baseUrl: string;
  apiKey: string;
  model: string;
  queryPrefix: string;
  docPrefix: string;
  allowedRemoteHosts: string;
  chunkWords: number;
  strideWords: number;
  batchSize: number;
  /** Embedding requests in flight at once while indexing. */
  embedConcurrency: number;
  /** Memory for resident search vectors (MB). */
  cacheMB: number;
  excludeTag: string;
  /** Library keys to index; empty = all. */
  libraries: string[];
  autoIndex: boolean;
  /** Which PDF survives when a whole-book PDF contains a chapter PDF. */
  preferDuplicates: 'whole' | 'parts';
  apiEnabled: boolean;
}

// Without the `global` flag Zotero prepends "extensions.zotero.", matching prefs.js.
const PREFIX = 'seekbook.';

export function getPref(key: string): any {
  return Zotero.Prefs.get(PREFIX + key);
}

export function setPref(key: string, value: string | number | boolean): void {
  Zotero.Prefs.set(PREFIX + key, value);
}

function int(key: string, fallback: number, min: number, max: number): number {
  const v = Number(getPref(key));
  return Number.isFinite(v) && getPref(key) !== undefined ? Math.min(max, Math.max(min, Math.round(v))) : fallback;
}

function str(key: string, fallback = ''): string {
  const v = getPref(key);
  return typeof v === 'string' ? v.trim() : fallback;
}

function bool(key: string, fallback: boolean): boolean {
  const v = getPref(key);
  return typeof v === 'boolean' ? v : fallback;
}

export function readPrefs(): SeekBookPrefs {
  const chunkWords = int('chunkWords', 200, 40, 2000);
  return {
    provider: str('provider') === 'openai' ? 'openai' : 'ollama',
    baseUrl: str('baseUrl'),
    apiKey: str('apiKey'),
    model: str('model'),
    // Prefixes keep their trailing space/newline.
    queryPrefix: typeof getPref('queryPrefix') === 'string' ? getPref('queryPrefix') : '',
    docPrefix: typeof getPref('docPrefix') === 'string' ? getPref('docPrefix') : '',
    allowedRemoteHosts: str('allowedRemoteHosts'),
    chunkWords,
    strideWords: Math.min(chunkWords, int('strideWords', 120, 10, 2000)),
    batchSize: int('batchSize', 32, 1, 256),
    embedConcurrency: int('embedConcurrency', 2, 1, 8),
    cacheMB: int('cacheMB', 1024, 64, 16384),
    excludeTag: str('excludeTag', 'seekbook-exclude'),
    libraries: str('libraries').split(/[,\s]+/).filter(Boolean),
    autoIndex: bool('autoIndex', false),
    preferDuplicates: str('preferDuplicates') === 'parts' ? 'parts' : 'whole',
    apiEnabled: bool('apiEnabled', true),
  };
}
