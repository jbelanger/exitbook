/**
 * Dual-pagination token utilities for Alchemy's FROM/TO pagination model.
 * Alchemy requires separate requests for transfers sent FROM and TO an address,
 * each with independent page cursors. These utilities encode/decode both cursors
 * into a single opaque token for the streaming adapter.
 */

import { err, ok, type Result } from '@exitbook/foundation';

interface DualPageToken {
  from?: string | undefined;
  to?: string | undefined;
}

/**
 * Decode combined pageToken used to track independent FROM/TO pagination.
 * Only the JSON-encoded dual-token format is supported.
 */
export function parseDualPageToken(token?: string): Result<DualPageToken, Error> {
  if (!token) {
    return ok({});
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(token);
  } catch {
    return err(new Error('Alchemy dual page token must be a JSON-encoded object.'));
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return err(new Error('Alchemy dual page token must decode to an object.'));
  }

  const rawToken = parsed as { from?: unknown; to?: unknown };
  if (rawToken.from !== undefined && rawToken.from !== null && typeof rawToken.from !== 'string') {
    return err(new Error('Alchemy dual page token "from" cursor must be a string when present.'));
  }
  if (rawToken.to !== undefined && rawToken.to !== null && typeof rawToken.to !== 'string') {
    return err(new Error('Alchemy dual page token "to" cursor must be a string when present.'));
  }

  const result: DualPageToken = {};
  if (typeof rawToken.from === 'string' && rawToken.from.length > 0) {
    result.from = rawToken.from;
  }
  if (typeof rawToken.to === 'string' && rawToken.to.length > 0) {
    result.to = rawToken.to;
  }
  return ok(result);
}

/**
 * Encode FROM/TO pageKeys into a single pageToken string for the adapter.
 * Returns undefined when both directions are exhausted.
 */
export function buildDualPageToken(fromKey?: string | null, toKey?: string | null): string | undefined {
  if (!fromKey && !toKey) return undefined;
  return JSON.stringify({ from: fromKey ?? undefined, to: toKey ?? undefined });
}
