/**
 * AES-GCM + PBKDF2 settings encryption for Forge's cross-device
 * export/import flow.
 *
 * Why not symmetric without a passphrase: any encryption key Forge
 * itself owns can't safely travel via the vault to other devices,
 * because anything Forge can decrypt, an attacker who has the vault
 * (e.g., synced via a third-party drive) can also decrypt by reading
 * the plugin code. A user-chosen passphrase is the only key the
 * attacker doesn't already have.
 *
 * Why WebCrypto: built into all Obsidian-supported runtimes (desktop
 * + iOS + Android). No dependency, no bundle bloat, audited
 * implementation.
 *
 * Format (v1):
 *   {
 *     "v": 1,
 *     "salt": "<base64 of 16 random bytes>",
 *     "iv":   "<base64 of 12 random bytes>",
 *     "data": "<base64 of AES-GCM ciphertext>"
 *   }
 *
 *   Key: PBKDF2(passphrase, salt, iterations=200_000, hash=SHA-256, length=256)
 *   Cipher: AES-GCM with the iv above. Tag is appended to ciphertext.
 *
 * Each export gets a fresh salt + iv so two exports of the same
 * payload don't share ciphertext.
 */

const PBKDF2_ITERATIONS = 200_000;
const SALT_BYTES = 16;
const IV_BYTES = 12;

export interface EncryptedBundle {
  v: 1;
  salt: string;
  iv: string;
  data: string;
}

export async function encryptJson(
  payload: unknown,
  passphrase: string,
): Promise<EncryptedBundle> {
  if (!passphrase) throw new Error('Passphrase required');

  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const key = await deriveKey(passphrase, salt);
  const plaintext = new TextEncoder().encode(JSON.stringify(payload));

  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv: iv as BufferSource },
      key,
      plaintext as BufferSource,
    ),
  );

  return {
    v: 1,
    salt: bytesToB64(salt),
    iv: bytesToB64(iv),
    data: bytesToB64(ciphertext),
  };
}

export async function decryptJson<T>(
  bundle: EncryptedBundle,
  passphrase: string,
): Promise<T> {
  if (bundle.v !== 1) {
    throw new Error(`Unsupported bundle version ${bundle.v}`);
  }
  if (!passphrase) throw new Error('Passphrase required');

  const salt = b64ToBytes(bundle.salt);
  const iv = b64ToBytes(bundle.iv);
  const ciphertext = b64ToBytes(bundle.data);
  const key = await deriveKey(passphrase, salt);

  let plaintext: ArrayBuffer;

  try {
    plaintext = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: iv as BufferSource },
      key,
      ciphertext as BufferSource,
    );
  } catch {
    throw new Error('Wrong passphrase, or file is corrupted');
  }

  return JSON.parse(new TextDecoder().decode(plaintext)) as T;
}

async function deriveKey(
  passphrase: string,
  salt: Uint8Array,
): Promise<CryptoKey> {
  const material = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(passphrase),
    { name: 'PBKDF2' },
    false,
    ['deriveKey'],
  );

  return crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: salt as BufferSource,
      iterations: PBKDF2_ITERATIONS,
      hash: 'SHA-256',
    },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

/* ---------- helpers ---------- */

function bytesToB64(bytes: Uint8Array): string {
  let binary = '';

  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }

  return btoa(binary);
}

function b64ToBytes(s: string): Uint8Array {
  const binary = atob(s);
  const out = new Uint8Array(binary.length);

  for (let i = 0; i < binary.length; i++) {
    out[i] = binary.charCodeAt(i);
  }

  return out;
}
