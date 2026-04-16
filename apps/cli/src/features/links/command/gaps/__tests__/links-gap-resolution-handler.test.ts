import { buildLinkGapIssueKey } from '@exitbook/accounting/linking';
import type { OverrideEvent, Transaction, TransactionDraft, TransactionLink } from '@exitbook/core';
import type { Currency } from '@exitbook/foundation';
import { ok } from '@exitbook/foundation';
import { parseDecimal } from '@exitbook/foundation';
import { describe, expect, it, vi } from 'vitest';

import { createPersistedTransaction } from '../../../../../features/shared/__tests__/transaction-test-utils.js';
import { buildLinkGapRef } from '../../../link-selector.js';
import { LinksGapResolutionHandler } from '../links-gap-resolution-handler.js';

function createBlockchainDeposit(
  overrides: Omit<Partial<Transaction>, 'movements' | 'fees'> & {
    fees?: TransactionDraft['fees'];
    movements?: TransactionDraft['movements'];
  } = {}
): Transaction {
  return createPersistedTransaction({
    id: 11,
    accountId: 1,
    txFingerprint: 'btc-gap-transaction-fingerprint',
    datetime: '2026-03-21T17:12:00.000Z',
    timestamp: Date.parse('2026-03-21T17:12:00.000Z'),
    platformKey: 'bitcoin',
    platformKind: 'blockchain',
    status: 'success',
    blockchain: {
      name: 'bitcoin',
      transaction_hash: 'hash',
      is_confirmed: true,
    },
    movements: {
      inflows: [
        {
          assetId: 'test:btc',
          assetSymbol: 'BTC' as Currency,
          grossAmount: parseDecimal('0.0018'),
          netAmount: parseDecimal('0.0018'),
        },
      ],
      outflows: [],
    },
    fees: [],
    operation: {
      category: 'transfer',
      type: 'deposit',
    },
    ...overrides,
  });
}

function createConfirmedLink(targetTransactionId: number): TransactionLink {
  return {
    id: 91,
    sourceTransactionId: 7,
    targetTransactionId,
    assetSymbol: 'BTC' as Currency,
    sourceAssetId: 'test:btc',
    targetAssetId: 'test:btc',
    sourceAmount: parseDecimal('0.0018'),
    targetAmount: parseDecimal('0.0018'),
    sourceMovementFingerprint: 'movement:test:btc:7:outflow:0',
    targetMovementFingerprint: `movement:test:btc:${targetTransactionId}:inflow:0`,
    linkType: 'exchange_to_blockchain',
    confidenceScore: parseDecimal('1'),
    matchCriteria: {
      assetMatch: true,
      amountSimilarity: parseDecimal('1'),
      timingValid: true,
      timingHours: 1,
      addressMatch: true,
    },
    status: 'confirmed',
    reviewedBy: undefined,
    reviewedAt: undefined,
    createdAt: new Date('2026-03-21T17:12:00.000Z'),
    updatedAt: new Date('2026-03-21T17:12:00.000Z'),
    metadata: undefined,
  };
}

function createLinkGapResolveEvent(
  txFingerprint: string,
  assetId = 'test:btc',
  direction: 'inflow' | 'outflow' = 'inflow'
): OverrideEvent {
  return {
    id: `gap-resolve:${txFingerprint}:${assetId}:${direction}`,
    created_at: '2026-04-09T12:00:00.000Z',
    profile_key: 'default',
    actor: 'user',
    source: 'cli',
    scope: 'link-gap-resolve',
    payload: {
      type: 'link_gap_resolve',
      asset_id: assetId,
      direction,
      tx_fingerprint: txFingerprint,
    },
  };
}

function createOverrideStore(overrides?: { appendResult?: OverrideEvent; gapResolutionEvents?: OverrideEvent[] }): {
  append: ReturnType<typeof vi.fn>;
} {
  return {
    append: vi.fn().mockResolvedValue(ok(overrides?.appendResult ?? createLinkGapResolveEvent('a'.repeat(64)))),
  };
}

function createDatabase(transaction: Transaction, links: TransactionLink[] = []) {
  return {
    loadProfileLinkGapSourceData: vi.fn().mockResolvedValue(
      ok({
        accounts: [],
        excludedAssetIds: new Set<string>(),
        links,
        resolvedIssueKeys: new Set<string>(),
        transactions: [transaction],
      })
    ),
  };
}

