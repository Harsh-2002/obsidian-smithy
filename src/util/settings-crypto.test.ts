import { describe, expect, it } from 'vitest';

import { decryptJson, encryptJson } from './settings-crypto';

describe('settings-crypto', () => {
  it('round-trips a payload with the correct passphrase', async () => {
    const payload = { foo: 'bar', n: 42, arr: ['x', 'y'] };
    const bundle = await encryptJson(payload, 'correct-horse-battery-staple');

    expect(bundle.v).toBe(1);
    expect(bundle.salt).toMatch(/^[A-Za-z0-9+/=]+$/);
    expect(bundle.iv).toMatch(/^[A-Za-z0-9+/=]+$/);
    expect(bundle.data).toMatch(/^[A-Za-z0-9+/=]+$/);

    const decrypted = await decryptJson<typeof payload>(
      bundle,
      'correct-horse-battery-staple',
    );

    expect(decrypted).toEqual(payload);
  });

  it('rejects a wrong passphrase with a clear error', async () => {
    const bundle = await encryptJson({ secret: 'value' }, 'right-pw');

    await expect(decryptJson(bundle, 'wrong-pw')).rejects.toThrow(
      /wrong passphrase/i,
    );
  });

  it('produces different ciphertext for the same payload + passphrase', async () => {
    const a = await encryptJson({ same: 'data' }, 'pw');
    const b = await encryptJson({ same: 'data' }, 'pw');

    // Salt + IV are random per call so the encoded data differs.
    expect(a.data).not.toBe(b.data);
    expect(a.salt).not.toBe(b.salt);
  });

  it('refuses to encrypt with an empty passphrase', async () => {
    await expect(encryptJson({}, '')).rejects.toThrow(/passphrase/i);
  });

  it('refuses an unsupported bundle version', async () => {
    const bundle = await encryptJson({ x: 1 }, 'pw');
    const tampered = { ...bundle, v: 99 as unknown as 1 };

    await expect(decryptJson(tampered, 'pw')).rejects.toThrow(
      /version/i,
    );
  });
});
