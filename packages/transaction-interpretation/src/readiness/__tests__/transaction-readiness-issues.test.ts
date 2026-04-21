import type { Transaction } from '@exitbook/core';
import { type Currency, parseDecimal } from '@exitbook/foundation';
import { describe, expect, it } from 'vitest';

import { collectTransactionReadinessIssues } from '../transaction-readiness-issues.js';

function makeTransaction(overrides: Partial<Transaction> = {}): Transaction {
  return {
    id: overrides.id ?? 11,
    accountId: overrides.accountId ?? 7,
    txFingerprint: overrides.txFingerprint ?? 'tx-readiness',
    datetime: '2025-01-01T00:00:00.000Z',
    timestamp: 1_735_689_600_000,
    platformKey: overrides.platformKey ?? 'cardano',
    platformKind: overrides.platformKind ?? 'blockchain',
    status: 'success',
    from: 'source',
    to: 'target',
    movements: overrides.movements ?? {
      inflows: [
        {
          assetId: 'blockchain:cardano:native',
          assetSymbol: 'ADA' as Currency,
          grossAmount: parseDecimal('10.5'),
          netAmount: parseDecimal('10.5'),
          movementFingerprint: 'in-0',
          movementRole: 'principal',
        },
      ],
      outflows: [],
    },
    fees: [],
    diagnostics: overrides.diagnostics ?? [],
    operation: overrides.operation ?? { category: 'transfer', type: 'deposit' },
    blockchain: {
      name: overrides.platformKey ?? 'cardano',
      transaction_hash: '0xhash',
      is_confirmed: true,
    },
    excludedFromAccounting: false,
    ...overrides,
  };
}

describe('collectTransactionReadinessIssues', () => {
  it('reports unknown classification when only diagnostic-based operation meaning exists', () => {
    const transaction = makeTransaction({
      diagnostics: [
        {
          code: 'classification_uncertain',
          message: 'Needs review',
          severity: 'warning',
        },
      ],
    });

    expect(collectTransactionReadinessIssues(transaction)).toEqual([
      {
        code: 'unknown_classification',
        diagnosticCode: 'classification_uncertain',
        diagnosticMessage: 'Needs review',
      },
    ]);
  });

  it('suppresses unknown classification when asserted annotations resolve the operation', () => {
    const transaction = makeTransaction({
      diagnostics: [
        {
          code: 'classification_uncertain',
          message: 'Needs review',
          severity: 'warning',
        },
      ],
    });

    expect(
      collectTransactionReadinessIssues(transaction, [
        {
          annotationFingerprint: 'annotation:bridge:tx-readiness',
          accountId: transaction.accountId,
          transactionId: transaction.id,
          txFingerprint: transaction.txFingerprint,
          kind: 'bridge_participant',
          tier: 'asserted',
          target: { scope: 'transaction' },
          role: 'source',
          protocolRef: { id: 'wormhole' },
          detectorId: 'bridge-participant',
          derivedFromTxIds: [transaction.id],
          provenanceInputs: ['processor', 'diagnostic'],
        },
      ])
    ).toEqual([]);
  });

  it('reports allocation uncertainty independently from operation interpretation', () => {
    const transaction = makeTransaction({
      diagnostics: [
        {
          code: 'allocation_uncertain',
          message: 'Per-asset proceeds split is not exact',
          severity: 'warning',
        },
      ],
    });

    expect(collectTransactionReadinessIssues(transaction)).toEqual([
      {
        code: 'uncertain_proceeds_allocation',
        diagnosticCode: 'allocation_uncertain',
        diagnosticMessage: 'Per-asset proceeds split is not exact',
      },
    ]);
  });
});