describe('LinksGapResolutionHandler', () => {
  it('writes a resolve override for an unresolved gap issue', async () => {
    const transaction = createBlockchainDeposit();
    const gapIdentity = {
      txFingerprint: transaction.txFingerprint,
      assetId: 'test:btc',
      direction: 'inflow' as const,
    };
    const gapRef = buildLinkGapRef(gapIdentity);
    const database = createDatabase(transaction);
    const overrideStore = createOverrideStore();
    const handler = new LinksGapResolutionHandler(database as never, 'default', overrideStore as never);

    const result = await handler.resolve({
      selector: gapRef,
      reason: 'BullBitcoin purchase sent directly to wallet',
    });

    expect(result.isOk()).toBe(true);
    if (result.isErr()) {
      throw result.error;
    }

    expect(result.value).toMatchObject({
      action: 'resolve',
      assetId: 'test:btc',
      assetSymbol: 'BTC',
      changed: true,
      direction: 'inflow',
      gapRef,
      platformKey: 'bitcoin',
      reason: 'BullBitcoin purchase sent directly to wallet',
      transactionGapCount: 1,
      transactionId: 11,
      transactionRef: transaction.txFingerprint.slice(0, 10),
      txFingerprint: transaction.txFingerprint,
    });
    expect(overrideStore.append).toHaveBeenCalledWith({
      profileKey: 'default',
      scope: 'link-gap-resolve',
      payload: {
        type: 'link_gap_resolve',
        asset_id: 'test:btc',
        direction: 'inflow',
        tx_fingerprint: transaction.txFingerprint,
      },
      reason: 'BullBitcoin purchase sent directly to wallet',
    });
  });

  it('returns unchanged when the transaction is already resolved', async () => {
    const transaction = createBlockchainDeposit();
    const gapIdentity = {
      txFingerprint: transaction.txFingerprint,
      assetId: 'test:btc',
      direction: 'inflow' as const,
    };
    const database = createDatabase(transaction);
    const overrideStore = createOverrideStore({
      gapResolutionEvents: [
        createLinkGapResolveEvent(transaction.txFingerprint, gapIdentity.assetId, gapIdentity.direction),
      ],
    });
    database.loadProfileLinkGapSourceData.mockResolvedValue(
      ok({
        accounts: [],
        excludedAssetIds: new Set<string>(),
        links: [],
        resolvedIssueKeys: new Set([buildLinkGapIssueKey(gapIdentity)]),
        transactions: [transaction],
      })
    );
    const handler = new LinksGapResolutionHandler(database as never, 'default', overrideStore as never);

    const result = await handler.resolve({
      selector: buildLinkGapRef(gapIdentity),
    });

    expect(result.isOk()).toBe(true);
    if (result.isErr()) {
      throw result.error;
    }

    expect(result.value.changed).toBe(false);
    expect(result.value.gapRef).toBe(buildLinkGapRef(gapIdentity));
    expect(overrideStore.append).not.toHaveBeenCalled();
  });

  it('writes a reopen override for a resolved gap issue', async () => {
    const transaction = createBlockchainDeposit();
    const gapIdentity = {
      txFingerprint: transaction.txFingerprint,
      assetId: 'test:btc',
      direction: 'inflow' as const,
    };
    const database = createDatabase(transaction);
    const overrideStore = createOverrideStore({
      gapResolutionEvents: [
        createLinkGapResolveEvent(transaction.txFingerprint, gapIdentity.assetId, gapIdentity.direction),
      ],
    });
    database.loadProfileLinkGapSourceData.mockResolvedValue(
      ok({
        accounts: [],
        excludedAssetIds: new Set<string>(),
        links: [],
        resolvedIssueKeys: new Set([buildLinkGapIssueKey(gapIdentity)]),
        transactions: [transaction],
      })
    );
    const handler = new LinksGapResolutionHandler(database as never, 'default', overrideStore as never);

    const result = await handler.reopen({
      selector: buildLinkGapRef(gapIdentity),
      reason: 'Recheck after importing BullBitcoin history',
    });

    expect(result.isOk()).toBe(true);
    if (result.isErr()) {
      throw result.error;
    }

    expect(result.value).toMatchObject({
      action: 'reopen',
      assetId: 'test:btc',
      changed: true,
      direction: 'inflow',
      gapRef: buildLinkGapRef(gapIdentity),
      reason: 'Recheck after importing BullBitcoin history',
      transactionGapCount: 1,
    });
    expect(overrideStore.append).toHaveBeenCalledWith({
      profileKey: 'default',
      scope: 'link-gap-reopen',
      payload: {
        type: 'link_gap_reopen',
        asset_id: 'test:btc',
        direction: 'inflow',
        tx_fingerprint: transaction.txFingerprint,
      },
      reason: 'Recheck after importing BullBitcoin history',
    });
  });

  it('fails when the selected gap does not currently exist', async () => {
    const transaction = createBlockchainDeposit();
    const gapRef = buildLinkGapRef({
      txFingerprint: transaction.txFingerprint,
      assetId: 'test:btc',
      direction: 'inflow',
    });
    const database = createDatabase(transaction, [createConfirmedLink(transaction.id)]);
    const overrideStore = createOverrideStore();
    const handler = new LinksGapResolutionHandler(database as never, 'default', overrideStore as never);

    const result = await handler.resolve({
      selector: gapRef,
    });

    expect(result.isErr()).toBe(true);
    if (result.isOk()) {
      throw new Error('Expected resolve to fail when no gap is present');
    }

    expect(result.error.message).toContain(`Link gap ref '${gapRef.toLowerCase()}' not found`);
    expect(overrideStore.append).not.toHaveBeenCalled();
  });
});
