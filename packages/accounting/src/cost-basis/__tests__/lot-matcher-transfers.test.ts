import type { FeeMovement } from '@exitbook/core';
import {
  err,
  type Currency,
  parseDecimal,
  type AssetMovement,
  type Result,
  type UniversalTransactionData,
} from '@exitbook/core';
import { assertErr, assertOk } from '@exitbook/core/test-utils';
import { getLogger } from '@exitbook/logger';
import { Decimal } from 'decimal.js';
import { describe, expect, it } from 'vitest';

import { createFeeMovement, createPriceAtTxTime, createTransactionFromMovements } from '../../__tests__/test-utils.js';
import type { TransactionLink } from '../../linking/types.js';
import type { AccountingScopedTransaction } from '../build-accounting-scoped-transactions.js';
import { buildAccountingScopedTransactions } from '../build-accounting-scoped-transactions.js';
import { LotMatcher } from '../lot-matcher.js';
import { AverageCostStrategy } from '../strategies/average-cost-strategy.js';
import { FifoStrategy } from '../strategies/fifo-strategy.js';
import { validateScopedTransferLinks } from '../validated-scoped-transfer-links.js';

describe('LotMatcher - Transfer-Aware Integration Tests (ADR-004 Phase 2)', () => {
  const createTransaction = (
    id: number,
    datetime: string,
    source: string,
    inflows: AssetMovement[] = [],
    outflows: AssetMovement[] = [],
    fees: FeeMovement[] = []
  ): UniversalTransactionData =>
    createTransactionFromMovements(id, datetime, { inflows, outflows }, fees, {
      source,
      category: 'transfer',
      type: 'withdrawal',
    });

  const createLink = (
    id: number,
    sourceTransactionId: number,
    targetTransactionId: number,
    assetSymbol: string,
    sourceAmount: string,
    targetAmount: string,
    confidenceScore = '98.5'
  ): TransactionLink => ({
    id,
    sourceTransactionId,
    targetTransactionId,
    assetSymbol: assetSymbol as Currency,
    sourceAssetId: `exchange:source:${assetSymbol.toLowerCase()}`,
    targetAssetId: `blockchain:target:${assetSymbol.toLowerCase()}`,
    sourceAmount: parseDecimal(sourceAmount),
    targetAmount: parseDecimal(targetAmount),
    sourceMovementFingerprint: `movement:exchange:source:${sourceTransactionId}:${assetSymbol.toLowerCase()}:outflow:0`,
    targetMovementFingerprint: `movement:blockchain:target:${targetTransactionId}:${assetSymbol.toLowerCase()}:inflow:0`,
    linkType: 'exchange_to_blockchain',
    confidenceScore: parseDecimal(confidenceScore),
    matchCriteria: {
      assetMatch: true,
      amountSimilarity: parseDecimal('0.99'),
      timingValid: true,
      timingHours: 0.5,
    },
    status: 'confirmed',
    createdAt: new Date('2024-01-01'),
    updatedAt: new Date('2024-01-01'),
  });

  const matcher = new LotMatcher();
  const logger = getLogger('lot-matcher-transfers.test');

  let transactions: UniversalTransactionData[] = [];

  async function matchTransactions(
    rawTransactions: UniversalTransactionData[],
    confirmedLinks: TransactionLink[],
    config: Parameters<LotMatcher['match']>[2]
  ): Promise<Result<Awaited<ReturnType<LotMatcher['match']>> extends Result<infer T, infer _E> ? T : never, Error>> {
    const scopedResult = buildAccountingScopedTransactions(rawTransactions, logger);
    if (scopedResult.isErr()) {
      return err(scopedResult.error);
    }
    const scoped = scopedResult.value;
    const hydratedLinks = hydrateTestLinks(scoped.transactions, confirmedLinks);
    const validatedLinksResult = validateScopedTransferLinks(scoped.transactions, hydratedLinks);
    if (validatedLinksResult.isErr()) {
      return err(validatedLinksResult.error);
    }

    return matcher.match(scoped, validatedLinksResult.value, config);
  }

  function hydrateTestLinks(
    scopedTransactions: AccountingScopedTransaction[],
    confirmedLinks: TransactionLink[]
  ): TransactionLink[] {
    const usageByHint = new Map<string, number>();

    return confirmedLinks.map((link) => {
      const sourceTransaction = scopedTransactions.find(
        (scopedTransaction) => scopedTransaction.tx.id === link.sourceTransactionId
      );
      const targetTransaction = scopedTransactions.find(
        (scopedTransaction) => scopedTransaction.tx.id === link.targetTransactionId
      );
      if (!sourceTransaction || !targetTransaction) {
        throw new Error(`Failed to hydrate test link ${link.id}: source or target transaction not found`);
      }

      const sourceMovement = resolveScopedMovement(
        sourceTransaction,
        'outflow',
        link.sourceMovementFingerprint,
        usageByHint
      );
      const targetMovement = resolveScopedMovement(
        targetTransaction,
        'inflow',
        link.targetMovementFingerprint,
        usageByHint
      );

      return {
        ...link,
        sourceAssetId: sourceMovement.assetId,
        targetAssetId: targetMovement.assetId,
        sourceMovementFingerprint: sourceMovement.movementFingerprint,
        targetMovementFingerprint: targetMovement.movementFingerprint,
      };
    });
  }

  function resolveScopedMovement(
    scopedTransaction: AccountingScopedTransaction,
    movementType: 'inflow' | 'outflow',
    fingerprintHint: string,
    usageByHint: Map<string, number>
  ) {
    const positionMatch = fingerprintHint.match(/:(inflow|outflow):(\d+)$/);
    const hintedPosition = positionMatch ? Number.parseInt(positionMatch[2]!, 10) : 0;
    const usageKey = `${scopedTransaction.tx.id}:${movementType}:${fingerprintHint}`;
    const usageOffset = usageByHint.get(usageKey) ?? 0;
    const position = hintedPosition + usageOffset;
    const movements =
      movementType === 'inflow' ? scopedTransaction.movements.inflows : scopedTransaction.movements.outflows;
    const movement = movements[position];
    if (!movement) {
      throw new Error(
        `Failed to resolve scoped ${movementType} movement at position ${position} for transaction ${scopedTransaction.tx.id}`
      );
    }
    usageByHint.set(usageKey, usageOffset + 1);
    return movement;
  }

  describe('1. Timestamp inconsistencies - reversed deposit/withdrawal', () => {
    it('should process transfer correctly when target timestamp < source timestamp', async () => {
      const purchaseTx = createTransaction(
        1,
        '2024-01-01T00:00:00Z',
        'kraken',
        [
          {
            assetId: 'test:btc',
            assetSymbol: 'BTC' as Currency,
            grossAmount: parseDecimal('1'),
            priceAtTxTime: createPriceAtTxTime('50000'),
          },
        ],
        []
      );

      const withdrawalTx = createTransaction(
        2,
        '2024-02-01T12:00:00Z',
        'kraken',
        [],
        [
          {
            assetId: 'test:btc',
            assetSymbol: 'BTC' as Currency,
            grossAmount: parseDecimal('1'),
            netAmount: parseDecimal('0.9995'),
            priceAtTxTime: createPriceAtTxTime('60000'),
          },
        ],
        [
          {
            ...createFeeMovement('network', 'on-chain', 'BTC', '0.0005', '60000'),
            assetId: 'exchange:kraken:btc',
          },
        ]
      );

      const depositTx = createTransaction(
        3,
        '2024-02-01T11:30:00Z',
        'blockchain-wallet',
        [
          {
            assetId: 'test:btc',
            assetSymbol: 'BTC' as Currency,
            grossAmount: parseDecimal('0.9995'),
            priceAtTxTime: createPriceAtTxTime('60000'),
          },
        ],
        []
      );

      transactions = [purchaseTx, withdrawalTx, depositTx];

      // sourceAmount matches outflow's netAmount (what production link creation stores)
      const link = createLink(1, 2, 3, 'BTC', '0.9995', '0.9995');

      const fifoStrategy = new FifoStrategy();

      const result = await matchTransactions(transactions, [link], {
        calculationId: 'calc1',
        strategy: fifoStrategy,
        jurisdiction: { sameAssetTransferFeePolicy: 'disposal' },
      });
      const resultValue = assertOk(result);
      const btcResult = resultValue.assetResults.find((r) => r.assetSymbol === 'BTC');
      expect(btcResult).toBeDefined();
      expect(btcResult!.lots).toHaveLength(2);
      expect(btcResult!.lotTransfers).toHaveLength(1);

      const transferLot = btcResult!.lots[1];
      expect(transferLot?.acquisitionTransactionId).toBe(3);
      expect(transferLot?.quantity.toFixed()).toBe('0.9995');
    });
  });

  describe('2. Simple transfer with crypto fee (US/disposal)', () => {
    it('should create separate disposal for network fee with US jurisdiction', async () => {
      const purchaseTx = createTransaction(
        1,
        '2024-01-01T00:00:00Z',
        'kraken',
        [
          {
            assetId: 'test:btc',
            assetSymbol: 'BTC' as Currency,
            grossAmount: parseDecimal('1'),
            priceAtTxTime: createPriceAtTxTime('50000'),
          },
        ],
        []
      );

      const withdrawalTx = createTransaction(
        2,
        '2024-02-01T12:00:00Z',
        'kraken',
        [],
        [
          {
            assetId: 'test:btc',
            assetSymbol: 'BTC' as Currency,
            grossAmount: parseDecimal('1'),
            netAmount: parseDecimal('0.9995'),
            priceAtTxTime: createPriceAtTxTime('60000'),
          },
        ],
        [createFeeMovement('network', 'on-chain', 'BTC', '0.0005', '60000')]
      );

      const depositTx = createTransaction(
        3,
        '2024-02-01T14:00:00Z',
        'blockchain-wallet',
        [
          {
            assetId: 'test:btc',
            assetSymbol: 'BTC' as Currency,
            grossAmount: parseDecimal('0.9995'),
            priceAtTxTime: createPriceAtTxTime('60000'),
          },
        ],
        []
      );

      transactions = [purchaseTx, withdrawalTx, depositTx];

      // sourceAmount matches outflow's netAmount (what production link creation stores)
      const link = createLink(1, 2, 3, 'BTC', '0.9995', '0.9995');

      const fifoStrategy = new FifoStrategy();

      const result = await matchTransactions(transactions, [link], {
        calculationId: 'calc1',
        strategy: fifoStrategy,
        jurisdiction: { sameAssetTransferFeePolicy: 'disposal' },
      });

      const resultValue = assertOk(result);
      const btcResult = resultValue.assetResults.find((r) => r.assetSymbol === 'BTC');
      expect(btcResult).toBeDefined();

      expect(btcResult!.lots).toHaveLength(2);
      const purchaseLot = btcResult!.lots[0];
      expect(purchaseLot?.quantity.toFixed()).toBe('1');
      expect(purchaseLot?.costBasisPerUnit.toFixed()).toBe('50000');
      expect(purchaseLot?.remainingQuantity.toFixed()).toBe('0');
      expect(purchaseLot?.status).toBe('fully_disposed');

      const transferLot = btcResult!.lots[1];
      expect(transferLot?.acquisitionTransactionId).toBe(3);
      expect(transferLot?.quantity.toFixed()).toBe('0.9995');
      expect(transferLot?.costBasisPerUnit.toFixed()).toBe('50000');
      expect(transferLot?.remainingQuantity.toFixed()).toBe('0.9995');

      expect(btcResult!.disposals).toHaveLength(1);
      const feeDisposal = btcResult!.disposals[0];
      expect(feeDisposal?.disposalTransactionId).toBe(2);
      expect(feeDisposal?.quantityDisposed.toFixed()).toBe('0.0005');
      expect(feeDisposal?.proceedsPerUnit.toFixed()).toBe('60000');
      expect(feeDisposal?.costBasisPerUnit.toFixed()).toBe('50000');
      expect(feeDisposal?.gainLoss.toFixed()).toBe('5');

      expect(btcResult!.lotTransfers).toHaveLength(1);
      const transfer = btcResult!.lotTransfers[0];
      expect(transfer?.quantityTransferred.toFixed()).toBe('0.9995');
      expect(transfer?.costBasisPerUnit.toFixed()).toBe('50000');
      expect(transfer?.sourceTransactionId).toBe(2);
      expect(transfer?.targetTransactionId).toBe(3);
    });
  });

  describe('3. Simple transfer with crypto fee (CA/add-to-basis)', () => {
    it('should add network fee to cost basis with CA jurisdiction', async () => {
      const purchaseTx = createTransaction(
        1,
        '2024-01-01T00:00:00Z',
        'kraken',
        [
          {
            assetId: 'test:btc',
            assetSymbol: 'BTC' as Currency,
            grossAmount: parseDecimal('1'),
            priceAtTxTime: createPriceAtTxTime('50000'),
          },
        ],
        []
      );

      const withdrawalTx = createTransaction(
        2,
        '2024-02-01T12:00:00Z',
        'kraken',
        [],
        [
          {
            assetId: 'test:btc',
            assetSymbol: 'BTC' as Currency,
            grossAmount: parseDecimal('1'),
            netAmount: parseDecimal('0.9995'),
            priceAtTxTime: createPriceAtTxTime('60000'),
          },
        ],
        [createFeeMovement('network', 'on-chain', 'BTC', '0.0005', '60000')]
      );

      const depositTx = createTransaction(
        3,
        '2024-02-01T14:00:00Z',
        'blockchain-wallet',
        [
          {
            assetId: 'test:btc',
            assetSymbol: 'BTC' as Currency,
            grossAmount: parseDecimal('0.9995'),
            priceAtTxTime: createPriceAtTxTime('60000'),
          },
        ],
        []
      );

      transactions = [purchaseTx, withdrawalTx, depositTx];

      // sourceAmount matches outflow's netAmount (what production link creation stores)
      const link = createLink(1, 2, 3, 'BTC', '0.9995', '0.9995');

      const fifoStrategy = new FifoStrategy();

      const result = await matchTransactions(transactions, [link], {
        calculationId: 'calc1',
        strategy: fifoStrategy,
        jurisdiction: { sameAssetTransferFeePolicy: 'add-to-basis' },
      });

      const resultValue = assertOk(result);
      const btcResult = resultValue.assetResults.find((r) => r.assetSymbol === 'BTC');
      expect(btcResult).toBeDefined();

      expect(btcResult!.lots).toHaveLength(2);
      expect(btcResult!.disposals).toHaveLength(0);

      const transferLot = btcResult!.lots[1];
      expect(transferLot?.acquisitionTransactionId).toBe(3);
      expect(transferLot?.quantity.toFixed()).toBe('0.9995');
      const expectedBasis = parseDecimal('49975').plus(new Decimal('30'));
      const expectedPerUnit = expectedBasis.dividedBy(parseDecimal('0.9995'));
      expect(transferLot?.costBasisPerUnit.toFixed()).toBe(expectedPerUnit.toFixed());

      expect(btcResult!.lotTransfers).toHaveLength(1);
      const transfer = btcResult!.lotTransfers[0];
      expect(transfer?.metadata?.cryptoFeeUsdValue).toBeDefined();
      expect(new Decimal(transfer!.metadata!.cryptoFeeUsdValue!).toFixed()).toBe('30');
    });
  });

  describe('4. Simple transfer with fiat fee', () => {
    it('should add fiat fee to cost basis of target', async () => {
      const purchaseTx = createTransaction(
        1,
        '2024-01-01T00:00:00Z',
        'kraken',
        [
          {
            assetId: 'test:btc',
            assetSymbol: 'BTC' as Currency,
            grossAmount: parseDecimal('1'),
            priceAtTxTime: createPriceAtTxTime('50000'),
          },
        ],
        []
      );

      const withdrawalTx = createTransaction(
        2,
        '2024-02-01T12:00:00Z',
        'kraken',
        [],
        [
          {
            assetId: 'test:btc',
            assetSymbol: 'BTC' as Currency,
            grossAmount: parseDecimal('1'),
            netAmount: parseDecimal('0.9995'),
            priceAtTxTime: createPriceAtTxTime('60000'),
          },
        ],
        [
          createFeeMovement('network', 'on-chain', 'BTC', '0.0005', '60000'),
          createFeeMovement('platform', 'balance', 'USD', '1.5', '1'),
        ]
      );

      const depositTx = createTransaction(
        3,
        '2024-02-01T14:00:00Z',
        'blockchain-wallet',
        [
          {
            assetId: 'test:btc',
            assetSymbol: 'BTC' as Currency,
            grossAmount: parseDecimal('0.9995'),
            priceAtTxTime: createPriceAtTxTime('60000'),
          },
        ],
        []
      );

      transactions = [purchaseTx, withdrawalTx, depositTx];

      // sourceAmount matches outflow's netAmount (what production link creation stores)
      const link = createLink(1, 2, 3, 'BTC', '0.9995', '0.9995');

      const fifoStrategy = new FifoStrategy();

      const result = await matchTransactions(transactions, [link], {
        calculationId: 'calc1',
        strategy: fifoStrategy,
        jurisdiction: { sameAssetTransferFeePolicy: 'disposal' },
      });

      const resultValue = assertOk(result);
      const btcResult = resultValue.assetResults.find((r) => r.assetSymbol === 'BTC');
      expect(btcResult).toBeDefined();

      const transferLot = btcResult!.lots[1];
      expect(transferLot?.acquisitionTransactionId).toBe(3);
      const expectedBasis = parseDecimal('49975').plus(new Decimal('1.5'));
      const expectedPerUnit = expectedBasis.dividedBy(parseDecimal('0.9995'));
      expect(transferLot?.costBasisPerUnit.toFixed()).toBe(expectedPerUnit.toFixed());
    });
  });

  describe('5. Multi-hop transfer', () => {
    it('should handle sequential links (exchange A → B → C)', async () => {
      const purchaseTx = createTransaction(
        1,
        '2024-01-01T00:00:00Z',
        'kraken',
        [
          {
            assetId: 'test:btc',
            assetSymbol: 'BTC' as Currency,
            grossAmount: parseDecimal('1'),
            priceAtTxTime: createPriceAtTxTime('50000'),
          },
        ],
        []
      );

      const withdrawal1Tx = createTransaction(
        2,
        '2024-02-01T12:00:00Z',
        'kraken',
        [],
        [
          {
            assetId: 'test:btc',
            assetSymbol: 'BTC' as Currency,
            grossAmount: parseDecimal('1'),
            netAmount: parseDecimal('0.9995'),
            priceAtTxTime: createPriceAtTxTime('60000'),
          },
        ],
        [createFeeMovement('network', 'on-chain', 'BTC', '0.0005', '60000')]
      );

      const deposit1Tx = createTransaction(
        3,
        '2024-02-01T14:00:00Z',
        'wallet',
        [
          {
            assetId: 'test:btc',
            assetSymbol: 'BTC' as Currency,
            grossAmount: parseDecimal('0.9995'),
            priceAtTxTime: createPriceAtTxTime('60000'),
          },
        ],
        []
      );

      const withdrawal2Tx = createTransaction(
        4,
        '2024-03-01T12:00:00Z',
        'wallet',
        [],
        [
          {
            assetId: 'test:btc',
            assetSymbol: 'BTC' as Currency,
            grossAmount: parseDecimal('0.9995'),
            netAmount: parseDecimal('0.9992'),
            priceAtTxTime: createPriceAtTxTime('65000'),
          },
        ],
        [createFeeMovement('network', 'on-chain', 'BTC', '0.0003', '65000')]
      );

      const deposit2Tx = createTransaction(
        5,
        '2024-03-01T14:00:00Z',
        'coinbase',
        [
          {
            assetId: 'test:btc',
            assetSymbol: 'BTC' as Currency,
            grossAmount: parseDecimal('0.9992'),
            priceAtTxTime: createPriceAtTxTime('65000'),
          },
        ],
        []
      );

      transactions = [purchaseTx, withdrawal1Tx, deposit1Tx, withdrawal2Tx, deposit2Tx];

      // sourceAmount matches outflow's netAmount (what production link creation stores)
      const link1 = createLink(1, 2, 3, 'BTC', '0.9995', '0.9995');
      const link2 = createLink(2, 4, 5, 'BTC', '0.9992', '0.9992');

      const fifoStrategy = new FifoStrategy();

      const result = await matchTransactions(transactions, [link1, link2], {
        calculationId: 'calc1',
        strategy: fifoStrategy,
        jurisdiction: { sameAssetTransferFeePolicy: 'disposal' },
      });
      const resultValue = assertOk(result);
      const btcResult = resultValue.assetResults.find((r) => r.assetSymbol === 'BTC');
      expect(btcResult).toBeDefined();

      expect(btcResult!.lots).toHaveLength(3);
      expect(btcResult!.disposals).toHaveLength(2);
      expect(btcResult!.lotTransfers).toHaveLength(2);

      const finalLot = btcResult!.lots[2];
      expect(finalLot?.acquisitionTransactionId).toBe(5);
      expect(finalLot?.quantity.toFixed()).toBe('0.9992');
      expect(finalLot?.costBasisPerUnit.toFixed()).toBe('50000');

      const feeDisposal1 = btcResult!.disposals[0];
      expect(feeDisposal1?.quantityDisposed.toFixed()).toBe('0.0005');
      const feeDisposal2 = btcResult!.disposals[1];
      expect(feeDisposal2?.quantityDisposed.toFixed()).toBe('0.0003');
    });
  });

  describe('6. Third-asset fee', () => {
    it('should create disposal for fee in different asset (e.g., BTC transfer, ETH fee)', async () => {
      const purchaseBTCTx = createTransaction(
        1,
        '2024-01-01T00:00:00Z',
        'exchange',
        [
          {
            assetId: 'test:btc',
            assetSymbol: 'BTC' as Currency,
            grossAmount: parseDecimal('1'),
            priceAtTxTime: createPriceAtTxTime('50000'),
          },
        ],
        []
      );

      const purchaseETHTx = createTransaction(
        2,
        '2024-01-01T00:00:00Z',
        'exchange',
        [
          {
            assetId: 'test:eth',
            assetSymbol: 'ETH' as Currency,
            grossAmount: parseDecimal('10'),
            priceAtTxTime: createPriceAtTxTime('3000'),
          },
        ],
        []
      );

      const withdrawalTx = createTransaction(
        3,
        '2024-02-01T12:00:00Z',
        'exchange',
        [],
        [
          {
            assetId: 'test:btc',
            assetSymbol: 'BTC' as Currency,
            grossAmount: parseDecimal('1'),
            priceAtTxTime: createPriceAtTxTime('60000'),
          },
          {
            assetId: 'test:eth',
            assetSymbol: 'ETH' as Currency,
            grossAmount: parseDecimal('0.01'),
            priceAtTxTime: createPriceAtTxTime('3500'),
          },
        ],
        [createFeeMovement('network', 'on-chain', 'ETH', '0.01', '3500')]
      );

      const depositTx = createTransaction(
        4,
        '2024-02-01T14:00:00Z',
        'wallet',
        [
          {
            assetId: 'test:btc',
            assetSymbol: 'BTC' as Currency,
            grossAmount: parseDecimal('1'),
            priceAtTxTime: createPriceAtTxTime('60000'),
          },
        ],
        []
      );

      transactions = [purchaseBTCTx, purchaseETHTx, withdrawalTx, depositTx];

      const link = createLink(1, 3, 4, 'BTC', '1.0', '1.0');

      const fifoStrategy = new FifoStrategy();

      const result = await matchTransactions(transactions, [link], {
        calculationId: 'calc1',
        strategy: fifoStrategy,
        jurisdiction: { sameAssetTransferFeePolicy: 'disposal' },
      });

      const resultValue = assertOk(result);
      const btcResult = resultValue.assetResults.find((r) => r.assetSymbol === 'BTC');
      const ethResult = resultValue.assetResults.find((r) => r.assetSymbol === 'ETH');

      expect(btcResult).toBeDefined();
      expect(ethResult).toBeDefined();

      expect(btcResult!.lotTransfers).toHaveLength(1);
      expect(btcResult!.disposals).toHaveLength(0);

      expect(ethResult!.disposals).toHaveLength(1);
      const ethFeeDisposal = ethResult!.disposals[0];
      expect(ethFeeDisposal?.quantityDisposed.toFixed()).toBe('0.01');
      expect(ethFeeDisposal?.proceedsPerUnit.toFixed()).toBe('3500');
    });
  });

  describe('7. Batched withdrawal', () => {
    it('should handle single transaction with 2 outflows of same asset/amount', async () => {
      const purchaseTx = createTransaction(
        1,
        '2024-01-01T00:00:00Z',
        'exchange',
        [
          {
            assetId: 'test:btc',
            assetSymbol: 'BTC' as Currency,
            grossAmount: parseDecimal('2'),
            priceAtTxTime: createPriceAtTxTime('50000'),
          },
        ],
        []
      );

      const batchedWithdrawalTx = createTransaction(
        2,
        '2024-02-01T12:00:00Z',
        'exchange',
        [],
        [
          {
            assetId: 'test:btc',
            assetSymbol: 'BTC' as Currency,
            grossAmount: parseDecimal('1'),
            netAmount: parseDecimal('0.99975'),
            priceAtTxTime: createPriceAtTxTime('60000'),
          },
          {
            assetId: 'test:btc',
            assetSymbol: 'BTC' as Currency,
            grossAmount: parseDecimal('1'),
            netAmount: parseDecimal('0.99975'),
            priceAtTxTime: createPriceAtTxTime('60000'),
          },
        ],
        [createFeeMovement('network', 'on-chain', 'BTC', '0.0005', '60000')]
      );

      const deposit1Tx = createTransaction(
        3,
        '2024-02-01T14:00:00Z',
        'wallet-a',
        [
          {
            assetId: 'test:btc',
            assetSymbol: 'BTC' as Currency,
            grossAmount: parseDecimal('0.99975'),
            priceAtTxTime: createPriceAtTxTime('60000'),
          },
        ],
        []
      );

      const deposit2Tx = createTransaction(
        4,
        '2024-02-01T14:00:00Z',
        'wallet-b',
        [
          {
            assetId: 'test:btc',
            assetSymbol: 'BTC' as Currency,
            grossAmount: parseDecimal('0.99975'),
            priceAtTxTime: createPriceAtTxTime('60000'),
          },
        ],
        []
      );

      transactions = [purchaseTx, batchedWithdrawalTx, deposit1Tx, deposit2Tx];

      // sourceAmount matches outflow's netAmount (what production link creation stores)
      const link1 = createLink(1, 2, 3, 'BTC', '0.99975', '0.99975');
      const link2 = createLink(2, 2, 4, 'BTC', '0.99975', '0.99975');

      const fifoStrategy = new FifoStrategy();

      const result = await matchTransactions(transactions, [link1, link2], {
        calculationId: 'calc1',
        strategy: fifoStrategy,
        jurisdiction: { sameAssetTransferFeePolicy: 'disposal' },
      });
      const resultValue = assertOk(result);
      const btcResult = resultValue.assetResults.find((r) => r.assetSymbol === 'BTC');
      expect(btcResult).toBeDefined();

      expect(btcResult!.lots).toHaveLength(3);
      expect(btcResult!.lotTransfers).toHaveLength(2);

      const transferLot1 = btcResult!.lots[1];
      expect(transferLot1?.acquisitionTransactionId).toBe(3);
      expect(transferLot1?.quantity.toFixed()).toBe('0.99975');

      const transferLot2 = btcResult!.lots[2];
      expect(transferLot2?.acquisitionTransactionId).toBe(4);
      expect(transferLot2?.quantity.toFixed()).toBe('0.99975');
    });
  });

  describe('8. Multiple inflows', () => {
    it('should fail when one confirmed link tries to span multiple sibling inflows', async () => {
      const purchaseTx = createTransaction(
        1,
        '2024-01-01T00:00:00Z',
        'exchange-a',
        [
          {
            assetId: 'test:btc',
            assetSymbol: 'BTC' as Currency,
            grossAmount: parseDecimal('1'),
            priceAtTxTime: createPriceAtTxTime('50000'),
          },
        ],
        []
      );

      const withdrawalTx = createTransaction(
        2,
        '2024-02-01T12:00:00Z',
        'exchange-a',
        [],
        [
          {
            assetId: 'test:btc',
            assetSymbol: 'BTC' as Currency,
            grossAmount: parseDecimal('1'),
            netAmount: parseDecimal('0.9995'),
            priceAtTxTime: createPriceAtTxTime('60000'),
          },
        ],
        [createFeeMovement('network', 'on-chain', 'BTC', '0.0005', '60000')]
      );

      const depositTx = createTransaction(
        3,
        '2024-02-01T14:00:00Z',
        'exchange-b',
        [
          {
            assetId: 'test:btc',
            assetSymbol: 'BTC' as Currency,
            grossAmount: parseDecimal('0.5'),
            priceAtTxTime: createPriceAtTxTime('60000'),
          },
          {
            assetId: 'test:btc',
            assetSymbol: 'BTC' as Currency,
            grossAmount: parseDecimal('0.4995'),
            priceAtTxTime: createPriceAtTxTime('60000'),
          },
        ],
        []
      );

      transactions = [purchaseTx, withdrawalTx, depositTx];

      // sourceAmount matches outflow's netAmount (what production link creation stores)
      const link = createLink(1, 2, 3, 'BTC', '0.9995', '0.9995');

      const fifoStrategy = new FifoStrategy();

      const result = await matchTransactions(transactions, [link], {
        calculationId: 'calc1',
        strategy: fifoStrategy,
        jurisdiction: { sameAssetTransferFeePolicy: 'disposal' },
      });

      const resultError = assertErr(result);
      expect(resultError.message).toContain('target amount mismatch');
    });
  });

  describe('9. Multiple crypto fees', () => {
    it('should handle both network + platform fees in same asset', async () => {
      const purchaseTx = createTransaction(
        1,
        '2024-01-01T00:00:00Z',
        'exchange',
        [
          {
            assetId: 'test:btc',
            assetSymbol: 'BTC' as Currency,
            grossAmount: parseDecimal('1'),
            priceAtTxTime: createPriceAtTxTime('50000'),
          },
        ],
        []
      );

      const withdrawalTx = createTransaction(
        2,
        '2024-02-01T12:00:00Z',
        'exchange',
        [],
        [
          {
            assetId: 'test:btc',
            assetSymbol: 'BTC' as Currency,
            grossAmount: parseDecimal('1'),
            netAmount: parseDecimal('0.9995'),
            priceAtTxTime: createPriceAtTxTime('60000'),
          },
        ],
        [
          createFeeMovement('network', 'on-chain', 'BTC', '0.0003', '60000'),
          createFeeMovement('platform', 'on-chain', 'BTC', '0.0002', '60000'),
        ]
      );

      const depositTx = createTransaction(
        3,
        '2024-02-01T14:00:00Z',
        'wallet',
        [
          {
            assetId: 'test:btc',
            assetSymbol: 'BTC' as Currency,
            grossAmount: parseDecimal('0.9995'),
            priceAtTxTime: createPriceAtTxTime('60000'),
          },
        ],
        []
      );

      transactions = [purchaseTx, withdrawalTx, depositTx];

      // sourceAmount matches outflow's netAmount (what production link creation stores)
      const link = createLink(1, 2, 3, 'BTC', '0.9995', '0.9995');

      const fifoStrategy = new FifoStrategy();

      const result = await matchTransactions(transactions, [link], {
        calculationId: 'calc1',
        strategy: fifoStrategy,
        jurisdiction: { sameAssetTransferFeePolicy: 'disposal' },
      });

      const resultValue = assertOk(result);
      const btcResult = resultValue.assetResults.find((r) => r.assetSymbol === 'BTC');
      expect(btcResult).toBeDefined();

      expect(btcResult!.disposals).toHaveLength(1);
      const feeDisposal = btcResult!.disposals[0];
      expect(feeDisposal?.quantityDisposed.toFixed()).toBe('0.0005');

      expect(btcResult!.lotTransfers).toHaveLength(1);
      const transfer = btcResult!.lotTransfers[0];
      expect(transfer?.quantityTransferred.toFixed()).toBe('0.9995');
    });
  });

  describe('10. Moderate variance warning', () => {
    it('should warn but succeed on 1.2% variance on Binance', async () => {
      const purchaseTx = createTransaction(
        1,
        '2024-01-01T00:00:00Z',
        'binance',
        [
          {
            assetId: 'test:btc',
            assetSymbol: 'BTC' as Currency,
            grossAmount: parseDecimal('1'),
            priceAtTxTime: createPriceAtTxTime('50000'),
          },
        ],
        []
      );

      const withdrawalTx = createTransaction(
        2,
        '2024-02-01T12:00:00Z',
        'binance',
        [],
        [
          {
            assetId: 'test:btc',
            assetSymbol: 'BTC' as Currency,
            grossAmount: parseDecimal('1'),
            netAmount: parseDecimal('0.9875'),
            priceAtTxTime: createPriceAtTxTime('60000'),
          },
        ],
        [createFeeMovement('network', 'on-chain', 'BTC', '0.0005', '60000')]
      );

      const depositTx = createTransaction(
        3,
        '2024-02-01T14:00:00Z',
        'wallet',
        [
          {
            assetId: 'test:btc',
            assetSymbol: 'BTC' as Currency,
            grossAmount: parseDecimal('0.9875'),
            priceAtTxTime: createPriceAtTxTime('60000'),
          },
        ],
        []
      );

      transactions = [purchaseTx, withdrawalTx, depositTx];

      // sourceAmount matches outflow's netAmount (what production link creation stores)
      const link = createLink(1, 2, 3, 'BTC', '0.9875', '0.9875');

      const fifoStrategy = new FifoStrategy();

      const result = await matchTransactions(transactions, [link], {
        calculationId: 'calc1',
        strategy: fifoStrategy,
        jurisdiction: { sameAssetTransferFeePolicy: 'disposal' },
      });
      const resultValue = assertOk(result);
      const btcResult = resultValue.assetResults.find((r) => r.assetSymbol === 'BTC');
      expect(btcResult).toBeDefined();
      expect(btcResult!.lotTransfers).toHaveLength(1);
    });
  });

  describe('11. Excessive variance error', () => {
    it('should error on 6% variance on Binance', async () => {
      const purchaseTx = createTransaction(
        1,
        '2024-01-01T00:00:00Z',
        'binance',
        [
          {
            assetId: 'test:btc',
            assetSymbol: 'BTC' as Currency,
            grossAmount: parseDecimal('1'),
            priceAtTxTime: createPriceAtTxTime('50000'),
          },
        ],
        []
      );

      const withdrawalTx = createTransaction(
        2,
        '2024-02-01T12:00:00Z',
        'binance',
        [],
        [
          {
            assetId: 'test:btc',
            assetSymbol: 'BTC' as Currency,
            grossAmount: parseDecimal('1'),
            netAmount: parseDecimal('0.94'),
            priceAtTxTime: createPriceAtTxTime('60000'),
          },
        ],
        [createFeeMovement('network', 'on-chain', 'BTC', '0.0005', '60000')]
      );

      const depositTx = createTransaction(
        3,
        '2024-02-01T14:00:00Z',
        'wallet',
        [
          {
            assetId: 'test:btc',
            assetSymbol: 'BTC' as Currency,
            grossAmount: parseDecimal('0.94'),
            priceAtTxTime: createPriceAtTxTime('60000'),
          },
        ],
        []
      );

      transactions = [purchaseTx, withdrawalTx, depositTx];

      // sourceAmount matches outflow's netAmount (what production link creation stores)
      const link = createLink(1, 2, 3, 'BTC', '0.94', '0.94');

      const fifoStrategy = new FifoStrategy();

      const result = await matchTransactions(transactions, [link], {
        calculationId: 'calc1',
        strategy: fifoStrategy,
        jurisdiction: { sameAssetTransferFeePolicy: 'disposal' },
      });

      const resultError = assertErr(result);
      expect(resultError.message).toContain('Outflow fee validation failed');
      expect(resultError.message).toContain('hidden fee');
      expect(resultError.message).toContain('Exceeds error threshold');
    });
  });

  describe('12. Hidden fee scenario', () => {
    it('should accept 2% variance within Binance tolerance', async () => {
      const purchaseTx = createTransaction(
        1,
        '2024-01-01T00:00:00Z',
        'binance',
        [
          {
            assetId: 'test:btc',
            assetSymbol: 'BTC' as Currency,
            grossAmount: parseDecimal('1'),
            priceAtTxTime: createPriceAtTxTime('50000'),
          },
        ],
        []
      );

      const withdrawalTx = createTransaction(
        2,
        '2024-02-01T12:00:00Z',
        'binance',
        [],
        [
          {
            assetId: 'test:btc',
            assetSymbol: 'BTC' as Currency,
            grossAmount: parseDecimal('1'),
            netAmount: parseDecimal('0.98'),
            priceAtTxTime: createPriceAtTxTime('60000'),
          },
        ],
        []
      );

      const depositTx = createTransaction(
        3,
        '2024-02-01T14:00:00Z',
        'wallet',
        [
          {
            assetId: 'test:btc',
            assetSymbol: 'BTC' as Currency,
            grossAmount: parseDecimal('0.98'),
            priceAtTxTime: createPriceAtTxTime('60000'),
          },
        ],
        []
      );

      transactions = [purchaseTx, withdrawalTx, depositTx];

      // sourceAmount matches outflow's netAmount (what production link creation stores)
      const link = createLink(1, 2, 3, 'BTC', '0.98', '0.98');

      const fifoStrategy = new FifoStrategy();

      const result = await matchTransactions(transactions, [link], {
        calculationId: 'calc1',
        strategy: fifoStrategy,
        jurisdiction: { sameAssetTransferFeePolicy: 'disposal' },
      });

      const resultValue = assertOk(result);
      const btcResult = resultValue.assetResults.find((r) => r.assetSymbol === 'BTC');
      expect(btcResult).toBeDefined();
      expect(btcResult!.lotTransfers).toHaveLength(1);
    });
  });

  describe('13. Missing price graceful degradation', () => {
    it('should warn when crypto fee lacks price with add-to-basis policy', async () => {
      const purchaseTx = createTransaction(
        1,
        '2024-01-01T00:00:00Z',
        'kraken',
        [
          {
            assetId: 'test:btc',
            assetSymbol: 'BTC' as Currency,
            grossAmount: parseDecimal('1'),
            priceAtTxTime: createPriceAtTxTime('50000'),
          },
        ],
        []
      );

      const withdrawalTx = createTransaction(
        2,
        '2024-02-01T12:00:00Z',
        'kraken',
        [],
        [
          {
            assetId: 'test:btc',
            assetSymbol: 'BTC' as Currency,
            grossAmount: parseDecimal('1'),
            netAmount: parseDecimal('0.9995'),
            priceAtTxTime: createPriceAtTxTime('60000'),
          },
        ],
        [createFeeMovement('network', 'on-chain', 'BTC', '0.0005')] // Fee without price to test graceful degradation
      );

      const depositTx = createTransaction(
        3,
        '2024-02-01T14:00:00Z',
        'wallet',
        [
          {
            assetId: 'test:btc',
            assetSymbol: 'BTC' as Currency,
            grossAmount: parseDecimal('0.9995'),
            priceAtTxTime: createPriceAtTxTime('60000'),
          },
        ],
        []
      );

      transactions = [purchaseTx, withdrawalTx, depositTx];

      // sourceAmount matches outflow's netAmount (what production link creation stores)
      const link = createLink(1, 2, 3, 'BTC', '0.9995', '0.9995');

      const fifoStrategy = new FifoStrategy();

      const result = await matchTransactions(transactions, [link], {
        calculationId: 'calc1',
        strategy: fifoStrategy,
        jurisdiction: { sameAssetTransferFeePolicy: 'add-to-basis' },
      });

      const resultValue = assertOk(result);
      const btcResult = resultValue.assetResults.find((r) => r.assetSymbol === 'BTC');
      expect(btcResult).toBeDefined();

      const transferLot = btcResult!.lots[1];
      expect(transferLot).toBeDefined();

      const transfer = btcResult!.lotTransfers[0];
      expect(transfer?.metadata?.cryptoFeeUsdValue).toBeUndefined();

      const expectedBasis = parseDecimal('49975');
      const expectedPerUnit = expectedBasis.dividedBy(parseDecimal('0.9995'));
      expect(transferLot?.costBasisPerUnit.toFixed()).toBe(expectedPerUnit.toFixed());
    });
  });

  describe('14. Cross-assetId transfer (exchange → blockchain with different assetIds)', () => {
    it('should inherit cost basis across asset groups with different assetIds', async () => {
      // BTC purchase on exchange
      const purchaseTx = createTransaction(
        1,
        '2024-01-01T00:00:00Z',
        'kraken',
        [
          {
            assetId: 'exchange:kraken:btc',
            assetSymbol: 'BTC' as Currency,
            grossAmount: parseDecimal('1'),
            priceAtTxTime: createPriceAtTxTime('50000'),
          },
        ],
        []
      );

      // Exchange withdrawal
      const withdrawalTx = createTransaction(
        2,
        '2024-02-01T12:00:00Z',
        'kraken',
        [],
        [
          {
            assetId: 'exchange:kraken:btc',
            assetSymbol: 'BTC' as Currency,
            grossAmount: parseDecimal('1'),
            netAmount: parseDecimal('0.9995'),
            priceAtTxTime: createPriceAtTxTime('60000'),
          },
        ],
        [createFeeMovement('network', 'on-chain', 'BTC', '0.0005', '60000')]
      );

      // Blockchain deposit — different assetId
      const depositTx = createTransaction(
        3,
        '2024-02-01T14:00:00Z',
        'blockchain:bitcoin',
        [
          {
            assetId: 'blockchain:bitcoin:native',
            assetSymbol: 'BTC' as Currency,
            grossAmount: parseDecimal('0.9995'),
            priceAtTxTime: createPriceAtTxTime('60000'),
          },
        ],
        []
      );

      transactions = [purchaseTx, withdrawalTx, depositTx];

      const link = createLink(1, 2, 3, 'BTC', '0.9995', '0.9995', '98.5');

      const fifoStrategy = new FifoStrategy();

      const result = await matchTransactions(transactions, [link], {
        calculationId: 'calc1',
        strategy: fifoStrategy,
        jurisdiction: { sameAssetTransferFeePolicy: 'disposal' },
      });
      const resultValue = assertOk(result);
      const exchangeResult = resultValue.assetResults.find((r) => r.assetId === 'exchange:kraken:btc');
      const blockchainResult = resultValue.assetResults.find((r) => r.assetId === 'blockchain:bitcoin:native');

      expect(exchangeResult).toBeDefined();
      expect(blockchainResult).toBeDefined();

      // Exchange group: 1 purchase lot, 1 fee disposal, 1 transfer
      expect(exchangeResult!.lots).toHaveLength(1);
      expect(exchangeResult!.lots[0]?.costBasisPerUnit.toFixed()).toBe('50000');
      expect(exchangeResult!.lotTransfers).toHaveLength(1);

      // Blockchain group: 1 lot (transfer target) with inherited cost basis
      expect(blockchainResult!.lots).toHaveLength(1);
      const transferLot = blockchainResult!.lots[0];
      expect(transferLot?.acquisitionTransactionId).toBe(3);
      expect(transferLot?.quantity.toFixed()).toBe('0.9995');
      expect(transferLot?.costBasisPerUnit.toFixed()).toBe('50000');

      // Totals
      expect(resultValue.totalTransfersProcessed).toBe(1);
    });
  });

  describe('15. Strategy-specific transfer basis handling', () => {
    it('should use pooled ACB cost basis on transfer records under average-cost', async () => {
      const purchaseLotA = createTransaction(
        1,
        '2024-01-01T00:00:00Z',
        'kraken',
        [
          {
            assetId: 'test:btc',
            assetSymbol: 'BTC' as Currency,
            grossAmount: parseDecimal('1'),
            priceAtTxTime: createPriceAtTxTime('10000'),
          },
        ],
        []
      );
      const purchaseLotB = createTransaction(
        2,
        '2024-01-02T00:00:00Z',
        'kraken',
        [
          {
            assetId: 'test:btc',
            assetSymbol: 'BTC' as Currency,
            grossAmount: parseDecimal('1'),
            priceAtTxTime: createPriceAtTxTime('30000'),
          },
        ],
        []
      );
      const withdrawalTx = createTransaction(
        3,
        '2024-02-01T12:00:00Z',
        'kraken',
        [],
        [
          {
            assetId: 'test:btc',
            assetSymbol: 'BTC' as Currency,
            grossAmount: parseDecimal('1'),
            netAmount: parseDecimal('1'),
            priceAtTxTime: createPriceAtTxTime('40000'),
          },
        ]
      );
      const depositTx = createTransaction(
        4,
        '2024-02-01T14:00:00Z',
        'wallet',
        [
          {
            assetId: 'test:btc',
            assetSymbol: 'BTC' as Currency,
            grossAmount: parseDecimal('1'),
            priceAtTxTime: createPriceAtTxTime('40000'),
          },
        ],
        []
      );

      transactions = [purchaseLotA, purchaseLotB, withdrawalTx, depositTx];

      const link = createLink(101, 3, 4, 'BTC', '1', '1');
      const averageCostStrategy = new AverageCostStrategy();

      const result = await matchTransactions(transactions, [link], {
        calculationId: 'calc-acb-transfer',
        strategy: averageCostStrategy,
        jurisdiction: { sameAssetTransferFeePolicy: 'disposal' },
      });

      const resultValue = assertOk(result);
      const btcResult = resultValue.assetResults.find((r) => r.assetSymbol === 'BTC');
      expect(btcResult).toBeDefined();

      // Two source lots should produce two transfer records.
      expect(btcResult!.lotTransfers).toHaveLength(2);
      for (const transfer of btcResult!.lotTransfers) {
        expect(transfer.costBasisPerUnit.toFixed()).toBe('20000');
      }

      // Target lot should inherit pooled ACB.
      const transferLot = btcResult!.lots.find((lot) => lot.acquisitionTransactionId === 4);
      expect(transferLot).toBeDefined();
      expect(transferLot?.costBasisPerUnit.toFixed()).toBe('20000');
    });

    it('should preserve per-lot basis under fifo when transfer spans multiple lots', async () => {
      const purchaseLotA = createTransaction(
        1,
        '2024-01-01T00:00:00Z',
        'kraken',
        [
          {
            assetId: 'test:btc',
            assetSymbol: 'BTC' as Currency,
            grossAmount: parseDecimal('1'),
            priceAtTxTime: createPriceAtTxTime('10000'),
          },
        ],
        []
      );
      const purchaseLotB = createTransaction(
        2,
        '2024-01-02T00:00:00Z',
        'kraken',
        [
          {
            assetId: 'test:btc',
            assetSymbol: 'BTC' as Currency,
            grossAmount: parseDecimal('1'),
            priceAtTxTime: createPriceAtTxTime('30000'),
          },
        ],
        []
      );
      const withdrawalTx = createTransaction(
        3,
        '2024-02-01T12:00:00Z',
        'kraken',
        [],
        [
          {
            assetId: 'test:btc',
            assetSymbol: 'BTC' as Currency,
            grossAmount: parseDecimal('1.5'),
            netAmount: parseDecimal('1.5'),
            priceAtTxTime: createPriceAtTxTime('40000'),
          },
        ]
      );
      const depositTx = createTransaction(
        4,
        '2024-02-01T14:00:00Z',
        'wallet',
        [
          {
            assetId: 'test:btc',
            assetSymbol: 'BTC' as Currency,
            grossAmount: parseDecimal('1.5'),
            priceAtTxTime: createPriceAtTxTime('40000'),
          },
        ],
        []
      );

      transactions = [purchaseLotA, purchaseLotB, withdrawalTx, depositTx];

      const link = createLink(102, 3, 4, 'BTC', '1.5', '1.5');
      const fifoStrategy = new FifoStrategy();

      const result = await matchTransactions(transactions, [link], {
        calculationId: 'calc-fifo-transfer',
        strategy: fifoStrategy,
        jurisdiction: { sameAssetTransferFeePolicy: 'disposal' },
      });

      const resultValue = assertOk(result);
      const btcResult = resultValue.assetResults.find((r) => r.assetSymbol === 'BTC');
      expect(btcResult).toBeDefined();
      expect(btcResult!.lotTransfers).toHaveLength(2);

      const transferByBasis = new Map(
        btcResult!.lotTransfers.map((transfer) => [transfer.costBasisPerUnit.toFixed(), transfer])
      );
      expect(transferByBasis.get('10000')?.quantityTransferred.toFixed()).toBe('1');
      expect(transferByBasis.get('30000')?.quantityTransferred.toFixed()).toBe('0.5');
    });
  });
});
