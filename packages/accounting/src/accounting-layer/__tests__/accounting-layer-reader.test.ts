import { ok, parseDecimal } from '@exitbook/foundation';
import type { Currency } from '@exitbook/foundation';
import { assertOk } from '@exitbook/foundation/test-utils';
import type { Logger } from '@exitbook/logger';
import { describe, expect, it, vi } from 'vitest';

import { buildTransaction } from '../../__tests__/test-utils.js';
import type { IAccountingLayerSourceReader } from '../../ports/accounting-layer-reader.js';
import { computeAccountingEntryFingerprint } from '../accounting-entry-fingerprint.js';
import type { AccountingEntryDraft } from '../accounting-entry-types.js';
import { buildAccountingLayerReader } from '../accounting-layer-reader.js';
import {
  buildAccountingLayerIndexes,
  resolveAssetAccountingEntry,
  resolveFeeAccountingEntry,
  resolveInternalTransferCarryovers,
} from '../accounting-layer-resolution.js';
import { buildAccountingLayerFromTransactions } from '../build-accounting-layer-from-transactions.js';

const noopLogger: Logger = {
  debug: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
  trace: vi.fn(),
  warn: vi.fn(),
};

describe('computeAccountingEntryFingerprint', () => {
  it('stays stable regardless of provenance binding order', () => {
    const draft: AccountingEntryDraft = {
      kind: 'asset_inflow',
      assetId: 'blockchain:cardano:native',
      assetSymbol: 'ADA' as Currency,
      quantity: parseDecimal('10.5'),
      role: 'staking_reward',
      provenanceBindings: [
        {
          txFingerprint: 'tx-b',
          movementFingerprint: 'movement:b',
          quantity: parseDecimal('4.5'),
        },
        {
          txFingerprint: 'tx-a',
          movementFingerprint: 'movement:a',
          quantity: parseDecimal('6'),
        },
      ],
    };

    const reordered: AccountingEntryDraft = {
      ...draft,
      provenanceBindings: [...draft.provenanceBindings].reverse(),
    };

    expect(assertOk(computeAccountingEntryFingerprint(draft))).toBe(
      assertOk(computeAccountingEntryFingerprint(reordered))
    );
  });
});

