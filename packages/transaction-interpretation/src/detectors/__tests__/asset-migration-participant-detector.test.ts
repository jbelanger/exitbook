import type { Transaction } from '@exitbook/core';
import { parseDecimal, type Currency } from '@exitbook/foundation';
import { assertOk } from '@exitbook/foundation/test-utils';
import { describe, expect, it } from 'vitest';

import { AssetMigrationParticipantDetector } from '../asset-migration-participant-detector.js';

function makeTransaction(
  overrides: Partial<Transaction> & {
    diagnostics?: Transaction['diagnostics'];
    inflowCount?: number | undefined;
    outflowCount?: number | undefined;
  } = {}
): Transaction {
  const inflowCount = overrides.inflowCount ?? 0;
  const outflowCount = overrides.outflowCount ?? 1;

  return {
    id: overrides.id ?? 11,
    accountId: overrides.accountId ?? 7,
    txFingerprint: overrides.txFingerprint ?? 'tx-migration',
    datetime: '2025-01-01T00:00:00.000Z',
    timestamp: 1_735_689_600_000,
    platformKey: overrides.platformKey ?? 'kraken',
    platformKind: overrides.platformKind ?? 'exchange',
    status: 'success',
    from: 'source-address',
    to: 'destination-address',
    movements: {
      inflows: Array.from({ length: inflowCount }, (_, index) => ({
        assetId: 'exchange:kraken:render',
        assetSymbol: 'RENDER' as Currency,
        grossAmount: parseDecimal('100'),
        netAmount: parseDecimal('100'),
        movementFingerprint: `in-${index}`,
      })),
      outflows: Array.from({ length: outflowCount }, (_, index) => ({
        assetId: 'exchange:kraken:rndr',
        assetSymbol: 'RNDR' as Currency,
        grossAmount: parseDecimal('100'),
        netAmount: parseDecimal('100'),
        movementFingerprint: `out-${index}`,
      })),
    },
    fees: [],
    operation: overrides.operation ?? { category: 'transfer', type: 'withdrawal' },
    blockchain: undefined,
    diagnostics: overrides.diagnostics,
    excludedFromAccounting: false,
    ...overrides,
  };
}

describe('AssetMigrationParticipantDetector', () => {
  it('emits a heuristic source annotation for a one-way migration outflow', async () => {
    const detector = new AssetMigrationParticipantDetector();
    const transaction = makeTransaction({
      diagnostics: [
        {
          code: 'possible_asset_migration',
          message: 'Kraken spotfromfutures rows may reflect an internal asset migration.',
          severity: 'info',
          metadata: {
            migrationGroupKey: 'migration-group-rndr',
            providerSubtype: 'spotfromfutures',
          },
        },
      ],
      inflowCount: 0,
      outflowCount: 1,
    });

    const result = await detector.run({
      accountId: transaction.accountId,
      transactionId: transaction.id,
      txFingerprint: transaction.txFingerprint,
      transaction,
    });

    const annotation = assertOk(result).annotations[0];
    expect(annotation).toMatchObject({
      accountId: transaction.accountId,
      transactionId: transaction.id,
      txFingerprint: transaction.txFingerprint,
      kind: 'asset_migration_participant',
      tier: 'heuristic',
      role: 'source',
      groupKey: 'migration-group-rndr',
      detectorId: 'asset-migration-participant',
      derivedFromTxIds: [transaction.id],
      provenanceInputs: ['diagnostic'],
      metadata: {
        providerSubtype: 'spotfromfutures',
      },
    });
  });

  it('emits a heuristic target annotation for a one-way migration inflow', async () => {
    const detector = new AssetMigrationParticipantDetector();
    const transaction = makeTransaction({
      operation: { category: 'transfer', type: 'deposit' },
      diagnostics: [
        {
          code: 'possible_asset_migration',
          message: 'Kraken migration credit.',
          severity: 'info',
          metadata: {
            migrationGroupKey: 'migration-group-render',
          },
        },
      ],
      inflowCount: 1,
      outflowCount: 0,
    });

    const result = await detector.run({
      accountId: transaction.accountId,
      transactionId: transaction.id,
      txFingerprint: transaction.txFingerprint,
      transaction,
    });

    const annotation = assertOk(result).annotations[0];
    expect(annotation).toMatchObject({
      role: 'target',
      groupKey: 'migration-group-render',
    });
  });

  it('does not emit when the diagnostic is missing a migrationGroupKey', async () => {
    const detector = new AssetMigrationParticipantDetector();
    const transaction = makeTransaction({
      diagnostics: [
        {
          code: 'possible_asset_migration',
          message: 'Migration rows without group key.',
          severity: 'info',
          metadata: {
            providerSubtype: 'spotfromfutures',
          },
        },
      ],
    });

    const result = await detector.run({
      accountId: transaction.accountId,
      transactionId: transaction.id,
      txFingerprint: transaction.txFingerprint,
      transaction,
    });

    expect(assertOk(result).annotations).toEqual([]);
  });

  it('does not emit for transactions with both inflows and outflows', async () => {
    const detector = new AssetMigrationParticipantDetector();
    const transaction = makeTransaction({
      operation: { category: 'transfer', type: 'transfer' },
      diagnostics: [
        {
          code: 'possible_asset_migration',
          message: 'Ambiguous migration transaction.',
          severity: 'info',
          metadata: {
            migrationGroupKey: 'migration-group-ambiguous',
          },
        },
      ],
      inflowCount: 1,
      outflowCount: 1,
    });

    const result = await detector.run({
      accountId: transaction.accountId,
      transactionId: transaction.id,
      txFingerprint: transaction.txFingerprint,
      transaction,
    });

    expect(assertOk(result).annotations).toEqual([]);
  });
});
