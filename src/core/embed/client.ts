/**
 * Embedding server client: Ollama native (POST /api/embed) or any
 * OpenAI-compatible server (POST /v1/embeddings). Every request passes the
 * host guard and is sent with redirect: 'error'.
 */
import { assertAllowedUrl, parseAllowedHosts } from '../host-guard';
import type { SeekBookPrefs } from '../../prefs';
import { getFetch, newAbortController } from '../../util/env';

export class EmbeddingError extends Error {
  constructor(message: string, readonly retryable = false) {
    super(message);
    this.name = 'EmbeddingError';
  }
}

export type EmbeddingConfig = Pick<SeekBookPrefs, 'provider' | 'baseUrl' | 'apiKey' | 'model' | 'allowedRemoteHosts'>;

export function embedUrl(cfg: EmbeddingConfig): string {
  const base = cfg.baseUrl.replace(/\/+$/, '');
  return cfg.provider === 'openai' ? `${base}/embeddings` : `${base}/api/embed`;
}

export function embedBody(cfg: EmbeddingConfig, input: string[]): Record<string, unknown> {
  // Ollama: no truncation of long inputs is better than a silent cut; windows are short anyway.
  return cfg.provider === 'openai' ? { model: cfg.model, input } : { model: cfg.model, input, truncate: true };
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
      throw new EmbeddingError(`embedding server not reachable: ${e?.message || e}`, true);
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
  if (!cfg.model) throw new EmbeddingError('No embedding model set (Settings → SeekBook)');
  const url = embedUrl(cfg);
  assertAllowedUrl(url, parseAllowedHosts(cfg.allowedRemoteHosts));
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (cfg.apiKey) headers.Authorization = `Bearer ${cfg.apiKey}`;
  const retries = opts.retries ?? 3;
  const sleep = opts.sleep ?? ((ms: number) => Zotero.Promise.delay(ms));
  let lastError: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    if (attempt) await sleep((opts.backoffMs ?? 1000) * 2 ** (attempt - 1));
    if (opts.signal?.aborted) break;
    try {
      const json = await post(url, { method: 'POST', headers, body: JSON.stringify(embedBody(cfg, input)), redirect: 'error' },
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
  const base = cfg.baseUrl.replace(/\/+$/, '');
  const url = cfg.provider === 'openai' ? `${base}/models` : `${base}/api/tags`;
  assertAllowedUrl(url, parseAllowedHosts(cfg.allowedRemoteHosts));
  const headers: Record<string, string> = {};
  if (cfg.apiKey) headers.Authorization = `Bearer ${cfg.apiKey}`;
  const resp = await getFetch()(url, { method: 'GET', headers, redirect: 'error' });
  if (!resp.ok) throw new EmbeddingError(`model list: HTTP ${resp.status}`);
  return parseModelList(await resp.json());
}
