/** Typed access to extensions.zotero.seekbook.* (defaults in prefs.js). */

/** Embedding server: Ollama native, OpenAI-compatible, or local with ZotSeek's active model (no server). */
export type Provider = 'ollama' | 'openai' | 'zotseek';

/** ZotSeek's active embedding model ({id, label, dimensions}), or null without ZotSeek (or without its API). */
export function zotseekModel(): { id: string; label: string; dimensions: number } | null {
  try {
    return (Zotero as any).ZotSeek?.api?.embeddingModel?.() ?? null;
  } catch {
    return null;
  }
}

/** Ready to embed: a server and a model, or ZotSeek's model in local mode. */
export function isConfigured(p: Pick<SeekBookPrefs, 'provider' | 'baseUrl' | 'model'>): boolean {
  return p.provider === 'zotseek' ? !!p.model : !!(p.baseUrl && p.model);
}

export interface SeekBookPrefs {
  provider: Provider;
  baseUrl: string;
  apiKey: string;
  model: string;
  queryPrefix: string;
  docPrefix: string;
  allowedRemoteHosts: string;
  /** https servers with an invalid (e.g. self-signed) certificate are accepted. */
  allowInvalidCerts: boolean;
  /** User name as `user` in embedding requests (default); off: only its hash. ollama.ils.local only. */
  sendUserName: boolean;
  chunkWords: number;
  strideWords: number;
  batchSize: number;
  /** Embedding requests in flight at once while indexing. */
  embedConcurrency: number;
  /** Memory for resident search vectors (MB). */
  cacheMB: number;
  excludeTag: string;
  /** Items of other types with at least this many pages are indexed like books; 0 = books only. */
  minPages: number;
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
  const p = str('provider');
  const provider: Provider = p === 'ollama' || p === 'zotseek' ? p : 'openai';
  // Local mode: ZotSeek's model, and ZotSeek adds that model's prefixes itself.
  const local = provider === 'zotseek';
  return {
    provider,
    baseUrl: str('baseUrl'),
    apiKey: str('apiKey'),
    model: local ? zotseekModel()?.id || '' : str('model'),
    // Prefixes keep their trailing space/newline.
    queryPrefix: !local && typeof getPref('queryPrefix') === 'string' ? getPref('queryPrefix') : '',
    docPrefix: !local && typeof getPref('docPrefix') === 'string' ? getPref('docPrefix') : '',
    allowedRemoteHosts: str('allowedRemoteHosts'),
    allowInvalidCerts: bool('allowInvalidCerts', false),
    sendUserName: bool('sendUserName', true),
    chunkWords,
    strideWords: Math.min(chunkWords, int('strideWords', 120, 10, 2000)),
    batchSize: int('batchSize', 32, 1, 256),
    embedConcurrency: int('embedConcurrency', 2, 1, 8),
    cacheMB: int('cacheMB', 1024, 64, 16384),
    excludeTag: str('excludeTag', 'seekbook-exclude'),
    minPages: int('minPages', 30, 0, 100000),
    libraries: str('libraries').split(/[,\s]+/).filter(Boolean),
    autoIndex: bool('autoIndex', true),
    preferDuplicates: str('preferDuplicates') === 'parts' ? 'parts' : 'whole',
    apiEnabled: bool('apiEnabled', true),
  };
}

const ILS_HOST = 'ollama.ils.local';
export const ILS_ENDPOINT = `https://${ILS_HOST}/v1`;

/**
 * Forced move of ollama.ils.local to the OpenAI interface: native Ollama (or an unset interface) with that host
 * becomes "openai"; a bare address gets /v1 (any scheme or port). null: nothing to change.
 */
export function migratedEmbeddingServer(provider: string, baseUrl: string): { provider: 'openai'; baseUrl: string } | null {
  if (provider === 'openai' || provider === 'zotseek') return null;
  try {
    const u = new URL(baseUrl.trim());
    if (u.hostname.toLowerCase() !== ILS_HOST || u.username || u.password) return null;
    const bare = u.pathname.replace(/\/+$/, '') === '';
    return { provider: 'openai', baseUrl: bare ? ILS_ENDPOINT : baseUrl.trim() };
  } catch {
    return null;
  }
}

/** Applies migratedEmbeddingServer to the stored prefs (at startup). */
export function migrateEmbeddingServer(): void {
  const next = migratedEmbeddingServer(str('provider', 'ollama'), str('baseUrl'));
  if (!next) return;
  setPref('provider', next.provider);
  setPref('baseUrl', next.baseUrl);
}
