import type { Currency, Transaction, TransactionLink } from '@exitbook/core';
import { parseDecimal } from '@exitbook/core';
import { ok } from '@exitbook/core';
import { seedAssetMovementFingerprint } from '@exitbook/core/test-utils';
import type { DataContext } from '@exitbook/data';
import { Decimal } from 'decimal.js';
import { vi, type Mock } from 'vitest';

import { createPersistedTransaction } from '../../shared/__tests__/transaction-test-utils.js';
import type { LinkGapAnalysis } from '../command/links-gap-utils.ts';
import type { LinkWithTransactions } from '../view/links-view-state.js';

/**
 * Create a mock transaction link with sensible defaults
 */
export function createMockLink(
  id: number,
  overrides: {
    assetSymbol?: Currency;
    confidenceScore?: number | Decimal;
    metadata?: TransactionLink['metadata'];
    reviewedAt?: Date;
    reviewedBy?: string;
    sourceMovementFingerprint?: string;
    sourceTransactionId?: number;
    status?: 'suggested' | 'confirmed' | 'rejected';
    targetMovementFingerprint?: string;
    targetTransactionId?: number;
  } = {}
): TransactionLink {
  const confidenceScore = overrides.confidenceScore ?? 0.85;
  const confidenceDecimal =
    typeof confidenceScore === 'number' ? parseDecimal(confidenceScore.toString()) : confidenceScore;

  return {
    id,
    sourceTransactionId: overrides.sourceTransactionId ?? 1,
    targetTransactionId: overrides.targetTransactionId ?? 2,
    assetSymbol: overrides.assetSymbol ?? ('BTC' as Currency),
    sourceAssetId: 'exchange:source:btc',
    targetAssetId: 'blockchain:target:btc',
    sourceAmount: parseDecimal('1.0'),
    targetAmount: parseDecimal('1.0'),
    sourceMovementFingerprint: overrides.sourceMovementFingerprint ?? 'movement:exchange:source:1:btc:outflow:0',
    targetMovementFingerprint: overrides.targetMovementFingerprint ?? 'movement:blockchain:target:2:btc:inflow:0',
    linkType: 'exchange_to_blockchain',
    confidenceScore: confidenceDecimal,
    matchCriteria: {
      assetMatch: true,
      amountSimilarity: parseDecimal('0.99'),
      timingValid: true,
      timingHours: 1,
      addressMatch: true,
    },
    status: overrides.status ?? 'suggested',
    reviewedBy: overrides.reviewedBy,
    reviewedAt: overrides.reviewedAt,
    createdAt: new Date('2024-01-01T12:00:00Z'),
    updatedAt: new Date('2024-01-01T12:00:00Z'),
    metadata: overrides.metadata,
  };
}

/**
 * Create a mock transaction with sensible defaults
 */
export function createMockTransaction(
  id: number,
  overrides: {
    assetSymbol?: Currency;
    movements?: {
      inflows?: { amount: string; assetSymbol: string }[];
      outflows?: { amount: string; assetSymbol: string }[];
    };
    source?: string;
  } = {}
): Transaction {
  const inflows = overrides.movements?.inflows ?? [{ assetSymbol: overrides.assetSymbol ?? 'BTC', amount: '1.0' }];
  const outflows = overrides.movements?.outflows ?? [];
  const txFingerprint = `tx-${id}`;

  return createPersistedTransaction({
    id,
    accountId: 1,
    txFingerprint,
    source: overrides.source ?? 'test-source',
    sourceType: 'exchange',
    datetime: '2024-01-01T12:00:00Z',
    timestamp: Date.parse('2024-01-01T12:00:00Z'),
    status: 'success',
    from: '0x1234567890abcdef1234567890abcdef12345678',
    to: '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd',
    movements: {
      inflows: inflows.map((inflow) => {
        const grossAmt = parseDecimal(inflow.amount);
        const netAmount = grossAmt.times(0.999);
        return {
          assetId: 'test:btc',
          assetSymbol: (inflow.assetSymbol as Currency) ?? ('BTC' as Currency),
          grossAmount: grossAmt,
          netAmount,
        };
      }),
      outflows: outflows.map((outflow) => {
        const grossAmt = parseDecimal(outflow.amount);
        const netAmount = grossAmt.times(0.999);
        return {
          assetId: 'test:btc',
          assetSymbol: (outflow.assetSymbol as Currency) ?? ('BTC' as Currency),
          grossAmount: grossAmt,
          netAmount,
        };
      }),
    },
    fees: [],
    operation: {
      category: 'transfer',
      type: 'deposit',
    },
  });
}

/**
 * Create a mock LinkWithTransactions for view controller tests
 */
