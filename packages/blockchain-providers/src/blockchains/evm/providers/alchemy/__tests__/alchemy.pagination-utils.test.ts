import { describe, expect, it } from 'vitest';

import { buildDualPageToken, parseDualPageToken } from '../alchemy.pagination-utils.js';

describe('alchemy pagination utils', () => {
  it('round-trips the supported JSON dual-page token format', () => {
    const token = buildDualPageToken('from-key', 'to-key');
    const parsed = parseDualPageToken(token);

    expect(parsed.isOk()).toBe(true);
    if (parsed.isErr()) {
      return;
    }

    expect(parsed.value).toEqual({ from: 'from-key', to: 'to-key' });
  });

  it('treats missing token as an empty cursor state', () => {
    const parsed = parseDualPageToken();

    expect(parsed.isOk()).toBe(true);
    if (parsed.isErr()) {
      return;
    }

    expect(parsed.value).toEqual({});
  });

  it('rejects legacy non-JSON token formats', () => {
    const parsed = parseDualPageToken('from-only:::to-only');

    expect(parsed.isErr()).toBe(true);
    if (parsed.isOk()) {
      return;
    }

    expect(parsed.error.message).toContain('JSON-encoded object');
  });
});
