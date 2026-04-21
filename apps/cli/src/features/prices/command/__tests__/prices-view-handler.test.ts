import type { Transaction } from '@exitbook/core';
import type { DataSession } from '@exitbook/data/session';
import { ok, parseDecimal, type Currency } from '@exitbook/foundation';
import { ANNOTATION_KINDS, ANNOTATION_TIERS, type TransactionAnnotation } from '@exitbook/transaction-interpretation';
import { describe, expect, it, vi } from 'vitest';

import { createPersistedTransaction } from '../../../shared/__tests__/transaction-test-utils.js';
import { PricesViewHandler } from '../prices-view-handler.js';

function createTransaction(): Transaction {
  return createPersistedTransaction({
    id: 7,
    accountId: 1,
    txFingerprint: 'prices-view-handler-test-7',
    datetime: '2025-01-01T00:00:00.000Z',
    timestamp: Date.parse('2025-01-01T00:00:00.000Z'),
    platformKey: 'ethereum',
    platformKind: 'blockchain',
    status: 'success',
    operation: { category: 'transfer', type: 'withdrawal' },
    movements: {
      outflows: [
        {
          assetId: 'asset:eth',
          assetSymbol: 'ETH' as Currency,
          grossAmount: parseDecimal('1'),
          netAmount: parseDecimal('1'),
        },
      ],
    },
    fees: [],
    diagnostics: [],
    userNotes: [],
    from: 'wallet-a',
    to: 'bridge-router',
  });
}

function createAnnotation(transaction: Transaction): TransactionAnnotation {
  return {
    annotationFingerprint: 'annotation:prices:7',
    accountId: transaction.accountId,
    transactionId: transaction.id,
    txFingerprint: transaction.txFingerprint,
    kind: 'bridge_participant',
    tier: 'asserted',
    role: 'source',
    target: { scope: 'transaction' },
    detectorId: 'bridge-detector',
    derivedFromTxIds: [transaction.id],
    provenanceInputs: ['diagnostic'],
  };
}

describe('PricesViewHandler.executeMissing', () => {
  it('derives operation labels from persisted transaction annotations', async () => {
    const transaction = createTransaction();
    const findAll = vi.fn().mockResolvedValue(ok([transaction]));
    const readAnnotations = vi.fn().mockResolvedValue(ok([createAnnotation(transaction)]));
    const db = {
      transactions: {
        findAll,
      },
      transactionAnnotations: {
        readAnnotations,
      },
    } as unknown as DataSession;

    const handler = new PricesViewHandler(db, 1);
    const result = await handler.executeMissing({});

    expect(result.isOk()).toBe(true);
    if (result.isErr()) {
      throw result.error;
    }

    expect(readAnnotations).toHaveBeenCalledWith({
      transactionIds: [transaction.id],
      kinds: ANNOTATION_KINDS,
      tiers: ANNOTATION_TIERS,
    });
    expect(result.value.movements).toHaveLength(1);
    expect(result.value.movements[0]?.operationLabel).toBe('bridge/send');
  });
});
