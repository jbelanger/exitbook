/**
 * Dual-pagination token utilities for Alchemy's FROM/TO pagination model.
 * Alchemy requires separate requests for transfers sent FROM and TO an address,
 * each with independent page cursors. These utilities encode/decode both cursors
 * into a single opaque token for the streaming adapter.
 */

/**
 * Decode combined pageToken used to track independent FROM/TO pagination.
 * Supports both the JSON-encoded format introduced for streaming and the
 * legacy single-token format (treated as FROM-only).
 */
export function parseDualPageToken(token?: string): { from?: string; to?: string } {
  if (!token) return {};

  try {
    const parsed = JSON.parse(token) as { from?: string | null; to?: string | null };
    const result: { from?: string; to?: string } = {};
    if (parsed.from) result.from = parsed.from;
    if (parsed.to) result.to = parsed.to;
    return result;
  } catch {
    const parts = token.split(':::');
    if (parts.length === 2) {
      const result: { from?: string; to?: string } = {};
      if (parts[0]) result.from = parts[0];
      if (parts[1]) result.to = parts[1];
      return result;
    }
    return { from: token };
  }
}

/**
 * Encode FROM/TO pageKeys into a single pageToken string for the adapter.
 * Returns undefined when both directions are exhausted.
 */
export function buildDualPageToken(fromKey?: string | null, toKey?: string | null): string | undefined {
  if (!fromKey && !toKey) return undefined;
  return JSON.stringify({ from: fromKey ?? undefined, to: toKey ?? undefined });
}
