import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assertAllowedUrl, parseAllowedHosts } from '../src/core/host-guard';


test('loopback is allowed without configuration', () => {
  for (const url of ['http://127.0.0.1:11434', 'http://localhost:1234/v1/models', 'http://[::1]:8080']) {
    assert.doesNotThrow(() => assertAllowedUrl(url, []));
  }
});

test('remote hosts need an explicit, exact entry', () => {
  assert.throws(() => assertAllowedUrl('https://ollama.ils.local', []), { code: 'HOST_REJECTED' });
  const allowed = parseAllowedHosts('ollama.ils.local');
  assert.equal(assertAllowedUrl('https://ollama.ils.local/api/embed', allowed).hostname, 'ollama.ils.local');
  assert.throws(() => assertAllowedUrl('https://ollama.ils.local.evil.com', allowed), { code: 'HOST_REJECTED' });
});

test('credentials and other schemes are rejected', () => {
  const allowed = ['ollama.ils.local'];
  assert.throws(() => assertAllowedUrl('https://u:p@ollama.ils.local', allowed), { code: 'HOST_REJECTED' });
  assert.throws(() => assertAllowedUrl('file:///etc/passwd', allowed), { code: 'HOST_REJECTED' });
});

test('host list parsing normalizes entries', () => {
  assert.deepEqual(parseAllowedHosts(' https://Ollama.ILS.local:443/x, gpu01:11434 gpu01,, '), ['ollama.ils.local', 'gpu01']);
  assert.deepEqual(parseAllowedHosts(undefined), []);
});

test('an API key needs https, except on this computer', async () => {
  const { assertSecureTransport } = await import('../src/core/host-guard');
  const u = (s: string) => new URL(s);
  assert.throws(() => assertSecureTransport(u('http://ollama.example.local:11434'), 'secret'), { code: 'HOST_REJECTED' });
  assert.doesNotThrow(() => assertSecureTransport(u('https://ollama.example.local'), 'secret'));
  assert.doesNotThrow(() => assertSecureTransport(u('http://ollama.example.local:11434'), ''));
  for (const local of ['http://127.0.0.1:11434', 'http://localhost:8000', 'http://[::1]:11434']) {
    assert.doesNotThrow(() => assertSecureTransport(u(local), 'secret'), local);
  }
});