function createMockLinkWithTransactions(
  id: number,
  overrides: {
    assetSymbol?: Currency;
    confidence?: number;
    reviewedAt?: Date;
    reviewedBy?: string;
    status?: 'suggested' | 'confirmed' | 'rejected';
  } = {}
): LinkWithTransactions {
  const confidence = overrides.confidence ?? 0.85;

  return {
    link: createMockLink(id, {
      assetSymbol: overrides.assetSymbol ?? ('BTC' as Currency),
      confidenceScore: confidence,
      sourceMovementFingerprint: `movement:exchange:source:${id}:btc:outflow:0`,
      sourceTransactionId: id * 10 + 1,
      status: overrides.status ?? 'suggested',
      targetMovementFingerprint: `movement:blockchain:target:${id}:btc:inflow:0`,
      targetTransactionId: id * 10 + 2,
      ...(overrides.reviewedBy !== undefined && { reviewedBy: overrides.reviewedBy }),
      ...(overrides.reviewedAt !== undefined && { reviewedAt: overrides.reviewedAt }),
    }),
    sourceTransaction: undefined,
    targetTransaction: undefined,
  };
}

/**
 * Create a batch of mock links with various statuses and confidence levels
 */
export function createMockLinksBatch(count = 4): LinkWithTransactions[] {
  return [
    createMockLinkWithTransactions(1, {
      assetSymbol: 'ETH' as Currency,
      confidence: 0.98,
      status: 'confirmed',
      reviewedBy: 'user@example.com',
      reviewedAt: new Date('2024-03-20T12:00:00Z'),
    }),
    createMockLinkWithTransactions(2, {
      assetSymbol: 'BTC' as Currency,
      confidence: 0.96,
      status: 'confirmed',
      reviewedBy: 'user@example.com',
      reviewedAt: new Date('2024-03-20T12:00:00Z'),
    }),
    createMockLinkWithTransactions(3, {
      assetSymbol: 'ETH' as Currency,
      confidence: 0.82,
      status: 'suggested',
    }),
    ...(count > 3
      ? [
          createMockLinkWithTransactions(4, {
            assetSymbol: 'ETH' as Currency,
            confidence: 0.52,
            status: 'rejected',
            reviewedBy: 'user@example.com',
            reviewedAt: new Date('2024-03-20T12:00:00Z'),
          }),
        ]
      : []),
  ];
}

/**
 * Create mock transaction objects for handler tests
 */
export function createMockTransactionObjects() {
  return {
    source: {
      id: 1,
      accountId: 1,
      source: 'kraken',
      txFingerprint: 'txfp:kraken:1:WITHDRAWAL-123',
    },
    target: {
      id: 2,
      accountId: 2,
      source: 'blockchain:bitcoin',
      txFingerprint: 'txfp:bitcoin:2:abc123',
    },
  };
}

export function createConfirmableTransferFixture(
  overrides: {
    sourceAmount?: string;
    status?: 'suggested' | 'confirmed' | 'rejected';
    targetAmount?: string;
  } = {}
): {
  link: TransactionLink;
  sourceTransaction: Transaction;
  targetTransaction: Transaction;
  transactions: Transaction[];
} {
  const sourceAmount = overrides.sourceAmount ?? '1';
  const targetAmount = overrides.targetAmount ?? sourceAmount;

  const sourceTransaction: Transaction = {
    id: 1,
    accountId: 1,
    txFingerprint: 'txfp:kraken:1:WITHDRAWAL-123',
    source: 'kraken',
    sourceType: 'exchange',
    datetime: '2024-01-01T12:00:00Z',
    timestamp: Date.parse('2024-01-01T12:00:00Z'),
    status: 'success',
    movements: {
      inflows: [],
      outflows: [
        {
          assetId: 'exchange:source:btc',
          assetSymbol: 'BTC' as Currency,
          movementFingerprint: seedAssetMovementFingerprint(
            'txfp:kraken:1:WITHDRAWAL-123',
            'outflow',
            {
              assetId: 'exchange:source:btc',
              grossAmount: parseDecimal(sourceAmount),
              netAmount: parseDecimal(sourceAmount),
            },
            1
          ),
          grossAmount: parseDecimal(sourceAmount),
          netAmount: parseDecimal(sourceAmount),
        },
      ],
    },
    fees: [],
    operation: {
      category: 'transfer',
      type: 'withdrawal',
    },
  };

  const targetTransaction: Transaction = {
    id: 2,
    accountId: 2,
    txFingerprint: 'txfp:bitcoin:2:abc123',
    source: 'bitcoin',
    sourceType: 'blockchain',
    datetime: '2024-01-01T12:30:00Z',
    timestamp: Date.parse('2024-01-01T12:30:00Z'),
    status: 'success',
    movements: {
      inflows: [
        {
          assetId: 'blockchain:target:btc',
          assetSymbol: 'BTC' as Currency,
          movementFingerprint: seedAssetMovementFingerprint(
            'txfp:bitcoin:2:abc123',
            'inflow',
            {
              assetId: 'blockchain:target:btc',
              grossAmount: parseDecimal(targetAmount),
              netAmount: parseDecimal(targetAmount),
            },
            1
          ),
          grossAmount: parseDecimal(targetAmount),
          netAmount: parseDecimal(targetAmount),
        },
      ],
      outflows: [],
    },
    fees: [],
    operation: {
      category: 'transfer',
      type: 'deposit',
    },
  };

  const link: TransactionLink = {
    ...createMockLink(123, { status: overrides.status ?? 'suggested' }),
    sourceAssetId: 'exchange:source:btc',
    targetAssetId: 'blockchain:target:btc',
    sourceAmount: parseDecimal(sourceAmount),
    targetAmount: parseDecimal(targetAmount),
    sourceMovementFingerprint: sourceTransaction.movements.outflows![0]!.movementFingerprint,
    targetMovementFingerprint: targetTransaction.movements.inflows![0]!.movementFingerprint,
  };

  return {
    link,
    transactions: [sourceTransaction, targetTransaction],
    sourceTransaction,
    targetTransaction,
  };
}

