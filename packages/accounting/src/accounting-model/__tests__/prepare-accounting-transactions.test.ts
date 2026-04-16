/* eslint-disable @typescript-eslint/unbound-method -- acceptable for tests */
import type { FeeMovementDraft, Transaction } from '@exitbook/core';
import type { Currency } from '@exitbook/foundation';
import { parseDecimal } from '@exitbook/foundation';
import { assertErr, assertOk } from '@exitbook/foundation/test-utils';
import type { Logger } from '@exitbook/logger';
import { describe, expect, it, vi } from 'vitest';

import {
  createFeeMovement,
  createPriceAtTxTime,
  createTransaction,
  materializeTestTransaction,
} from '../../__tests__/test-utils.js';
import { createExplainedMultiSourceAdaHashPartialTransactions } from '../../linking/strategies/test-utils.js';
import { prepareAccountingTransactions } from '../prepare-accounting-transactions.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const noopLogger = {
  trace: () => {
    /* no-op */
  },
  debug: () => {
    /* no-op */
  },
  info: () => {
    /* no-op */
  },
  warn: () => {
    /* no-op */
  },
  error: () => {
    /* no-op */
  },
} as Logger;

function createSpyLogger(): Logger {
  return {
    trace: vi.fn(),
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  } as unknown as Logger;
}

