import type { Currency, OverrideEvent } from '@exitbook/core';
import { parseDecimal } from '@exitbook/core';
import { assertOk } from '@exitbook/core/test-utils';
import type { Logger } from '@exitbook/logger';
import { describe, expect, it, vi } from 'vitest';

import { buildLinkFromOrphanedOverride } from '../linking-orchestrator-utils.js';
import type { OrphanedLinkOverride } from '../override-replay.js';
import { buildLinkCandidates } from '../pre-linking/build-link-candidates.js';

import { createTransaction } from './test-utils.js';

const logger = {
  info: vi.fn(),
  warn: vi.fn(),
  debug: vi.fn(),
  error: vi.fn(),
  trace: vi.fn(),
} as unknown as Logger;

describe('buildLinkFromOrphanedOverride', () => {
  it('resolves orphaned overrides from candidate-shaped amounts and movement fingerprints', () => {
    const transactions = [
      createTransaction({
        id: 1,
        accountId: 1,
        source: 'blockchain:bitcoin',
        sourceType: 'blockchain',
        datetime: '2026-01-01T00:00:00Z',
        outflows: [{ assetSymbol: 'BTC', amount: '10', netAmount: '9.999' }],
        blockchain: { name: 'bitcoin', transaction_hash: '0xshared', is_confirmed: true },
      }),
      createTransaction({
        id: 2,
        accountId: 2,
        source: 'blockchain:bitcoin',
        sourceType: 'blockchain',
        datetime: '2026-01-01T00:00:00Z',
        inflows: [{ assetSymbol: 'BTC', amount: '4' }],
        blockchain: { name: 'bitcoin', transaction_hash: '0xshared', is_confirmed: true },
      }),
      createTransaction({
        id: 3,
        accountId: 3,
        source: 'blockchain:bitcoin',
        sourceType: 'blockchain',
        datetime: '2026-01-01T02:00:00Z',
        inflows: [{ assetSymbol: 'BTC', amount: '6' }],
        blockchain: { name: 'bitcoin', transaction_hash: '0xdeposit', is_confirmed: true },
      }),
    ];
    transactions[0]!.fees = [
      {
        assetId: 'test:btc',
        assetSymbol: 'BTC' as Currency,
        amount: parseDecimal('0'),
        scope: 'network',
        settlement: 'on-chain',
      },
    ];

    const { candidates } = assertOk(buildLinkCandidates(transactions, logger));
    const txById = new Map(transactions.map((tx) => [tx.id, tx]));

    const overrideEvent: OverrideEvent = {
      id: 'evt-orphan',
      created_at: '2026-01-01T03:00:00.000Z',
      actor: 'cli-user',
      source: 'cli',
      scope: 'link',
      payload: {
        type: 'link_override',
        action: 'confirm',
        link_type: 'transfer',
        source_fingerprint: 'blockchain:bitcoin:blockchain:bitcoin-1',
        target_fingerprint: 'blockchain:bitcoin:blockchain:bitcoin-3',
        asset: 'BTC',
        resolved_link_fingerprint:
          'resolved-link:v1:movement:blockchain:bitcoin:blockchain:bitcoin-1:outflow:0:movement:blockchain:bitcoin:blockchain:bitcoin-3:inflow:0:test:btc:test:btc',
        source_asset_id: 'test:btc',
        target_asset_id: 'test:btc',
        source_movement_fingerprint: 'movement:blockchain:bitcoin:blockchain:bitcoin-1:outflow:0',
        target_movement_fingerprint: 'movement:blockchain:bitcoin:blockchain:bitcoin-3:inflow:0',
        source_amount: '6',
        target_amount: '6',
      },
    };
    const entry: OrphanedLinkOverride = {
      override: overrideEvent,
      sourceTransactionId: 1,
      targetTransactionId: 3,
      assetSymbol: 'BTC',
      linkType: 'transfer',
      sourceAssetId: 'test:btc',
      targetAssetId: 'test:btc',
      sourceMovementFingerprint: 'movement:blockchain:bitcoin:blockchain:bitcoin-1:outflow:0',
      targetMovementFingerprint: 'movement:blockchain:bitcoin:blockchain:bitcoin-3:inflow:0',
      sourceAmount: '6',
      targetAmount: '6',
    };

    const result = assertOk(buildLinkFromOrphanedOverride(entry, candidates, txById));

    expect(result.sourceAmount.toFixed()).toBe('6');
    expect(result.targetAmount.toFixed()).toBe('6');
    expect(result.sourceMovementFingerprint).toBe('movement:blockchain:bitcoin:blockchain:bitcoin-1:outflow:0');
    expect(result.targetMovementFingerprint).toBe('movement:blockchain:bitcoin:blockchain:bitcoin-3:inflow:0');
  });
});
