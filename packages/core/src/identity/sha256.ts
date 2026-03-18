// ---------------------------------------------------------------------------
// Runtime-agnostic SHA-256 hashing
//
// Prefers `node:crypto` (sync, faster) when available; falls back to
// Web Crypto API (`globalThis.crypto.subtle`) for non-Node runtimes.
// ---------------------------------------------------------------------------

type HashFn = (data: string) => Promise<string>;

let resolvedHashFn: HashFn | undefined;

async function getHashFn(): Promise<HashFn> {
  if (resolvedHashFn) return resolvedHashFn;

  try {
    const { createHash } = await import('node:crypto');
    // Verify it actually works (some bundlers shim the import but throw on use)
    createHash('sha256');
    resolvedHashFn = async (data: string) => createHash('sha256').update(data).digest('hex');
  } catch {
    resolvedHashFn = async (data: string) => {
      if (!globalThis.crypto?.subtle) {
        throw new Error('No crypto implementation available (need node:crypto or Web Crypto API)');
      }
      const encoded = new TextEncoder().encode(data);
      const buf = await globalThis.crypto.subtle.digest('SHA-256', encoded);
      return Array.from(new Uint8Array(buf))
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('');
    };
  }

  return resolvedHashFn;
}

/**
 * Compute SHA-256 hex digest of a string.
 *
 * Uses `node:crypto` when available, falls back to Web Crypto API.
 */
export async function sha256Hex(data: string): Promise<string> {
  const hashFn = await getHashFn();
  return hashFn(data);
}
