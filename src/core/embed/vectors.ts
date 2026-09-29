/**
 * Vector helpers: normalization, int8 quantization, cosine scores and byte
 * conversion for SQLite BLOBs. Pure, unit-tested.
 *
 * Storage is two-tier (decision E1): float32 for exact final scoring, int8 +
 * scale for the candidate scan over a whole scope.
 */

export function normalize(v: ArrayLike<number>): Float32Array {
  let sum = 0;
  for (let i = 0; i < v.length; i++) sum += v[i] * v[i];
  const inv = sum > 0 ? 1 / Math.sqrt(sum) : 0;
  const out = new Float32Array(v.length);
  for (let i = 0; i < v.length; i++) out[i] = v[i] * inv;
  return out;
}

/** Symmetric int8 quantization: q = round(v / scale), scale = max|v| / 127. */
export function quantize(v: Float32Array): { q: Int8Array; scale: number } {
  let max = 0;
  for (let i = 0; i < v.length; i++) max = Math.max(max, Math.abs(v[i]));
  const scale = max > 0 ? max / 127 : 1;
  const q = new Int8Array(v.length);
  for (let i = 0; i < v.length; i++) q[i] = Math.max(-127, Math.min(127, Math.round(v[i] / scale)));
  return { q, scale };
}

export function dot(a: ArrayLike<number>, b: ArrayLike<number>): number {
  let s = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) s += a[i] * b[i];
  return s;
}

/** Cosine of a normalized float query against an int8 vector at `offset` in a packed matrix (stored vectors are normalized). */
export function dotInt8(query: Float32Array, matrix: Int8Array, offset: number, scale: number): number {
  let s = 0;
  const n = query.length;
  for (let i = 0; i < n; i++) s += query[i] * matrix[offset + i];
  return s * scale;
}

export function floatToBytes(v: Float32Array): Uint8Array {
  return new Uint8Array(v.buffer.slice(v.byteOffset, v.byteOffset + v.byteLength));
}

/** Bytes of a BLOB as SQLite hands them to JS (Uint8Array or plain number array). */
export function toBytes(blob: ArrayLike<number> | ArrayBuffer): Uint8Array {
  if (blob instanceof Uint8Array) return blob;
  if (blob instanceof ArrayBuffer) return new Uint8Array(blob);
  return Uint8Array.from(blob as ArrayLike<number>);
}

export function bytesToFloat(blob: ArrayLike<number> | ArrayBuffer): Float32Array {
  const bytes = toBytes(blob);
  const copy = new Uint8Array(bytes.length);
  copy.set(bytes);
  return new Float32Array(copy.buffer, 0, Math.floor(bytes.length / 4));
}

export function int8ToBytes(q: Int8Array): Uint8Array {
  return new Uint8Array(q.buffer.slice(q.byteOffset, q.byteOffset + q.byteLength));
}

export function bytesToInt8(blob: ArrayLike<number> | ArrayBuffer): Int8Array {
  const bytes = toBytes(blob);
  return new Int8Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
}
