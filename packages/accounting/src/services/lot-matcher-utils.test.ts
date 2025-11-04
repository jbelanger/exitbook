import { Currency, type AssetMovement, type PriceAtTxTime, type UniversalTransaction } from '@exitbook/core';
import { Decimal } from 'decimal.js';
import { describe, expect, it } from 'vitest';

import type { LotTransfer } from '../domain/schemas.js';
import type { TransactionLink } from '../linking/types.js';

import {
  buildAcquisitionLotFromInflow,
  buildDependencyGraph,
  buildTransferMetadata,
  calculateFeeAllocationForMovement,
  calculateInheritedCostBasis,
  calculateNetProceeds,
  calculateTargetCostBasis,
  calculateTransferDisposalAmount,
  collectFiatFees,
  extractCryptoFee,
  filterTransactionsWithoutPrices,
  getVarianceTolerance,
  groupTransactionsByAsset,
  sortWithLogicalOrdering,
  validateTransferVariance,
} from './lot-matcher-utils.js';

// Helper functions
function createMockTransaction(
  id: number,
  datetime: string,
  movements: { inflows?: AssetMovement[]; outflows?: AssetMovement[] },
  fees: { network?: AssetMovement; platform?: AssetMovement } = {}
): UniversalTransaction {
  return {
    id,
    externalId: `ext-${id}`,
    source: 'test',
    datetime,
    timestamp: new Date(datetime).getTime(),
    status: 'success',
    movements,
    fees,
    operation: {
      category: 'trade',
      type: 'buy',
    },
  };
}

