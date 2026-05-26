/**
 * SHA-256 → hex via Web Crypto (mobile-safe, no Node Buffer).
 */
export async function sha256Hex(
  bytes: ArrayBuffer | Uint8Array,
): Promise<string> {
  // crypto.subtle wants a BufferSource of ArrayBuffer (not SharedArrayBuffer);
  // unwrap a typed-array view to its raw ArrayBuffer slice.
  const buf: ArrayBuffer =
    bytes instanceof Uint8Array
      ? bytes.buffer.slice(
          bytes.byteOffset,
          bytes.byteOffset + bytes.byteLength,
        ) as ArrayBuffer
      : bytes;
  const digest = await crypto.subtle.digest('SHA-256', buf);

  return bufToHex(digest);
}

function bufToHex(buf: ArrayBuffer): string {
  const view = new Uint8Array(buf);
  let out = '';

  for (let i = 0; i < view.length; i++) {
    out += view[i].toString(16).padStart(2, '0');
  }

  return out;
}
