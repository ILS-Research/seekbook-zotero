/**
 * Embedding client: Ollama native (POST /api/embed), any OpenAI-compatible
 * server (POST /v1/embeddings), or local without a server through ZotSeek's
 * active model (Zotero.ZotSeek.api.embed, ZotSeek ILS fork 1.22.4.9+, only when its setting allows other plugins). Every
 * server request passes the host guard and is sent with redirect: 'error'.
 */
import { currentUserName, endUserValue, isStatsHost } from './end-user';
import { assertAllowedUrl, assertSecureTransport, parseAllowedHosts } from '../host-guard';
import { prepareTls } from '../tls';
import { zotseekModel, type SeekBookPrefs } from '../../prefs';
import { getFetch, newAbortController } from '../../util/env';

export class EmbeddingError extends Error {
  constructor(message: string, readonly retryable = false) {
    super(message);
    this.name = 'EmbeddingError';
  }
}

export type EmbeddingConfig = Pick<SeekBookPrefs, 'provider' | 'baseUrl' | 'apiKey' | 'model' | 'allowedRemoteHosts'>
  & Partial<Pick<SeekBookPrefs, 'allowInvalidCerts' | 'sendUserName'>>;

/** Host guard, https for API keys, certificate exception: everything before a request to the server. */
async function checkedUrl(cfg: Omit<EmbeddingConfig, 'model'>, url: string): Promise<void> {
  const u = assertAllowedUrl(url, parseAllowedHosts(cfg.allowedRemoteHosts));
  assertSecureTransport(u, cfg.apiKey);
  if (typeof Zotero !== 'undefined') await prepareTls(u, !!cfg.allowInvalidCerts);
}

export function embedUrl(cfg: EmbeddingConfig): string {
  const base = cfg.baseUrl.replace(/\/+$/, '');
  return cfg.provider === 'openai' ? `${base}/embeddings` : `${base}/api/embed`;
}

export function embedBody(cfg: EmbeddingConfig, input: string[], user?: string): Record<string, unknown> {
  // Ollama: no truncation of long inputs is better than a silent cut; windows are short anyway.
  if (cfg.provider !== 'openai') return { model: cfg.model, input, truncate: true };
  return user ? { model: cfg.model, input, user } : { model: cfg.model, input };
}

/** Vectors from either response shape, in input order. */
export function parseEmbedResponse(json: any, expected: number): number[][] {
  let vectors: unknown;
  if (Array.isArray(json?.embeddings)) vectors = json.embeddings;
  else if (Array.isArray(json?.data)) {
    vectors = [...json.data].sort((a: any, b: any) => (a?.index ?? 0) - (b?.index ?? 0)).map((d: any) => d?.embedding);
  }
  if (!Array.isArray(vectors) || vectors.length !== expected) {
    throw new EmbeddingError(`unexpected embedding response: expected ${expected} vectors`);
  }
  const dims = (vectors[0] as unknown[])?.length;
  for (const v of vectors) {
    if (!Array.isArray(v) || !v.length || v.length !== dims || v.some((x) => typeof x !== 'number' || !Number.isFinite(x))) {
      throw new EmbeddingError('unexpected embedding response: vectors of different length or not numeric');
    }
  }
  return vectors as number[][];
}

export interface EmbedOptions {
  retries?: number;
  /** Base delay of the exponential backoff in ms. */
  backoffMs?: number;
  signal?: AbortSignal;
  sleep?: (ms: number) => Promise<void>;
  /** Per attempt; a server that does not answer in time counts as a retryable failure. */
  timeoutMs?: number;
  /** Search query or document text: local mode lets ZotSeek add the model's matching prefix. */
  kind?: 'query' | 'doc';
}

/** Local mode: the texts through ZotSeek's active model (it adds the model's prefix), checked like server vectors. */
async function embedLocal(cfg: EmbeddingConfig, input: string[], opts: EmbedOptions): Promise<number[][]> {
  const api = (Zotero as any).ZotSeek?.api;
  if (typeof api?.embed !== 'function') {
    throw new EmbeddingError('Local mode needs ZotSeek (ILS fork 1.22.4.9 or newer) with "Let other plugins use ZotSeek\'s embedding models" switched on (Settings → ZotSeek), or choose an embedding server');
  }
  const current = api.embeddingModel?.()?.id;
  // ZotSeek's model was switched since SeekBook read it: these vectors would not match the index.
  if (current !== cfg.model) throw new EmbeddingError(`ZotSeek's model changed (${cfg.model} → ${current}): rebuild the index`);
  if (opts.signal?.aborted) throw abortError();
  const vectors = await api.embed(input, opts.kind ?? 'doc');
  if (opts.signal?.aborted) throw abortError();
  return parseEmbedResponse({ embeddings: vectors }, input.length);
}

/** Long enough for a cold model load on a busy server, short enough that stop/shutdown do not hang. */
export const EMBED_TIMEOUT_MS = 120_000;

/** Calls `fn` after `ms`; returns a cancel function. The plugin sandbox has no setTimeout. */
function startTimer(ms: number, fn: () => void): () => void {
  if (typeof setTimeout === 'function') {
    const h = setTimeout(fn, ms);
    return () => clearTimeout(h);
  }
  let live = true;
  void Zotero.Promise.delay(ms).then(() => { if (live) fn(); });
  return () => { live = false; };
}

