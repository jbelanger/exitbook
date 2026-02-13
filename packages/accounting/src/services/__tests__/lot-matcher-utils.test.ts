import type { FeeMovement } from '@exitbook/core';
import {
  Currency,
  parseDecimal,
  type AssetMovement,
  type PriceAtTxTime,
  type UniversalTransactionData,
} from '@exitbook/core';
import { Decimal } from 'decimal.js';
import { describe, expect, it } from 'vitest';

import type { LotTransfer } from '../../domain/schemas.js';
import type { TransactionLink } from '../../linking/types.js';
import {
  buildDependencyGraph,
  sortWithLogicalOrdering,
  sortTransactionsByDependency,
  sortAssetGroupsByDependency,
  getVarianceTolerance,
  extractOnChainFees,
  extractCryptoFee,
  collectFiatFees,
  filterTransactionsWithoutPrices,
  calculateFeesInFiat,
  groupTransactionsByAsset,
  buildAcquisitionLotFromInflow,
  calculateNetProceeds,
  validateTransferVariance,
  validateOutflowFees,
  calculateTransferDisposalAmount,
  buildTransferMetadata,
  calculateInheritedCostBasis,
  calculateTargetCostBasis,
} from '../lot-matcher-utils.js';

// Helper functions
function createMockTransaction(
  id: number,
  datetime: string,
  movements: { inflows?: AssetMovement[]; outflows?: AssetMovement[] },
  fees: FeeMovement[] = []
): UniversalTransactionData {
  return {
    id,
    accountId: 1,
    externalId: `ext-${id}`,
    source: 'test',
    sourceType: 'exchange',
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

function createMovement(
  assetSymbol: string,
  amount: string,
  priceAmount?: string,
  priceCurrency = 'USD'
): AssetMovement {
  const movement: AssetMovement = {
    assetId: `test:${assetSymbol.toLowerCase()}`,
    assetSymbol,
    grossAmount: new Decimal(amount),
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

function createFeeMovement(
  scope: 'network' | 'platform' | 'spread' | 'tax' | 'other',
  settlement: 'on-chain' | 'balance' | 'external',
  assetSymbol: string,
  amount: string,
  priceAmount?: string,
  priceCurrency = 'USD'
): FeeMovement {
  const movement: FeeMovement = {
    assetId: `test:${assetSymbol.toLowerCase()}`,
    scope,
    settlement,
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
  sourceName: number,
  targetId: number,
  assetSymbol: string,
  sourceAmount: string,
  targetAmount: string,
  confidenceScore = '0.99'
): TransactionLink {
  return {
    id,
    sourceTransactionId: sourceName,
    targetTransactionId: targetId,
    assetSymbol,
    sourceAssetId: `test:${assetSymbol.toLowerCase()}`,
    targetAssetId: `test:${assetSymbol.toLowerCase()}`,
    sourceAmount: new Decimal(sourceAmount),
    targetAmount: new Decimal(targetAmount),
    linkType: 'exchange_to_blockchain',
    confidenceScore: new Decimal(confidenceScore),
    matchCriteria: {
      assetMatch: true,
      amountSimilarity: parseDecimal('1.0'),
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

  describe('sortTransactionsByDependency', () => {
    it('should return chronological order when links empty', () => {
      const tx1 = createMockTransaction(1, '2024-01-01T10:00:00Z', {});
      const tx2 = createMockTransaction(2, '2024-01-01T11:00:00Z', {});
      const tx3 = createMockTransaction(3, '2024-01-01T12:00:00Z', {});

      const result = sortTransactionsByDependency([tx3, tx1, tx2], []);

      expect(result.isOk()).toBe(true);
      expect(result._unsafeUnwrap().map((tx) => tx.id)).toEqual([1, 2, 3]);
    });

    it('should enforce source-before-target regardless of timestamp', () => {
      const tx1 = createMockTransaction(1, '2024-01-01T12:00:00Z', {}); // Later timestamp
      const tx2 = createMockTransaction(2, '2024-01-01T10:00:00Z', {}); // Earlier timestamp
      const link = createTransactionLink('link-1', 1, 2, 'BTC', '1', '1'); // 1 → 2

      const result = sortTransactionsByDependency([tx2, tx1], [link]);

      expect(result.isOk()).toBe(true);
      expect(result._unsafeUnwrap().map((tx) => tx.id)).toEqual([1, 2]); // Dependency overrides timestamp
    });

    it('should break ties by tx id when datetime equal', () => {
      const tx1 = createMockTransaction(1, '2024-01-01T10:00:00Z', {});
      const tx2 = createMockTransaction(2, '2024-01-01T10:00:00Z', {}); // Same timestamp
      const tx3 = createMockTransaction(3, '2024-01-01T10:00:00Z', {}); // Same timestamp

      const result = sortTransactionsByDependency([tx3, tx1, tx2], []);

      expect(result.isOk()).toBe(true);
      expect(result._unsafeUnwrap().map((tx) => tx.id)).toEqual([1, 2, 3]); // Sorted by ID
    });

    it('should ignore links not in provided tx set', () => {
      const tx1 = createMockTransaction(1, '2024-01-01T10:00:00Z', {});
      const tx2 = createMockTransaction(2, '2024-01-01T11:00:00Z', {});
      const linkToExternal = createTransactionLink('link-1', 1, 999, 'BTC', '1', '1'); // 1 → 999 (not in set)

      const result = sortTransactionsByDependency([tx2, tx1], [linkToExternal]);

      expect(result.isOk()).toBe(true);
      expect(result._unsafeUnwrap().map((tx) => tx.id)).toEqual([1, 2]); // Chronological (link ignored)
    });

    it('should return error with unresolved tx ids on cycle', () => {
      const tx1 = createMockTransaction(1, '2024-01-01T10:00:00Z', {});
      const tx2 = createMockTransaction(2, '2024-01-01T11:00:00Z', {});
      const link1 = createTransactionLink('link-1', 1, 2, 'BTC', '1', '1'); // 1 → 2
      const link2 = createTransactionLink('link-2', 2, 1, 'BTC', '1', '1'); // 2 → 1 (creates cycle)

      const result = sortTransactionsByDependency([tx1, tx2], [link1, link2]);

      expect(result.isErr()).toBe(true);
      const error = result._unsafeUnwrapErr();
      expect(error.message).toContain('Transaction dependency cycle detected');
      expect(error.message).toMatch(/1.*2/); // Both tx IDs mentioned
    });

    it('should handle complex dependency chains', () => {
      const tx1 = createMockTransaction(1, '2024-01-01T10:00:00Z', {}); // No deps
      const tx2 = createMockTransaction(2, '2024-01-01T11:00:00Z', {}); // Depends on 1
      const tx3 = createMockTransaction(3, '2024-01-01T09:00:00Z', {}); // Earlier, but depends on 2
      const tx4 = createMockTransaction(4, '2024-01-01T08:00:00Z', {}); // Earliest, no deps

      const link1 = createTransactionLink('link-1', 1, 2, 'BTC', '1', '1'); // 1 → 2
      const link2 = createTransactionLink('link-2', 2, 3, 'BTC', '1', '1'); // 2 → 3

      const result = sortTransactionsByDependency([tx3, tx4, tx1, tx2], [link1, link2]);

      expect(result.isOk()).toBe(true);
      const sorted = result._unsafeUnwrap().map((tx) => tx.id);

      // tx4 and tx1 have no dependencies, sorted by timestamp (4 is earlier)
      // Then tx2 (depends on tx1), then tx3 (depends on tx2)
      expect(sorted).toEqual([4, 1, 2, 3]);
    });

    it('should handle cross-asset bidirectional transfers (non-cycle)', () => {
      // A → B (deposit to exchange)
      const tx1 = createMockTransaction(1, '2024-01-01T10:00:00Z', {}); // blockchain send
      const tx2 = createMockTransaction(2, '2024-01-01T10:30:00Z', {}); // exchange receive

      // B → A (withdrawal from exchange) - different transaction IDs
      const tx3 = createMockTransaction(3, '2024-01-01T14:00:00Z', {}); // exchange send
      const tx4 = createMockTransaction(4, '2024-01-01T14:30:00Z', {}); // blockchain receive

      const link1 = createTransactionLink('link-1', 1, 2, 'BTC', '1', '1'); // tx1 → tx2
      const link2 = createTransactionLink('link-2', 3, 4, 'BTC', '1', '1'); // tx3 → tx4

      const result = sortTransactionsByDependency([tx1, tx2, tx3, tx4], [link1, link2]);

      expect(result.isOk()).toBe(true);
      expect(result._unsafeUnwrap().map((tx) => tx.id)).toEqual([1, 2, 3, 4]); // Chronological + dependency
    });
  });

  describe('sortAssetGroupsByDependency', () => {
    const makeEntry = (
      assetId: string,
      assetSymbol: string
    ): [string, { assetSymbol: string; transactions: UniversalTransactionData[] }] => [
      assetId,
      { assetSymbol, transactions: [] },
    ];

    const makeCrossAssetLink = (_sourceAssetId: string, _targetAssetId: string): TransactionLink =>
      createTransactionLink('link-1', 1, 2, 'BTC', '1', '1');

    it('should return original order when no cross-asset links exist', () => {
      const entries = [makeEntry('test:btc', 'BTC'), makeEntry('test:eth', 'ETH')];
      const links = [createTransactionLink('link-1', 1, 2, 'BTC', '1', '1')]; // same-asset link

      const result = sortAssetGroupsByDependency(entries, links);

      expect(result.isOk()).toBe(true);
      expect(result._unsafeUnwrap().map(([id]) => id)).toEqual(['test:btc', 'test:eth']);
    });

    it('should order source group before target group for cross-asset link', () => {
      const entries = [makeEntry('blockchain:bitcoin:native', 'BTC'), makeEntry('exchange:kraken:btc', 'BTC')];
      const link: TransactionLink = {
        ...makeCrossAssetLink('exchange:kraken:btc', 'blockchain:bitcoin:native'),
        sourceAssetId: 'exchange:kraken:btc',
        targetAssetId: 'blockchain:bitcoin:native',
      };

      const result = sortAssetGroupsByDependency(entries, [link]);

      expect(result.isOk()).toBe(true);
      expect(result._unsafeUnwrap().map(([id]) => id)).toEqual(['exchange:kraken:btc', 'blockchain:bitcoin:native']);
    });

    it('should handle chain A→B→C correctly', () => {
      const entries = [makeEntry('c', 'BTC'), makeEntry('a', 'BTC'), makeEntry('b', 'BTC')];
      const linkAB: TransactionLink = {
        ...makeCrossAssetLink('a', 'b'),
        sourceAssetId: 'a',
        targetAssetId: 'b',
      };
      const linkBC: TransactionLink = {
        ...makeCrossAssetLink('b', 'c'),
        sourceAssetId: 'b',
        targetAssetId: 'c',
      };

      const result = sortAssetGroupsByDependency(entries, [linkAB, linkBC]);

      expect(result.isOk()).toBe(true);
      expect(result._unsafeUnwrap().map(([id]) => id)).toEqual(['a', 'b', 'c']);
    });

    it('should not reorder for same-asset links', () => {
      const entries = [makeEntry('test:btc', 'BTC'), makeEntry('test:eth', 'ETH')];
      const link: TransactionLink = {
        ...makeCrossAssetLink('test:btc', 'test:btc'),
        sourceAssetId: 'test:btc',
        targetAssetId: 'test:btc',
      };

      const result = sortAssetGroupsByDependency(entries, [link]);

      expect(result.isOk()).toBe(true);
      expect(result._unsafeUnwrap().map(([id]) => id)).toEqual(['test:btc', 'test:eth']);
    });

    it('should detect cross-asset dependency cycles and return error', () => {
      const entries = [makeEntry('exchange:kraken:btc', 'BTC'), makeEntry('blockchain:bitcoin:native', 'BTC')];

      // Create bidirectional links (A ↔ B)
      const linkAtoB: TransactionLink = {
        ...makeCrossAssetLink('exchange:kraken:btc', 'blockchain:bitcoin:native'),
        sourceAssetId: 'exchange:kraken:btc',
        targetAssetId: 'blockchain:bitcoin:native',
      };
      const linkBtoA: TransactionLink = {
        ...makeCrossAssetLink('blockchain:bitcoin:native', 'exchange:kraken:btc'),
        sourceAssetId: 'blockchain:bitcoin:native',
        targetAssetId: 'exchange:kraken:btc',
      };

      const result = sortAssetGroupsByDependency(entries, [linkAtoB, linkBtoA]);

      expect(result.isErr()).toBe(true);
      const error = result._unsafeUnwrapErr();
      expect(error.message).toContain('Cross-asset dependency cycle');
      expect(error.message).toContain('exchange:kraken:btc');
      expect(error.message).toContain('blockchain:bitcoin:native');
      expect(error.message).toContain('Transaction-level dependency resolution is required');
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

  describe('extractOnChainFees', () => {
    it('should extract only on-chain fees for specified asset', () => {
      const tx = createMockTransaction(1, '2024-01-01T00:00:00Z', {}, [
        createFeeMovement('network', 'on-chain', 'BTC', '0.001', '50000'),
        createFeeMovement('platform', 'balance', 'BTC', '0.0004', '50000'),
        createFeeMovement('network', 'on-chain', 'ETH', '0.002', '3000'),
      ]);

      const btcOnChainFees = extractOnChainFees(tx, 'BTC');

      expect(btcOnChainFees.toFixed()).toBe('0.001');
    });

    it('should return zero when no on-chain fees exist', () => {
      const tx = createMockTransaction(1, '2024-01-01T00:00:00Z', {}, [
        createFeeMovement('platform', 'balance', 'BTC', '0.0004', '50000'),
      ]);

      const onChainFees = extractOnChainFees(tx, 'BTC');

      expect(onChainFees.toFixed()).toBe('0');
    });

    it('should sum multiple on-chain fees for same asset', () => {
      const tx = createMockTransaction(1, '2024-01-01T00:00:00Z', {}, [
        createFeeMovement('network', 'on-chain', 'BTC', '0.001', '50000'),
        createFeeMovement('platform', 'on-chain', 'BTC', '0.0002', '50000'),
      ]);

      const onChainFees = extractOnChainFees(tx, 'BTC');

      expect(onChainFees.toFixed()).toBe('0.0012');
    });
  });

  describe('extractCryptoFee', () => {
    it('should extract network fee', () => {
      const tx = createMockTransaction(1, '2024-01-01T00:00:00Z', {}, [
        createFeeMovement('network', 'on-chain', 'BTC', '0.001', '50000'),
      ]);

      const result = extractCryptoFee(tx, 'BTC');

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value.amount.toFixed()).toBe('0.001');
        expect(result.value.feeType).toBe('network');
        expect(result.value.priceAtTxTime?.price.amount.toFixed()).toBe('50000');
      }
    });

    it('should extract platform fee', () => {
      const tx = createMockTransaction(1, '2024-01-01T00:00:00Z', {}, [
        createFeeMovement('platform', 'on-chain', 'BTC', '0.002', '50000'),
      ]);

      const result = extractCryptoFee(tx, 'BTC');

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value.amount.toFixed()).toBe('0.002');
        expect(result.value.feeType).toBe('platform');
      }
    });

    it('should combine network and platform fees', () => {
      const tx = createMockTransaction(1, '2024-01-01T00:00:00Z', {}, [
        createFeeMovement('network', 'on-chain', 'BTC', '0.001', '50000'),
        createFeeMovement('platform', 'on-chain', 'BTC', '0.002', '50000'),
      ]);

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
      const tx = createMockTransaction(1, '2024-01-01T00:00:00Z', {}, [
        createFeeMovement('network', 'on-chain', 'ETH', '0.01', '3000'),
      ]);

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
      const sourceTx = createMockTransaction(1, '2024-01-01T00:00:00Z', {}, [
        createFeeMovement('platform', 'balance', 'USD', '1.50', '1'),
      ]);
      const targetTx = createMockTransaction(2, '2024-01-01T00:00:00Z', {}, [
        createFeeMovement('platform', 'balance', 'EUR', '2.00', '1.1'),
      ]);

      const result = collectFiatFees(sourceTx, targetTx);

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value.length).toBe(2);
        expect(result.value[0]!.assetSymbol).toBe('USD');
        expect(result.value[0]!.amount.toFixed()).toBe('1.5');
        expect(result.value[0]!.txId).toBe(1);
        expect(result.value[1]!.assetSymbol).toBe('EUR');
        expect(result.value[1]!.amount.toFixed()).toBe('2');
        expect(result.value[1]!.txId).toBe(2);
      }
    });

    it('should ignore crypto fees', () => {
      const sourceTx = createMockTransaction(1, '2024-01-01T00:00:00Z', {}, [
        createFeeMovement('network', 'on-chain', 'BTC', '0.001', '50000'),
      ]);
      const targetTx = createMockTransaction(2, '2024-01-01T00:00:00Z', {}, [
        createFeeMovement('platform', 'on-chain', 'ETH', '0.01', '3000'),
      ]);

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

  describe('calculateFeesInFiat', () => {
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
        [createFeeMovement('platform', 'balance', 'USD', '80', '1')]
      );

      const btcMovement = tx.movements.inflows![0]!;
      const ethMovement = tx.movements.inflows![1]!;

      const btcFeeResult = calculateFeesInFiat(tx, btcMovement, true);
      const ethFeeResult = calculateFeesInFiat(tx, ethMovement, true);

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

      const result = calculateFeesInFiat(tx, tx.movements.inflows![0]!, true);

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
        [createFeeMovement('network', 'on-chain', 'BTC', '0.001', '50000')]
      );

      const result = calculateFeesInFiat(tx, feeMovement, true);

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
        [createFeeMovement('platform', 'balance', 'USD', '10', '1')]
      );

      const token1Movement = tx.movements.inflows![0]!;
      const result = calculateFeesInFiat(tx, token1Movement, true);

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
        [createFeeMovement('platform', 'balance', 'USD', '100', '1')]
      );

      const result = calculateFeesInFiat(tx, tx.movements.inflows![0]!, true);

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        // Single BTC inflow gets ALL the $100 fee allocated to it (no other movements to split with)
        expect(result.value.toFixed()).toBe('100');
      }
    });

    it('should use fee price when available (even if fiat currency differs)', () => {
      const tx = createMockTransaction(
        1,
        '2024-01-01T00:00:00Z',
        {
          inflows: [createMovement('BTC', '1', '50000', 'USD')],
        },
        [createFeeMovement('platform', 'balance', 'EUR', '50', '1')] // EUR fee with $1 USD price
      );

      const result = calculateFeesInFiat(tx, tx.movements.inflows![0]!, true);

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        // Fee has price: 50 EUR * $1 = $50, allocated to single BTC movement
        expect(result.value.toFixed()).toBe('50');
      }
    });

    it('should error on crypto fee without price', () => {
      const tx = createMockTransaction(
        1,
        '2024-01-01T00:00:00Z',
        {
          inflows: [createMovement('BTC', '1', '50000')],
        },
        [createFeeMovement('network', 'on-chain', 'ETH', '0.01')] // Crypto fee without price
      );

      const result = calculateFeesInFiat(tx, tx.movements.inflows![0]!, true);

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
        [createFeeMovement('platform', 'balance', 'USD', '10', '1')]
      );

      const usdMovement = tx.movements.inflows![1]!;
      const result = calculateFeesInFiat(tx, usdMovement, true);

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
      expect(grouped.get('test:btc')?.transactions.map((t) => t.id)).toEqual([1, 2]);
      expect(grouped.get('test:eth')?.transactions.map((t) => t.id)).toEqual([3]);
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
      expect(grouped.get('test:btc')?.transactions.map((t) => t.id)).toEqual([1]);
      expect(grouped.get('test:usd')?.transactions.map((t) => t.id)).toEqual([1]);
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
        [createFeeMovement('platform', 'balance', 'USD', '100', '1')]
      );

      const result = buildAcquisitionLotFromInflow(tx, tx.movements.inflows![0]!, 'calc-123', 'fifo');

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        const lot = result.value;
        expect(lot.assetSymbol).toBe('BTC');
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
    it('should NOT subtract platform fees from disposal proceeds (ADR-005)', () => {
      const tx = createMockTransaction(
        1,
        '2024-01-01T00:00:00Z',
        {
          outflows: [createMovement('BTC', '1', '52000')],
        },
        [createFeeMovement('platform', 'balance', 'USD', '200', '1')] // Platform fee with balance settlement
      );

      const result = calculateNetProceeds(tx, tx.movements.outflows![0]!);

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        // Per ADR-005: Only on-chain fees reduce disposal proceeds
        // Platform fees (settlement='balance') are charged separately and don't affect proceeds
        // Gross: 1 * 52000 = 52000
        // Fee subtracted: $0 (platform fee not included)
        // Proceeds per unit: 52000
        expect(result.value.proceedsPerUnit.toFixed()).toBe('52000');
        expect(result.value.totalFeeAmount.toFixed()).toBe('0');
      }
    });

    it('should subtract on-chain fees from disposal proceeds (ADR-005)', () => {
      const tx = createMockTransaction(
        1,
        '2024-01-01T00:00:00Z',
        {
          outflows: [createMovement('ETH', '1', '3500')],
        },
        [createFeeMovement('network', 'on-chain', 'ETH', '0.002', '3500')] // Network fee with on-chain settlement
      );

      const result = calculateNetProceeds(tx, tx.movements.outflows![0]!);

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        // Per ADR-005: On-chain fees DO reduce disposal proceeds
        // Gross proceeds: 1 * 3500 = 3500
        // Fee: 0.002 * 3500 = 7
        // Net proceeds: 3500 - 7 = 3493
        // Per unit: 3493 / 1 = 3493
        expect(result.value.proceedsPerUnit.toFixed()).toBe('3493');
        expect(result.value.totalFeeAmount.toFixed()).toBe('7');
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
      const result = validateTransferVariance(parseDecimal('1'), new Decimal('1.005'), 'kraken', 1, 'BTC');

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value.variancePct.toFixed(2)).toBe('0.50');
      }
    });

    it('should error when exceeding error threshold', () => {
      const result = validateTransferVariance(parseDecimal('1'), new Decimal('1.05'), 'kraken', 1, 'BTC');

      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error.message).toContain('Transfer amount mismatch');
        expect(result.error.message).toContain('5.00% variance');
      }
    });

    it('should handle zero actual amount', () => {
      const result = validateTransferVariance(parseDecimal('0'), new Decimal('1'), 'kraken', 1, 'BTC');

      // When actual is zero, variance is 0%
      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value.variancePct.toFixed()).toBe('0');
      }
    });

    it('should respect config override', () => {
      const result = validateTransferVariance(
        parseDecimal('1'),
        parseDecimal('1.15'),
        'kraken',
        1,
        'BTC',
        { warn: 10, error: 20 } // High tolerance
      );

      expect(result.isOk()).toBe(true);
    });
  });

  describe('validateOutflowFees', () => {
    it('should pass when netAmount matches grossAmount minus on-chain fees', () => {
      const outflow: AssetMovement = {
        assetId: 'test:btc',
        assetSymbol: 'BTC',
        grossAmount: parseDecimal('1.0'),
        netAmount: parseDecimal('0.9995'),
      };
      const tx = createMockTransaction(1, '2024-01-01T00:00:00Z', {}, [
        createFeeMovement('network', 'on-chain', 'BTC', '0.0005', '50000'),
      ]);

      const result = validateOutflowFees(outflow, tx, 'kraken', 1);

      expect(result.isOk()).toBe(true);
    });

    it('should pass when no netAmount is provided (legacy data)', () => {
      const outflow: AssetMovement = {
        assetId: 'test:btc',
        assetSymbol: 'BTC',
        grossAmount: parseDecimal('1.0'),
      };
      const tx = createMockTransaction(1, '2024-01-01T00:00:00Z', {});

      const result = validateOutflowFees(outflow, tx, 'kraken', 1);

      expect(result.isOk()).toBe(true);
    });

    it('should ignore balance-settled fees when validating netAmount', () => {
      const outflow: AssetMovement = {
        assetId: 'test:btc',
        assetSymbol: 'BTC',
        grossAmount: parseDecimal('1.0'),
        netAmount: parseDecimal('1.0'),
      };
      const tx = createMockTransaction(1, '2024-01-01T00:00:00Z', {}, [
        createFeeMovement('platform', 'balance', 'BTC', '0.0004', '50000'),
      ]);

      const result = validateOutflowFees(outflow, tx, 'kraken', 1);

      expect(result.isOk()).toBe(true);
    });

    it('should error when hidden fees exceed error threshold', () => {
      const outflow: AssetMovement = {
        assetId: 'test:btc',
        assetSymbol: 'BTC',
        grossAmount: parseDecimal('1.0'),
        netAmount: parseDecimal('0.94'),
      };
      const tx = createMockTransaction(1, '2024-01-01T00:00:00Z', {}, [
        createFeeMovement('network', 'on-chain', 'BTC', '0.0005', '50000'),
      ]);

      const result = validateOutflowFees(outflow, tx, 'binance', 1);

      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error.message).toContain('Outflow fee validation failed');
        expect(result.error.message).toContain('hidden fee');
        expect(result.error.message).toContain('Exceeds error threshold');
      }
    });

    it('should pass when hidden fees are within error threshold', () => {
      const outflow: AssetMovement = {
        assetId: 'test:btc',
        assetSymbol: 'BTC',
        grossAmount: parseDecimal('1.0'),
        netAmount: parseDecimal('0.98'),
      };
      const tx = createMockTransaction(1, '2024-01-01T00:00:00Z', {}, []);

      const result = validateOutflowFees(outflow, tx, 'binance', 1);

      expect(result.isOk()).toBe(true);
    });

    it('should sum multiple on-chain fees when validating', () => {
      const outflow: AssetMovement = {
        assetId: 'test:btc',
        assetSymbol: 'BTC',
        grossAmount: parseDecimal('1.0'),
        netAmount: parseDecimal('0.9988'),
      };
      const tx = createMockTransaction(1, '2024-01-01T00:00:00Z', {}, [
        createFeeMovement('network', 'on-chain', 'BTC', '0.0007', '50000'),
        createFeeMovement('platform', 'on-chain', 'BTC', '0.0005', '50000'),
      ]);

      const result = validateOutflowFees(outflow, tx, 'kraken', 1);

      expect(result.isOk()).toBe(true);
    });

    it('should use custom tolerance when provided', () => {
      const outflow: AssetMovement = {
        assetId: 'test:btc',
        assetSymbol: 'BTC',
        grossAmount: parseDecimal('1.0'),
        netAmount: parseDecimal('0.92'),
      };
      const tx = createMockTransaction(1, '2024-01-01T00:00:00Z', {}, []);

      const result = validateOutflowFees(outflow, tx, 'kraken', 1, { warn: 5.0, error: 10.0 });

      expect(result.isOk()).toBe(true);
    });
  });

  describe('calculateTransferDisposalAmount', () => {
    it('should return full amount for add-to-basis policy', () => {
      const outflow = createMovement('BTC', '1', '50000');
      const cryptoFee = {
        amount: parseDecimal('0.001'),
        feeType: 'network',
        priceAtTxTime: createPriceAtTxTime('50000'),
      };

      const result = calculateTransferDisposalAmount(outflow, cryptoFee, 'add-to-basis');

      expect(result.transferDisposalQuantity.toFixed()).toBe('1');
    });

    it('should return net amount for disposal policy', () => {
      const outflow = createMovement('BTC', '1', '50000');
      const cryptoFee = {
        amount: parseDecimal('0.001'),
        feeType: 'network',
        priceAtTxTime: createPriceAtTxTime('50000'),
      };

      const result = calculateTransferDisposalAmount(outflow, cryptoFee, 'disposal');

      expect(result.transferDisposalQuantity.toFixed()).toBe('0.999');
    });

    it('should handle zero fee', () => {
      const outflow = createMovement('BTC', '1', '50000');
      const cryptoFee = { amount: parseDecimal('0'), feeType: 'none', priceAtTxTime: undefined };

      const result = calculateTransferDisposalAmount(outflow, cryptoFee, 'disposal');

      expect(result.transferDisposalQuantity.toFixed()).toBe('1');
    });
  });

  describe('buildTransferMetadata', () => {
    it('should build metadata with crypto fee for add-to-basis policy', () => {
      const cryptoFee = { amount: parseDecimal('0.001'), priceAtTxTime: createPriceAtTxTime('50000') };

      const metadata = buildTransferMetadata(cryptoFee, 'add-to-basis', parseDecimal('0.5'), new Decimal('1'));

      expect(metadata).toBeDefined();
      expect(metadata?.cryptoFeeUsdValue).toBeDefined();
      // Fee share: (0.5 / 1) * (0.001 * 50000) = 25
      expect(metadata?.cryptoFeeUsdValue?.toFixed()).toBe('25');
    });

    it('should return undefined for disposal policy', () => {
      const cryptoFee = { amount: parseDecimal('0.001'), priceAtTxTime: createPriceAtTxTime('50000') };

      const metadata = buildTransferMetadata(cryptoFee, 'disposal', parseDecimal('0.5'), new Decimal('1'));

      expect(metadata).toBeUndefined();
    });

    it('should return undefined for zero fee', () => {
      const cryptoFee = { amount: parseDecimal('0'), priceAtTxTime: undefined };

      const metadata = buildTransferMetadata(cryptoFee, 'add-to-basis', parseDecimal('0.5'), new Decimal('1'));

      expect(metadata).toBeUndefined();
    });

    it('should return undefined when fee has no price', () => {
      const cryptoFee = { amount: parseDecimal('0.001'), priceAtTxTime: undefined };

      const metadata = buildTransferMetadata(cryptoFee, 'add-to-basis', parseDecimal('0.5'), new Decimal('1'));

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
          quantityTransferred: parseDecimal('0.5'),
          costBasisPerUnit: parseDecimal('50000'),
          sourceTransactionId: 1,
          targetTransactionId: 2,
          createdAt: new Date(),
        },
        {
          id: '2',
          calculationId: 'calc-1',
          sourceLotId: 'lot-2',
          linkId: 'link-1',
          quantityTransferred: parseDecimal('0.3'),
          costBasisPerUnit: parseDecimal('51000'),
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
          quantityTransferred: parseDecimal('0.5'),
          costBasisPerUnit: parseDecimal('50000'),
          sourceTransactionId: 1,
          targetTransactionId: 2,
          metadata: { cryptoFeeUsdValue: parseDecimal('25') },
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
        { amount: parseDecimal('10'), priceAtTxTime: createPriceAtTxTime('1') },
        { amount: parseDecimal('5'), priceAtTxTime: createPriceAtTxTime('1') },
      ];

      const result = calculateTargetCostBasis(parseDecimal('50000'), fiatFees, new Decimal('1'));

      // (50000 + 10 + 5) / 1 = 50015
      expect(result.toFixed()).toBe('50015');
    });

    it('should ignore fiat fees without prices', () => {
      const fiatFees = [
        { amount: parseDecimal('10'), priceAtTxTime: createPriceAtTxTime('1') },
        { amount: parseDecimal('5'), priceAtTxTime: undefined },
      ];

      const result = calculateTargetCostBasis(parseDecimal('50000'), fiatFees, new Decimal('1'));

      // (50000 + 10) / 1 = 50010
      expect(result.toFixed()).toBe('50010');
    });

    it('should handle zero fiat fees', () => {
      const result = calculateTargetCostBasis(parseDecimal('50000'), [], new Decimal('2'));

      // 50000 / 2 = 25000
      expect(result.toFixed()).toBe('25000');
    });

    it('should divide by received quantity', () => {
      const fiatFees = [{ amount: parseDecimal('100'), priceAtTxTime: createPriceAtTxTime('1') }];

      const result = calculateTargetCostBasis(parseDecimal('50000'), fiatFees, new Decimal('0.5'));

      // (50000 + 100) / 0.5 = 100200
      expect(result.toFixed()).toBe('100200');
    });
  });
});
