import { describe, expect, it } from 'vitest';

import { base64ToBytes, bytesToBase64, hmacSha512, sha256Hex } from '../crypto-utils.js';

describe('crypto-utils', () => {
  it('round-trips byte arrays through base64', () => {
    const bytes = Uint8Array.from([0, 1, 2, 126, 127, 128, 254, 255]);

    const encoded = bytesToBase64(bytes);
    const decoded = base64ToBytes(encoded);

    expect(encoded).toBe('AAECfn+A/v8=');
    expect(decoded).toEqual(bytes);
  });

  it('decodes known base64 text payloads', () => {
    const decoded = base64ToBytes('aGVsbG8=');

    expect(new TextDecoder().decode(decoded)).toBe('hello');
  });

  it('produces stable SHA-256 hex output', () => {
    expect(sha256Hex('hello')).toBe('2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824');
  });

  it('produces stable HMAC-SHA-512 output', () => {
    const key = new TextEncoder().encode('secret');
    const message = new TextEncoder().encode('message');

    expect(bytesToBase64(hmacSha512(key, message))).toBe(
      'G7pYfHMO7box9Tq7C2ylieCd5OiU7kVeYUCAc5l1mtqvoGnux8AWR7sXPcsX9V0ir0mhgHG3SMXC7df3qCnGMg=='
    );
  });
});