function createBlockchainTx(
  id: number,
  accountId: number,
  datetime: string,
  blockchain: string,
  txHash: string,
  inflows: { amount: string; assetId: string; assetSymbol: string; price: string }[],
  outflows: { amount: string; assetId: string; assetSymbol: string; price: string }[],
  fees: FeeMovementDraft[] = []
): Transaction {
  return materializeTestTransaction({
    id,
    accountId,
    identityReference: `ext-${id}`,
    datetime,
    timestamp: new Date(datetime).getTime(),
    platformKey: blockchain,
    platformKind: 'blockchain',
    status: 'success',
    movements: {
      inflows: inflows.map((i) => ({
        assetId: i.assetId,
        assetSymbol: i.assetSymbol as Currency,
        grossAmount: parseDecimal(i.amount),
        priceAtTxTime: createPriceAtTxTime(i.price),
      })),
      outflows: outflows.map((o) => ({
        assetId: o.assetId,
        assetSymbol: o.assetSymbol as Currency,
        grossAmount: parseDecimal(o.amount),
        priceAtTxTime: createPriceAtTxTime(o.price),
      })),
    },
    fees,
    operation: { category: 'transfer', type: 'transfer' },
    blockchain: {
      name: blockchain,
      transaction_hash: txHash,
      is_confirmed: true,
    },
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('prepareAccountingTransactions', () => {
  describe('non-blockchain transactions pass through unchanged', () => {
    it('should preserve exchange transactions without modification', () => {
      const txs = [
        createTransaction(
          1,
          '2024-01-01T00:00:00Z',
          [{ assetSymbol: 'BTC', amount: '1', price: '50000' }],
          [{ assetSymbol: 'USD', amount: '50000', price: '1' }],
          { platformKey: 'kraken' }
        ),
      ];

      const result = prepareAccountingTransactions(txs, noopLogger);
      const value = assertOk(result);

      expect(value.transactions).toHaveLength(1);
      expect(value.internalTransferCarryoverDrafts).toHaveLength(0);

      const scoped = value.transactions[0]!;
      expect(scoped.movements.inflows).toHaveLength(1);
      expect(scoped.movements.outflows).toHaveLength(1);
      expect(scoped.movements.inflows[0]!.grossAmount.toFixed()).toBe('1');
      expect(scoped.movements.outflows[0]!.grossAmount.toFixed()).toBe('50000');
    });
  });

  describe('clear same-hash internal change (Rule 2)', () => {
    it('should reduce source outflow and remove tracked inflow', () => {
      // Bitcoin UTXO: sender sends 0.5 BTC (of 1 BTC input) to receiver, 0.4 BTC change, 0.1 BTC fee
      const senderTx = createBlockchainTx(
        1,
        1,
        '2024-01-01T00:00:00Z',
        'bitcoin',
        '0xhash1',
        [],
        [{ assetId: 'blockchain:bitcoin:native', assetSymbol: 'BTC', amount: '1', price: '50000' }],
        [createFeeMovement('network', 'on-chain', 'BTC', '0.1', '50000')]
      );
      // Override the fee assetId to match
      senderTx.fees[0]!.assetId = 'blockchain:bitcoin:native';

      const receiverTx = createBlockchainTx(
        2,
        2,
        '2024-01-01T00:00:00Z',
        'bitcoin',
        '0xhash1',
        [{ assetId: 'blockchain:bitcoin:native', assetSymbol: 'BTC', amount: '0.5', price: '50000' }],
        [],
        [createFeeMovement('network', 'on-chain', 'BTC', '0.1', '50000')]
      );
      receiverTx.fees[0]!.assetId = 'blockchain:bitcoin:native';

      const changeTx = createBlockchainTx(
        3,
        1,
        '2024-01-01T00:00:00Z',
        'bitcoin',
        '0xhash1',
        [{ assetId: 'blockchain:bitcoin:native', assetSymbol: 'BTC', amount: '0.4', price: '50000' }],
        []
      );
      // Note: same accountId=1 as sender, but different txId due to per-address import

      const result = prepareAccountingTransactions([senderTx, receiverTx, changeTx], noopLogger);
      const value = assertOk(result);

      // Sender outflow should be reduced: 1 - 0.5 (receiver) - 0.4 (change) = 0.1 (external only... wait)
      // Actually: sender gross=1, inflows: receiver=0.5, change=0.4, total internal inflows = 0.9
      // External amount = 1 - 0.9 - 0.1(fee) = 0 → fee-only!
      // But wait, change tx has same accountId=1 as sender - it won't be grouped
      // because groupSameHashTransactions only creates groups from different accounts.
      // Actually: change output goes back to sender's own address, which is typically
      // tracked as a separate transaction with same accountId.
      // The group requires accountIds.size >= 2, and we have accounts 1 and 2.
      // But change tx (account 1) and sender tx (account 1) are same account,
      // so the group only has sender (account 1) and receiver (account 2).
      // Actually no — ALL txs with this hash are in the group.
      // The group has participants from account 1 (txId 1 outflow, txId 3 inflow)
      // and account 2 (txId 2 inflow).

      // Hmm, but account 1 has both outflow (txId 1) AND inflow (txId 3).
      // With per-asset grouping: sender txId=1 has outflow=1 BTC, change txId=3 has inflow=0.4 BTC.
      // These are different transactions, so txId=1 is pure outflow and txId=3 is pure inflow.
      // Result: sender=txId 1, receivers=[txId 2, txId 3].
      // Internal inflow total = 0.5 + 0.4 = 0.9
      // External = 1 - 0.9 - 0.1 = 0 → fee-only carryover

      expect(value.internalTransferCarryoverDrafts).toHaveLength(1);

      const carryover = value.internalTransferCarryoverDrafts[0]!;
      expect(carryover.assetId).toBe('blockchain:bitcoin:native');
      expect(carryover.sourceTransactionId).toBe(1);
      expect(carryover.targets).toHaveLength(2);
      expect(carryover.retainedQuantity.toFixed()).toBe('0.9');
    });

    it('should reduce source outflow for internal with remaining external amount', () => {
      // Sender sends 2 BTC, receiver gets 0.5 BTC internally, 1.5 BTC external (not tracked)
      const senderTx = createBlockchainTx(
        1,
        1,
        '2024-01-01T00:00:00Z',
        'bitcoin',
        '0xhash2',
        [],
        [{ assetId: 'blockchain:bitcoin:native', assetSymbol: 'BTC', amount: '2', price: '50000' }],
        [createFeeMovement('network', 'on-chain', 'BTC', '0.001', '50000')]
      );
      senderTx.fees[0]!.assetId = 'blockchain:bitcoin:native';

      const receiverTx = createBlockchainTx(
        2,
        2,
        '2024-01-01T00:00:00Z',
        'bitcoin',
        '0xhash2',
        [{ assetId: 'blockchain:bitcoin:native', assetSymbol: 'BTC', amount: '0.5', price: '50000' }],
        [],
        [createFeeMovement('network', 'on-chain', 'BTC', '0.001', '50000')]
      );
      receiverTx.fees[0]!.assetId = 'blockchain:bitcoin:native';

      const result = prepareAccountingTransactions([senderTx, receiverTx], noopLogger);
      const value = assertOk(result);

      expect(value.internalTransferCarryoverDrafts).toHaveLength(0);

      // Sender outflow should be reduced: 2 - 0.5 = 1.5 gross
      const senderScoped = value.transactions.find((t) => t.tx.id === 1)!;
      expect(senderScoped.movements.outflows).toHaveLength(1);
      expect(senderScoped.movements.outflows[0]!.grossAmount.toFixed()).toBe('1.5');
      // Net should be gross - fee: 1.5 - 0.001 = 1.499
      expect(senderScoped.movements.outflows[0]!.netAmount!.toFixed()).toBe('1.499');
      expect(senderScoped.rebuildDependencyTransactionIds).toEqual([2]);

      // Receiver inflow should be removed (internal)
      const receiverScoped = value.transactions.find((t) => t.tx.id === 2)!;
      expect(receiverScoped.movements.inflows).toHaveLength(0);

      // Receiver on-chain fee should be removed (deduped to sender)
      const receiverOnChainFees = receiverScoped.fees.filter(
        (f) => f.assetId === 'blockchain:bitcoin:native' && f.settlement === 'on-chain'
      );
      expect(receiverOnChainFees).toHaveLength(0);
    });

    it('should deterministically scope a multi-input bitcoin send with tracked change', () => {
      const hash = '2ea11d4d2e7c897660ec747a891e9ec57ca0a1d594336a936b2ea7aa152bda96';

      const firstSourceTx = createBlockchainTx(
        6356,
        8,
        '2024-05-31T20:17:28.000Z',
        'bitcoin',
        hash,
        [],
        [{ assetId: 'blockchain:bitcoin:native', assetSymbol: 'BTC', amount: '0.01109536', price: '68000' }],
        [createFeeMovement('network', 'on-chain', 'BTC', '0.00017347', '68000')]
      );
      firstSourceTx.fees[0]!.assetId = 'blockchain:bitcoin:native';

      const secondSourceTx = createBlockchainTx(
        6360,
        10,
        '2024-05-31T20:17:28.000Z',
        'bitcoin',
        hash,
        [],
        [{ assetId: 'blockchain:bitcoin:native', assetSymbol: 'BTC', amount: '0.01012179', price: '68000' }],
        [createFeeMovement('network', 'on-chain', 'BTC', '0.00017347', '68000')]
      );
      secondSourceTx.fees[0]!.assetId = 'blockchain:bitcoin:native';

      const trackedChangeTx = createBlockchainTx(
        6371,
        20,
        '2024-05-31T20:17:28.000Z',
        'bitcoin',
        hash,
        [{ assetId: 'blockchain:bitcoin:native', assetSymbol: 'BTC', amount: '0.00625144', price: '68000' }],
        []
      );

      const result = prepareAccountingTransactions([firstSourceTx, secondSourceTx, trackedChangeTx], noopLogger);
      const value = assertOk(result);

      expect(value.internalTransferCarryoverDrafts).toHaveLength(0);

      const firstScoped = value.transactions.find((tx) => tx.tx.id === 6356)!;
      expect(firstScoped.movements.outflows).toHaveLength(1);
      expect(firstScoped.movements.outflows[0]!.grossAmount.toFixed()).toBe('0.01109536');
      expect(firstScoped.movements.outflows[0]!.netAmount!.toFixed()).toBe('0.01092189');
      expect(
        firstScoped.fees.filter((fee) => fee.assetId === 'blockchain:bitcoin:native' && fee.settlement === 'on-chain')
      ).toHaveLength(1);

      const secondScoped = value.transactions.find((tx) => tx.tx.id === 6360)!;
      expect(secondScoped.movements.outflows).toHaveLength(1);
      expect(secondScoped.movements.outflows[0]!.grossAmount.toFixed()).toBe('0.00387035');
      expect(secondScoped.movements.outflows[0]!.netAmount!.toFixed()).toBe('0.00387035');
      expect(
        secondScoped.fees.filter((fee) => fee.assetId === 'blockchain:bitcoin:native' && fee.settlement === 'on-chain')
      ).toHaveLength(0);

      const trackedChangeScoped = value.transactions.find((tx) => tx.tx.id === 6371)!;
      expect(trackedChangeScoped.movements.inflows).toHaveLength(0);
    });
  });

  describe('scoped fee normalization', () => {
    it('should dedupe same-hash fees for pure multi-source external sends', () => {
      const hash = '0xpureexternal';

      const firstSourceTx = createBlockchainTx(
        1,
        11,
        '2024-01-01T00:00:00Z',
        'bitcoin',
        hash,
        [],
        [{ assetId: 'blockchain:bitcoin:native', assetSymbol: 'BTC', amount: '0.00301222', price: '50000' }],
        [createFeeMovement('network', 'on-chain', 'BTC', '0.0000383', '50000')]
      );
      firstSourceTx.fees[0]!.assetId = 'blockchain:bitcoin:native';

      const secondSourceTx = createBlockchainTx(
        2,
        22,
        '2024-01-01T00:00:00Z',
        'bitcoin',
        hash,
        [],
        [{ assetId: 'blockchain:bitcoin:native', assetSymbol: 'BTC', amount: '0.00625144', price: '50000' }],
        [createFeeMovement('network', 'on-chain', 'BTC', '0.0000383', '50000')]
      );
      secondSourceTx.fees[0]!.assetId = 'blockchain:bitcoin:native';

      const result = prepareAccountingTransactions([firstSourceTx, secondSourceTx], noopLogger);
      const value = assertOk(result);

      const firstScoped = value.transactions.find((tx) => tx.tx.id === 1)!;
      const secondScoped = value.transactions.find((tx) => tx.tx.id === 2)!;

      expect(firstScoped.movements.outflows[0]!.grossAmount.toFixed()).toBe('0.00301222');
      expect(firstScoped.movements.outflows[0]!.netAmount!.toFixed()).toBe('0.00301222');
      expect(
        firstScoped.fees.filter((fee) => fee.assetId === 'blockchain:bitcoin:native' && fee.settlement === 'on-chain')
      ).toHaveLength(0);

      expect(secondScoped.movements.outflows[0]!.grossAmount.toFixed()).toBe('0.00625144');
      expect(secondScoped.movements.outflows[0]!.netAmount!.toFixed()).toBe('0.00621314');
      const secondOnChainFees = secondScoped.fees.filter(
        (fee) => fee.assetId === 'blockchain:bitcoin:native' && fee.settlement === 'on-chain'
      );
      expect(secondOnChainFees).toHaveLength(1);
      expect(secondOnChainFees[0]!.amount.toFixed()).toBe('0.0000383');
    });

    it('should reconcile net/gross after same-hash reduction', () => {
      const senderTx = createBlockchainTx(
        1,
        1,
        '2024-01-01T00:00:00Z',
        'bitcoin',
        '0xhashfee',
        [],
        [{ assetId: 'blockchain:bitcoin:native', assetSymbol: 'BTC', amount: '1', price: '50000' }],
        [createFeeMovement('network', 'on-chain', 'BTC', '0.0001', '50000')]
      );
      senderTx.fees[0]!.assetId = 'blockchain:bitcoin:native';

      const receiverTx = createBlockchainTx(
        2,
        2,
        '2024-01-01T00:00:00Z',
        'bitcoin',
        '0xhashfee',
        [{ assetId: 'blockchain:bitcoin:native', assetSymbol: 'BTC', amount: '0.3', price: '50000' }],
        []
      );

      const result = prepareAccountingTransactions([senderTx, receiverTx], noopLogger);
      const value = assertOk(result);

      const senderScoped = value.transactions.find((t) => t.tx.id === 1)!;
      const outflow = senderScoped.movements.outflows[0]!;

      // Gross should be 1 - 0.3 = 0.7
      expect(outflow.grossAmount.toFixed()).toBe('0.7');
      // Net should be 0.7 - 0.0001 = 0.6999
      expect(outflow.netAmount!.toFixed()).toBe('0.6999');
    });

    it('should normalize a receiver-owned on-chain fee onto the sender', () => {
      const senderTx = createBlockchainTx(
        1,
        1,
        '2024-01-01T00:00:00Z',
        'bitcoin',
        '0xhashreceiverfee',
        [],
        [{ assetId: 'blockchain:bitcoin:native', assetSymbol: 'BTC', amount: '2', price: '50000' }],
        []
      );

      const receiverTx = createBlockchainTx(
        2,
        2,
        '2024-01-01T00:00:00Z',
        'bitcoin',
        '0xhashreceiverfee',
        [{ assetId: 'blockchain:bitcoin:native', assetSymbol: 'BTC', amount: '0.5', price: '50000' }],
        [],
        [createFeeMovement('network', 'on-chain', 'BTC', '0.001', '50000')]
      );
      receiverTx.fees[0]!.assetId = 'blockchain:bitcoin:native';

      const result = prepareAccountingTransactions([senderTx, receiverTx], noopLogger);
      const value = assertOk(result);

      const senderScoped = value.transactions.find((t) => t.tx.id === 1)!;
      const senderOnChainFees = senderScoped.fees.filter(
        (fee) => fee.assetId === 'blockchain:bitcoin:native' && fee.settlement === 'on-chain'
      );
      expect(senderOnChainFees).toHaveLength(1);
      expect(senderOnChainFees[0]!.amount.toFixed()).toBe('0.001');
      expect(senderOnChainFees[0]!.originalTransactionId).toBe(2);
      expect(senderScoped.movements.outflows[0]!.netAmount!.toFixed()).toBe('1.499');

      const receiverScoped = value.transactions.find((t) => t.tx.id === 2)!;
      const receiverOnChainFees = receiverScoped.fees.filter(
        (fee) => fee.assetId === 'blockchain:bitcoin:native' && fee.settlement === 'on-chain'
      );
      expect(receiverOnChainFees).toHaveLength(0);
    });

    it('preserves already-allocated per-source fees instead of deduping them again', () => {
      const result = prepareAccountingTransactions(createExplainedMultiSourceAdaHashPartialTransactions(), noopLogger);
      const value = assertOk(result);

      const firstScoped = value.transactions.find((tx) => tx.tx.id === 2447)!;
      const secondScoped = value.transactions.find((tx) => tx.tx.id === 2452)!;
      const thirdScoped = value.transactions.find((tx) => tx.tx.id === 2454)!;

      expect(firstScoped.movements.outflows[0]!.grossAmount.toFixed()).toBe('1021.402541');
      expect(firstScoped.movements.outflows[0]!.netAmount!.toFixed()).toBe('1021.329314829243639698026006');
      expect(secondScoped.movements.outflows[0]!.grossAmount.toFixed()).toBe('975.034581');
      expect(secondScoped.movements.outflows[0]!.netAmount!.toFixed()).toBe('974.9646790310350899938477373');
      expect(thirdScoped.movements.outflows[0]!.grossAmount.toFixed()).toBe('672.948242');
      expect(thirdScoped.movements.outflows[0]!.netAmount!.toFixed()).toBe('672.8999971397212703081262567');
    });
  });

  describe('asset identity collision (Rule 0)', () => {
    it('should return Err for same-symbol different-assetId in same-hash group', () => {
      const tx1 = createBlockchainTx(
        1,
        1,
        '2024-01-01T00:00:00Z',
        'ethereum',
        '0xhashcollide',
        [],
        [
          {
            assetId: 'blockchain:ethereum:0xcontract_a',
            assetSymbol: 'USDC',
            amount: '100',
            price: '1',
          },
        ]
      );

      const tx2 = createBlockchainTx(
        2,
        2,
        '2024-01-01T00:00:00Z',
        'ethereum',
        '0xhashcollide',
        [
          {
            assetId: 'blockchain:ethereum:0xcontract_b',
            assetSymbol: 'USDC',
            amount: '100',
            price: '1',
          },
        ],
        []
      );

      const result = prepareAccountingTransactions([tx1, tx2], noopLogger);
      const error = assertErr(result);
      expect(error.message).toContain('Asset identity collision');
      expect(error.message).toContain('USDC');
    });
  });

  describe('fee-only internal transfer (Rule 3)', () => {
    it('should emit InternalTransferCarryoverDraft for pure internal same-hash', () => {
      // Send 1 BTC to own address on another account, entire amount is internal
      const senderTx = createBlockchainTx(
        1,
        1,
        '2024-01-01T00:00:00Z',
        'bitcoin',
        '0xhashinternal',
        [],
        [{ assetId: 'blockchain:bitcoin:native', assetSymbol: 'BTC', amount: '1.001', price: '50000' }],
        [createFeeMovement('network', 'on-chain', 'BTC', '0.001', '50000')]
      );
      senderTx.fees[0]!.assetId = 'blockchain:bitcoin:native';

      const receiverTx = createBlockchainTx(
        2,
        2,
        '2024-01-01T00:00:00Z',
        'bitcoin',
        '0xhashinternal',
        [{ assetId: 'blockchain:bitcoin:native', assetSymbol: 'BTC', amount: '1', price: '50000' }],
        [],
        [createFeeMovement('network', 'on-chain', 'BTC', '0.001', '50000')]
      );
      receiverTx.fees[0]!.assetId = 'blockchain:bitcoin:native';

      const result = prepareAccountingTransactions([senderTx, receiverTx], noopLogger);
      const value = assertOk(result);

      // Sender outflow should be removed (no external quantity)
      const senderScoped = value.transactions.find((t) => t.tx.id === 1)!;
      expect(senderScoped.movements.outflows.filter((m) => m.assetId === 'blockchain:bitcoin:native')).toHaveLength(0);

      // Receiver inflow should be kept (fee-only carryover needs targets)
      const receiverScoped = value.transactions.find((t) => t.tx.id === 2)!;
      expect(receiverScoped.movements.inflows).toHaveLength(1);

      // Carryover should be emitted
      expect(value.internalTransferCarryoverDrafts).toHaveLength(1);
      const carryover = value.internalTransferCarryoverDrafts[0]!;
      expect(carryover.assetId).toBe('blockchain:bitcoin:native');
      expect(carryover.assetSymbol).toBe('BTC');
      expect(carryover.fee.amount.toFixed()).toBe('0.001');
      expect(carryover.retainedQuantity.toFixed()).toBe('1');
      expect(carryover.sourceTransactionId).toBe(1);
      expect(carryover.targets).toHaveLength(1);
      expect(carryover.targets[0]!.targetTransactionId).toBe(2);
      expect(carryover.targets[0]!.quantity.toFixed()).toBe('1');
    });

    it('should preserve per-target retained quantities for multi-target same-hash internal sends', () => {
      const senderTx = createBlockchainTx(
        1,
        1,
        '2024-01-01T00:00:00Z',
        'bitcoin',
        '0xhashmulti',
        [],
        [{ assetId: 'blockchain:bitcoin:native', assetSymbol: 'BTC', amount: '1.5001', price: '50000' }],
        [createFeeMovement('network', 'on-chain', 'BTC', '0.0001', '50000')]
      );
      senderTx.fees[0]!.assetId = 'blockchain:bitcoin:native';

      const receiver1Tx = createBlockchainTx(
        2,
        2,
        '2024-01-01T00:00:00Z',
        'bitcoin',
        '0xhashmulti',
        [{ assetId: 'blockchain:bitcoin:native', assetSymbol: 'BTC', amount: '1', price: '50000' }],
        []
      );

      const receiver2Tx = createBlockchainTx(
        3,
        3,
        '2024-01-01T00:00:00Z',
        'bitcoin',
        '0xhashmulti',
        [{ assetId: 'blockchain:bitcoin:native', assetSymbol: 'BTC', amount: '0.5', price: '50000' }],
        []
      );

      const result = prepareAccountingTransactions([senderTx, receiver1Tx, receiver2Tx], noopLogger);
      const value = assertOk(result);

      expect(value.internalTransferCarryoverDrafts).toHaveLength(1);
      const carryover = value.internalTransferCarryoverDrafts[0]!;
      expect(carryover.targets).toHaveLength(2);

      const target1 = carryover.targets.find((t) => t.targetTransactionId === 2)!;
      const target2 = carryover.targets.find((t) => t.targetTransactionId === 3)!;
      expect(target1.quantity.toFixed()).toBe('1');
      expect(target2.quantity.toFixed()).toBe('0.5');
      expect(carryover.retainedQuantity.toFixed()).toBe('1.5');
    });

    it('should emit deterministic carryovers for multi-source fee-only same-hash groups', () => {
      const sourceOneTx = createBlockchainTx(
        1,
        1,
        '2024-01-01T00:00:00Z',
        'bitcoin',
        '0xhashmultisourceinternal',
        [],
        [{ assetId: 'blockchain:bitcoin:native', assetSymbol: 'BTC', amount: '1.0001', price: '50000' }],
        [createFeeMovement('network', 'on-chain', 'BTC', '0.0001', '50000')]
      );
      sourceOneTx.fees[0]!.assetId = 'blockchain:bitcoin:native';

      const sourceTwoTx = createBlockchainTx(
        2,
        2,
        '2024-01-01T00:00:00Z',
        'bitcoin',
        '0xhashmultisourceinternal',
        [],
        [{ assetId: 'blockchain:bitcoin:native', assetSymbol: 'BTC', amount: '1', price: '50000' }],
        [createFeeMovement('network', 'on-chain', 'BTC', '0.0001', '50000')]
      );
      sourceTwoTx.fees[0]!.assetId = 'blockchain:bitcoin:native';

      const receiverTx = createBlockchainTx(
        3,
        3,
        '2024-01-01T00:00:00Z',
        'bitcoin',
        '0xhashmultisourceinternal',
        [{ assetId: 'blockchain:bitcoin:native', assetSymbol: 'BTC', amount: '2', price: '50000' }],
        []
      );

      const result = prepareAccountingTransactions([sourceOneTx, sourceTwoTx, receiverTx], noopLogger);
      const value = assertOk(result);

      const firstScoped = value.transactions.find((tx) => tx.tx.id === 1)!;
      const secondScoped = value.transactions.find((tx) => tx.tx.id === 2)!;
      expect(
        firstScoped.movements.outflows.filter((movement) => movement.assetId === 'blockchain:bitcoin:native')
      ).toHaveLength(0);
      expect(
        secondScoped.movements.outflows.filter((movement) => movement.assetId === 'blockchain:bitcoin:native')
      ).toHaveLength(0);
      expect(firstScoped.rebuildDependencyTransactionIds).toEqual([3]);
      expect(secondScoped.rebuildDependencyTransactionIds).toEqual([3]);

      expect(value.internalTransferCarryoverDrafts).toHaveLength(2);

      const firstCarryover = value.internalTransferCarryoverDrafts.find(
        (carryover) => carryover.sourceTransactionId === 1
      )!;
      expect(firstCarryover.fee.amount.toFixed()).toBe('0.0001');
      expect(firstCarryover.retainedQuantity.toFixed()).toBe('1');
      expect(firstCarryover.targets).toHaveLength(1);
      expect(firstCarryover.targets[0]!.targetTransactionId).toBe(3);
      expect(firstCarryover.targets[0]!.quantity.toFixed()).toBe('1');

      const secondCarryover = value.internalTransferCarryoverDrafts.find(
        (carryover) => carryover.sourceTransactionId === 2
      )!;
      expect(secondCarryover.fee.amount.toFixed()).toBe('0');
      expect(secondCarryover.retainedQuantity.toFixed()).toBe('1');
      expect(secondCarryover.targets).toHaveLength(1);
      expect(secondCarryover.targets[0]!.targetTransactionId).toBe(3);
      expect(secondCarryover.targets[0]!.quantity.toFixed()).toBe('1');
    });

    it('should emit a fee-only carryover when only the receiver has the raw fee row', () => {
      const senderTx = createBlockchainTx(
        1,
        1,
        '2024-01-01T00:00:00Z',
        'bitcoin',
        '0xhashreceivercarry',
        [],
        [{ assetId: 'blockchain:bitcoin:native', assetSymbol: 'BTC', amount: '1.001', price: '50000' }],
        []
      );

      const receiverTx = createBlockchainTx(
        2,
        2,
        '2024-01-01T00:00:00Z',
        'bitcoin',
        '0xhashreceivercarry',
        [{ assetId: 'blockchain:bitcoin:native', assetSymbol: 'BTC', amount: '1', price: '50000' }],
        [],
        [createFeeMovement('network', 'on-chain', 'BTC', '0.001', '50000')]
      );
      receiverTx.fees[0]!.assetId = 'blockchain:bitcoin:native';

      const result = prepareAccountingTransactions([senderTx, receiverTx], noopLogger);
      const value = assertOk(result);

      expect(value.internalTransferCarryoverDrafts).toHaveLength(1);
      expect(value.internalTransferCarryoverDrafts[0]!.fee.amount.toFixed()).toBe('0.001');

      const senderScoped = value.transactions.find((t) => t.tx.id === 1)!;
      const senderOnChainFees = senderScoped.fees.filter(
        (fee) => fee.assetId === 'blockchain:bitcoin:native' && fee.settlement === 'on-chain'
      );
      expect(senderOnChainFees).toHaveLength(1);
      expect(senderOnChainFees[0]!.amount.toFixed()).toBe('0.001');
      expect(senderOnChainFees[0]!.originalTransactionId).toBe(2);
    });
  });

  describe('builder does not mutate raw transaction data', () => {
    it('should not mutate raw transaction movements or fees when scoped amounts are rewritten', () => {
      const senderTx = createBlockchainTx(
        1,
        1,
        '2024-01-01T00:00:00Z',
        'bitcoin',
        '0xhashimmutable',
        [],
        [{ assetId: 'blockchain:bitcoin:native', assetSymbol: 'BTC', amount: '2', price: '50000' }],
        [createFeeMovement('network', 'on-chain', 'BTC', '0.001', '50000')]
      );
      senderTx.fees[0]!.assetId = 'blockchain:bitcoin:native';

      const receiverTx = createBlockchainTx(
        2,
        2,
        '2024-01-01T00:00:00Z',
        'bitcoin',
        '0xhashimmutable',
        [{ assetId: 'blockchain:bitcoin:native', assetSymbol: 'BTC', amount: '0.5', price: '50000' }],
        []
      );

      // Capture original values
      const originalSenderOutflowGross = senderTx.movements.outflows![0]!.grossAmount;
      const originalReceiverInflowGross = receiverTx.movements.inflows![0]!.grossAmount;

      prepareAccountingTransactions([senderTx, receiverTx], noopLogger);

      // Raw transactions should be unchanged
      expect(senderTx.movements.outflows![0]!.grossAmount).toBe(originalSenderOutflowGross);
      expect(receiverTx.movements.inflows![0]!.grossAmount).toBe(originalReceiverInflowGross);
    });
  });

  describe('scoped movements preserve raw identity', () => {
    it('should preserve movement fingerprints after same-hash reduction', () => {
      const senderTx = createBlockchainTx(
        1,
        1,
        '2024-01-01T00:00:00Z',
        'bitcoin',
        '0xhashfp',
        [],
        [{ assetId: 'blockchain:bitcoin:native', assetSymbol: 'BTC', amount: '2', price: '50000' }],
        [createFeeMovement('network', 'on-chain', 'BTC', '0.001', '50000')]
      );
      senderTx.fees[0]!.assetId = 'blockchain:bitcoin:native';

      const receiverTx = createBlockchainTx(
        2,
        2,
        '2024-01-01T00:00:00Z',
        'bitcoin',
        '0xhashfp',
        [{ assetId: 'blockchain:bitcoin:native', assetSymbol: 'BTC', amount: '0.5', price: '50000' }],
        []
      );

      const result = prepareAccountingTransactions([senderTx, receiverTx], noopLogger);
      const value = assertOk(result);

      const senderScoped = value.transactions.find((t) => t.tx.id === 1)!;
      const outflow = senderScoped.movements.outflows[0]!;

      expect(outflow.movementFingerprint).toBe(senderTx.movements.outflows![0]!.movementFingerprint);
      // Amount was rewritten
      expect(outflow.grossAmount.toFixed()).toBe('1.5');
    });
  });

  describe('fee-only carryover preserves movement fingerprints', () => {
    it('should include source and target movement fingerprints in carryover', () => {
      const senderTx = createBlockchainTx(
        1,
        1,
        '2024-01-01T00:00:00Z',
        'bitcoin',
        '0xhashcarryfp',
        [],
        [{ assetId: 'blockchain:bitcoin:native', assetSymbol: 'BTC', amount: '1.001', price: '50000' }],
        [createFeeMovement('network', 'on-chain', 'BTC', '0.001', '50000')]
      );
      senderTx.fees[0]!.assetId = 'blockchain:bitcoin:native';

      const receiverTx = createBlockchainTx(
        2,
        2,
        '2024-01-01T00:00:00Z',
        'bitcoin',
        '0xhashcarryfp',
        [{ assetId: 'blockchain:bitcoin:native', assetSymbol: 'BTC', amount: '1', price: '50000' }],
        [],
        [createFeeMovement('network', 'on-chain', 'BTC', '0.001', '50000')]
      );
      receiverTx.fees[0]!.assetId = 'blockchain:bitcoin:native';

      const result = prepareAccountingTransactions([senderTx, receiverTx], noopLogger);
      const value = assertOk(result);

      expect(value.internalTransferCarryoverDrafts).toHaveLength(1);
      const carryover = value.internalTransferCarryoverDrafts[0]!;
      expect(carryover.sourceMovementFingerprint).toBe(senderTx.movements.outflows![0]!.movementFingerprint);
      expect(carryover.targets[0]!.targetMovementFingerprint).toBe(
        receiverTx.movements.inflows![0]!.movementFingerprint
      );
    });
  });

  describe('ambiguous same-hash groups', () => {
    it('should warn and skip mixed inflow/outflow on same participant', () => {
      // Same transaction has both inflow and outflow for BTC
      const tx1 = createBlockchainTx(
        1,
        1,
        '2024-01-01T00:00:00Z',
        'bitcoin',
        '0xhashmixed',
        [{ assetId: 'blockchain:bitcoin:native', assetSymbol: 'BTC', amount: '0.5', price: '50000' }],
        [{ assetId: 'blockchain:bitcoin:native', assetSymbol: 'BTC', amount: '1', price: '50000' }]
      );

      const tx2 = createBlockchainTx(
        2,
        2,
        '2024-01-01T00:00:00Z',
        'bitcoin',
        '0xhashmixed',
        [{ assetId: 'blockchain:bitcoin:native', assetSymbol: 'BTC', amount: '0.5', price: '50000' }],
        []
      );

      const logger = createSpyLogger();
      const result = prepareAccountingTransactions([tx1, tx2], logger);
      const value = assertOk(result);

      expect(value.transactions).toHaveLength(2);
      expect(value.transactions.find((transaction) => transaction.tx.id === 1)?.movements.inflows).toHaveLength(1);
      expect(value.transactions.find((transaction) => transaction.tx.id === 1)?.movements.outflows).toHaveLength(1);
      expect(value.transactions.find((transaction) => transaction.tx.id === 2)?.movements.inflows).toHaveLength(1);
      expect(vi.mocked(logger.warn)).toHaveBeenCalledWith(
        expect.objectContaining({ mixedTxIds: [1] }),
        expect.stringContaining('both inflows and outflows')
      );
    });

    it('should ignore non-principal inflows when evaluating same-hash ambiguity', () => {
      const tx1 = materializeTestTransaction({
        id: 1,
        accountId: 1,
        identityReference: 'ext-role-1',
        datetime: '2024-01-01T00:00:00Z',
        timestamp: new Date('2024-01-01T00:00:00Z').getTime(),
        platformKey: 'cardano',
        platformKind: 'blockchain',
        status: 'success',
        movements: {
          inflows: [
            {
              assetId: 'blockchain:cardano:native',
              assetSymbol: 'ADA' as Currency,
              grossAmount: parseDecimal('0.5'),
              movementRole: 'staking_reward',
              priceAtTxTime: createPriceAtTxTime('1'),
            },
          ],
          outflows: [
            {
              assetId: 'blockchain:cardano:native',
              assetSymbol: 'ADA' as Currency,
              grossAmount: parseDecimal('2'),
              priceAtTxTime: createPriceAtTxTime('1'),
            },
          ],
        },
        fees: [],
        operation: { category: 'transfer', type: 'transfer' },
        blockchain: { name: 'cardano', transaction_hash: '0xhash-role', is_confirmed: true },
      });

      const tx2 = createBlockchainTx(
        2,
        2,
        '2024-01-01T00:00:00Z',
        'cardano',
        '0xhash-role',
        [{ assetId: 'blockchain:cardano:native', assetSymbol: 'ADA', amount: '0.5', price: '1' }],
        []
      );

      const logger = createSpyLogger();
      const result = prepareAccountingTransactions([tx1, tx2], logger);
      const value = assertOk(result);

      const senderScoped = value.transactions.find((transaction) => transaction.tx.id === 1)!;
      const receiverScoped = value.transactions.find((transaction) => transaction.tx.id === 2)!;

      expect(senderScoped.movements.inflows).toHaveLength(1);
      expect(senderScoped.movements.inflows[0]!.movementRole).toBe('staking_reward');
      expect(senderScoped.movements.outflows).toHaveLength(1);
      expect(senderScoped.movements.outflows[0]!.grossAmount.toFixed()).toBe('1.5');
      expect(receiverScoped.movements.inflows).toHaveLength(0);
      expect(vi.mocked(logger.warn)).not.toHaveBeenCalledWith(
        expect.objectContaining({ mixedTxIds: [1] }),
        expect.stringContaining('both inflows and outflows')
      );
    });

    it('should warn and skip multi-movement participant', () => {
      // Sender has two outflow movements for BTC in one tx
      const senderTx = materializeTestTransaction({
        id: 1,
        accountId: 1,
        identityReference: 'ext-1',
        datetime: '2024-01-01T00:00:00Z',
        timestamp: new Date('2024-01-01T00:00:00Z').getTime(),
        platformKey: 'bitcoin',
        platformKind: 'blockchain',
        status: 'success',
        movements: {
          inflows: [],
          outflows: [
            {
              assetId: 'blockchain:bitcoin:native',
              assetSymbol: 'BTC' as Currency,
              grossAmount: parseDecimal('0.5'),
              priceAtTxTime: createPriceAtTxTime('50000'),
            },
            {
              assetId: 'blockchain:bitcoin:native',
              assetSymbol: 'BTC' as Currency,
              grossAmount: parseDecimal('0.3'),
              priceAtTxTime: createPriceAtTxTime('50000'),
            },
          ],
        },
        fees: [],
        operation: { category: 'transfer', type: 'transfer' },
        blockchain: { name: 'bitcoin', transaction_hash: '0xhashmultimove', is_confirmed: true },
      });

      const receiverTx = createBlockchainTx(
        2,
        2,
        '2024-01-01T00:00:00Z',
        'bitcoin',
        '0xhashmultimove',
        [{ assetId: 'blockchain:bitcoin:native', assetSymbol: 'BTC', amount: '0.5', price: '50000' }],
        []
      );

      const logger = createSpyLogger();
      const result = prepareAccountingTransactions([senderTx, receiverTx], logger);
      const value = assertOk(result);

      expect(value.transactions).toHaveLength(2);
      expect(value.transactions.find((transaction) => transaction.tx.id === 1)?.movements.outflows).toHaveLength(2);
      expect(value.transactions.find((transaction) => transaction.tx.id === 2)?.movements.inflows).toHaveLength(1);
      expect(vi.mocked(logger.warn)).toHaveBeenCalledWith(
        expect.objectContaining({ senderTxId: 1, senderOutflowMovementCount: 2 }),
        expect.stringContaining('multiple outflow movements')
      );
    });

    it('should return Err when internal inflows plus fee exceed sender outflow', () => {
      const senderTx = createBlockchainTx(
        1,
        1,
        '2024-01-01T00:00:00Z',
        'bitcoin',
        '0xhashnegative',
        [],
        [{ assetId: 'blockchain:bitcoin:native', assetSymbol: 'BTC', amount: '1', price: '50000' }],
        [createFeeMovement('network', 'on-chain', 'BTC', '0.1', '50000')]
      );
      senderTx.fees[0]!.assetId = 'blockchain:bitcoin:native';

      const receiverTx = createBlockchainTx(
        2,
        2,
        '2024-01-01T00:00:00Z',
        'bitcoin',
        '0xhashnegative',
        [{ assetId: 'blockchain:bitcoin:native', assetSymbol: 'BTC', amount: '0.95', price: '50000' }],
        []
      );

      const result = prepareAccountingTransactions([senderTx, receiverTx], noopLogger);
      const error = assertErr(result);
      expect(error.message).toContain('internal inflows plus deduped fee exceed sender outflow');
    });
  });

  describe('same-hash grouping boundaries', () => {
    it('should not group transactions from different blockchains that share a normalized hash', () => {
      const bitcoinTx = createBlockchainTx(
        1,
        1,
        '2024-01-01T00:00:00Z',
        'bitcoin',
        '0xsharedhash',
        [],
        [{ assetId: 'blockchain:bitcoin:native', assetSymbol: 'BTC', amount: '1', price: '50000' }],
        [createFeeMovement('network', 'on-chain', 'BTC', '0.001', '50000')]
      );
      bitcoinTx.fees[0]!.assetId = 'blockchain:bitcoin:native';

      const litecoinTx = createBlockchainTx(
        2,
        2,
        '2024-01-01T00:00:00Z',
        'litecoin',
        '0xsharedhash',
        [{ assetId: 'blockchain:litecoin:native', assetSymbol: 'LTC', amount: '1', price: '100' }],
        [],
        [createFeeMovement('network', 'on-chain', 'LTC', '0.001', '100')]
      );
      litecoinTx.fees[0]!.assetId = 'blockchain:litecoin:native';

      const result = prepareAccountingTransactions([bitcoinTx, litecoinTx], noopLogger);
      const value = assertOk(result);

      expect(value.internalTransferCarryoverDrafts).toHaveLength(0);

      const bitcoinScoped = value.transactions.find((t) => t.tx.id === 1)!;
      expect(bitcoinScoped.movements.outflows[0]!.grossAmount.toFixed()).toBe('1');

      const litecoinScoped = value.transactions.find((t) => t.tx.id === 2)!;
      expect(litecoinScoped.movements.inflows[0]!.grossAmount.toFixed()).toBe('1');
    });
  });
});
