import type { OverrideEvent } from '@exitbook/core';
import { ok } from '@exitbook/foundation';
import { assertErr, assertOk } from '@exitbook/foundation/test-utils';
import { describe, expect, it, vi } from 'vitest';

import { readResolvedLinkGapTxFingerprints, replayLinkGapResolutionEvents } from '../link-gap-resolution-replay.js';

function createLinkGapResolutionEvent(txFingerprint: string, overrides?: Partial<OverrideEvent>): OverrideEvent {
  const payloadType = overrides?.payload?.type;
  const isReopen = payloadType === 'link_gap_reopen';

  return {
    id: overrides?.id ?? `link-gap:${txFingerprint}:${isReopen ? 'reopen' : 'resolve'}`,
    created_at: overrides?.created_at ?? '2026-04-09T12:00:00.000Z',
    profile_key: overrides?.profile_key ?? 'default',
    actor: overrides?.actor ?? 'user',
    source: overrides?.source ?? 'cli',
    scope: overrides?.scope ?? (isReopen ? 'link-gap-reopen' : 'link-gap-resolve'),
    reason: overrides?.reason,
    payload:
      overrides?.payload ??
      ({
        type: 'link_gap_resolve',
        tx_fingerprint: txFingerprint,
      } satisfies OverrideEvent['payload']),
  };
}

describe('link gap resolution replay', () => {
  it('keeps the latest resolution state per transaction fingerprint', () => {
    const firstFingerprint = 'a'.repeat(64);
    const secondFingerprint = 'b'.repeat(64);

    const result = replayLinkGapResolutionEvents([
      createLinkGapResolutionEvent(firstFingerprint),
      createLinkGapResolutionEvent(secondFingerprint),
      createLinkGapResolutionEvent(firstFingerprint, {
        payload: {
          type: 'link_gap_reopen',
          tx_fingerprint: firstFingerprint,
        },
        scope: 'link-gap-reopen',
      }),
    ]);

    const resolvedTxFingerprints = assertOk(result);
    expect(resolvedTxFingerprints.has(firstFingerprint)).toBe(false);
    expect(resolvedTxFingerprints.has(secondFingerprint)).toBe(true);
  });

  it('fails replay when a non-link-gap scope is provided', () => {
    const result = replayLinkGapResolutionEvents([
      {
        id: 'note:1',
        created_at: '2026-04-09T12:00:00.000Z',
        profile_key: 'default',
        actor: 'user',
        source: 'cli',
        scope: 'transaction-note',
        payload: {
          type: 'transaction_note_override',
          action: 'set',
          tx_fingerprint: 'c'.repeat(64),
          message: 'not allowed here',
        },
      },
    ]);

    expect(assertErr(result).message).toContain("Only 'link-gap-resolve' and 'link-gap-reopen' are allowed");
  });

  it('reads link-gap resolution overrides from the store when the database exists', async () => {
    const txFingerprint = 'd'.repeat(64);
    const overrideStore = {
      exists: vi.fn().mockReturnValue(true),
      readByScopes: vi.fn().mockResolvedValue(ok([createLinkGapResolutionEvent(txFingerprint)])),
    };

    const result = await readResolvedLinkGapTxFingerprints(overrideStore, 'default');

    const resolvedTxFingerprints = assertOk(result);
    expect(overrideStore.readByScopes).toHaveBeenCalledWith('default', ['link-gap-resolve', 'link-gap-reopen']);
    expect(resolvedTxFingerprints.has(txFingerprint)).toBe(true);
  });

  it('returns an empty set when the override store is missing', async () => {
    const overrideStore = {
      exists: vi.fn().mockReturnValue(false),
      readByScopes: vi.fn(),
    };

    const result = await readResolvedLinkGapTxFingerprints(overrideStore, 'default');

    expect(assertOk(result).size).toBe(0);
    expect(overrideStore.readByScopes).not.toHaveBeenCalled();
  });
});
