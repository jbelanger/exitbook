import type { Currency, OverrideEvent } from '@exitbook/core';
import { computeResolvedLinkFingerprint, parseDecimal } from '@exitbook/core';
import { assertOk } from '@exitbook/core/test-utils';
import type { Logger } from '@exitbook/logger';
import { describe, expect, it, vi } from 'vitest';

import { buildLinkableMovements } from '../pre-linking/build-linkable-movements.js';
import { createTransaction, requirePresent } from '../shared/test-utils.js';

import { buildLinkFromOrphanedOverride } from './linking-orchestrator-utils.js';
import type { OrphanedLinkOverride } from './override-replay.js';

const logger = {
  info: vi.fn(),
  warn: vi.fn(),
  debug: vi.fn(),
  error: vi.fn(),
  trace: vi.fn(),
} as unknown as Logger;

describe('buildLinkFromOrphanedOverride', () => {
  it('resolves orphaned overrides from linkable-movement amounts and movement fingerprints', () => {
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

    const { linkableMovements } = assertOk(buildLinkableMovements(transactions, logger));
    const txById = new Map(transactions.map((tx) => [tx.id, tx]));
    const sourceTxFingerprint = transactions[0]!.txFingerprint;
    const targetTxFingerprint = transactions[2]!.txFingerprint;
    const sourceMovementFingerprint = requirePresent(
      transactions[0]!.movements.outflows?.[0]?.movementFingerprint,
      'Expected source outflow movement fingerprint'
    );
    const targetMovementFingerprint = requirePresent(
      transactions[2]!.movements.inflows?.[0]?.movementFingerprint,
      'Expected target inflow movement fingerprint'
    );
    const resolvedLinkFingerprint = assertOk(
      computeResolvedLinkFingerprint({
        sourceAssetId: 'test:btc',
        targetAssetId: 'test:btc',
        sourceMovementFingerprint,
        targetMovementFingerprint,
      })
    );

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
        source_fingerprint: sourceTxFingerprint,
        target_fingerprint: targetTxFingerprint,
        asset: 'BTC',
        resolved_link_fingerprint: resolvedLinkFingerprint,
        source_asset_id: 'test:btc',
        target_asset_id: 'test:btc',
        source_movement_fingerprint: sourceMovementFingerprint,
        target_movement_fingerprint: targetMovementFingerprint,
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
      sourceMovementFingerprint,
      targetMovementFingerprint,
      sourceAmount: '6',
      targetAmount: '6',
    };

    const result = assertOk(buildLinkFromOrphanedOverride(entry, linkableMovements, txById));

    expect(result.sourceAmount.toFixed()).toBe('6');
    expect(result.targetAmount.toFixed()).toBe('6');
    expect(result.sourceMovementFingerprint).toBe(sourceMovementFingerprint);
    expect(result.targetMovementFingerprint).toBe(targetMovementFingerprint);
  });
});
