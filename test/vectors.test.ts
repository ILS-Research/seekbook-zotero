import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bytesToFloat, bytesToInt8, dot, dotInt8, floatToBytes, int8ToBytes, normalize, quantize } from '../src/core/embed/vectors';
import { base64ToBytes, bytesToBase64, bytesToHex, hexToBytes } from '../src/util/base64';

test('int8 cosine is close to float cosine', () => {
  const rnd = (seed: number) => Array.from({ length: 256 }, (_, i) => Math.sin(seed * 997 + i * 13.37));
  const a = normalize(rnd(1));
  const b = normalize(rnd(2));
  const { q, scale } = quantize(b);
  assert.ok(Math.abs(dotInt8(a, q, 0, scale) - dot(a, b)) < 0.01);
  assert.ok(Math.abs(dot(a, a) - 1) < 1e-5);
});

test('byte round trips', () => {
  const f = Float32Array.from([1.5, -2.25, 0]);
  assert.deepEqual(Array.from(bytesToFloat(floatToBytes(f))), [1.5, -2.25, 0]);
  assert.deepEqual(Array.from(bytesToFloat(Array.from(floatToBytes(f)))), [1.5, -2.25, 0]);
  const q = Int8Array.from([-127, 0, 5, 127]);
  assert.deepEqual(Array.from(bytesToInt8(int8ToBytes(q))), [-127, 0, 5, 127]);
  for (const len of [0, 1, 2, 3, 4, 5, 300]) {
    const bytes = Uint8Array.from({ length: len }, (_, i) => (i * 37) & 255);
    assert.equal(bytesToBase64(bytes), Buffer.from(bytes).toString('base64'));
    assert.deepEqual(Array.from(base64ToBytes(bytesToBase64(bytes))), Array.from(bytes));
    assert.equal(bytesToHex(bytes), Buffer.from(bytes).toString('hex').toUpperCase());
    assert.deepEqual(Array.from(hexToBytes(bytesToHex(bytes))), Array.from(bytes));
  }
});
