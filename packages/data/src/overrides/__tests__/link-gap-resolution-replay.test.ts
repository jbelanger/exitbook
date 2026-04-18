import { buildLinkGapIssueKey } from '@exitbook/accounting/linking';
import type { OverrideEvent } from '@exitbook/core';
import { ok } from '@exitbook/foundation';
import { assertErr, assertOk } from '@exitbook/foundation/test-utils';
import { describe, expect, it, vi } from 'vitest';

import {
  readResolvedLinkGapExceptions,
  readResolvedLinkGapIssueKeys,
  replayResolvedLinkGapExceptions,
  replayResolvedLinkGapIssues,
} from '../link-gap-resolution-replay.js';

function createLinkGapResolutionEvent(
  txFingerprint: string,
  assetId: string,
  direction: 'inflow' | 'outflow',
  overrides?: Partial<OverrideEvent>
): OverrideEvent {
  const payloadType = overrides?.payload?.type;
  const isReopen = payloadType === 'link_gap_reopen';

  return {
    id: overrides?.id ?? `link-gap:${txFingerprint}:${assetId}:${direction}:${isReopen ? 'reopen' : 'resolve'}`,
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
        asset_id: assetId,
        direction,
      } satisfies OverrideEvent['payload']),
  };
}

describe('link gap resolution replay', () => {
  it('keeps the latest resolution state per gap issue identity', () => {
    const txFingerprint = 'a'.repeat(64);
    const otherFingerprint = 'b'.repeat(64);

    const result = replayResolvedLinkGapIssues([
      createLinkGapResolutionEvent(txFingerprint, 'test:btc', 'inflow'),
      createLinkGapResolutionEvent(txFingerprint, 'test:usdt', 'inflow'),
      createLinkGapResolutionEvent(otherFingerprint, 'test:btc', 'outflow'),
      createLinkGapResolutionEvent(txFingerprint, 'test:btc', 'inflow', {
        payload: {
          type: 'link_gap_reopen',
          tx_fingerprint: txFingerprint,
          asset_id: 'test:btc',
          direction: 'inflow',
        },
        scope: 'link-gap-reopen',
      }),
    ]);

    const resolvedIssueKeys = assertOk(result);
    expect(
      resolvedIssueKeys.has(buildLinkGapIssueKey({ txFingerprint, assetId: 'test:btc', direction: 'inflow' }))
    ).toBe(false);
    expect(
      resolvedIssueKeys.has(buildLinkGapIssueKey({ txFingerprint, assetId: 'test:usdt', direction: 'inflow' }))
    ).toBe(true);
    expect(
      resolvedIssueKeys.has(
        buildLinkGapIssueKey({ txFingerprint: otherFingerprint, assetId: 'test:btc', direction: 'outflow' })
      )
    ).toBe(true);
  });

  it('fails replay when a non-link-gap scope is provided', () => {
    const result = replayResolvedLinkGapIssues([
      {
        id: 'note:1',
        created_at: '2026-04-09T12:00:00.000Z',
        profile_key: 'default',
        actor: 'user',
        source: 'cli',
        scope: 'transaction-user-note',
        payload: {
          type: 'transaction_user_note_override',
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
      readByScopes: vi.fn().mockResolvedValue(ok([createLinkGapResolutionEvent(txFingerprint, 'test:btc', 'inflow')])),
    };

    const result = await readResolvedLinkGapIssueKeys(overrideStore, 'default');

    const resolvedIssueKeys = assertOk(result);
    expect(overrideStore.readByScopes).toHaveBeenCalledWith('default', ['link-gap-resolve', 'link-gap-reopen']);
    expect(
      resolvedIssueKeys.has(buildLinkGapIssueKey({ txFingerprint, assetId: 'test:btc', direction: 'inflow' }))
    ).toBe(true);
  });

  it('keeps the latest resolve reason for currently resolved exceptions', () => {
    const txFingerprint = 'e'.repeat(64);

    const result = replayResolvedLinkGapExceptions([
      createLinkGapResolutionEvent(txFingerprint, 'test:btc', 'inflow', {
        created_at: '2026-04-09T12:00:00.000Z',
        reason: 'Initial reason',
      }),
      createLinkGapResolutionEvent(txFingerprint, 'test:btc', 'inflow', {
        payload: {
          type: 'link_gap_reopen',
          tx_fingerprint: txFingerprint,
          asset_id: 'test:btc',
          direction: 'inflow',
        },
        scope: 'link-gap-reopen',
      }),
      createLinkGapResolutionEvent(txFingerprint, 'test:btc', 'inflow', {
        created_at: '2026-04-10T15:30:00.000Z',
        reason: 'BullBitcoin purchase sent directly to wallet',
      }),
    ]);

    const exceptions = assertOk(result);
    expect(exceptions).toEqual(
      new Map([
        [
          buildLinkGapIssueKey({ txFingerprint, assetId: 'test:btc', direction: 'inflow' }),
          {
            txFingerprint,
            assetId: 'test:btc',
            direction: 'inflow',
            resolvedAt: '2026-04-10T15:30:00.000Z',
            reason: 'BullBitcoin purchase sent directly to wallet',
          },
        ],
      ])
    );
  });

  it('reads resolved link-gap exceptions with reasons from the store', async () => {
    const txFingerprint = 'f'.repeat(64);
    const overrideStore = {
      exists: vi.fn().mockReturnValue(true),
      readByScopes: vi.fn().mockResolvedValue(
        ok([
          createLinkGapResolutionEvent(txFingerprint, 'test:btc', 'inflow', {
            created_at: '2026-04-18T14:00:00.000Z',
            reason: 'BullBitcoin purchase sent directly to wallet',
          }),
        ])
      ),
    };

    const result = await readResolvedLinkGapExceptions(overrideStore, 'default');

    expect(assertOk(result)).toEqual(
      new Map([
        [
          buildLinkGapIssueKey({ txFingerprint, assetId: 'test:btc', direction: 'inflow' }),
          {
            txFingerprint,
            assetId: 'test:btc',
            direction: 'inflow',
            resolvedAt: '2026-04-18T14:00:00.000Z',
            reason: 'BullBitcoin purchase sent directly to wallet',
          },
        ],
      ])
    );
  });

  it('returns an empty set when the override store is missing', async () => {
    const overrideStore = {
      exists: vi.fn().mockReturnValue(false),
      readByScopes: vi.fn(),
    };

    const result = await readResolvedLinkGapIssueKeys(overrideStore, 'default');

    expect(assertOk(result).size).toBe(0);
    expect(overrideStore.readByScopes).not.toHaveBeenCalled();
  });

  it('returns an empty map of exceptions when the override store is missing', async () => {
    const overrideStore = {
      exists: vi.fn().mockReturnValue(false),
      readByScopes: vi.fn(),
    };

    const result = await readResolvedLinkGapExceptions(overrideStore, 'default');

    expect(assertOk(result).size).toBe(0);
    expect(overrideStore.readByScopes).not.toHaveBeenCalled();
  });
});
