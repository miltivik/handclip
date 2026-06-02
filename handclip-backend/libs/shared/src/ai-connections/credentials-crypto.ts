import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';
import { EncryptedCredentials } from './types';

export function parseEncryptionKey(value: string): Buffer {
  const key = Buffer.from(value, 'base64');
  if (key.length !== 32) throw new Error('AI_CONNECTIONS_ENCRYPTION_KEY must decode to 32 bytes');
  return key;
}

export function encryptJson(value: unknown, keyValue: string): EncryptedCredentials {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', parseEncryptionKey(keyValue), iv);
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
  return {
    credentialsCiphertext: ciphertext.toString('base64'),
    credentialsIv: iv.toString('base64'),
    credentialsTag: cipher.getAuthTag().toString('base64'),
  };
}

export function decryptJson<T>(value: EncryptedCredentials, keyValue: string): T {
  const decipher = createDecipheriv(
    'aes-256-gcm',
    parseEncryptionKey(keyValue),
    Buffer.from(value.credentialsIv, 'base64'),
  );
  decipher.setAuthTag(Buffer.from(value.credentialsTag, 'base64'));
  const cleartext = Buffer.concat([
    decipher.update(Buffer.from(value.credentialsCiphertext, 'base64')),
    decipher.final(),
  ]);
  return JSON.parse(cleartext.toString('utf8')) as T;
}
