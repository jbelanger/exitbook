import { buildLedgerLinkingGapResolutionKey } from '@exitbook/accounting/ledger-linking';
import type { OverrideEvent } from '@exitbook/core';
import { ok } from '@exitbook/foundation';
import { assertErr, assertOk } from '@exitbook/foundation/test-utils';
import { describe, expect, it, vi } from 'vitest';

import {
  readResolvedLedgerLinkingGapResolutionKeys,
  readResolvedLedgerLinkingGapResolutions,
  replayResolvedLedgerLinkingGapResolutions,
} from '../ledger-linking-gap-resolution-replay.js';

describe('ledger-linking gap resolution replay', () => {
  it('builds the same key as the accounting review model', () => {
    expect(buildLedgerLinkingGapResolutionKey({ postingFingerprint: 'ledger_posting:v1:first' })).toBe(
      'ledger_linking_v2:ledger_posting:v1:first'
    );
  });

  it('keeps accepted posting-level gap resolutions keyed by posting fingerprint', () => {
    const result = replayResolvedLedgerLinkingGapResolutions([
      createGapResolutionEvent('ledger_posting:v1:first', 'accepted_transfer_residual'),
      createGapResolutionEvent('ledger_posting:v1:second', 'fiat_cash_movement'),
    ]);

    const resolutions = assertOk(result);
    expect([...resolutions.keys()]).toEqual([
      'ledger_linking_v2:ledger_posting:v1:first',
      'ledger_linking_v2:ledger_posting:v1:second',
    ]);
    expect(resolutions.get('ledger_linking_v2:ledger_posting:v1:first')).toMatchObject({
      postingFingerprint: 'ledger_posting:v1:first',
      remainingAmount: '0.01',
      resolutionKind: 'accepted_transfer_residual',
      reviewId: 'gr_test',
    });
  });

  it('rejects non ledger-linking gap resolution scopes', () => {
    const result = replayResolvedLedgerLinkingGapResolutions([
      {
        ...createGapResolutionEvent('ledger_posting:v1:first', 'accepted_transfer_residual'),
        scope: 'link-gap-resolve',
      },
    ]);

    expect(assertErr(result).message).toContain("Only 'ledger-linking-gap-resolution-accept' is allowed");
  });

  it('reads accepted gap resolution keys from the override store', async () => {
    const overrideStore = {
      exists: vi.fn().mockReturnValue(true),
      readByScopes: vi
        .fn()
        .mockResolvedValue(ok([createGapResolutionEvent('ledger_posting:v1:first', 'likely_spam_airdrop')])),
    };

    const result = await readResolvedLedgerLinkingGapResolutionKeys(overrideStore, 'default');

    const keys = assertOk(result);
    expect(overrideStore.readByScopes).toHaveBeenCalledWith('default', ['ledger-linking-gap-resolution-accept']);
    expect(keys).toEqual(new Set(['ledger_linking_v2:ledger_posting:v1:first']));
  });

  it('returns an empty map when the override store does not exist', async () => {
    const overrideStore = {
      exists: vi.fn().mockReturnValue(false),
      readByScopes: vi.fn(),
    };

    const result = await readResolvedLedgerLinkingGapResolutions(overrideStore, 'default');

    expect(assertOk(result)).toEqual(new Map());
    expect(overrideStore.readByScopes).not.toHaveBeenCalled();
  });
});

function createGapResolutionEvent(
  postingFingerprint: string,
  resolutionKind: Extract<OverrideEvent['payload'], { type: 'ledger_linking_gap_resolution_accept' }>['resolution_kind']
): OverrideEvent {
  return {
    actor: 'user',
    created_at: '2026-04-30T00:00:00.000Z',
    id: `gap-resolution:${postingFingerprint}`,
    profile_key: 'default',
    reason: 'Accepted non-link resolution',
    scope: 'ledger-linking-gap-resolution-accept',
    source: 'cli',
    payload: {
      asset_id: 'exchange:coinbase:eth',
      asset_symbol: 'ETH',
      claimed_amount: '1',
      direction: 'source',
      journal_fingerprint: 'ledger_journal:v1:test',
      original_amount: '1.01',
      platform_key: 'coinbase',
      platform_kind: 'exchange',
      posting_fingerprint: postingFingerprint,
      remaining_amount: '0.01',
      resolution_kind: resolutionKind,
      review_id: 'gr_test',
      source_activity_fingerprint: 'source_activity:v1:test',
      type: 'ledger_linking_gap_resolution_accept',
    },
  };
}
