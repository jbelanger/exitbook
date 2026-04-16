import type { FeeMovementDraft, TransactionLink } from '@exitbook/core';
import type { AssetMovementDraft, Transaction } from '@exitbook/core';
import { err, type Currency, parseDecimal, type Result } from '@exitbook/foundation';
import { assertErr, assertOk } from '@exitbook/foundation/test-utils';
import { getLogger } from '@exitbook/logger';
import { Decimal } from 'decimal.js';
import { describe, expect, it } from 'vitest';

import {
  createFeeMovement,
  createPriceAtTxTime,
  createTransactionFromMovements,
  materializeTestTransaction,
} from '../../../../__tests__/test-utils.js';
import { buildAccountingModelFromPreparedBuild } from '../../../../accounting-model/build-accounting-model-from-transactions.js';
import {
  prepareAccountingTransactions,
  type PreparedAccountingTransaction,
} from '../../../../accounting-model/prepare-accounting-transactions.js';
import { validateTransferLinks } from '../../../../accounting-model/validated-transfer-links.js';
import { FifoStrategy } from '../../strategies/fifo-strategy.js';
import { LotMatcher } from '../lot-matcher.js';

describe('LotMatcher - Transfer-Aware Integration Tests (ADR-004 Phase 2)', () => {
  const createTransaction = (
    id: number,
    datetime: string,
    source: string,
    inflows: AssetMovementDraft[] = [],
    outflows: AssetMovementDraft[] = [],
    fees: FeeMovementDraft[] = []
  ): Transaction =>
    createTransactionFromMovements(id, datetime, { inflows, outflows }, fees, {
      platformKey: source,
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
    confidenceScore = '98.5',
    impliedFeeAmount?: string,
    metadata?: TransactionLink['metadata']
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
    impliedFeeAmount: impliedFeeAmount ? parseDecimal(impliedFeeAmount) : undefined,
    matchCriteria: {
      assetMatch: true,
      amountSimilarity: parseDecimal('0.99'),
      timingValid: true,
      timingHours: 0.5,
    },
    status: 'confirmed',
    createdAt: new Date('2024-01-01'),
    updatedAt: new Date('2024-01-01'),
    ...(metadata ? { metadata } : {}),
  });

  const matcher = new LotMatcher();
  const logger = getLogger('lot-matcher-transfers.test');

  let transactions: Transaction[] = [];

  async function matchTransactions(
    rawTransactions: Transaction[],
    confirmedLinks: TransactionLink[],
    config: Parameters<LotMatcher['match']>[2]
  ): Promise<Result<Awaited<ReturnType<LotMatcher['match']>> extends Result<infer T, infer _E> ? T : never, Error>> {
    const scopedResult = prepareAccountingTransactions(rawTransactions, logger);
    if (scopedResult.isErr()) {
      return err(scopedResult.error);
    }
    const scoped = scopedResult.value;
    const accountingModelResult = buildAccountingModelFromPreparedBuild(scoped);
    if (accountingModelResult.isErr()) {
      return err(accountingModelResult.error);
    }
    const hydratedLinks = hydrateTestLinks(scoped.transactions, confirmedLinks);
    const validatedLinksResult = validateTransferLinks(
      accountingModelResult.value.accountingTransactionViews,
      hydratedLinks
    );
    if (validatedLinksResult.isErr()) {
      return err(validatedLinksResult.error);
    }

    return matcher.match(accountingModelResult.value, validatedLinksResult.value, config);
  }

  function hydrateTestLinks(
    preparedTransactions: PreparedAccountingTransaction[],
    confirmedLinks: TransactionLink[]
  ): TransactionLink[] {
    const usageByHint = new Map<string, number>();

    return confirmedLinks.map((link) => {
      const sourceTransaction = preparedTransactions.find(
        (preparedTransaction) => preparedTransaction.tx.id === link.sourceTransactionId
      );
      const targetTransaction = preparedTransactions.find(
        (preparedTransaction) => preparedTransaction.tx.id === link.targetTransactionId
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
    preparedTransaction: PreparedAccountingTransaction,
    movementType: 'inflow' | 'outflow',
    fingerprintHint: string,
    usageByHint: Map<string, number>
  ) {
    const positionMatch = fingerprintHint.match(/:(inflow|outflow):(\d+)$/);
    const hintedPosition = positionMatch ? Number.parseInt(positionMatch[2]!, 10) : 0;
    const usageKey = `${preparedTransaction.tx.id}:${movementType}:${fingerprintHint}`;
    const usageOffset = usageByHint.get(usageKey) ?? 0;
    const position = hintedPosition + usageOffset;
    const movements =
      movementType === 'inflow' ? preparedTransaction.movements.inflows : preparedTransaction.movements.outflows;
    const movement = movements[position];
    if (!movement) {
      throw new Error(
        `Failed to resolve scoped ${movementType} movement at position ${position} for transaction ${preparedTransaction.tx.id}`
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
      expect(transfer?.metadata?.sameAssetFeeUsdValue).toBeDefined();
      expect(new Decimal(transfer!.metadata!.sameAssetFeeUsdValue!).toFixed()).toBe('30');
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

    it('treats link implied fee amounts as same-asset transfer fees', async () => {
      const purchaseTx = createTransaction(
        1,
        '2024-01-01T00:00:00Z',
        'kraken',
        [
          {
            assetId: 'test:eth',
            assetSymbol: 'ETH' as Currency,
            grossAmount: parseDecimal('1'),
            priceAtTxTime: createPriceAtTxTime('3000'),
          },
        ],
        []
      );

      const withdrawalTx = createTransaction(
        2,
        '2024-05-24T05:14:17.000Z',
        'arbitrum',
        [],
        [
          {
            assetId: 'test:eth',
            assetSymbol: 'ETH' as Currency,
            grossAmount: parseDecimal('0.04'),
            netAmount: parseDecimal('0.04'),
            priceAtTxTime: createPriceAtTxTime('3500'),
          },
        ],
        []
      );

      const depositTx = createTransaction(
        3,
        '2024-05-24T05:14:47.000Z',
        'ethereum',
        [
          {
            assetId: 'test:eth',
            assetSymbol: 'ETH' as Currency,
            grossAmount: parseDecimal('0.038410276629335232'),
            priceAtTxTime: createPriceAtTxTime('3500'),
          },
        ],
        []
      );

      transactions = [purchaseTx, withdrawalTx, depositTx];

      const link = createLink(1, 2, 3, 'ETH', '0.04', '0.038410276629335232', '1', '0.001589723370664768');

      const fifoStrategy = new FifoStrategy();

      const result = await matchTransactions(transactions, [link], {
        calculationId: 'calc1',
        strategy: fifoStrategy,
        jurisdiction: { sameAssetTransferFeePolicy: 'disposal' },
      });

      const resultValue = assertOk(result);
      const ethResult = resultValue.assetResults.find((r) => r.assetSymbol === 'ETH');
      expect(ethResult).toBeDefined();

      expect(ethResult!.lotTransfers).toHaveLength(1);
      expect(ethResult!.lotTransfers[0]?.quantityTransferred.eq(parseDecimal('0.038410276629335232'))).toBe(true);
      expect(
        ethResult!.disposals
          .reduce((sum, disposal) => sum.plus(disposal.quantityDisposed), parseDecimal('0'))
          .eq(parseDecimal('0.001589723370664768'))
      ).toBe(true);
      expect(ethResult!.lots[1]?.quantity.eq(parseDecimal('0.038410276629335232'))).toBe(true);
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
      expect(transfer?.metadata?.sameAssetFeeUsdValue).toBeUndefined();

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

  describe('Explained target residuals', () => {
    it('creates an acquisition lot for an exact explained residual on a transfer target', async () => {
      const sharedHash = '0c62fbdfe97c5e94346f0976114b769b45080dc5d9e0c03ca33ad112dc8f25cf';

      const chainAcquisitionTx = createTransactionFromMovements(
        1,
        '2024-07-20T12:00:00Z',
        {
          inflows: [
            {
              assetId: 'blockchain:cardano:native',
              assetSymbol: 'ADA' as Currency,
              grossAmount: parseDecimal('2669.193991'),
              priceAtTxTime: createPriceAtTxTime('0.75'),
            },
          ],
        },
        [],
        { platformKey: 'cardano', platformKind: 'blockchain', category: 'transfer', type: 'deposit' }
      );

      const chainWithdrawalTx = materializeTestTransaction({
        ...createTransactionFromMovements(
          2,
          '2024-07-25T20:32:02Z',
          {
            outflows: [
              {
                assetId: 'blockchain:cardano:native',
                assetSymbol: 'ADA' as Currency,
                grossAmount: parseDecimal('2669.193991'),
                netAmount: parseDecimal('2669.193991'),
                priceAtTxTime: createPriceAtTxTime('0.75'),
              },
            ],
          },
          [],
          { platformKey: 'cardano', platformKind: 'blockchain', category: 'transfer', type: 'withdrawal' }
        ),
        diagnostics: [
          {
            code: 'unattributed_staking_reward_component',
            severity: 'info',
            message: 'Includes wallet-scoped staking reward component.',
            metadata: {
              amount: '10.524451',
              assetSymbol: 'ADA',
              movementRole: 'staking_reward',
            },
          },
        ],
        blockchain: {
          name: 'cardano',
          transaction_hash: sharedHash,
          is_confirmed: true,
        },
      });

      const exchangeDepositTx = materializeTestTransaction({
        ...createTransactionFromMovements(
          3,
          '2024-07-25T20:35:47Z',
          {
            inflows: [
              {
                assetId: 'exchange:kucoin:ada',
                assetSymbol: 'ADA' as Currency,
                grossAmount: parseDecimal('2679.718442'),
                priceAtTxTime: createPriceAtTxTime('0.75'),
              },
            ],
          },
          [],
          { platformKey: 'kucoin', platformKind: 'exchange', category: 'transfer', type: 'deposit' }
        ),
        blockchain: {
          name: 'cardano',
          transaction_hash: sharedHash,
          is_confirmed: true,
        },
      });

      transactions = [chainAcquisitionTx, chainWithdrawalTx, exchangeDepositTx];

      const link = createLink(50, 2, 3, 'ADA', '2669.193991', '2669.193991', '100', undefined, {
        partialMatch: true,
        fullSourceAmount: '2669.193991',
        fullTargetAmount: '2679.718442',
        consumedAmount: '2669.193991',
        explainedTargetResidualAmount: '10.524451',
        explainedTargetResidualRole: 'staking_reward',
      });

      const result = await matchTransactions(transactions, [link], {
        calculationId: 'calc1',
        strategy: new FifoStrategy(),
        jurisdiction: { sameAssetTransferFeePolicy: 'disposal' },
      });

      const resultValue = assertOk(result);
      const kucoinAda = resultValue.assetResults.find((assetResult) => assetResult.assetId === 'exchange:kucoin:ada');
      expect(kucoinAda).toBeDefined();
      expect(kucoinAda!.lots).toHaveLength(2);
      expect(kucoinAda!.lots.map((lot) => lot.quantity.toFixed())).toEqual(['2669.193991', '10.524451']);
    });

    it('does not create an acquisition lot when explained residual metadata does not match the uncovered quantity', async () => {
      const sharedHash = '0c62fbdfe97c5e94346f0976114b769b45080dc5d9e0c03ca33ad112dc8f25cf';

      const chainAcquisitionTx = createTransactionFromMovements(
        1,
        '2024-07-20T12:00:00Z',
        {
          inflows: [
            {
              assetId: 'blockchain:cardano:native',
              assetSymbol: 'ADA' as Currency,
              grossAmount: parseDecimal('2669.193991'),
              priceAtTxTime: createPriceAtTxTime('0.75'),
            },
          ],
        },
        [],
        { platformKey: 'cardano', platformKind: 'blockchain', category: 'transfer', type: 'deposit' }
      );

      const chainWithdrawalTx = materializeTestTransaction({
        ...createTransactionFromMovements(
          2,
          '2024-07-25T20:32:02Z',
          {
            outflows: [
              {
                assetId: 'blockchain:cardano:native',
                assetSymbol: 'ADA' as Currency,
                grossAmount: parseDecimal('2669.193991'),
                netAmount: parseDecimal('2669.193991'),
                priceAtTxTime: createPriceAtTxTime('0.75'),
              },
            ],
          },
          [],
          { platformKey: 'cardano', platformKind: 'blockchain', category: 'transfer', type: 'withdrawal' }
        ),
        diagnostics: [
          {
            code: 'unattributed_staking_reward_component',
            severity: 'info',
            message: 'Includes wallet-scoped staking reward component.',
            metadata: {
              amount: '10.524451',
              assetSymbol: 'ADA',
              movementRole: 'staking_reward',
            },
          },
        ],
        blockchain: {
          name: 'cardano',
          transaction_hash: sharedHash,
          is_confirmed: true,
        },
      });

      const exchangeDepositTx = materializeTestTransaction({
        ...createTransactionFromMovements(
          3,
          '2024-07-25T20:35:47Z',
          {
            inflows: [
              {
                assetId: 'exchange:kucoin:ada',
                assetSymbol: 'ADA' as Currency,
                grossAmount: parseDecimal('2679.718442'),
                priceAtTxTime: createPriceAtTxTime('0.75'),
              },
            ],
          },
          [],
          { platformKey: 'kucoin', platformKind: 'exchange', category: 'transfer', type: 'deposit' }
        ),
        blockchain: {
          name: 'cardano',
          transaction_hash: sharedHash,
          is_confirmed: true,
        },
      });

      transactions = [chainAcquisitionTx, chainWithdrawalTx, exchangeDepositTx];

      const link = createLink(50, 2, 3, 'ADA', '2669.193991', '2669.193991', '100', undefined, {
        partialMatch: true,
        fullSourceAmount: '2669.193991',
        fullTargetAmount: '2679.718442',
        consumedAmount: '2669.193991',
        explainedTargetResidualAmount: '10.000000',
        explainedTargetResidualRole: 'staking_reward',
      });

      const result = await matchTransactions(transactions, [link], {
        calculationId: 'calc1',
        strategy: new FifoStrategy(),
        jurisdiction: { sameAssetTransferFeePolicy: 'disposal' },
      });

      const resultValue = assertOk(result);
      const kucoinAda = resultValue.assetResults.find((assetResult) => assetResult.assetId === 'exchange:kucoin:ada');
      expect(kucoinAda).toBeDefined();
      expect(kucoinAda!.lots).toHaveLength(1);
      expect(kucoinAda!.lots.map((lot) => lot.quantity.toFixed())).toEqual(['2669.193991']);
    });
  });
});
