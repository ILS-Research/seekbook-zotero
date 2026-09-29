import { test } from 'node:test';
import assert from 'node:assert/strict';
import { embed, embedBody, embedUrl, EmbeddingError, parseEmbedResponse } from '../src/core/embed/client';

const cfg = { provider: 'ollama' as const, baseUrl: 'http://127.0.0.1:11434/', apiKey: '', model: 'qwen3-embedding:8b', allowedRemoteHosts: '' };

test('urls and bodies per provider', () => {
  assert.equal(embedUrl(cfg), 'http://127.0.0.1:11434/api/embed');
  assert.equal(embedUrl({ ...cfg, provider: 'openai', baseUrl: 'http://localhost:8000/v1' }), 'http://localhost:8000/v1/embeddings');
  assert.deepEqual(embedBody({ ...cfg, provider: 'openai' }, ['a']), { model: cfg.model, input: ['a'] });
});

test('both response shapes parse; bad ones throw', () => {
  assert.deepEqual(parseEmbedResponse({ embeddings: [[1, 2], [3, 4]] }, 2), [[1, 2], [3, 4]]);
  assert.deepEqual(parseEmbedResponse({ data: [{ index: 1, embedding: [3] }, { index: 0, embedding: [1] }] }, 2), [[1], [3]]);
  assert.throws(() => parseEmbedResponse({ embeddings: [[1]] }, 2), EmbeddingError);
  assert.throws(() => parseEmbedResponse({ embeddings: [[1], [1, 2]] }, 2), EmbeddingError);
});

test('remote host needs the allow-list; retries on 500, not on 400', async () => {
  await assert.rejects(embed({ ...cfg, baseUrl: 'https://ollama.ils.local' }, ['x']), { code: 'HOST_REJECTED' });
  const orig = globalThis.fetch;
  let calls = 0;
  const statuses = [500, 200];
  globalThis.fetch = (async (_url: string, init: any) => {
    calls++;
    assert.equal(init.redirect, 'error');
    const status = statuses.shift() ?? 400;
    return new Response(status === 200 ? JSON.stringify({ embeddings: [[0.1, 0.2]] }) : 'boom', { status });
  }) as any;
  try {
    const v = await embed(cfg, ['x'], { sleep: async () => {}, retries: 2 });
    assert.deepEqual(v, [[0.1, 0.2]]);
    assert.equal(calls, 2);
    calls = 0;
    await assert.rejects(embed(cfg, ['x'], { sleep: async () => {}, retries: 3 }), /HTTP 400/);
    assert.equal(calls, 1);
  } finally {
    globalThis.fetch = orig;
  }
});

test('model list: embedding models first', async () => {
  const { parseModelList } = await import('../src/core/embed/client');
  assert.deepEqual(parseModelList({ models: [{ name: 'qwen3:8b' }, { name: 'qwen3-embedding:8b' }, { name: 'bge-m3:latest' }] }),
    ['bge-m3:latest', 'qwen3-embedding:8b', 'qwen3:8b']);
  assert.deepEqual(parseModelList({ data: [{ id: 'text-embedding-3-small' }, { id: 'gpt-4o' }] }), ['text-embedding-3-small', 'gpt-4o']);
});

/** fetch that never answers until its signal aborts (like a hanging server). */
function hangingFetch(): typeof fetch {
  return ((_url: string, init: any) => new Promise((_resolve, reject) => {
    init.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
  })) as any;
}

test('network errors and timeouts are retryable EmbeddingErrors', async () => {
  const orig = globalThis.fetch;
  try {
    let calls = 0;
    globalThis.fetch = (async () => { calls++; throw new TypeError('NetworkError when attempting to fetch resource.'); }) as any;
    await assert.rejects(embed(cfg, ['x'], { sleep: async () => {}, retries: 2 }),
      (e: any) => e instanceof EmbeddingError && e.retryable && /not reachable/.test(e.message));
    assert.equal(calls, 3);
    globalThis.fetch = hangingFetch();
    await assert.rejects(embed(cfg, ['x'], { sleep: async () => {}, retries: 1, timeoutMs: 20 }),
      (e: any) => e instanceof EmbeddingError && /no answer within/.test(e.message));
    globalThis.fetch = (async () => new Response('not json', { status: 200 })) as any;
    await assert.rejects(embed(cfg, ['x'], { sleep: async () => {}, retries: 0 }),
      (e: any) => e instanceof EmbeddingError && /invalid JSON/.test(e.message));
  } finally {
    globalThis.fetch = orig;
  }
});

test('aborting the signal ends a hanging request at once, without retries', async () => {
  const orig = globalThis.fetch;
  globalThis.fetch = hangingFetch();
  try {
    const ctrl = new AbortController();
    const p = embed(cfg, ['x'], { sleep: async () => {}, retries: 3, timeoutMs: 60_000, signal: ctrl.signal });
    ctrl.abort();
    await assert.rejects(p, { name: 'AbortError' });
    await assert.rejects(embed(cfg, ['x'], { signal: ctrl.signal }), { name: 'AbortError' });
  } finally {
    globalThis.fetch = orig;
  }
});
