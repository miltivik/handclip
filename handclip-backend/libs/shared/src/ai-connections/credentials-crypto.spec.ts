import { describe, expect, it } from 'vitest';
import { decryptJson, encryptJson, parseEncryptionKey } from './credentials-crypto';

const key = Buffer.alloc(32, 7).toString('base64');

describe('credentials crypto', () => {
  it('roundtrips oauth credentials', () => {
    const encrypted = encryptJson({ access: 'a', refresh: 'r', expires: 123 }, key);
    expect(decryptJson(encrypted, key)).toEqual({ access: 'a', refresh: 'r', expires: 123 });
  });

  it('rejects keys that are not 32 bytes', () => {
    expect(() => parseEncryptionKey(Buffer.alloc(31).toString('base64'))).toThrow(
      'AI_CONNECTIONS_ENCRYPTION_KEY must decode to 32 bytes',
    );
  });

  it('rejects a different decryption key', () => {
    const encrypted = encryptJson({ access: 'secret' }, key);
    expect(() => decryptJson(encrypted, Buffer.alloc(32, 8).toString('base64'))).toThrow();
  });
});