describe('buildAccountingLayerFromTransactions', () => {
  it('uses effective net quantity for asset entries and keeps fee entries separate', () => {
    const transaction = buildTransaction({
      id: 1,
      datetime: '2024-01-01T00:00:00Z',
      platformKind: 'blockchain',
      platformKey: 'bitcoin',
      category: 'transfer',
      type: 'withdrawal',
      outflows: [
        {
          assetId: 'blockchain:bitcoin:native',
          assetSymbol: 'BTC',
          amount: '1.01',
          netAmount: '1',
        },
      ],
      fees: [
        {
          assetId: 'blockchain:bitcoin:native',
          assetSymbol: 'BTC' as Currency,
          amount: parseDecimal('0.01'),
          scope: 'network',
          settlement: 'on-chain',
        },
      ],
    });

    const buildResult = assertOk(buildAccountingLayerFromTransactions([transaction], noopLogger));

    expect(buildResult.accountingTransactionViews).toHaveLength(1);
    expect(buildResult.entries).toHaveLength(2);
    expect(buildResult.derivationDependencies).toEqual([]);
    expect(buildResult.internalTransferCarryovers).toEqual([]);
    expect(buildResult.accountingTransactionViews[0]).toMatchObject({
      processedTransaction: transaction,
      inflows: [],
      outflows: [
        {
          assetId: 'blockchain:bitcoin:native',
          assetSymbol: 'BTC',
          grossQuantity: parseDecimal('1.01'),
          netQuantity: parseDecimal('1'),
          role: 'principal',
        },
      ],
      fees: [
        {
          assetId: 'blockchain:bitcoin:native',
          assetSymbol: 'BTC',
          quantity: parseDecimal('0.01'),
          feeScope: 'network',
          feeSettlement: 'on-chain',
        },
      ],
    });

    expect(buildResult.entries[0]).toMatchObject({
      kind: 'asset_outflow',
      assetId: 'blockchain:bitcoin:native',
      quantity: parseDecimal('1'),
      role: 'principal',
    });
    expect(buildResult.entries[0]!.provenanceBindings).toEqual([
      {
        txFingerprint: transaction.txFingerprint,
        movementFingerprint: transaction.movements.outflows?.[0]!.movementFingerprint,
        quantity: parseDecimal('1'),
      },
    ]);

    expect(buildResult.entries[1]).toMatchObject({
      kind: 'fee',
      assetId: 'blockchain:bitcoin:native',
      quantity: parseDecimal('0.01'),
      feeScope: 'network',
      feeSettlement: 'on-chain',
    });
    expect(buildResult.entries[1]!.provenanceBindings).toEqual([
      {
        txFingerprint: transaction.txFingerprint,
        movementFingerprint: transaction.fees[0]!.movementFingerprint,
        quantity: parseDecimal('0.01'),
      },
    ]);
  });

  it('drops zero-quantity fees from the canonical accounting layer', () => {
    const transaction = buildTransaction({
      id: 2,
      datetime: '2024-01-01T00:00:00Z',
      platformKind: 'blockchain',
      platformKey: 'bitcoin',
      category: 'transfer',
      type: 'withdrawal',
      outflows: [
        {
          assetId: 'blockchain:bitcoin:native',
          assetSymbol: 'BTC',
          amount: '1',
          netAmount: '1',
        },
      ],
      fees: [
        {
          assetId: 'blockchain:bitcoin:native',
          assetSymbol: 'BTC' as Currency,
          amount: parseDecimal('0'),
          scope: 'network',
          settlement: 'on-chain',
        },
      ],
    });

    const buildResult = assertOk(buildAccountingLayerFromTransactions([transaction], noopLogger));

    expect(buildResult.accountingTransactionViews).toHaveLength(1);
    expect(buildResult.accountingTransactionViews[0]!.fees).toEqual([]);
    expect(buildResult.entries).toHaveLength(1);
    expect(buildResult.entries[0]).toMatchObject({
      kind: 'asset_outflow',
      assetId: 'blockchain:bitcoin:native',
      quantity: parseDecimal('1'),
    });
  });

  it('emits internal-transfer carryovers and derivation dependencies for pure internal same-hash transfers', () => {
    const sameHash = 'same-hash-transfer';
    const sourceTransaction = buildTransaction({
      accountId: 1,
      id: 1,
      datetime: '2024-01-01T00:00:00Z',
      platformKind: 'blockchain',
      platformKey: 'bitcoin',
      category: 'transfer',
      type: 'withdrawal',
      blockchain: { name: 'bitcoin', transaction_hash: sameHash, is_confirmed: true },
      outflows: [
        {
          assetId: 'blockchain:bitcoin:native',
          assetSymbol: 'BTC',
          amount: '1.001',
          price: '50000',
        },
      ],
      fees: [
        {
          assetId: 'blockchain:bitcoin:native',
          assetSymbol: 'BTC' as Currency,
          amount: parseDecimal('0.001'),
          scope: 'network',
          settlement: 'on-chain',
          priceAtTxTime: {
            price: { amount: parseDecimal('50000'), currency: 'USD' as Currency },
            source: 'manual',
            fetchedAt: new Date('2024-01-01T00:00:00Z'),
            granularity: 'exact',
          },
        },
      ],
    });
    const receiverTransaction = buildTransaction({
      accountId: 2,
      id: 2,
      datetime: '2024-01-01T00:00:00Z',
      platformKind: 'blockchain',
      platformKey: 'bitcoin',
      category: 'transfer',
      type: 'deposit',
      blockchain: { name: 'bitcoin', transaction_hash: sameHash, is_confirmed: true },
      inflows: [
        {
          assetId: 'blockchain:bitcoin:native',
          assetSymbol: 'BTC',
          amount: '1',
          price: '50000',
        },
      ],
    });

    const buildResult = assertOk(
      buildAccountingLayerFromTransactions([sourceTransaction, receiverTransaction], noopLogger)
    );

    expect(buildResult.accountingTransactionViews).toHaveLength(2);
    expect(buildResult.entries).toHaveLength(3);
    expect(buildResult.derivationDependencies).toEqual([
      {
        ownerTxFingerprint: sourceTransaction.txFingerprint,
        supportingTxFingerprint: receiverTransaction.txFingerprint,
        reason: 'same_hash_internal_scoping',
      },
    ]);
    expect(buildResult.internalTransferCarryovers).toHaveLength(1);

    const sourceEntry = buildResult.entries.find(
      (entry) =>
        entry.kind === 'asset_outflow' &&
        entry.provenanceBindings.some(
          (binding) => binding.movementFingerprint === sourceTransaction.movements.outflows?.[0]!.movementFingerprint
        )
    );
    const feeEntry = buildResult.entries.find(
      (entry) =>
        entry.kind === 'fee' &&
        entry.provenanceBindings.some(
          (binding) => binding.movementFingerprint === sourceTransaction.fees[0]!.movementFingerprint
        )
    );
    const targetEntry = buildResult.entries.find(
      (entry) =>
        entry.kind === 'asset_inflow' &&
        entry.provenanceBindings.some(
          (binding) => binding.movementFingerprint === receiverTransaction.movements.inflows?.[0]!.movementFingerprint
        )
    );

    expect(sourceEntry).toMatchObject({
      kind: 'asset_outflow',
      assetId: 'blockchain:bitcoin:native',
      quantity: parseDecimal('1'),
      role: 'principal',
    });
    expect(feeEntry).toMatchObject({
      kind: 'fee',
      assetId: 'blockchain:bitcoin:native',
      quantity: parseDecimal('0.001'),
    });
    expect(targetEntry).toMatchObject({
      kind: 'asset_inflow',
      assetId: 'blockchain:bitcoin:native',
      quantity: parseDecimal('1'),
      role: 'principal',
    });

    expect(buildResult.internalTransferCarryovers[0]).toEqual({
      sourceEntryFingerprint: sourceEntry!.entryFingerprint,
      feeEntryFingerprint: feeEntry!.entryFingerprint,
      targetBindings: [
        {
          quantity: parseDecimal('1'),
          targetEntryFingerprint: targetEntry!.entryFingerprint,
        },
      ],
    });
  });

  it('resolves canonical entries and internal-transfer carryovers back to transaction views cleanly', () => {
    const sameHash = 'same-hash-transfer';
    const sourceTransaction = buildTransaction({
      accountId: 1,
      id: 1,
      datetime: '2024-01-01T00:00:00Z',
      platformKind: 'blockchain',
      platformKey: 'bitcoin',
      category: 'transfer',
      type: 'withdrawal',
      blockchain: { name: 'bitcoin', transaction_hash: sameHash, is_confirmed: true },
      outflows: [
        {
          assetId: 'blockchain:bitcoin:native',
          assetSymbol: 'BTC',
          amount: '1.001',
          price: '50000',
        },
      ],
      fees: [
        {
          assetId: 'blockchain:bitcoin:native',
          assetSymbol: 'BTC' as Currency,
          amount: parseDecimal('0.001'),
          scope: 'network',
          settlement: 'on-chain',
          priceAtTxTime: {
            price: { amount: parseDecimal('50000'), currency: 'USD' as Currency },
            source: 'manual',
            fetchedAt: new Date('2024-01-01T00:00:00Z'),
            granularity: 'exact',
          },
        },
      ],
    });
    const receiverTransaction = buildTransaction({
      accountId: 2,
      id: 2,
      datetime: '2024-01-01T00:00:00Z',
      platformKind: 'blockchain',
      platformKey: 'bitcoin',
      category: 'transfer',
      type: 'deposit',
      blockchain: { name: 'bitcoin', transaction_hash: sameHash, is_confirmed: true },
      inflows: [
        {
          assetId: 'blockchain:bitcoin:native',
          assetSymbol: 'BTC',
          amount: '1',
          price: '50000',
        },
      ],
    });

    const buildResult = assertOk(
      buildAccountingLayerFromTransactions([sourceTransaction, receiverTransaction], noopLogger)
    );
    const indexes = assertOk(buildAccountingLayerIndexes(buildResult));

    const carryover = buildResult.internalTransferCarryovers[0]!;
    const resolvedCarryovers = assertOk(resolveInternalTransferCarryovers(buildResult));
    const sourceResolution = assertOk(resolveAssetAccountingEntry(indexes, carryover.sourceEntryFingerprint));
    const feeResolution = assertOk(resolveFeeAccountingEntry(indexes, carryover.feeEntryFingerprint!));

    expect(sourceResolution.processedTransaction.id).toBe(sourceTransaction.id);
    expect(sourceResolution.movement.movementFingerprint).toBe(
      sourceTransaction.movements.outflows?.[0]!.movementFingerprint
    );
    expect(sourceResolution.movement.sourceKind).toBe('processed_transaction');
    expect(sourceResolution.entry.quantity.toFixed()).toBe('1');

    expect(feeResolution.transactionView.processedTransaction.id).toBe(sourceTransaction.id);
    expect(feeResolution.fee.movementFingerprint).toBe(sourceTransaction.fees[0]!.movementFingerprint);
    expect(feeResolution.entry.quantity.toFixed()).toBe('0.001');

    expect(resolvedCarryovers).toHaveLength(1);
    const resolvedCarryover = resolvedCarryovers[0];
    expect(resolvedCarryover).toBeDefined();
    expect(resolvedCarryover!.source.processedTransaction.id).toBe(sourceTransaction.id);
    expect(resolvedCarryover!.source.movement.sourceKind).toBe('processed_transaction');
    expect(resolvedCarryover!.targets).toHaveLength(1);
    const resolvedTarget = resolvedCarryover!.targets[0];
    expect(resolvedTarget).toBeDefined();
    expect(resolvedTarget!.target.transactionView?.processedTransaction.id).toBe(receiverTransaction.id);
    expect(resolvedTarget!.target.movement.movementFingerprint).toBe(
      receiverTransaction.movements.inflows?.[0]!.movementFingerprint
    );
  });
});

describe('buildAccountingLayerReader', () => {
  it('loads processed transactions from the source reader and materializes the accounting layer', async () => {
    const transaction = buildTransaction({
      id: 5,
      datetime: '2024-03-01T00:00:00Z',
      inflows: [{ assetSymbol: 'ETH', assetId: 'blockchain:ethereum:native', amount: '2' }],
    });

    const loadAccountingLayerSource = vi.fn().mockResolvedValue(ok({ transactions: [transaction] }));
    const sourceReader: IAccountingLayerSourceReader = {
      loadAccountingLayerSource,
    };

    const reader = buildAccountingLayerReader({ sourceReader, logger: noopLogger });
    const buildResult = assertOk(await reader.loadAccountingLayer());

    expect(loadAccountingLayerSource).toHaveBeenCalledOnce();
    expect(buildResult.accountingTransactionViews).toHaveLength(1);
    expect(buildResult.processedTransactions).toEqual([transaction]);
    expect(buildResult.entries).toHaveLength(1);
    expect(buildResult.entries[0]).toMatchObject({
      kind: 'asset_inflow',
      assetId: 'blockchain:ethereum:native',
      quantity: parseDecimal('2'),
      role: 'principal',
    });
  });
});
