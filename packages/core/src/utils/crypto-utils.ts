// ---------------------------------------------------------------------------
// Runtime-agnostic crypto utilities
//
// Uses the Web Crypto API directly so @exitbook/core stays portable across
// Node, browsers, and future React Native targets without any node:crypto
// dependency.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// SHA-256
// ---------------------------------------------------------------------------

/**
 * Compute SHA-256 hex digest of a string.
 */
export async function sha256Hex(data: string): Promise<string> {
  const encoded = new TextEncoder().encode(data);
  const buf = await globalThis.crypto.subtle.digest('SHA-256', encoded);
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
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