function createMovement(asset: string, amount: string, priceAmount?: string, priceCurrency = 'USD'): AssetMovement {
  const movement: AssetMovement = {
    asset,
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

function createPriceAtTxTime(amount: string, currency = 'USD'): PriceAtTxTime {
  return {
    price: {
      amount: new Decimal(amount),
      currency: Currency.create(currency),
    },
    source: 'test',
    fetchedAt: new Date(),
  };
}

function createTransactionLink(
  id: string,
  sourceId: number,
  targetId: number,
  asset: string,
  sourceAmount: string,
  targetAmount: string,
  confidenceScore = '0.99'
): TransactionLink {
  return {
    id,
    sourceTransactionId: sourceId,
    targetTransactionId: targetId,
    asset,
    sourceAmount: new Decimal(sourceAmount),
    targetAmount: new Decimal(targetAmount),
    linkType: 'exchange_to_blockchain',
    confidenceScore: new Decimal(confidenceScore),
    matchCriteria: {
      assetMatch: true,
      amountSimilarity: new Decimal('1.0'),
      timingValid: true,
      timingHours: 1,
    },
    status: 'confirmed',
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

describe('lot-matcher-utils', () => {
  describe('buildDependencyGraph', () => {
    it('should create dependency graph from transaction links', () => {
      const links: TransactionLink[] = [
        createTransactionLink('1', 1, 2, 'BTC', '1', '1', '0.99'),
        createTransactionLink('2', 2, 3, 'BTC', '0.5', '0.5', '0.98'),
      ];

      const graph = buildDependencyGraph(links);

      expect(graph.size).toBe(2);
      expect(graph.get(2)).toEqual(new Set([1]));
      expect(graph.get(3)).toEqual(new Set([2]));
    });

    it('should handle multiple sources for same target', () => {
      const links: TransactionLink[] = [
        createTransactionLink('1', 1, 3, 'BTC', '0.5', '0.5', '0.99'),
        createTransactionLink('2', 2, 3, 'BTC', '0.5', '0.5', '0.98'),
      ];

      const graph = buildDependencyGraph(links);

      expect(graph.size).toBe(1);
      expect(graph.get(3)).toEqual(new Set([1, 2]));
    });

    it('should return empty map for no links', () => {
      const graph = buildDependencyGraph([]);
      expect(graph.size).toBe(0);
    });
  });

  describe('sortWithLogicalOrdering', () => {
    it('should sort by dependency graph first, chronological second', () => {
      const transactions = [
        createMockTransaction(3, '2024-01-03T00:00:00Z', {}),
        createMockTransaction(1, '2024-01-01T00:00:00Z', {}),
        createMockTransaction(2, '2024-01-02T00:00:00Z', {}),
      ];

      const dependencyGraph = new Map([[3, new Set([1])]]);

      const sorted = sortWithLogicalOrdering(transactions, dependencyGraph);

      expect(sorted.map((t) => t.id)).toEqual([1, 2, 3]);
    });

    it('should respect dependency order over chronological order', () => {
      const transactions = [
        createMockTransaction(2, '2024-01-01T00:00:00Z', {}), // Earlier timestamp
        createMockTransaction(1, '2024-01-02T00:00:00Z', {}), // Later timestamp but comes first due to dependency
      ];

      const dependencyGraph = new Map([[2, new Set([1])]]); // 2 depends on 1

      const sorted = sortWithLogicalOrdering(transactions, dependencyGraph);

      expect(sorted.map((t) => t.id)).toEqual([1, 2]);
    });

    it('should handle empty dependency graph with chronological sorting', () => {
      const transactions = [
        createMockTransaction(3, '2024-01-03T00:00:00Z', {}),
        createMockTransaction(1, '2024-01-01T00:00:00Z', {}),
        createMockTransaction(2, '2024-01-02T00:00:00Z', {}),
      ];

      const sorted = sortWithLogicalOrdering(transactions, new Map());

      expect(sorted.map((t) => t.id)).toEqual([1, 2, 3]);
    });
  });

  describe('getVarianceTolerance', () => {
    it('should return source-specific tolerances', () => {
      const krakenTolerance = getVarianceTolerance('kraken');
      expect(krakenTolerance.warn.toNumber()).toBe(0.5);
      expect(krakenTolerance.error.toNumber()).toBe(2.0);

      const binanceTolerance = getVarianceTolerance('binance');
      expect(binanceTolerance.warn.toNumber()).toBe(1.5);
      expect(binanceTolerance.error.toNumber()).toBe(5.0);
    });

    it('should be case-insensitive', () => {
      const tolerance1 = getVarianceTolerance('KRAKEN');
      const tolerance2 = getVarianceTolerance('kraken');

      expect(tolerance1.warn.equals(tolerance2.warn)).toBe(true);
      expect(tolerance1.error.equals(tolerance2.error)).toBe(true);
    });

    it('should return default for unknown source', () => {
      const tolerance = getVarianceTolerance('unknown-exchange');
      expect(tolerance.warn.toNumber()).toBe(1.0);
      expect(tolerance.error.toNumber()).toBe(3.0);
    });

    it('should accept config override', () => {
      const tolerance = getVarianceTolerance('kraken', { warn: 2.0, error: 10.0 });
      expect(tolerance.warn.toNumber()).toBe(2.0);
      expect(tolerance.error.toNumber()).toBe(10.0);
    });
  });

  describe('extractCryptoFee', () => {
    it('should extract network fee', () => {
      const tx = createMockTransaction(
        1,
        '2024-01-01T00:00:00Z',
        {},
        { network: createMovement('BTC', '0.001', '50000') }
      );

      const result = extractCryptoFee(tx, 'BTC');

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value.amount.toFixed()).toBe('0.001');
        expect(result.value.feeType).toBe('network');
        expect(result.value.priceAtTxTime?.price.amount.toFixed()).toBe('50000');
      }
    });

    it('should extract platform fee', () => {
      const tx = createMockTransaction(
        1,
        '2024-01-01T00:00:00Z',
        {},
        { platform: createMovement('BTC', '0.002', '50000') }
      );

      const result = extractCryptoFee(tx, 'BTC');

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value.amount.toFixed()).toBe('0.002');
        expect(result.value.feeType).toBe('platform');
      }
    });

    it('should combine network and platform fees', () => {
      const tx = createMockTransaction(
        1,
        '2024-01-01T00:00:00Z',
        {},
        {
          network: createMovement('BTC', '0.001', '50000'),
          platform: createMovement('BTC', '0.002', '50000'),
        }
      );

      const result = extractCryptoFee(tx, 'BTC');

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value.amount.toFixed()).toBe('0.003');
        expect(result.value.feeType).toBe('network+platform');
      }
    });

    it('should return zero for no fees', () => {
      const tx = createMockTransaction(1, '2024-01-01T00:00:00Z', {});

      const result = extractCryptoFee(tx, 'BTC');

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value.amount.toFixed()).toBe('0');
        expect(result.value.feeType).toBe('none');
      }
    });

    it('should return zero for fees in different asset', () => {
      const tx = createMockTransaction(
        1,
        '2024-01-01T00:00:00Z',
        {},
        { network: createMovement('ETH', '0.01', '3000') }
      );

      const result = extractCryptoFee(tx, 'BTC');

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value.amount.toFixed()).toBe('0');
        expect(result.value.feeType).toBe('none');
      }
    });
  });

  describe('collectFiatFees', () => {
    it('should collect fiat fees from both transactions', () => {
      const sourceTx = createMockTransaction(
        1,
        '2024-01-01T00:00:00Z',
        {},
        { network: createMovement('USD', '1.50', '1') }
      );
      const targetTx = createMockTransaction(
        2,
        '2024-01-01T00:00:00Z',
        {},
        { platform: createMovement('EUR', '2.00', '1.1') }
      );

      const result = collectFiatFees(sourceTx, targetTx);

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value.length).toBe(2);
        expect(result.value[0]!.asset).toBe('USD');
        expect(result.value[0]!.amount.toFixed()).toBe('1.5');
        expect(result.value[0]!.txId).toBe(1);
        expect(result.value[1]!.asset).toBe('EUR');
        expect(result.value[1]!.amount.toFixed()).toBe('2');
        expect(result.value[1]!.txId).toBe(2);
      }
    });

    it('should ignore crypto fees', () => {
      const sourceTx = createMockTransaction(
        1,
        '2024-01-01T00:00:00Z',
        {},
        { network: createMovement('BTC', '0.001', '50000') }
      );
      const targetTx = createMockTransaction(
        2,
        '2024-01-01T00:00:00Z',
        {},
        { platform: createMovement('ETH', '0.01', '3000') }
      );

      const result = collectFiatFees(sourceTx, targetTx);

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value.length).toBe(0);
      }
    });

    it('should return empty array for no fees', () => {
      const sourceTx = createMockTransaction(1, '2024-01-01T00:00:00Z', {});
      const targetTx = createMockTransaction(2, '2024-01-01T00:00:00Z', {});

      const result = collectFiatFees(sourceTx, targetTx);

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value.length).toBe(0);
      }
    });
  });

  describe('filterTransactionsWithoutPrices', () => {
    it('should filter transactions with missing prices on crypto movements', () => {
      const transactions = [
        createMockTransaction(1, '2024-01-01T00:00:00Z', {
          inflows: [createMovement('BTC', '1', '50000')],
        }),
        createMockTransaction(2, '2024-01-01T00:00:00Z', {
          inflows: [createMovement('BTC', '1')], // Missing price
        }),
        createMockTransaction(3, '2024-01-01T00:00:00Z', {
          outflows: [createMovement('ETH', '10')], // Missing price
        }),
      ];

      const missing = filterTransactionsWithoutPrices(transactions);

      expect(missing.length).toBe(2);
      expect(missing.map((t) => t.id)).toEqual([2, 3]);
    });

    it('should ignore fiat movements without prices', () => {
      const transactions = [
        createMockTransaction(1, '2024-01-01T00:00:00Z', {
          inflows: [createMovement('USD', '1000')], // Fiat without price - OK
          outflows: [createMovement('BTC', '1', '50000')],
        }),
      ];

      const missing = filterTransactionsWithoutPrices(transactions);

      expect(missing.length).toBe(0);
    });

    it('should return empty for all priced transactions', () => {
      const transactions = [
        createMockTransaction(1, '2024-01-01T00:00:00Z', {
          inflows: [createMovement('BTC', '1', '50000')],
          outflows: [createMovement('USD', '50000', '1')],
        }),
      ];

      const missing = filterTransactionsWithoutPrices(transactions);

      expect(missing.length).toBe(0);
    });
  });

  describe('calculateFeeAllocationForMovement', () => {
    it('should allocate fees proportionally to movement value', () => {
      const tx = createMockTransaction(
        1,
        '2024-01-01T00:00:00Z',
        {
          inflows: [
            createMovement('BTC', '1', '50000'), // $50,000
            createMovement('ETH', '10', '3000'), // $30,000
          ],
        },
        {
          platform: createMovement('USD', '80', '1'), // $80 fee
        }
      );

      const btcMovement = tx.movements.inflows![0]!;
      const ethMovement = tx.movements.inflows![1]!;

      const btcFeeResult = calculateFeeAllocationForMovement(tx, btcMovement);
      const ethFeeResult = calculateFeeAllocationForMovement(tx, ethMovement);

      expect(btcFeeResult.isOk()).toBe(true);
      expect(ethFeeResult.isOk()).toBe(true);

      if (btcFeeResult.isOk() && ethFeeResult.isOk()) {
        // BTC: 50000/80000 * 80 = 50
        expect(btcFeeResult.value.toFixed()).toBe('50');
        // ETH: 30000/80000 * 80 = 30
        expect(ethFeeResult.value.toFixed()).toBe('30');
      }
    });

    it('should return zero for no fees', () => {
      const tx = createMockTransaction(1, '2024-01-01T00:00:00Z', {
        inflows: [createMovement('BTC', '1', '50000')],
      });

      const result = calculateFeeAllocationForMovement(tx, tx.movements.inflows![0]!);

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value.toFixed()).toBe('0');
      }
    });

    it('should not allocate fees to fee movement itself', () => {
      const feeMovement = createMovement('BTC', '0.001', '50000');
      const tx = createMockTransaction(
        1,
        '2024-01-01T00:00:00Z',
        {
          inflows: [createMovement('BTC', '1', '50000')],
        },
        {
          network: feeMovement,
        }
      );

      const result = calculateFeeAllocationForMovement(tx, feeMovement);

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value.toFixed()).toBe('0');
      }
    });

    it('should split fees evenly when all movements have zero value', () => {
      const tx = createMockTransaction(
        1,
        '2024-01-01T00:00:00Z',
        {
          inflows: [
            createMovement('TOKEN1', '1000', '0'), // $0 value
            createMovement('TOKEN2', '2000', '0'), // $0 value
          ],
        },
        {
          platform: createMovement('USD', '10', '1'),
        }
      );

      const token1Movement = tx.movements.inflows![0]!;
      const result = calculateFeeAllocationForMovement(tx, token1Movement);

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        // Split evenly: 10 / 2 = 5
        expect(result.value.toFixed()).toBe('5');
      }
    });

    it('should handle fiat fee with same currency as movement price', () => {
      const tx = createMockTransaction(
        1,
        '2024-01-01T00:00:00Z',
        {
          inflows: [createMovement('BTC', '1', '50000', 'USD')],
        },
        {
          platform: createMovement('USD', '50'), // No price, but USD
        }
      );

      const result = calculateFeeAllocationForMovement(tx, tx.movements.inflows![0]!);

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value.toFixed()).toBe('50');
      }
    });

    it('should error on fiat fee with different currency and no price', () => {
      const tx = createMockTransaction(
        1,
        '2024-01-01T00:00:00Z',
        {
          inflows: [createMovement('BTC', '1', '50000', 'USD')],
        },
        {
          platform: createMovement('EUR', '50'), // No price, different currency
        }
      );

      const result = calculateFeeAllocationForMovement(tx, tx.movements.inflows![0]!);

      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error.message).toContain('cannot be converted');
      }
    });

    it('should error on crypto fee without price', () => {
      const tx = createMockTransaction(
        1,
        '2024-01-01T00:00:00Z',
        {
          inflows: [createMovement('BTC', '1', '50000')],
        },
        {
          network: createMovement('ETH', '0.01'), // Crypto fee without price
        }
      );

      const result = calculateFeeAllocationForMovement(tx, tx.movements.inflows![0]!);

      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error.message).toContain('missing priceAtTxTime');
      }
    });

    it('should allocate fees proportionally even to fiat movements with value', () => {
      const tx = createMockTransaction(
        1,
        '2024-01-01T00:00:00Z',
        {
          inflows: [createMovement('BTC', '1', '50000'), createMovement('USD', '50000', '1')],
        },
        {
          platform: createMovement('USD', '10', '1'),
        }
      );

      const usdMovement = tx.movements.inflows![1]!;
      const result = calculateFeeAllocationForMovement(tx, usdMovement);

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        // nonFiatMovements only includes BTC (totalValue = 50000)
        // usdMovement value = 50000
        // Fee allocation: 10 * 50000 / 50000 = 10
        // Note: This fee allocation won't be used for cost basis as fiat is filtered in lot matching
        expect(result.value.toFixed()).toBe('10');
      }
    });
  });

  describe('groupTransactionsByAsset', () => {
    it('should group transactions by asset from inflows and outflows', () => {
      const transactions = [
        createMockTransaction(1, '2024-01-01T00:00:00Z', {
          inflows: [createMovement('BTC', '1', '50000')],
        }),
        createMockTransaction(2, '2024-01-01T00:00:00Z', {
          outflows: [createMovement('BTC', '0.5', '51000')],
        }),
        createMockTransaction(3, '2024-01-01T00:00:00Z', {
          inflows: [createMovement('ETH', '10', '3000')],
        }),
      ];

      const grouped = groupTransactionsByAsset(transactions);

      expect(grouped.size).toBe(2);
      expect(grouped.get('BTC')?.map((t) => t.id)).toEqual([1, 2]);
      expect(grouped.get('ETH')?.map((t) => t.id)).toEqual([3]);
    });

    it('should handle transactions with multiple assets', () => {
      const transactions = [
        createMockTransaction(1, '2024-01-01T00:00:00Z', {
          inflows: [createMovement('BTC', '1', '50000')],
          outflows: [createMovement('USD', '50000', '1')],
        }),
      ];

      const grouped = groupTransactionsByAsset(transactions);

      expect(grouped.size).toBe(2);
      expect(grouped.get('BTC')?.map((t) => t.id)).toEqual([1]);
      expect(grouped.get('USD')?.map((t) => t.id)).toEqual([1]);
    });

    it('should return empty map for no transactions', () => {
      const grouped = groupTransactionsByAsset([]);
      expect(grouped.size).toBe(0);
    });
  });

  describe('buildAcquisitionLotFromInflow', () => {
    it('should create lot with cost basis including fees', () => {
      const tx = createMockTransaction(
        1,
        '2024-01-01T00:00:00Z',
        {
          inflows: [createMovement('BTC', '1', '50000')],
        },
        {
          platform: createMovement('USD', '100', '1'), // $100 fee
        }
      );

      const result = buildAcquisitionLotFromInflow(tx, tx.movements.inflows![0]!, 'calc-123', 'fifo');

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        const lot = result.value;
        expect(lot.asset).toBe('BTC');
        expect(lot.quantity.toFixed()).toBe('1');
        // Cost basis = (1 * 50000 + 100) / 1 = 50100
        expect(lot.costBasisPerUnit.toFixed()).toBe('50100');
        expect(lot.method).toBe('fifo');
        expect(lot.acquisitionTransactionId).toBe(1);
      }
    });

    it('should error on missing price', () => {
      const tx = createMockTransaction(1, '2024-01-01T00:00:00Z', {
        inflows: [createMovement('BTC', '1')], // No price
      });

      const result = buildAcquisitionLotFromInflow(tx, tx.movements.inflows![0]!, 'calc-123', 'fifo');

      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error.message).toContain('missing priceAtTxTime');
      }
    });

    it('should create lot with zero fees', () => {
      const tx = createMockTransaction(1, '2024-01-01T00:00:00Z', {
        inflows: [createMovement('BTC', '1', '50000')],
      });

      const result = buildAcquisitionLotFromInflow(tx, tx.movements.inflows![0]!, 'calc-123', 'lifo');

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value.costBasisPerUnit.toFixed()).toBe('50000');
      }
    });
  });

  describe('calculateNetProceeds', () => {
    it('should calculate proceeds minus fees', () => {
      const tx = createMockTransaction(
        1,
        '2024-01-01T00:00:00Z',
        {
          outflows: [createMovement('BTC', '1', '52000')],
        },
        {
          platform: createMovement('USD', '200', '1'), // $200 fee
        }
      );

      const result = calculateNetProceeds(tx, tx.movements.outflows![0]!);

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        // Gross: 1 * 52000 = 52000
        // Net: 52000 - 200 = 51800
        // Per unit: 51800 / 1 = 51800
        expect(result.value.proceedsPerUnit.toFixed()).toBe('51800');
        expect(result.value.totalFeeAmount.toFixed()).toBe('200');
      }
    });

    it('should error on missing price', () => {
      const tx = createMockTransaction(1, '2024-01-01T00:00:00Z', {
        outflows: [createMovement('BTC', '1')], // No price
      });

      const result = calculateNetProceeds(tx, tx.movements.outflows![0]!);

      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error.message).toContain('missing priceAtTxTime');
      }
    });

    it('should handle zero fees', () => {
      const tx = createMockTransaction(1, '2024-01-01T00:00:00Z', {
        outflows: [createMovement('BTC', '2', '52000')],
      });

      const result = calculateNetProceeds(tx, tx.movements.outflows![0]!);

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value.proceedsPerUnit.toFixed()).toBe('52000');
        expect(result.value.totalFeeAmount.toFixed()).toBe('0');
      }
    });
  });

  describe('validateTransferVariance', () => {
    it('should pass validation within tolerance', () => {
      const result = validateTransferVariance(new Decimal('1'), new Decimal('1.005'), 'kraken', 1, 'BTC');

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value.variancePct.toFixed(2)).toBe('0.50');
      }
    });

    it('should error when exceeding error threshold', () => {
      const result = validateTransferVariance(new Decimal('1'), new Decimal('1.05'), 'kraken', 1, 'BTC');

      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error.message).toContain('Transfer amount mismatch');
        expect(result.error.message).toContain('5.00% variance');
      }
    });

    it('should handle zero actual amount', () => {
      const result = validateTransferVariance(new Decimal('0'), new Decimal('1'), 'kraken', 1, 'BTC');

      // When actual is zero, variance is 0%
      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value.variancePct.toFixed()).toBe('0');
      }
    });

    it('should respect config override', () => {
      const result = validateTransferVariance(
        new Decimal('1'),
        new Decimal('1.15'),
        'kraken',
        1,
        'BTC',
        { warn: 10, error: 20 } // High tolerance
      );

      expect(result.isOk()).toBe(true);
    });
  });

  describe('calculateTransferDisposalAmount', () => {
    it('should return full amount for add-to-basis policy', () => {
      const outflow = createMovement('BTC', '1', '50000');
      const cryptoFee = {
        amount: new Decimal('0.001'),
        feeType: 'network',
        priceAtTxTime: createPriceAtTxTime('50000'),
      };

      const result = calculateTransferDisposalAmount(outflow, cryptoFee, 'add-to-basis');

      expect(result.amountToMatch.toFixed()).toBe('1');
    });

    it('should return net amount for disposal policy', () => {
      const outflow = createMovement('BTC', '1', '50000');
      const cryptoFee = {
        amount: new Decimal('0.001'),
        feeType: 'network',
        priceAtTxTime: createPriceAtTxTime('50000'),
      };

      const result = calculateTransferDisposalAmount(outflow, cryptoFee, 'disposal');

      expect(result.amountToMatch.toFixed()).toBe('0.999');
    });

    it('should handle zero fee', () => {
      const outflow = createMovement('BTC', '1', '50000');
      const cryptoFee = { amount: new Decimal('0'), feeType: 'none', priceAtTxTime: undefined };

      const result = calculateTransferDisposalAmount(outflow, cryptoFee, 'disposal');

      expect(result.amountToMatch.toFixed()).toBe('1');
    });
  });

  describe('buildTransferMetadata', () => {
    it('should build metadata with crypto fee for add-to-basis policy', () => {
      const cryptoFee = { amount: new Decimal('0.001'), priceAtTxTime: createPriceAtTxTime('50000') };

      const metadata = buildTransferMetadata(cryptoFee, 'add-to-basis', new Decimal('0.5'), new Decimal('1'));

      expect(metadata).toBeDefined();
      expect(metadata?.cryptoFeeUsdValue).toBeDefined();
      // Fee share: (0.5 / 1) * (0.001 * 50000) = 25
      expect(metadata?.cryptoFeeUsdValue?.toFixed()).toBe('25');
    });

    it('should return undefined for disposal policy', () => {
      const cryptoFee = { amount: new Decimal('0.001'), priceAtTxTime: createPriceAtTxTime('50000') };

      const metadata = buildTransferMetadata(cryptoFee, 'disposal', new Decimal('0.5'), new Decimal('1'));

      expect(metadata).toBeUndefined();
    });

    it('should return undefined for zero fee', () => {
      const cryptoFee = { amount: new Decimal('0'), priceAtTxTime: undefined };

      const metadata = buildTransferMetadata(cryptoFee, 'add-to-basis', new Decimal('0.5'), new Decimal('1'));

      expect(metadata).toBeUndefined();
    });

    it('should return undefined when fee has no price', () => {
      const cryptoFee = { amount: new Decimal('0.001'), priceAtTxTime: undefined };

      const metadata = buildTransferMetadata(cryptoFee, 'add-to-basis', new Decimal('0.5'), new Decimal('1'));

      expect(metadata).toBeUndefined();
    });
  });

  describe('calculateInheritedCostBasis', () => {
    it('should sum cost basis from transfers', () => {
      const transfers: LotTransfer[] = [
        {
          id: '1',
          calculationId: 'calc-1',
          sourceLotId: 'lot-1',
          linkId: 'link-1',
          quantityTransferred: new Decimal('0.5'),
          costBasisPerUnit: new Decimal('50000'),
          sourceTransactionId: 1,
          targetTransactionId: 2,
          createdAt: new Date(),
        },
        {
          id: '2',
          calculationId: 'calc-1',
          sourceLotId: 'lot-2',
          linkId: 'link-1',
          quantityTransferred: new Decimal('0.3'),
          costBasisPerUnit: new Decimal('51000'),
          sourceTransactionId: 1,
          targetTransactionId: 2,
          createdAt: new Date(),
        },
      ];

      const result = calculateInheritedCostBasis(transfers);

      // 0.5 * 50000 + 0.3 * 51000 = 25000 + 15300 = 40300
      expect(result.totalCostBasis.toFixed()).toBe('40300');
      expect(result.transferredQuantity.toFixed()).toBe('0.8');
      expect(result.cryptoFeeUsdAdded.toFixed()).toBe('0');
    });

    it('should include crypto fees from metadata', () => {
      const transfers: LotTransfer[] = [
        {
          id: '1',
          calculationId: 'calc-1',
          sourceLotId: 'lot-1',
          linkId: 'link-1',
          quantityTransferred: new Decimal('0.5'),
          costBasisPerUnit: new Decimal('50000'),
          sourceTransactionId: 1,
          targetTransactionId: 2,
          metadata: { cryptoFeeUsdValue: new Decimal('25') },
          createdAt: new Date(),
        },
      ];

      const result = calculateInheritedCostBasis(transfers);

      // 0.5 * 50000 + 25 = 25025
      expect(result.totalCostBasis.toFixed()).toBe('25025');
      expect(result.cryptoFeeUsdAdded.toFixed()).toBe('25');
    });

    it('should handle empty transfers array', () => {
      const result = calculateInheritedCostBasis([]);

      expect(result.totalCostBasis.toFixed()).toBe('0');
      expect(result.transferredQuantity.toFixed()).toBe('0');
      expect(result.cryptoFeeUsdAdded.toFixed()).toBe('0');
    });
  });

  describe('calculateTargetCostBasis', () => {
    it('should add fiat fees to inherited cost basis', () => {
      const fiatFees = [
        { amount: new Decimal('10'), priceAtTxTime: createPriceAtTxTime('1') },
        { amount: new Decimal('5'), priceAtTxTime: createPriceAtTxTime('1') },
      ];

      const result = calculateTargetCostBasis(new Decimal('50000'), fiatFees, new Decimal('1'));

      // (50000 + 10 + 5) / 1 = 50015
      expect(result.toFixed()).toBe('50015');
    });

    it('should ignore fiat fees without prices', () => {
      const fiatFees = [
        { amount: new Decimal('10'), priceAtTxTime: createPriceAtTxTime('1') },
        { amount: new Decimal('5'), priceAtTxTime: undefined },
      ];

      const result = calculateTargetCostBasis(new Decimal('50000'), fiatFees, new Decimal('1'));

      // (50000 + 10) / 1 = 50010
      expect(result.toFixed()).toBe('50010');
    });

    it('should handle zero fiat fees', () => {
      const result = calculateTargetCostBasis(new Decimal('50000'), [], new Decimal('2'));

      // 50000 / 2 = 25000
      expect(result.toFixed()).toBe('25000');
    });

    it('should divide by received quantity', () => {
      const fiatFees = [{ amount: new Decimal('100'), priceAtTxTime: createPriceAtTxTime('1') }];

      const result = calculateTargetCostBasis(new Decimal('50000'), fiatFees, new Decimal('0.5'));

      // (50000 + 100) / 0.5 = 100200
      expect(result.toFixed()).toBe('100200');
    });
  });
});
