import type { FeeMovement } from '@exitbook/core';
import { Currency, parseDecimal, type AssetMovement, type UniversalTransactionData } from '@exitbook/core';
import type { TransactionRepository } from '@exitbook/data';
import { Decimal } from 'decimal.js';
import { describe, expect, it, vi } from 'vitest';

import type { TransactionLink } from '../../linking/types.js';
import type { TransactionLinkRepository } from '../../persistence/transaction-link-repository.js';
import { LotMatcher } from '../lot-matcher.js';
import { AverageCostStrategy } from '../strategies/average-cost-strategy.js';
import { FifoStrategy } from '../strategies/fifo-strategy.js';

describe('LotMatcher - Transfer-Aware Integration Tests (ADR-004 Phase 2)', () => {
  const createPriceAtTxTime = (amount: string, currency = 'USD') => ({
    price: { amount: parseDecimal(amount), currency: Currency.create(currency) },
    source: 'manual' as const,
    fetchedAt: new Date('2024-01-01'),
  });

  const createTransaction = (
    id: number,
    datetime: string,
    source: string,
    inflows: AssetMovement[] = [],
    outflows: AssetMovement[] = [],
    fees: FeeMovement[] = []
  ): UniversalTransactionData => ({
    id,
    accountId: 1,
    externalId: `tx${id}`,
    datetime,
    timestamp: Date.parse(datetime),
    source,
    sourceType: 'exchange',
    status: 'success',
    movements: { inflows, outflows },
    fees,
    operation: { category: 'transfer', type: 'withdrawal' },
  });

  const createLink = (
    id: string,
    sourceTransactionId: number,
    targetTransactionId: number,
    assetSymbol: string,
    sourceAmount: string,
    targetAmount: string,
    confidenceScore = '98.5',
    sourceAssetId?: string,
    targetAssetId?: string
  ): TransactionLink => ({
    id,
    sourceTransactionId,
    targetTransactionId,
    assetSymbol: assetSymbol,
    sourceAssetId: sourceAssetId ?? `test:${assetSymbol.toLowerCase()}`,
    targetAssetId: targetAssetId ?? `test:${assetSymbol.toLowerCase()}`,
    sourceAmount: parseDecimal(sourceAmount),
    targetAmount: parseDecimal(targetAmount),
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

  function createFeeMovement(
    scope: 'network' | 'platform' | 'spread' | 'tax' | 'other',
    settlement: 'on-chain' | 'balance' | 'external',
    assetSymbol: string,
    amount: string,
    priceAmount?: string,
    priceCurrency = 'USD'
  ): FeeMovement {
    const movement: FeeMovement = {
      scope,
      settlement,
      assetId: `test:${assetSymbol.toLowerCase()}`,
      assetSymbol: assetSymbol,
      amount: new Decimal(amount),
    };

    if (priceAmount !== undefined) {
      movement.priceAtTxTime = {
        price: {
          amount: new Decimal(priceAmount),
          currency: Currency.create(priceCurrency),
        },
        source: 'test',
        fetchedAt: new Date(),
      };
    }

    return movement;
  }

  const mockTransactionRepo = () => {
    const repo: Partial<TransactionRepository> = {
      findById: vi.fn().mockImplementation((id: number) => {
        const sourceTx = transactions.find((t) => t.id === id);
        return sourceTx
          ? { isOk: () => true, isErr: () => false, value: sourceTx }
          : { isOk: () => false, isErr: () => true, error: new Error('Not found') };
      }),
    };
    return repo as TransactionRepository;
  };

  const mockLinkRepo = (links: TransactionLink[]) => {
    const repo: Partial<TransactionLinkRepository> = {
      findAll: vi.fn().mockResolvedValue({
        isOk: () => true,
        isErr: () => false,
        value: links,
      }),
    };
    return repo as TransactionLinkRepository;
  };

  let transactions: UniversalTransactionData[] = [];

  describe('1. Timestamp inconsistencies - reversed deposit/withdrawal', () => {
    it('should process transfer correctly when target timestamp < source timestamp', async () => {
      const purchaseTx = createTransaction(
        1,
        '2024-01-01T00:00:00Z',
        'kraken',
        [
          {
            assetId: 'test:btc',
            assetSymbol: 'BTC',
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
            assetSymbol: 'BTC',
            grossAmount: parseDecimal('1'),
            netAmount: parseDecimal('0.9995'),
            priceAtTxTime: createPriceAtTxTime('60000'),
          },
        ],
        [createFeeMovement('network', 'on-chain', 'BTC', '0.0005', '60000')]
      );

      const depositTx = createTransaction(
        3,
        '2024-02-01T11:30:00Z',
        'blockchain-wallet',
        [
          {
            assetId: 'test:btc',
            assetSymbol: 'BTC',
            grossAmount: parseDecimal('0.9995'),
            priceAtTxTime: createPriceAtTxTime('60000'),
          },
        ],
        []
      );

      transactions = [purchaseTx, withdrawalTx, depositTx];

      // sourceAmount matches outflow's netAmount (what production link creation stores)
      const link = createLink('link1', 2, 3, 'BTC', '0.9995', '0.9995');

      const txRepo = mockTransactionRepo();
      const linkRepo = mockLinkRepo([link]);
      const matcher = new LotMatcher(txRepo, linkRepo);
      const fifoStrategy = new FifoStrategy();

      const result = await matcher.match(transactions, {
        calculationId: 'calc1',
        strategy: fifoStrategy,
        jurisdiction: { sameAssetTransferFeePolicy: 'disposal' },
      });

      if (result.isErr()) {
        console.error('Test #1 error:', result.error.message);
      }
      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        const btcResult = result.value.assetResults.find((r) => r.assetSymbol === 'BTC');
        expect(btcResult).toBeDefined();
        expect(btcResult!.lots).toHaveLength(2);
        expect(btcResult!.disposals).toHaveLength(1);
        expect(btcResult!.lotTransfers).toHaveLength(1);

        const transferLot = btcResult!.lots[1];
        expect(transferLot?.acquisitionTransactionId).toBe(3);
        expect(transferLot?.quantity.toFixed()).toBe('0.9995');

        const feeDisposal = btcResult!.disposals[0];
        expect(feeDisposal?.quantityDisposed.toFixed()).toBe('0.0005');
      }
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
            assetSymbol: 'BTC',
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
            assetSymbol: 'BTC',
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
            assetSymbol: 'BTC',
            grossAmount: parseDecimal('0.9995'),
            priceAtTxTime: createPriceAtTxTime('60000'),
          },
        ],
        []
      );

      transactions = [purchaseTx, withdrawalTx, depositTx];

      // sourceAmount matches outflow's netAmount (what production link creation stores)
      const link = createLink('link1', 2, 3, 'BTC', '0.9995', '0.9995');

      const txRepo = mockTransactionRepo();
      const linkRepo = mockLinkRepo([link]);
      const matcher = new LotMatcher(txRepo, linkRepo);
      const fifoStrategy = new FifoStrategy();

      const result = await matcher.match(transactions, {
        calculationId: 'calc1',
        strategy: fifoStrategy,
        jurisdiction: { sameAssetTransferFeePolicy: 'disposal' },
      });

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        const btcResult = result.value.assetResults.find((r) => r.assetSymbol === 'BTC');
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
      }
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
            assetSymbol: 'BTC',
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
            assetSymbol: 'BTC',
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
            assetSymbol: 'BTC',
            grossAmount: parseDecimal('0.9995'),
            priceAtTxTime: createPriceAtTxTime('60000'),
          },
        ],
        []
      );

      transactions = [purchaseTx, withdrawalTx, depositTx];

      // sourceAmount matches outflow's netAmount (what production link creation stores)
      const link = createLink('link1', 2, 3, 'BTC', '0.9995', '0.9995');

      const txRepo = mockTransactionRepo();
      const linkRepo = mockLinkRepo([link]);
      const matcher = new LotMatcher(txRepo, linkRepo);
      const fifoStrategy = new FifoStrategy();

      const result = await matcher.match(transactions, {
        calculationId: 'calc1',
        strategy: fifoStrategy,
        jurisdiction: { sameAssetTransferFeePolicy: 'add-to-basis' },
      });

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        const btcResult = result.value.assetResults.find((r) => r.assetSymbol === 'BTC');
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
      }
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
            assetSymbol: 'BTC',
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
            assetSymbol: 'BTC',
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
            assetSymbol: 'BTC',
            grossAmount: parseDecimal('0.9995'),
            priceAtTxTime: createPriceAtTxTime('60000'),
          },
        ],
        []
      );

      transactions = [purchaseTx, withdrawalTx, depositTx];

      // sourceAmount matches outflow's netAmount (what production link creation stores)
      const link = createLink('link1', 2, 3, 'BTC', '0.9995', '0.9995');

      const txRepo = mockTransactionRepo();
      const linkRepo = mockLinkRepo([link]);
      const matcher = new LotMatcher(txRepo, linkRepo);
      const fifoStrategy = new FifoStrategy();

      const result = await matcher.match(transactions, {
        calculationId: 'calc1',
        strategy: fifoStrategy,
        jurisdiction: { sameAssetTransferFeePolicy: 'disposal' },
      });

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        const btcResult = result.value.assetResults.find((r) => r.assetSymbol === 'BTC');
        expect(btcResult).toBeDefined();

        const transferLot = btcResult!.lots[1];
        expect(transferLot?.acquisitionTransactionId).toBe(3);
        const expectedBasis = parseDecimal('49975').plus(new Decimal('1.5'));
        const expectedPerUnit = expectedBasis.dividedBy(parseDecimal('0.9995'));
        expect(transferLot?.costBasisPerUnit.toFixed()).toBe(expectedPerUnit.toFixed());
      }
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
            assetSymbol: 'BTC',
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
            assetSymbol: 'BTC',
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
            assetSymbol: 'BTC',
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
            assetSymbol: 'BTC',
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
            assetSymbol: 'BTC',
            grossAmount: parseDecimal('0.9992'),
            priceAtTxTime: createPriceAtTxTime('65000'),
          },
        ],
        []
      );

      transactions = [purchaseTx, withdrawal1Tx, deposit1Tx, withdrawal2Tx, deposit2Tx];

      // sourceAmount matches outflow's netAmount (what production link creation stores)
      const link1 = createLink('link1', 2, 3, 'BTC', '0.9995', '0.9995');
      const link2 = createLink('link2', 4, 5, 'BTC', '0.9992', '0.9992');

      const txRepo = mockTransactionRepo();
      const linkRepo = mockLinkRepo([link1, link2]);
      const matcher = new LotMatcher(txRepo, linkRepo);
      const fifoStrategy = new FifoStrategy();

      const result = await matcher.match(transactions, {
        calculationId: 'calc1',
        strategy: fifoStrategy,
        jurisdiction: { sameAssetTransferFeePolicy: 'disposal' },
      });

      if (result.isErr()) {
        console.error('Test #5 error:', result.error.message);
      }
      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        const btcResult = result.value.assetResults.find((r) => r.assetSymbol === 'BTC');
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
      }
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
            assetSymbol: 'BTC',
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
            assetSymbol: 'ETH',
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
            assetSymbol: 'BTC',
            grossAmount: parseDecimal('1'),
            priceAtTxTime: createPriceAtTxTime('60000'),
          },
          {
            assetId: 'test:eth',
            assetSymbol: 'ETH',
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
            assetSymbol: 'BTC',
            grossAmount: parseDecimal('1'),
            priceAtTxTime: createPriceAtTxTime('60000'),
          },
        ],
        []
      );

      transactions = [purchaseBTCTx, purchaseETHTx, withdrawalTx, depositTx];

      const link = createLink('link1', 3, 4, 'BTC', '1.0', '1.0');

      const txRepo = mockTransactionRepo();
      const linkRepo = mockLinkRepo([link]);
      const matcher = new LotMatcher(txRepo, linkRepo);
      const fifoStrategy = new FifoStrategy();

      const result = await matcher.match(transactions, {
        calculationId: 'calc1',
        strategy: fifoStrategy,
        jurisdiction: { sameAssetTransferFeePolicy: 'disposal' },
      });

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        const btcResult = result.value.assetResults.find((r) => r.assetSymbol === 'BTC');
        const ethResult = result.value.assetResults.find((r) => r.assetSymbol === 'ETH');

        expect(btcResult).toBeDefined();
        expect(ethResult).toBeDefined();

        expect(btcResult!.lotTransfers).toHaveLength(1);
        expect(btcResult!.disposals).toHaveLength(0);

        expect(ethResult!.disposals).toHaveLength(1);
        const ethFeeDisposal = ethResult!.disposals[0];
        expect(ethFeeDisposal?.quantityDisposed.toFixed()).toBe('0.01');
        expect(ethFeeDisposal?.proceedsPerUnit.toFixed()).toBe('3500');
      }
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
            assetSymbol: 'BTC',
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
            assetSymbol: 'BTC',
            grossAmount: parseDecimal('1'),
            netAmount: parseDecimal('0.99975'),
            priceAtTxTime: createPriceAtTxTime('60000'),
          },
          {
            assetId: 'test:btc',
            assetSymbol: 'BTC',
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
            assetSymbol: 'BTC',
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
            assetSymbol: 'BTC',
            grossAmount: parseDecimal('0.99975'),
            priceAtTxTime: createPriceAtTxTime('60000'),
          },
        ],
        []
      );

      transactions = [purchaseTx, batchedWithdrawalTx, deposit1Tx, deposit2Tx];

      // sourceAmount matches outflow's netAmount (what production link creation stores)
      const link1 = createLink('link1', 2, 3, 'BTC', '0.99975', '0.99975');
      const link2 = createLink('link2', 2, 4, 'BTC', '0.99975', '0.99975');

      const txRepo = mockTransactionRepo();
      const linkRepo = mockLinkRepo([link1, link2]);
      const matcher = new LotMatcher(txRepo, linkRepo);
      const fifoStrategy = new FifoStrategy();

      const result = await matcher.match(transactions, {
        calculationId: 'calc1',
        strategy: fifoStrategy,
        jurisdiction: { sameAssetTransferFeePolicy: 'disposal' },
      });

      if (result.isErr()) {
        console.error('Test #7 error:', result.error.message);
      }
      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        const btcResult = result.value.assetResults.find((r) => r.assetSymbol === 'BTC');
        expect(btcResult).toBeDefined();

        expect(btcResult!.lots).toHaveLength(3);
        expect(btcResult!.lotTransfers).toHaveLength(2);

        const transferLot1 = btcResult!.lots[1];
        expect(transferLot1?.acquisitionTransactionId).toBe(3);
        expect(transferLot1?.quantity.toFixed()).toBe('0.99975');

        const transferLot2 = btcResult!.lots[2];
        expect(transferLot2?.acquisitionTransactionId).toBe(4);
        expect(transferLot2?.quantity.toFixed()).toBe('0.99975');
      }
    });
  });

  describe('8. Multiple inflows', () => {
    it('should handle multiple inflows of same asset aggregated', async () => {
      const purchaseTx = createTransaction(
        1,
        '2024-01-01T00:00:00Z',
        'exchange-a',
        [
          {
            assetId: 'test:btc',
            assetSymbol: 'BTC',
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
            assetSymbol: 'BTC',
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
            assetSymbol: 'BTC',
            grossAmount: parseDecimal('0.5'),
            priceAtTxTime: createPriceAtTxTime('60000'),
          },
          {
            assetId: 'test:btc',
            assetSymbol: 'BTC',
            grossAmount: parseDecimal('0.4995'),
            priceAtTxTime: createPriceAtTxTime('60000'),
          },
        ],
        []
      );

      transactions = [purchaseTx, withdrawalTx, depositTx];

      // sourceAmount matches outflow's netAmount (what production link creation stores)
      const link = createLink('link1', 2, 3, 'BTC', '0.9995', '0.9995');

      const txRepo = mockTransactionRepo();
      const linkRepo = mockLinkRepo([link]);
      const matcher = new LotMatcher(txRepo, linkRepo);
      const fifoStrategy = new FifoStrategy();

      const result = await matcher.match(transactions, {
        calculationId: 'calc1',
        strategy: fifoStrategy,
        jurisdiction: { sameAssetTransferFeePolicy: 'disposal' },
      });

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        const btcResult = result.value.assetResults.find((r) => r.assetSymbol === 'BTC');
        expect(btcResult).toBeDefined();

        expect(btcResult!.lots).toHaveLength(2);
        expect(btcResult!.lotTransfers).toHaveLength(1);

        const transferLot = btcResult!.lots[1];
        expect(transferLot?.quantity.toFixed()).toBe('0.9995');
        expect(transferLot?.acquisitionTransactionId).toBe(3);
      }
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
            assetSymbol: 'BTC',
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
            assetSymbol: 'BTC',
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
            assetSymbol: 'BTC',
            grossAmount: parseDecimal('0.9995'),
            priceAtTxTime: createPriceAtTxTime('60000'),
          },
        ],
        []
      );

      transactions = [purchaseTx, withdrawalTx, depositTx];

      // sourceAmount matches outflow's netAmount (what production link creation stores)
      const link = createLink('link1', 2, 3, 'BTC', '0.9995', '0.9995');

      const txRepo = mockTransactionRepo();
      const linkRepo = mockLinkRepo([link]);
      const matcher = new LotMatcher(txRepo, linkRepo);
      const fifoStrategy = new FifoStrategy();

      const result = await matcher.match(transactions, {
        calculationId: 'calc1',
        strategy: fifoStrategy,
        jurisdiction: { sameAssetTransferFeePolicy: 'disposal' },
      });

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        const btcResult = result.value.assetResults.find((r) => r.assetSymbol === 'BTC');
        expect(btcResult).toBeDefined();

        expect(btcResult!.disposals).toHaveLength(1);
        const feeDisposal = btcResult!.disposals[0];
        expect(feeDisposal?.quantityDisposed.toFixed()).toBe('0.0005');

        expect(btcResult!.lotTransfers).toHaveLength(1);
        const transfer = btcResult!.lotTransfers[0];
        expect(transfer?.quantityTransferred.toFixed()).toBe('0.9995');
      }
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
            assetSymbol: 'BTC',
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
            assetSymbol: 'BTC',
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
            assetSymbol: 'BTC',
            grossAmount: parseDecimal('0.9875'),
            priceAtTxTime: createPriceAtTxTime('60000'),
          },
        ],
        []
      );

      transactions = [purchaseTx, withdrawalTx, depositTx];

      // sourceAmount matches outflow's netAmount (what production link creation stores)
      const link = createLink('link1', 2, 3, 'BTC', '0.9875', '0.9875');

      const txRepo = mockTransactionRepo();
      const linkRepo = mockLinkRepo([link]);
      const matcher = new LotMatcher(txRepo, linkRepo);
      const fifoStrategy = new FifoStrategy();

      const result = await matcher.match(transactions, {
        calculationId: 'calc1',
        strategy: fifoStrategy,
        jurisdiction: { sameAssetTransferFeePolicy: 'disposal' },
      });

      if (result.isErr()) {
        console.error('Test #10 error:', result.error.message);
      }
      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        const btcResult = result.value.assetResults.find((r) => r.assetSymbol === 'BTC');
        expect(btcResult).toBeDefined();
        expect(btcResult!.lotTransfers).toHaveLength(1);
      }
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
            assetSymbol: 'BTC',
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
            assetSymbol: 'BTC',
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
            assetSymbol: 'BTC',
            grossAmount: parseDecimal('0.94'),
            priceAtTxTime: createPriceAtTxTime('60000'),
          },
        ],
        []
      );

      transactions = [purchaseTx, withdrawalTx, depositTx];

      // sourceAmount matches outflow's netAmount (what production link creation stores)
      const link = createLink('link1', 2, 3, 'BTC', '0.94', '0.94');

      const txRepo = mockTransactionRepo();
      const linkRepo = mockLinkRepo([link]);
      const matcher = new LotMatcher(txRepo, linkRepo);
      const fifoStrategy = new FifoStrategy();

      const result = await matcher.match(transactions, {
        calculationId: 'calc1',
        strategy: fifoStrategy,
        jurisdiction: { sameAssetTransferFeePolicy: 'disposal' },
      });

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value.errors).toHaveLength(1);
        expect(result.value.errors[0]!.error).toContain('Outflow fee validation failed');
        expect(result.value.errors[0]!.error).toContain('hidden fee');
        expect(result.value.errors[0]!.error).toContain('Exceeds error threshold');
      }
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
            assetSymbol: 'BTC',
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
            assetSymbol: 'BTC',
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
            assetSymbol: 'BTC',
            grossAmount: parseDecimal('0.98'),
            priceAtTxTime: createPriceAtTxTime('60000'),
          },
        ],
        []
      );

      transactions = [purchaseTx, withdrawalTx, depositTx];

      // sourceAmount matches outflow's netAmount (what production link creation stores)
      const link = createLink('link1', 2, 3, 'BTC', '0.98', '0.98');

      const txRepo = mockTransactionRepo();
      const linkRepo = mockLinkRepo([link]);
      const matcher = new LotMatcher(txRepo, linkRepo);
      const fifoStrategy = new FifoStrategy();

      const result = await matcher.match(transactions, {
        calculationId: 'calc1',
        strategy: fifoStrategy,
        jurisdiction: { sameAssetTransferFeePolicy: 'disposal' },
      });

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        const btcResult = result.value.assetResults.find((r) => r.assetSymbol === 'BTC');
        expect(btcResult).toBeDefined();
        expect(btcResult!.lotTransfers).toHaveLength(1);
      }
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
            assetSymbol: 'BTC',
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
            assetSymbol: 'BTC',
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
            assetSymbol: 'BTC',
            grossAmount: parseDecimal('0.9995'),
            priceAtTxTime: createPriceAtTxTime('60000'),
          },
        ],
        []
      );

      transactions = [purchaseTx, withdrawalTx, depositTx];

      // sourceAmount matches outflow's netAmount (what production link creation stores)
      const link = createLink('link1', 2, 3, 'BTC', '0.9995', '0.9995');

      const txRepo = mockTransactionRepo();
      const linkRepo = mockLinkRepo([link]);
      const matcher = new LotMatcher(txRepo, linkRepo);
      const fifoStrategy = new FifoStrategy();

      const result = await matcher.match(transactions, {
        calculationId: 'calc1',
        strategy: fifoStrategy,
        jurisdiction: { sameAssetTransferFeePolicy: 'add-to-basis' },
      });

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        const btcResult = result.value.assetResults.find((r) => r.assetSymbol === 'BTC');
        expect(btcResult).toBeDefined();

        const transferLot = btcResult!.lots[1];
        expect(transferLot).toBeDefined();

        const transfer = btcResult!.lotTransfers[0];
        expect(transfer?.metadata?.cryptoFeeUsdValue).toBeUndefined();

        const expectedBasis = parseDecimal('49975');
        const expectedPerUnit = expectedBasis.dividedBy(parseDecimal('0.9995'));
        expect(transferLot?.costBasisPerUnit.toFixed()).toBe(expectedPerUnit.toFixed());
      }
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
            assetSymbol: 'BTC',
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
            assetSymbol: 'BTC',
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
            assetSymbol: 'BTC',
            grossAmount: parseDecimal('0.9995'),
            priceAtTxTime: createPriceAtTxTime('60000'),
          },
        ],
        []
      );

      transactions = [purchaseTx, withdrawalTx, depositTx];

      // Link with different sourceAssetId / targetAssetId
      const link = createLink(
        'link1',
        2,
        3,
        'BTC',
        '0.9995',
        '0.9995',
        '98.5',
        'exchange:kraken:btc',
        'blockchain:bitcoin:native'
      );

      const txRepo = mockTransactionRepo();
      const linkRepo = mockLinkRepo([link]);
      const matcher = new LotMatcher(txRepo, linkRepo);
      const fifoStrategy = new FifoStrategy();

      const result = await matcher.match(transactions, {
        calculationId: 'calc1',
        strategy: fifoStrategy,
        jurisdiction: { sameAssetTransferFeePolicy: 'disposal' },
      });

      if (result.isErr()) {
        console.error('Test #14 error:', result.error.message);
      }
      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        const exchangeResult = result.value.assetResults.find((r) => r.assetId === 'exchange:kraken:btc');
        const blockchainResult = result.value.assetResults.find((r) => r.assetId === 'blockchain:bitcoin:native');

        expect(exchangeResult).toBeDefined();
        expect(blockchainResult).toBeDefined();

        // Exchange group: 1 purchase lot, 1 fee disposal, 1 transfer
        expect(exchangeResult!.lots).toHaveLength(1);
        expect(exchangeResult!.lots[0]?.costBasisPerUnit.toFixed()).toBe('50000');
        expect(exchangeResult!.lotTransfers).toHaveLength(1);
        expect(exchangeResult!.disposals).toHaveLength(1);
        expect(exchangeResult!.disposals[0]?.quantityDisposed.toFixed()).toBe('0.0005');

        // Blockchain group: 1 lot (transfer target) with inherited cost basis
        expect(blockchainResult!.lots).toHaveLength(1);
        const transferLot = blockchainResult!.lots[0];
        expect(transferLot?.acquisitionTransactionId).toBe(3);
        expect(transferLot?.quantity.toFixed()).toBe('0.9995');
        expect(transferLot?.costBasisPerUnit.toFixed()).toBe('50000');

        // Totals
        expect(result.value.totalTransfersProcessed).toBe(1);
      }
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
            assetSymbol: 'BTC',
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
            assetSymbol: 'BTC',
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
            assetSymbol: 'BTC',
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
            assetSymbol: 'BTC',
            grossAmount: parseDecimal('1'),
            priceAtTxTime: createPriceAtTxTime('40000'),
          },
        ],
        []
      );

      transactions = [purchaseLotA, purchaseLotB, withdrawalTx, depositTx];

      const link = createLink('link-acb', 3, 4, 'BTC', '1', '1');
      const txRepo = mockTransactionRepo();
      const linkRepo = mockLinkRepo([link]);
      const matcher = new LotMatcher(txRepo, linkRepo);
      const averageCostStrategy = new AverageCostStrategy();

      const result = await matcher.match(transactions, {
        calculationId: 'calc-acb-transfer',
        strategy: averageCostStrategy,
        jurisdiction: { sameAssetTransferFeePolicy: 'disposal' },
      });

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        const btcResult = result.value.assetResults.find((r) => r.assetSymbol === 'BTC');
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
      }
    });

    it('should preserve per-lot basis under fifo when transfer spans multiple lots', async () => {
      const purchaseLotA = createTransaction(
        1,
        '2024-01-01T00:00:00Z',
        'kraken',
        [
          {
            assetId: 'test:btc',
            assetSymbol: 'BTC',
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
            assetSymbol: 'BTC',
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
            assetSymbol: 'BTC',
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
            assetSymbol: 'BTC',
            grossAmount: parseDecimal('1.5'),
            priceAtTxTime: createPriceAtTxTime('40000'),
          },
        ],
        []
      );

      transactions = [purchaseLotA, purchaseLotB, withdrawalTx, depositTx];

      const link = createLink('link-fifo', 3, 4, 'BTC', '1.5', '1.5');
      const txRepo = mockTransactionRepo();
      const linkRepo = mockLinkRepo([link]);
      const matcher = new LotMatcher(txRepo, linkRepo);
      const fifoStrategy = new FifoStrategy();

      const result = await matcher.match(transactions, {
        calculationId: 'calc-fifo-transfer',
        strategy: fifoStrategy,
        jurisdiction: { sameAssetTransferFeePolicy: 'disposal' },
      });

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        const btcResult = result.value.assetResults.find((r) => r.assetSymbol === 'BTC');
        expect(btcResult).toBeDefined();
        expect(btcResult!.lotTransfers).toHaveLength(2);

        const transferByBasis = new Map(
          btcResult!.lotTransfers.map((transfer) => [transfer.costBasisPerUnit.toFixed(), transfer])
        );
        expect(transferByBasis.get('10000')?.quantityTransferred.toFixed()).toBe('1');
        expect(transferByBasis.get('30000')?.quantityTransferred.toFixed()).toBe('0.5');
      }
    });
  });
});
