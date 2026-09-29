// Embedding server stand-in for E2E tests: POST /api/embed (Ollama) and /v1/embeddings (OpenAI).
// Vectors: hashed bag of words (64 dims) plus the model name's hash, so texts sharing words are
// similar and a model change changes every vector. The dimension is 64, or 32 for models ending in "-32".
// GET /__requests: number of embedding requests and inputs so far. POST /__fail?on=1|0 simulates an outage.
import fs from 'node:fs';
import http from 'node:http';
import https from 'node:https';

let requests = 0;
let inputs = 0;
let failing = false;
let delayMs = 0;

function hash(s) {
  let h = 2166136261;
  for (const c of s) h = Math.imul(h ^ c.codePointAt(0), 16777619) >>> 0;
  return h;
}

function vector(text, model) {
  const dims = model.endsWith('-32') ? 32 : model.endsWith('-4096') ? 4096 : 64;
  const v = new Array(dims).fill(0);
  v[hash(model) % dims] += 0.5;
  for (const w of text.toLowerCase().match(/[\p{L}\p{N}]{4,}/gu) || []) v[hash(w) % dims] += 1;
  return v;
}

const handler = async (req, res) => {
  const json = (status, data) => {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(data));
  };
  const url = new URL(req.url, 'http://x');
  if (req.method === 'GET' && url.pathname === '/api/tags') {
    return json(200, { models: [{ name: 'llama3:8b' }, { name: 'mock-embed' }, { name: 'mock-embed-32' }] });
  }
  if (req.method === 'GET' && url.pathname === '/__requests') return json(200, { requests, inputs });
  if (req.method === 'POST' && url.pathname === '/__delay') {
    delayMs = Number(url.searchParams.get('ms')) || 0;
    return json(200, { delayMs });
  }
  if (req.method === 'POST' && url.pathname === '/__fail') {
    failing = url.searchParams.get('on') === '1';
    return json(200, { failing });
  }
  if (req.method === 'POST' && (url.pathname === '/api/embed' || url.pathname === '/v1/embeddings')) {
    let body = '';
    for await (const chunk of req) body += chunk;
    if (failing) return json(503, { error: 'mock outage' });
    if (delayMs) await new Promise((r) => setTimeout(r, delayMs));
    const parsed = JSON.parse(body);
    const input = Array.isArray(parsed.input) ? parsed.input : [parsed.input];
    requests++;
    inputs += input.length;
    const vectors = input.map((t) => vector(String(t), String(parsed.model || '')));
    if (url.pathname === '/api/embed') return json(200, { model: parsed.model, embeddings: vectors });
    return json(200, { data: vectors.map((embedding, index) => ({ index, embedding })) });
  }
  res.writeHead(404);
  res.end();
};

http.createServer(handler).listen(11434, '127.0.0.1', () => console.log('mock embedding server on 127.0.0.1:11434'));
// Same API over https with a self-signed certificate (e2e/tls), for the "accept invalid certificate" setting.
https.createServer({ key: fs.readFileSync('/e2e/tls/selfsigned.key'), cert: fs.readFileSync('/e2e/tls/selfsigned.crt') }, handler)
  .listen(11435, '127.0.0.1', () => console.log('mock embedding server (self-signed https) on 127.0.0.1:11435'));