/**
 * Create a mock transaction links repository
 */
export function createMockLinkRepository(): {
  findAll: Mock;
  findById: Mock;
  updateStatus: Mock;
  updateStatuses: Mock;
} {
  return {
    findById: vi.fn(),
    findAll: vi.fn(),
    updateStatus: vi.fn(),
    updateStatuses: vi.fn(),
  };
}

/**
 * Create a mock transactions repository
 */
export function createMockTransactionRepository(): {
  findAll: Mock;
  findById: Mock;
} {
  return {
    findAll: vi.fn(),
    findById: vi.fn(),
  };
}

/**
 * Create a mock override store
 */
export function createMockOverrideStore(): {
  append: Mock;
  exists: Mock;
  readAll: Mock;
} {
  return {
    append: vi.fn().mockResolvedValue(ok({ id: 'test-event-id' })),
    exists: vi.fn(),
    readAll: vi.fn(),
  };
}

/**
 * Create a mock DataContext with transaction and links repositories
 */
export function createMockDataContext(
  overrides: {
    transactionLinks?: ReturnType<typeof createMockLinkRepository>;
    transactions?: ReturnType<typeof createMockTransactionRepository>;
  } = {}
): DataContext {
  const transactionLinks = overrides.transactionLinks ?? createMockLinkRepository();
  const transactions = overrides.transactions ?? createMockTransactionRepository();

  return {
    transactionLinks,
    transactions,
    executeInTransaction: vi.fn(async (fn: (tx: DataContext) => Promise<unknown>) =>
      fn({
        transactionLinks,
        transactions,
      } as unknown as DataContext)
    ),
  } as unknown as DataContext;
}

/**
 * Create mock gap analysis data
 */
export function createMockGapAnalysis(): LinkGapAnalysis {
  return {
    issues: [
      {
        transactionId: 2041,
        txFingerprint: 'eth-inflow-1',
        source: 'ethereum',
        blockchain: 'ethereum',
        timestamp: '2024-03-18T09:12:34Z',
        assetSymbol: 'ETH',
        missingAmount: '1.5',
        totalAmount: '1.5',
        confirmedCoveragePercent: '0',
        operationCategory: 'transfer',
        operationType: 'deposit',
        suggestedCount: 2,
        highestSuggestedConfidencePercent: '82.4',
        direction: 'inflow',
      },
      {
        transactionId: 2198,
        txFingerprint: 'eth-inflow-2',
        source: 'ethereum',
        blockchain: 'ethereum',
        timestamp: '2024-04-02T14:45:00Z',
        assetSymbol: 'ETH',
        missingAmount: '2.0',
        totalAmount: '2.0',
        confirmedCoveragePercent: '0',
        operationCategory: 'transfer',
        operationType: 'deposit',
        suggestedCount: 0,
        direction: 'inflow',
      },
      {
        transactionId: 2456,
        txFingerprint: 'kraken-outflow-1',
        source: 'kraken',
        timestamp: '2024-05-01T16:20:00Z',
        assetSymbol: 'ETH',
        missingAmount: '1.2',
        totalAmount: '1.2',
        confirmedCoveragePercent: '0',
        operationCategory: 'transfer',
        operationType: 'withdrawal',
        suggestedCount: 1,
        highestSuggestedConfidencePercent: '74.8',
        direction: 'outflow',
      },
    ],
    summary: {
      total_issues: 3,
      uncovered_inflows: 2,
      unmatched_outflows: 1,
      affected_assets: 1,
      assets: [
        {
          assetSymbol: 'ETH',
          inflowOccurrences: 2,
          inflowMissingAmount: '3.5',
          outflowOccurrences: 1,
          outflowMissingAmount: '1.2',
        },
      ],
    },
  };
}
