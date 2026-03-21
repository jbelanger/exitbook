// ---------------------------------------------------------------------------
// Runtime-agnostic crypto utilities
//
// Uses @noble/hashes — pure JS, audited, React Native safe.
// All operations are synchronous (no Web Crypto async overhead).
// ---------------------------------------------------------------------------

import { hmac } from '@noble/hashes/hmac.js';
import { sha256, sha512 } from '@noble/hashes/sha2.js';
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils.js';

// ---------------------------------------------------------------------------
// SHA-256
// ---------------------------------------------------------------------------

/**
 * Compute SHA-256 digest bytes for UTF-8 string or raw bytes.
 */
export function sha256Bytes(data: string | Uint8Array): Uint8Array {
  return sha256(typeof data === 'string' ? utf8ToBytes(data) : data);
}

/**
 * Compute SHA-256 hex digest of a UTF-8 string (synchronous).
 */
export function sha256Hex(data: string): string {
  return bytesToHex(sha256Bytes(data));
}

// ---------------------------------------------------------------------------
// HMAC-SHA-512
// ---------------------------------------------------------------------------

/**
 * Compute HMAC-SHA-512 of a message with the given key.
 * Returns the raw digest as a Uint8Array.
 */
export function hmacSha512(key: Uint8Array, message: Uint8Array): Uint8Array {
  return hmac(sha512, key, message);
}

// ---------------------------------------------------------------------------
// Base64
// ---------------------------------------------------------------------------

/**
 * Decode a base64 string into raw bytes.
 */
export function base64ToBytes(base64: string): Uint8Array {
  const binaryString = atob(base64);
  const bytes = new Uint8Array(binaryString.length);
  for (let index = 0; index < binaryString.length; index += 1) {
    bytes[index] = binaryString.charCodeAt(index);
  }
  return bytes;
}

/**
 * Encode raw bytes as a base64 string.
 */
export function bytesToBase64(bytes: Uint8Array): string {
  let binaryString = '';
  for (const byte of bytes) {
    binaryString += String.fromCharCode(byte);
  }
  return btoa(binaryString);
}

// ---------------------------------------------------------------------------
// Random Bytes
// ---------------------------------------------------------------------------

/**
 * Generate cryptographically secure random bytes.
 */
export function randomBytes(length: number): Uint8Array {
  return globalThis.crypto.getRandomValues(new Uint8Array(length));
}

/**
 * Generate a lowercase hex string from cryptographically secure random bytes.
 */
export function randomHex(byteCount: number): string {
  return bytesToHex(randomBytes(byteCount));
}

// ---------------------------------------------------------------------------
// Random UUID
// ---------------------------------------------------------------------------

/**
 * Generate a random UUID v4.
 *
 * Uses `globalThis.crypto.randomUUID()` — available in Node >=19, browsers,
 * and React Native. No `node:crypto` import needed.
 */
export function randomUUID(): string {
  return globalThis.crypto.randomUUID();
}
