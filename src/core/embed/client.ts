/**
 * Embedding server client: Ollama native (POST /api/embed) or any
 * OpenAI-compatible server (POST /v1/embeddings). Every request passes the
 * host guard and is sent with redirect: 'error'.
 */
import { assertAllowedUrl, parseAllowedHosts } from '../host-guard';
import type { SeekBookPrefs } from '../../prefs';
import { getFetch } from '../../util/env';

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
    try {
      const resp = await getFetch()(url, {
        method: 'POST', headers, body: JSON.stringify(embedBody(cfg, input)), redirect: 'error', signal: opts.signal,
      });
      if (!resp.ok) {
        const text = (await resp.text().catch(() => '')).slice(0, 300);
        // 4xx other than 408/429 will not get better by retrying.
        const retryable = resp.status >= 500 || resp.status === 408 || resp.status === 429;
        throw new EmbeddingError(`embedding server: HTTP ${resp.status} ${text}`, retryable);
      }
      return parseEmbedResponse(await resp.json(), input.length);
    } catch (e: any) {
      lastError = e;
      if (opts.signal?.aborted) throw e;
      const retryable = e instanceof EmbeddingError ? e.retryable : e?.code !== 'HOST_REJECTED';
      if (!retryable) throw e;
    }
  }
  throw lastError;
}
