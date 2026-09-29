/** Base64 without atob/btoa (missing in the plugin sandbox and in Node's older globals). */
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const LOOKUP = new Uint8Array(128);
for (let i = 0; i < ALPHABET.length; i++) LOOKUP[ALPHABET.charCodeAt(i)] = i;

export function bytesToBase64(bytes: Uint8Array): string {
  const parts: string[] = [];
  let chunk = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const n = (bytes[i] << 16) | ((bytes[i + 1] ?? 0) << 8) | (bytes[i + 2] ?? 0);
    chunk += ALPHABET[(n >> 18) & 63] + ALPHABET[(n >> 12) & 63]
      + (i + 1 < bytes.length ? ALPHABET[(n >> 6) & 63] : '=')
      + (i + 2 < bytes.length ? ALPHABET[n & 63] : '=');
    if (chunk.length >= 8192) { parts.push(chunk); chunk = ''; }
  }
  parts.push(chunk);
  return parts.join('');
}

export function base64ToBytes(s: string): Uint8Array {
  const clean = s.replace(/[^A-Za-z0-9+/]/g, '');
  const out = new Uint8Array(Math.floor((clean.length * 3) / 4));
  let o = 0;
  for (let i = 0; i < clean.length; i += 4) {
    const n = (LOOKUP[clean.charCodeAt(i)] << 18) | (LOOKUP[clean.charCodeAt(i + 1)] << 12)
      | ((LOOKUP[clean.charCodeAt(i + 2)] || 0) << 6) | (LOOKUP[clean.charCodeAt(i + 3)] || 0);
    if (o < out.length) out[o++] = (n >> 16) & 255;
    if (o < out.length) out[o++] = (n >> 8) & 255;
    if (o < out.length) out[o++] = n & 255;
  }
  return out;
}

const HEX = Array.from({ length: 256 }, (_, i) => i.toString(16).padStart(2, '0').toUpperCase());

export function bytesToHex(bytes: Uint8Array): string {
  const parts = new Array<string>(bytes.length);
  for (let i = 0; i < bytes.length; i++) parts[i] = HEX[bytes[i]];
  return parts.join('');
}

export function hexToBytes(s: string): Uint8Array {
  const out = new Uint8Array(s.length >> 1);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(s.substr(i * 2, 2), 16);
  return out;
}