/** One POST with timeout; aborting `signal` aborts the request. Network trouble becomes a retryable EmbeddingError. */
async function post(url: string, init: Record<string, unknown>, timeoutMs: number, signal?: AbortSignal): Promise<any> {
  const ctrl = newAbortController();
  let timedOut = false;
  const onAbort = () => ctrl.abort();
  if (signal?.aborted) ctrl.abort();
  signal?.addEventListener('abort', onAbort);
  const cancel = startTimer(timeoutMs, () => { timedOut = true; ctrl.abort(); });
  try {
    let resp: Response;
    try {
      resp = await getFetch()(url, { ...init, signal: ctrl.signal });
    } catch (e: any) {
      if (signal?.aborted) throw e;
      if (timedOut) throw new EmbeddingError(`embedding server: no answer within ${Math.round(timeoutMs / 1000)} s`, true);
      // fetch rejects with a TypeError for DNS, refused connections, TLS and CORS problems.
      const hint = url.startsWith('https:') ? ' (invalid certificate? see "Accept invalid certificate" in the settings)' : '';
      throw new EmbeddingError(`embedding server not reachable: ${e?.message || e}${hint}`, true);
    }
    if (!resp.ok) {
      const text = (await resp.text().catch(() => '')).slice(0, 300);
      // 4xx other than 408/429 will not get better by retrying.
      const retryable = resp.status >= 500 || resp.status === 408 || resp.status === 429;
      throw new EmbeddingError(`embedding server: HTTP ${resp.status} ${text}`, retryable);
    }
    try {
      return await resp.json();
    } catch (e: any) {
      if (signal?.aborted) throw e;
      throw new EmbeddingError(timedOut ? 'embedding server: answer timed out' : `embedding server: invalid JSON (${e?.message || e})`, true);
    }
  } finally {
    cancel();
    signal?.removeEventListener('abort', onAbort);
  }
}

export async function embed(cfg: EmbeddingConfig, input: string[], opts: EmbedOptions = {}): Promise<number[][]> {
  if (!input.length) return [];
  if (!cfg.model) throw new EmbeddingError(cfg.provider === 'zotseek' ? 'Local mode: ZotSeek is not installed, not started, or does not let other plugins use its models (Settings → ZotSeek)' : 'No embedding model set (Settings → SeekBook)');
  if (cfg.provider === 'zotseek') return embedLocal(cfg, input, opts);
  const url = embedUrl(cfg);
  await checkedUrl(cfg, url);
  // Usage statistics of the ILS server: the user name (plain, or hashed when the option is off); other hosts get nothing.
  const user = cfg.provider === 'openai' && isStatsHost(cfg.baseUrl)
    ? await endUserValue(currentUserName(), cfg.sendUserName !== false) : undefined;
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (cfg.apiKey) headers.Authorization = `Bearer ${cfg.apiKey}`;
  const retries = opts.retries ?? 3;
  const sleep = opts.sleep ?? ((ms: number) => Zotero.Promise.delay(ms));
  let lastError: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    if (attempt) await sleep((opts.backoffMs ?? 1000) * 2 ** (attempt - 1));
    if (opts.signal?.aborted) break;
    try {
      const json = await post(url, { method: 'POST', headers, body: JSON.stringify(embedBody(cfg, input, user)), redirect: 'error' },
        opts.timeoutMs ?? EMBED_TIMEOUT_MS, opts.signal);
      return parseEmbedResponse(json, input.length);
    } catch (e: any) {
      lastError = e;
      if (opts.signal?.aborted) throw e;
      const retryable = e instanceof EmbeddingError ? e.retryable : e?.code !== 'HOST_REJECTED';
      if (!retryable) throw e;
    }
  }
  if (opts.signal?.aborted) throw abortError();
  throw lastError;
}

function abortError(): Error {
  const e = new Error('aborted');
  e.name = 'AbortError';
  return e;
}

// Names of common embedding model families (Ollama lists chat and embedding models together).
const EMBEDDING_NAME = /embed|bge|\be5\b|e5-|minilm|gte|arctic|nomic|mxbai|jina|granite-embedding/i;

export function isEmbeddingModelName(name: string): boolean {
  return EMBEDDING_NAME.test(name);
}

/** Model names from a /api/tags or /models response: embedding models first, each group sorted. */
export function parseModelList(json: any): string[] {
  const names: string[] = Array.isArray(json?.models) ? json.models.map((m: any) => String(m?.name ?? m?.model ?? ''))
    : Array.isArray(json?.data) ? json.data.map((m: any) => String(m?.id ?? '')) : [];
  const unique = Array.from(new Set(names.filter(Boolean))).sort();
  return [...unique.filter(isEmbeddingModelName), ...unique.filter((n) => !isEmbeddingModelName(n))];
}

/** Models on the server (GET /api/tags or /models), same as in SeekChat. */
export async function listModels(cfg: Omit<EmbeddingConfig, 'model'>): Promise<string[]> {
  if (cfg.provider === 'zotseek') {
    const m = zotseekModel();
    if (!m) throw new EmbeddingError('Local mode needs ZotSeek (ILS fork 1.22.4.9 or newer) with "Let other plugins use ZotSeek\'s embedding models" switched on');
    return [m.id];
  }
  const base = cfg.baseUrl.replace(/\/+$/, '');
  const url = cfg.provider === 'openai' ? `${base}/models` : `${base}/api/tags`;
  await checkedUrl(cfg, url);
  const headers: Record<string, string> = {};
  if (cfg.apiKey) headers.Authorization = `Bearer ${cfg.apiKey}`;
  const resp = await getFetch()(url, { method: 'GET', headers, redirect: 'error' });
  if (!resp.ok) throw new EmbeddingError(`model list: HTTP ${resp.status}`);
  return parseModelList(await resp.json());
}
