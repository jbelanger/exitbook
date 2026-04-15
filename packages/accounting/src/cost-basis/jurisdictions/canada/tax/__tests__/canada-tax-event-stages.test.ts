import type { AssetMovement } from '@exitbook/core';
import type { Currency } from '@exitbook/foundation';
import { err, ok, parseDecimal } from '@exitbook/foundation';
import { assertErr, assertOk } from '@exitbook/foundation/test-utils';
import { describe, expect, it } from 'vitest';

import { buildTransaction, createFee, createPriceAtTxTime } from '../../../../../__tests__/test-utils.js';
import type { UsdConversionRateProviderLike } from '../../../../../price-enrichment/fx/usd-conversion-rate-provider.js';
import type {
  AccountingScopedTransaction,
  FeeOnlyInternalCarryover,
  ScopedFeeMovement,
} from '../../../../standard/matching/build-cost-basis-scoped-transactions.js';
import type {
  ValidatedScopedTransferLink,
  ValidatedScopedTransferSet,
} from '../../../../standard/matching/validated-scoped-transfer-links.js';
import { applyCarryoverSemantics } from '../canada-tax-event-carryover.js';
import {
  applyGenericFeeAdjustments,
  buildSameAssetTransferFeeAdjustments,
  buildValidatedTransferTargetFeeAdjustments,
} from '../canada-tax-event-fee-adjustments.js';
import { projectCanadaMovementEvents } from '../canada-tax-event-projection.js';
import type { CanadaAcquisitionEvent, CanadaFeeAdjustmentEvent } from '../canada-tax-types.js';

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

function createFxProvider(fromUSD?: Record<string, string>): UsdConversionRateProviderLike {
  return {
    getRateToUSD: async () => err(new Error('not implemented')),
    getRateFromUSD: async (currency: Currency) => {
      const rate = fromUSD?.[currency];
      if (!rate) return err(new Error(`No fromUSD rate for ${currency}`));
      return ok({ rate: parseDecimal(rate), source: 'test', fetchedAt: new Date() });
    },
  };
}

const identityConfig = {};

/**
 * Rewrites `test:xyz` assetIds to `exchange:test:xyz` so they pass through
 * `parseAssetId` which only accepts exchange/blockchain/fiat namespaces.
 */
function patchAssetId(assetId: string): string {
  if (assetId.startsWith('test:')) {
    return `exchange:test:${assetId.slice(5)}`;
  }
  return assetId;
}

/**
 * Build an AccountingScopedTransaction from a test transaction.
 * Derives movement fingerprints from the transaction's txFingerprint.
 */
function buildScopedTransaction(
  tx: ReturnType<typeof buildTransaction>,
  options?: {
    fees?: ScopedFeeMovement[];
  }
): AccountingScopedTransaction {
  const inflows: AssetMovement[] = (tx.movements.inflows ?? []).map((m) => ({
    ...m,
    assetId: patchAssetId(m.assetId),
    movementFingerprint: m.movementFingerprint,
  }));

  const outflows: AssetMovement[] = (tx.movements.outflows ?? []).map((m) => ({
    ...m,
    assetId: patchAssetId(m.assetId),
    movementFingerprint: m.movementFingerprint,
  }));

  const fees: ScopedFeeMovement[] =
    options?.fees ??
    tx.fees.map((f) => ({
      ...f,
      assetId: patchAssetId(f.assetId),
      originalTransactionId: tx.id,
    }));

  return {
    tx,
    rebuildDependencyTransactionIds: [],
    movements: { inflows, outflows },
    fees,
  };
}

function emptyTransferSet(): ValidatedScopedTransferSet {
  return {
    links: [],
    bySourceMovementFingerprint: new Map(),
    byTargetMovementFingerprint: new Map(),
  };
}

function makeTransferSet(links: ValidatedScopedTransferLink[]): ValidatedScopedTransferSet {
  const bySource = new Map<string, ValidatedScopedTransferLink[]>();
  const byTarget = new Map<string, ValidatedScopedTransferLink[]>();

  for (const link of links) {
    const sourceList = bySource.get(link.sourceMovementFingerprint) ?? [];
    sourceList.push(link);
    bySource.set(link.sourceMovementFingerprint, sourceList);

    const targetList = byTarget.get(link.targetMovementFingerprint) ?? [];
    targetList.push(link);
    byTarget.set(link.targetMovementFingerprint, targetList);
  }

  return { links, bySourceMovementFingerprint: bySource, byTargetMovementFingerprint: byTarget };
}

// ---------------------------------------------------------------------------
// projectCanadaMovementEvents
// ---------------------------------------------------------------------------

describe('projectCanadaMovementEvents', () => {
  it('projects an acquisition event from an inflow with no validated links', async () => {
    const tx = buildTransaction({
      id: 1,
      datetime: '2024-01-15T12:00:00Z',
      inflows: [{ assetSymbol: 'BTC', amount: '2', price: '50000' }],
    });
    const scoped = buildScopedTransaction(tx);
    const usdConversionRateProvider = createFxProvider({ CAD: '1.35' });

    const events = assertOk(
      await projectCanadaMovementEvents({
        scopedTransactions: [scoped],
        validatedTransfers: emptyTransferSet(),
        usdConversionRateProvider,
        identityConfig,
      })
    );

    expect(events).toHaveLength(1);
    expect(events[0]!.kind).toBe('acquisition');
    expect(events[0]!.assetSymbol).toBe('BTC');
    expect(events[0]!.transactionId).toBe(1);
    expect(events[0]!.provenanceKind).toBe('scoped-movement');
    expect(events[0]!.taxPropertyKey).toBe('ca:btc');
    // quantity should be grossAmount
    expect((events[0] as CanadaAcquisitionEvent).quantity.toFixed()).toBe('2');
    // valuation: 50000 * 1.35 = 67500 per unit
    expect(events[0]!.valuation.unitValueCad.toFixed()).toBe('67500');
    expect(events[0]!.valuation.totalValueCad.toFixed()).toBe('135000');
  });

  it('marks standalone staking-reward inflows with incomeCategory', async () => {
    const tx = buildTransaction({
      id: 5,
      datetime: '2024-04-15T12:00:00Z',
      inflows: [
        {
          assetSymbol: 'ADA',
          amount: '10.524451',
          price: '0.75',
          movementRole: 'staking_reward',
        },
      ],
    });
    const scoped = buildScopedTransaction(tx);
    const usdConversionRateProvider = createFxProvider({ CAD: '1.35' });

    const events = assertOk(
      await projectCanadaMovementEvents({
        scopedTransactions: [scoped],
        validatedTransfers: emptyTransferSet(),
        usdConversionRateProvider,
        identityConfig,
      })
    );

    expect(events).toHaveLength(1);
    expect(events[0]!.kind).toBe('acquisition');
    expect((events[0] as CanadaAcquisitionEvent).incomeCategory).toBe('staking_reward');
  });

  it('projects a disposition event from an outflow with no validated links', async () => {
    const tx = buildTransaction({
      id: 2,
      datetime: '2024-02-01T12:00:00Z',
      outflows: [{ assetSymbol: 'ETH', amount: '5', price: '3000' }],
    });
    const scoped = buildScopedTransaction(tx);
    const usdConversionRateProvider = createFxProvider({ CAD: '1.40' });

    const events = assertOk(
      await projectCanadaMovementEvents({
        scopedTransactions: [scoped],
        validatedTransfers: emptyTransferSet(),
        usdConversionRateProvider,
        identityConfig,
      })
    );

    expect(events).toHaveLength(1);
    expect(events[0]!.kind).toBe('disposition');
    expect(events[0]!.assetSymbol).toBe('ETH');
    expect(events[0]!.valuation.unitValueCad.toFixed()).toBe('4200');
    expect(events[0]!.valuation.totalValueCad.toFixed()).toBe('21000');
  });

  it('filters out fiat movements and returns empty events', async () => {
    const tx = buildTransaction({
      id: 3,
      datetime: '2024-03-01T12:00:00Z',
      inflows: [{ assetSymbol: 'USD', amount: '1000', assetId: 'fiat:usd' }],
    });
    const scoped = buildScopedTransaction(tx);
    const usdConversionRateProvider = createFxProvider({ CAD: '1.35' });

    const events = assertOk(
      await projectCanadaMovementEvents({
        scopedTransactions: [scoped],
        validatedTransfers: emptyTransferSet(),
        usdConversionRateProvider,
        identityConfig,
      })
    );

    expect(events).toHaveLength(0);
  });

  it('returns error when priceAtTxTime is missing on a crypto movement', async () => {
    const tx = buildTransaction({
      id: 4,
      datetime: '2024-04-01T12:00:00Z',
      inflows: [{ assetSymbol: 'BTC', amount: '1' }], // no price
    });
    const scoped = buildScopedTransaction(tx);
    const usdConversionRateProvider = createFxProvider({ CAD: '1.35' });

    const error = assertErr(
      await projectCanadaMovementEvents({
        scopedTransactions: [scoped],
        validatedTransfers: emptyTransferSet(),
        usdConversionRateProvider,
        identityConfig,
      })
    );

    expect(error.message).toContain('Missing priceAtTxTime');
    expect(error.message).toContain('BTC');
  });

  it('splits a movement into transfer + residual when validated links cover partial quantity', async () => {
    const withdrawalTx = buildTransaction({
      id: 10,
      datetime: '2024-05-01T12:00:00Z',
      outflows: [{ assetSymbol: 'BTC', amount: '3', netAmount: '2.8', price: '60000' }],
    });
    const depositTx = buildTransaction({
      id: 11,
      accountId: 2,
      datetime: '2024-05-01T12:05:00Z',
      inflows: [
        {
          assetSymbol: 'BTC',
          amount: '2',
          assetId: 'blockchain:bitcoin:native',
          price: '60000',
        },
      ],
      platformKey: 'bitcoin',
      platformKind: 'blockchain',
    });

    const scopedWithdrawal = buildScopedTransaction(withdrawalTx);
    const scopedDeposit = buildScopedTransaction(depositTx);

    const sourceMovementFp = scopedWithdrawal.movements.outflows[0]!.movementFingerprint;
    const targetMovementFp = scopedDeposit.movements.inflows[0]!.movementFingerprint;

    const link: ValidatedScopedTransferLink = {
      isPartialMatch: true,
      link: {
        id: 50,
        sourceTransactionId: 10,
        targetTransactionId: 11,
        assetSymbol: 'BTC' as Currency,
        sourceAssetId: 'exchange:test:btc',
        targetAssetId: 'blockchain:bitcoin:native',
        sourceAmount: parseDecimal('2'),
        targetAmount: parseDecimal('2'),
        sourceMovementFingerprint: sourceMovementFp,
        targetMovementFingerprint: targetMovementFp,
        linkType: 'exchange_to_blockchain',
        confidenceScore: parseDecimal('1'),
        matchCriteria: {
          assetMatch: true,
          amountSimilarity: parseDecimal('1'),
          timingValid: true,
          timingHours: 0,
        },
        status: 'confirmed',
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      sourceAssetId: 'exchange:test:btc',
      sourceMovementAmount: parseDecimal('2.8'),
      sourceMovementFingerprint: sourceMovementFp,
      targetAssetId: 'blockchain:bitcoin:native',
      targetMovementAmount: parseDecimal('2'),
      targetMovementFingerprint: targetMovementFp,
    };

    const transfers = makeTransferSet([link]);
    const usdConversionRateProvider = createFxProvider({ CAD: '1.35' });

    const events = assertOk(
      await projectCanadaMovementEvents({
        scopedTransactions: [scopedWithdrawal, scopedDeposit],
        validatedTransfers: transfers,
        usdConversionRateProvider,
        identityConfig,
      })
    );

    // Deposit side: full match -> transfer-in
    const transferInEvents = events.filter((e) => e.kind === 'transfer-in');
    expect(transferInEvents).toHaveLength(1);
    expect(transferInEvents[0]!.provenanceKind).toBe('validated-link');

    // Withdrawal side: partial link (2 of 2.8 net) -> transfer-out + residual disposition
    const transferOutEvents = events.filter((e) => e.kind === 'transfer-out');
    expect(transferOutEvents).toHaveLength(1);
    expect(transferOutEvents[0]!.provenanceKind).toBe('validated-link');

    const dispositionEvents = events.filter((e) => e.kind === 'disposition');
    expect(dispositionEvents).toHaveLength(1);
    // residual = 2.8 - 2 = 0.8
    expect(dispositionEvents[0]!.valuation.totalValueCad.toFixed()).toBe(
      parseDecimal('60000').times('1.35').times('0.8').toFixed()
    );
  });

  it('produces only transfer events when links fully cover the movement', async () => {
    const withdrawalTx = buildTransaction({
      id: 20,
      datetime: '2024-06-01T12:00:00Z',
      outflows: [{ assetSymbol: 'ETH', amount: '5', price: '3500' }],
    });
    const depositTx = buildTransaction({
      id: 21,
      accountId: 2,
      datetime: '2024-06-01T12:05:00Z',
      inflows: [
        {
          assetSymbol: 'ETH',
          amount: '5',
          assetId: 'exchange:coinbase:eth',
          price: '3500',
        },
      ],
    });

    const scopedWithdrawal = buildScopedTransaction(withdrawalTx);
    const scopedDeposit = buildScopedTransaction(depositTx);

    const sourceMovementFp = scopedWithdrawal.movements.outflows[0]!.movementFingerprint;
    const targetMovementFp = scopedDeposit.movements.inflows[0]!.movementFingerprint;

    const link: ValidatedScopedTransferLink = {
      isPartialMatch: false,
      link: {
        id: 60,
        sourceTransactionId: 20,
        targetTransactionId: 21,
        assetSymbol: 'ETH' as Currency,
        sourceAssetId: 'exchange:test:eth',
        targetAssetId: 'exchange:coinbase:eth',
        sourceAmount: parseDecimal('5'),
        targetAmount: parseDecimal('5'),
        sourceMovementFingerprint: sourceMovementFp,
        targetMovementFingerprint: targetMovementFp,
        linkType: 'exchange_to_exchange',
        confidenceScore: parseDecimal('1'),
        matchCriteria: {
          assetMatch: true,
          amountSimilarity: parseDecimal('1'),
          timingValid: true,
          timingHours: 0,
        },
        status: 'confirmed',
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      sourceAssetId: 'exchange:test:eth',
      sourceMovementAmount: parseDecimal('5'),
      sourceMovementFingerprint: sourceMovementFp,
      targetAssetId: 'exchange:coinbase:eth',
      targetMovementAmount: parseDecimal('5'),
      targetMovementFingerprint: targetMovementFp,
    };

    const transfers = makeTransferSet([link]);
    const usdConversionRateProvider = createFxProvider({ CAD: '1.35' });

    const events = assertOk(
      await projectCanadaMovementEvents({
        scopedTransactions: [scopedWithdrawal, scopedDeposit],
        validatedTransfers: transfers,
        usdConversionRateProvider,
        identityConfig,
      })
    );

    // No residual: full match on both sides
    const acquisitions = events.filter((e) => e.kind === 'acquisition');
    const dispositions = events.filter((e) => e.kind === 'disposition');
    expect(acquisitions).toHaveLength(0);
    expect(dispositions).toHaveLength(0);

    expect(events.filter((e) => e.kind === 'transfer-out')).toHaveLength(1);
    expect(events.filter((e) => e.kind === 'transfer-in')).toHaveLength(1);
  });

  it('marks exact explained inflow residuals as staking-reward acquisitions', async () => {
    const withdrawalTx = buildTransaction({
      id: 22,
      datetime: '2024-07-25T20:32:02Z',
      outflows: [{ assetSymbol: 'ADA', amount: '2669.193991', price: '0.75' }],
    });
    const depositTx = buildTransaction({
      id: 23,
      accountId: 2,
      datetime: '2024-07-25T20:35:47Z',
      inflows: [
        {
          assetSymbol: 'ADA',
          amount: '2679.718442',
          assetId: 'exchange:kucoin:ada',
          price: '0.75',
        },
      ],
    });

    const scopedWithdrawal = buildScopedTransaction(withdrawalTx);
    const scopedDeposit = buildScopedTransaction(depositTx);
    const sourceMovementFp = scopedWithdrawal.movements.outflows[0]!.movementFingerprint;
    const targetMovementFp = scopedDeposit.movements.inflows[0]!.movementFingerprint;

    const link: ValidatedScopedTransferLink = {
      isPartialMatch: true,
      link: {
        id: 61,
        sourceTransactionId: 22,
        targetTransactionId: 23,
        assetSymbol: 'ADA' as Currency,
        sourceAssetId: 'exchange:test:ada',
        targetAssetId: 'exchange:kucoin:ada',
        sourceAmount: parseDecimal('2669.193991'),
        targetAmount: parseDecimal('2669.193991'),
        sourceMovementFingerprint: sourceMovementFp,
        targetMovementFingerprint: targetMovementFp,
        linkType: 'blockchain_to_exchange',
        confidenceScore: parseDecimal('1'),
        matchCriteria: {
          assetMatch: true,
          amountSimilarity: parseDecimal('1'),
          timingValid: true,
          timingHours: 0,
        },
        status: 'confirmed',
        createdAt: new Date(),
        updatedAt: new Date(),
        metadata: {
          partialMatch: true,
          fullSourceAmount: '2669.193991',
          fullTargetAmount: '2679.718442',
          consumedAmount: '2669.193991',
          targetExcessAllowed: true,
          targetExcess: '10.524451',
          targetExcessPct: '0.393',
          explainedTargetResidualAmount: '10.524451',
          explainedTargetResidualRole: 'staking_reward',
        },
      },
      sourceAssetId: 'exchange:test:ada',
      sourceMovementAmount: parseDecimal('2669.193991'),
      sourceMovementFingerprint: sourceMovementFp,
      targetAssetId: 'exchange:kucoin:ada',
      targetMovementAmount: parseDecimal('2679.718442'),
      targetMovementFingerprint: targetMovementFp,
    };

    const events = assertOk(
      await projectCanadaMovementEvents({
        scopedTransactions: [scopedWithdrawal, scopedDeposit],
        validatedTransfers: makeTransferSet([link]),
        usdConversionRateProvider: createFxProvider({ CAD: '1.35' }),
        identityConfig,
      })
    );

    const transferInEvents = events.filter((event) => event.kind === 'transfer-in' && event.transactionId === 23);
    const acquisitionEvents = events.filter((event) => event.kind === 'acquisition' && event.transactionId === 23);

    expect(transferInEvents).toHaveLength(1);
    expect(transferInEvents[0]!.valuation.totalValueCad.toFixed()).toBe(
      parseDecimal('2669.193991').times('0.75').times('1.35').toFixed()
    );

    expect(acquisitionEvents).toHaveLength(1);
    expect((acquisitionEvents[0] as CanadaAcquisitionEvent).quantity.toFixed()).toBe('10.524451');
    expect((acquisitionEvents[0] as CanadaAcquisitionEvent).incomeCategory).toBe('staking_reward');
  });

  it('projects both acquisition and disposition for a trade with inflow and outflow', async () => {
    const tx = buildTransaction({
      id: 30,
      datetime: '2024-07-01T12:00:00Z',
      inflows: [{ assetSymbol: 'ETH', amount: '1', price: '3000' }],
      outflows: [{ assetSymbol: 'BTC', amount: '0.1', price: '30000' }],
    });
    const scoped = buildScopedTransaction(tx);
    const usdConversionRateProvider = createFxProvider({ CAD: '1.40' });

    const events = assertOk(
      await projectCanadaMovementEvents({
        scopedTransactions: [scoped],
        validatedTransfers: emptyTransferSet(),
        usdConversionRateProvider,
        identityConfig,
      })
    );

    expect(events).toHaveLength(2);
    const acquisition = events.find((e) => e.kind === 'acquisition');
    const disposition = events.find((e) => e.kind === 'disposition');
    expect(acquisition).toBeDefined();
    expect(disposition).toBeDefined();
    expect(acquisition!.assetSymbol).toBe('ETH');
    expect(disposition!.assetSymbol).toBe('BTC');
  });
});

// ---------------------------------------------------------------------------
// applyCarryoverSemantics
// ---------------------------------------------------------------------------

describe('applyCarryoverSemantics', () => {
  it('rewrites acquisition to transfer-in for carryover target', async () => {
    // Source tx (sender) and target tx (receiver)
    const sourceTx = buildTransaction({
      id: 100,
      datetime: '2024-01-10T12:00:00Z',
      outflows: [{ assetSymbol: 'BTC', amount: '1', price: '50000' }],
    });
    const targetTx = buildTransaction({
      id: 101,
      accountId: 2,
      datetime: '2024-01-10T12:05:00Z',
      inflows: [{ assetSymbol: 'BTC', amount: '1', price: '50000' }],
    });

    const scopedSource = buildScopedTransaction(sourceTx);
    const scopedTarget = buildScopedTransaction(targetTx);
    const targetMovementFp = scopedTarget.movements.inflows[0]!.movementFingerprint;
    const sourceMovementFp = scopedSource.movements.outflows[0]!.movementFingerprint;

    // Project events first — target inflow produces an acquisition
    const usdConversionRateProvider = createFxProvider({ CAD: '1.35' });
    const projectedEvents = assertOk(
      await projectCanadaMovementEvents({
        scopedTransactions: [scopedSource, scopedTarget],
        validatedTransfers: emptyTransferSet(),
        usdConversionRateProvider,
        identityConfig,
      })
    );

    // Verify an acquisition exists for the target
    const acquisitionBefore = projectedEvents.find((e) => e.kind === 'acquisition' && e.transactionId === 101);
    expect(acquisitionBefore).toBeDefined();

    const carryover: FeeOnlyInternalCarryover = {
      assetId: 'exchange:test:btc',
      assetSymbol: 'BTC' as Currency,
      fee: {
        assetId: 'exchange:test:btc',
        assetSymbol: 'BTC' as Currency,
        amount: parseDecimal('0'),
        movementFingerprint: 'movement:test:carryover:fee:0',
        scope: 'network',
        settlement: 'on-chain',
        originalTransactionId: 100,
      },
      retainedQuantity: parseDecimal('1'),
      sourceTransactionId: 100,
      sourceMovementFingerprint: sourceMovementFp,
      targets: [
        {
          targetTransactionId: 101,
          targetMovementFingerprint: targetMovementFp,
          quantity: parseDecimal('1'),
        },
      ],
    };

    const result = assertOk(
      await applyCarryoverSemantics({
        events: projectedEvents,
        scopedTransactions: [scopedSource, scopedTarget],
        feeOnlyInternalCarryovers: [carryover],
        usdConversionRateProvider,
        identityConfig,
      })
    );

    // The acquisition at targetMovementFp should now be a transfer-in
    const rewrittenEvent = result.find((e) => e.kind === 'transfer-in' && e.transactionId === 101);
    expect(rewrittenEvent).toBeDefined();
    expect(rewrittenEvent!.provenanceKind).toBe('fee-only-carryover');

    // No acquisition should remain for tx 101
    const remainingAcquisitions = result.filter((e) => e.kind === 'acquisition' && e.transactionId === 101);
    expect(remainingAcquisitions).toHaveLength(0);
  });

  it('returns error when carryover target movement is not projected as acquisition', async () => {
    const targetTx = buildTransaction({
      id: 200,
      datetime: '2024-01-10T12:00:00Z',
      outflows: [{ assetSymbol: 'BTC', amount: '1', price: '50000' }],
    });
    const scopedTarget = buildScopedTransaction(targetTx);

    // Project: outflow produces a disposition, not acquisition
    const usdConversionRateProvider = createFxProvider({ CAD: '1.35' });
    const projectedEvents = assertOk(
      await projectCanadaMovementEvents({
        scopedTransactions: [scopedTarget],
        validatedTransfers: emptyTransferSet(),
        usdConversionRateProvider,
        identityConfig,
      })
    );

    // Try to carryover into a fingerprint that has a disposition (not acquisition)
    const dispositionFp = scopedTarget.movements.outflows[0]!.movementFingerprint;

    const carryover: FeeOnlyInternalCarryover = {
      assetId: 'exchange:test:btc',
      assetSymbol: 'BTC' as Currency,
      fee: {
        assetId: 'exchange:test:btc',
        assetSymbol: 'BTC' as Currency,
        amount: parseDecimal('0'),
        movementFingerprint: 'movement:test:carryover:fee:1',
        scope: 'network',
        settlement: 'on-chain',
        originalTransactionId: 199,
      },
      retainedQuantity: parseDecimal('1'),
      sourceTransactionId: 199,
      sourceMovementFingerprint: 'some-source-fp',
      targets: [
        {
          targetTransactionId: 200,
          targetMovementFingerprint: dispositionFp,
          quantity: parseDecimal('1'),
        },
      ],
    };

    // Need a source transaction in the scoped list
    const sourceTx = buildTransaction({
      id: 199,
      datetime: '2024-01-10T11:00:00Z',
      outflows: [{ assetSymbol: 'BTC', amount: '1', price: '50000' }],
    });
    const scopedSource = buildScopedTransaction(sourceTx);

    const error = assertErr(
      await applyCarryoverSemantics({
        events: projectedEvents,
        scopedTransactions: [scopedSource, scopedTarget],
        feeOnlyInternalCarryovers: [carryover],
        usdConversionRateProvider,
        identityConfig,
      })
    );

    expect(error.message).toContain('already classified as disposition');
  });

  it('returns error when carryover source transaction is not found', async () => {
    const usdConversionRateProvider = createFxProvider({ CAD: '1.35' });

    const carryover: FeeOnlyInternalCarryover = {
      assetId: 'exchange:test:btc',
      assetSymbol: 'BTC' as Currency,
      fee: {
        assetId: 'exchange:test:btc',
        assetSymbol: 'BTC' as Currency,
        amount: parseDecimal('0'),
        movementFingerprint: 'movement:test:carryover:fee:3',
        scope: 'network',
        settlement: 'on-chain',
        originalTransactionId: 999,
      },
      retainedQuantity: parseDecimal('1'),
      sourceTransactionId: 999,
      sourceMovementFingerprint: 'missing-fp',
      targets: [
        {
          targetTransactionId: 1000,
          targetMovementFingerprint: 'target-fp',
          quantity: parseDecimal('1'),
        },
      ],
    };

    const error = assertErr(
      await applyCarryoverSemantics({
        events: [],
        scopedTransactions: [],
        feeOnlyInternalCarryovers: [carryover],
        usdConversionRateProvider,
        identityConfig,
      })
    );

    expect(error.message).toContain('Carryover source transaction 999 not found');
  });

  it('returns error when carryover target movement fingerprint has no projected events', async () => {
    const sourceTx = buildTransaction({
      id: 300,
      datetime: '2024-01-10T12:00:00Z',
      outflows: [{ assetSymbol: 'BTC', amount: '1', price: '50000' }],
    });
    const scopedSource = buildScopedTransaction(sourceTx);
    const usdConversionRateProvider = createFxProvider({ CAD: '1.35' });

    const carryover: FeeOnlyInternalCarryover = {
      assetId: 'exchange:test:btc',
      assetSymbol: 'BTC' as Currency,
      fee: {
        assetId: 'exchange:test:btc',
        assetSymbol: 'BTC' as Currency,
        amount: parseDecimal('0'),
        movementFingerprint: 'movement:test:carryover:fee:4',
        scope: 'network',
        settlement: 'on-chain',
        originalTransactionId: 300,
      },
      retainedQuantity: parseDecimal('1'),
      sourceTransactionId: 300,
      sourceMovementFingerprint: 'source-fp',
      targets: [
        {
          targetTransactionId: 301,
          targetMovementFingerprint: 'nonexistent-target-fp',
          quantity: parseDecimal('1'),
        },
      ],
    };

    const error = assertErr(
      await applyCarryoverSemantics({
        events: [],
        scopedTransactions: [scopedSource],
        feeOnlyInternalCarryovers: [carryover],
        usdConversionRateProvider,
        identityConfig,
      })
    );

    expect(error.message).toContain('was not projected as acquisition');
  });
});

// ---------------------------------------------------------------------------
// applyGenericFeeAdjustments
// ---------------------------------------------------------------------------

describe('applyGenericFeeAdjustments', () => {
  it('allocates fee CAD value to a single acquisition costBasisAdjustmentCad', async () => {
    const tx = buildTransaction({
      id: 400,
      datetime: '2024-03-15T12:00:00Z',
      inflows: [{ assetSymbol: 'BTC', amount: '1', price: '50000' }],
      fees: [
        createFee('USD', '25', {
          assetId: 'fiat:usd',
          priceAmount: '1',
          settlement: 'balance',
        }),
      ],
    });
    const scoped = buildScopedTransaction(tx);
    const usdConversionRateProvider = createFxProvider({ CAD: '1.40' });

    // Project events first
    const events = assertOk(
      await projectCanadaMovementEvents({
        scopedTransactions: [scoped],
        validatedTransfers: emptyTransferSet(),
        usdConversionRateProvider,
        identityConfig,
      })
    );

    expect(events).toHaveLength(1);
    expect(events[0]!.kind).toBe('acquisition');

    // Apply fee adjustments (mutates events in place)
    assertOk(
      await applyGenericFeeAdjustments({
        events,
        scopedTransactions: [scoped],
        usdConversionRateProvider,
        identityConfig,
        sameAssetTransferFeeEvents: [],
      })
    );

    const acquisition = events[0] as CanadaAcquisitionEvent;
    // Fee: 25 USD * 1.40 = 35 CAD
    expect(acquisition.costBasisAdjustmentCad).toBeDefined();
    expect(acquisition.costBasisAdjustmentCad!.toFixed(0)).toBe('35');
  });

  it('allocates fees proportionally across multiple acquisitions', async () => {
    const tx = buildTransaction({
      id: 401,
      datetime: '2024-03-15T12:00:00Z',
      inflows: [
        { assetSymbol: 'BTC', amount: '1', price: '40000' },
        { assetSymbol: 'ETH', amount: '10', price: '2000' },
      ],
      fees: [
        createFee('USD', '100', {
          assetId: 'fiat:usd',
          priceAmount: '1',
          settlement: 'balance',
        }),
      ],
    });
    const scoped = buildScopedTransaction(tx);
    const usdConversionRateProvider = createFxProvider({ CAD: '1.00' });

    const events = assertOk(
      await projectCanadaMovementEvents({
        scopedTransactions: [scoped],
        validatedTransfers: emptyTransferSet(),
        usdConversionRateProvider,
        identityConfig,
      })
    );

    expect(events).toHaveLength(2);

    assertOk(
      await applyGenericFeeAdjustments({
        events,
        scopedTransactions: [scoped],
        usdConversionRateProvider,
        identityConfig,
        sameAssetTransferFeeEvents: [],
      })
    );

    // Total fee: 100 USD * 1.00 = 100 CAD
    // BTC value: 40000 * 1, ETH value: 2000 * 10 = 20000 each => 50/50 allocation
    // The two acquisitions have same total CAD value (40000 vs 20000)
    // BTC share: 100 * 40000/60000 = 66.66..., ETH share: 100 * 20000/60000 = 33.33...
    const btcEvent = events.find((e) => e.assetSymbol === 'BTC') as CanadaAcquisitionEvent;
    const ethEvent = events.find((e) => e.assetSymbol === 'ETH') as CanadaAcquisitionEvent;

    expect(btcEvent.costBasisAdjustmentCad).toBeDefined();
    expect(ethEvent.costBasisAdjustmentCad).toBeDefined();

    // The two should sum to 100
    const totalAdjustment = btcEvent.costBasisAdjustmentCad!.plus(ethEvent.costBasisAdjustmentCad!);
    expect(totalAdjustment.toFixed(2)).toBe('100.00');
  });

  it('allocates on-chain fees to disposition proceedsReductionCad minus reserved same-asset fees', async () => {
    const tx = buildTransaction({
      id: 402,
      datetime: '2024-04-01T12:00:00Z',
      outflows: [{ assetSymbol: 'BTC', amount: '1', netAmount: '0.999', price: '60000' }],
      fees: [
        createFee('BTC', '0.001', {
          priceAmount: '60000',
          scope: 'network',
          settlement: 'on-chain',
        }),
      ],
    });
    const scoped = buildScopedTransaction(tx);
    const usdConversionRateProvider = createFxProvider({ CAD: '1.40' });

    const events = assertOk(
      await projectCanadaMovementEvents({
        scopedTransactions: [scoped],
        validatedTransfers: emptyTransferSet(),
        usdConversionRateProvider,
        identityConfig,
      })
    );

    expect(events).toHaveLength(1);
    expect(events[0]!.kind).toBe('disposition');

    // No same-asset fee events reserved
    assertOk(
      await applyGenericFeeAdjustments({
        events,
        scopedTransactions: [scoped],
        usdConversionRateProvider,
        identityConfig,
        sameAssetTransferFeeEvents: [],
      })
    );

    const disposition = events[0] as { proceedsReductionCad?: { toFixed: (n?: number) => string } };
    // Fee: 0.001 BTC * 60000 USD * 1.40 CAD = 84 CAD
    expect(disposition.proceedsReductionCad).toBeDefined();
    expect(disposition.proceedsReductionCad!.toFixed(0)).toBe('84');
  });

  it('subtracts reserved same-asset transfer fee CAD from disposition fee pool', async () => {
    const tx = buildTransaction({
      id: 403,
      datetime: '2024-04-01T12:00:00Z',
      outflows: [{ assetSymbol: 'BTC', amount: '1', netAmount: '0.999', price: '60000' }],
      fees: [
        createFee('BTC', '0.001', {
          priceAmount: '60000',
          scope: 'network',
          settlement: 'on-chain',
        }),
      ],
    });
    const scoped = buildScopedTransaction(tx);
    const usdConversionRateProvider = createFxProvider({ CAD: '1.40' });

    const events = assertOk(
      await projectCanadaMovementEvents({
        scopedTransactions: [scoped],
        validatedTransfers: emptyTransferSet(),
        usdConversionRateProvider,
        identityConfig,
      })
    );

    // Simulate a same-asset fee event that reserves 42 CAD of the 84 total on-chain fee
    const reservedFeeEvent: CanadaFeeAdjustmentEvent = {
      eventId: 'reserved-fee',
      kind: 'fee-adjustment',
      adjustmentType: 'same-asset-transfer-fee-add-to-basis',
      transactionId: 403,
      timestamp: new Date('2024-04-01T12:00:00Z'),
      assetId: 'exchange:test:btc',
      assetIdentityKey: 'btc',
      taxPropertyKey: 'ca:btc',
      assetSymbol: 'BTC' as Currency,
      valuation: {
        taxCurrency: 'CAD',
        storagePriceAmount: parseDecimal('60000'),
        storagePriceCurrency: 'USD' as Currency,
        quotedPriceAmount: parseDecimal('60000'),
        quotedPriceCurrency: 'USD' as Currency,
        unitValueCad: parseDecimal('84000'),
        totalValueCad: parseDecimal('42'),
        valuationSource: 'usd-to-cad-fx',
      },
      feeAssetId: 'exchange:test:btc',
      feeAssetSymbol: 'BTC' as Currency,
      feeQuantity: parseDecimal('0.0005'),
      provenanceKind: 'validated-link',
    };

    assertOk(
      await applyGenericFeeAdjustments({
        events,
        scopedTransactions: [scoped],
        usdConversionRateProvider,
        identityConfig,
        sameAssetTransferFeeEvents: [reservedFeeEvent],
      })
    );

    const disposition = events[0] as { proceedsReductionCad?: { toFixed: (n?: number) => string } };
    // 84 CAD total - 42 reserved = 42 CAD residual
    expect(disposition.proceedsReductionCad).toBeDefined();
    expect(disposition.proceedsReductionCad!.toFixed(0)).toBe('42');
  });

  it('does nothing when there are no fees', async () => {
    const tx = buildTransaction({
      id: 404,
      datetime: '2024-05-01T12:00:00Z',
      inflows: [{ assetSymbol: 'BTC', amount: '1', price: '50000' }],
    });
    const scoped = buildScopedTransaction(tx);
    const usdConversionRateProvider = createFxProvider({ CAD: '1.35' });

    const events = assertOk(
      await projectCanadaMovementEvents({
        scopedTransactions: [scoped],
        validatedTransfers: emptyTransferSet(),
        usdConversionRateProvider,
        identityConfig,
      })
    );

    assertOk(
      await applyGenericFeeAdjustments({
        events,
        scopedTransactions: [scoped],
        usdConversionRateProvider,
        identityConfig,
        sameAssetTransferFeeEvents: [],
      })
    );

    const acquisition = events[0] as CanadaAcquisitionEvent;
    expect(acquisition.costBasisAdjustmentCad).toBeUndefined();
  });

  it('returns error when same-asset reserved fees exceed on-chain fee pool', async () => {
    const tx = buildTransaction({
      id: 405,
      datetime: '2024-04-01T12:00:00Z',
      outflows: [{ assetSymbol: 'BTC', amount: '1', netAmount: '0.999', price: '60000' }],
      fees: [
        createFee('BTC', '0.001', {
          priceAmount: '60000',
          scope: 'network',
          settlement: 'on-chain',
        }),
      ],
    });
    const scoped = buildScopedTransaction(tx);
    const usdConversionRateProvider = createFxProvider({ CAD: '1.40' });

    const events = assertOk(
      await projectCanadaMovementEvents({
        scopedTransactions: [scoped],
        validatedTransfers: emptyTransferSet(),
        usdConversionRateProvider,
        identityConfig,
      })
    );

    // Reserve more than the total on-chain fee
    const overReservedFeeEvent: CanadaFeeAdjustmentEvent = {
      eventId: 'over-reserved-fee',
      kind: 'fee-adjustment',
      adjustmentType: 'same-asset-transfer-fee-add-to-basis',
      transactionId: 405,
      timestamp: new Date('2024-04-01T12:00:00Z'),
      assetId: 'exchange:test:btc',
      assetIdentityKey: 'btc',
      taxPropertyKey: 'ca:btc',
      assetSymbol: 'BTC' as Currency,
      valuation: {
        taxCurrency: 'CAD',
        storagePriceAmount: parseDecimal('60000'),
        storagePriceCurrency: 'USD' as Currency,
        quotedPriceAmount: parseDecimal('60000'),
        quotedPriceCurrency: 'USD' as Currency,
        unitValueCad: parseDecimal('84000'),
        totalValueCad: parseDecimal('100'),
        valuationSource: 'usd-to-cad-fx',
      },
      feeAssetId: 'exchange:test:btc',
      feeAssetSymbol: 'BTC' as Currency,
      feeQuantity: parseDecimal('0.002'),
      provenanceKind: 'validated-link',
    };

    const error = assertErr(
      await applyGenericFeeAdjustments({
        events,
        scopedTransactions: [scoped],
        usdConversionRateProvider,
        identityConfig,
        sameAssetTransferFeeEvents: [overReservedFeeEvent],
      })
    );

    expect(error.message).toContain('over-allocated');
  });
});

// ---------------------------------------------------------------------------
// buildValidatedTransferTargetFeeAdjustments
// ---------------------------------------------------------------------------

describe('buildValidatedTransferTargetFeeAdjustments', () => {
  it('builds fee adjustment events for a validated transfer with fiat fees', async () => {
    const withdrawalTx = buildTransaction({
      id: 500,
      datetime: '2024-06-01T12:00:00Z',
      outflows: [{ assetSymbol: 'BTC', amount: '1', price: '50000' }],
      fees: [
        createFee('USD', '10', {
          assetId: 'fiat:usd',
          priceAmount: '1',
          settlement: 'balance',
        }),
      ],
    });
    const depositTx = buildTransaction({
      id: 501,
      accountId: 2,
      datetime: '2024-06-01T12:05:00Z',
      inflows: [{ assetSymbol: 'BTC', amount: '1', price: '50000' }],
    });

    const scopedWithdrawal = buildScopedTransaction(withdrawalTx);
    const scopedDeposit = buildScopedTransaction(depositTx);

    const sourceMovementFp = scopedWithdrawal.movements.outflows[0]!.movementFingerprint;
    const targetMovementFp = scopedDeposit.movements.inflows[0]!.movementFingerprint;

    const link: ValidatedScopedTransferLink = {
      isPartialMatch: false,
      link: {
        id: 70,
        sourceTransactionId: 500,
        targetTransactionId: 501,
        assetSymbol: 'BTC' as Currency,
        sourceAssetId: 'exchange:test:btc',
        targetAssetId: 'exchange:test:btc',
        sourceAmount: parseDecimal('1'),
        targetAmount: parseDecimal('1'),
        sourceMovementFingerprint: sourceMovementFp,
        targetMovementFingerprint: targetMovementFp,
        linkType: 'exchange_to_exchange',
        confidenceScore: parseDecimal('1'),
        matchCriteria: {
          assetMatch: true,
          amountSimilarity: parseDecimal('1'),
          timingValid: true,
          timingHours: 0,
        },
        status: 'confirmed',
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      sourceAssetId: 'exchange:test:btc',
      sourceMovementAmount: parseDecimal('1'),
      sourceMovementFingerprint: sourceMovementFp,
      targetAssetId: 'exchange:test:btc',
      targetMovementAmount: parseDecimal('1'),
      targetMovementFingerprint: targetMovementFp,
    };

    const transfers = makeTransferSet([link]);
    const usdConversionRateProvider = createFxProvider({ CAD: '1.40' });

    const events = assertOk(
      await buildValidatedTransferTargetFeeAdjustments({
        scopedTransactions: [scopedWithdrawal, scopedDeposit],
        validatedTransfers: transfers,
        usdConversionRateProvider,
        identityConfig,
      })
    );

    // Source has a $10 USD fiat fee -> should produce a fee adjustment on the target pool
    expect(events.length).toBeGreaterThanOrEqual(1);
    const feeAdj = events[0]!;
    expect(feeAdj.kind).toBe('fee-adjustment');
    expect(feeAdj.adjustmentType).toBe('add-to-pool-cost');
    expect(feeAdj.assetSymbol).toBe('BTC');
    expect(feeAdj.provenanceKind).toBe('validated-link');
    expect(feeAdj.linkId).toBe(70);
  });

  it('returns empty events when there are no fiat fees on either side', async () => {
    const withdrawalTx = buildTransaction({
      id: 510,
      datetime: '2024-06-01T12:00:00Z',
      outflows: [{ assetSymbol: 'BTC', amount: '1', price: '50000' }],
    });
    const depositTx = buildTransaction({
      id: 511,
      accountId: 2,
      datetime: '2024-06-01T12:05:00Z',
      inflows: [{ assetSymbol: 'BTC', amount: '1', price: '50000' }],
    });

    const scopedWithdrawal = buildScopedTransaction(withdrawalTx);
    const scopedDeposit = buildScopedTransaction(depositTx);

    const sourceMovementFp = scopedWithdrawal.movements.outflows[0]!.movementFingerprint;
    const targetMovementFp = scopedDeposit.movements.inflows[0]!.movementFingerprint;

    const link: ValidatedScopedTransferLink = {
      isPartialMatch: false,
      link: {
        id: 71,
        sourceTransactionId: 510,
        targetTransactionId: 511,
        assetSymbol: 'BTC' as Currency,
        sourceAssetId: 'exchange:test:btc',
        targetAssetId: 'exchange:test:btc',
        sourceAmount: parseDecimal('1'),
        targetAmount: parseDecimal('1'),
        sourceMovementFingerprint: sourceMovementFp,
        targetMovementFingerprint: targetMovementFp,
        linkType: 'exchange_to_exchange',
        confidenceScore: parseDecimal('1'),
        matchCriteria: {
          assetMatch: true,
          amountSimilarity: parseDecimal('1'),
          timingValid: true,
          timingHours: 0,
        },
        status: 'confirmed',
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      sourceAssetId: 'exchange:test:btc',
      sourceMovementAmount: parseDecimal('1'),
      sourceMovementFingerprint: sourceMovementFp,
      targetAssetId: 'exchange:test:btc',
      targetMovementAmount: parseDecimal('1'),
      targetMovementFingerprint: targetMovementFp,
    };

    const transfers = makeTransferSet([link]);
    const usdConversionRateProvider = createFxProvider({ CAD: '1.40' });

    const events = assertOk(
      await buildValidatedTransferTargetFeeAdjustments({
        scopedTransactions: [scopedWithdrawal, scopedDeposit],
        validatedTransfers: transfers,
        usdConversionRateProvider,
        identityConfig,
      })
    );

    expect(events).toHaveLength(0);
  });

  it('returns error when transfer source transaction is not found', async () => {
    const depositTx = buildTransaction({
      id: 521,
      accountId: 2,
      datetime: '2024-06-01T12:05:00Z',
      inflows: [{ assetSymbol: 'BTC', amount: '1', price: '50000' }],
    });
    const scopedDeposit = buildScopedTransaction(depositTx);
    const targetMovementFp = scopedDeposit.movements.inflows[0]!.movementFingerprint;

    const link: ValidatedScopedTransferLink = {
      isPartialMatch: false,
      link: {
        id: 72,
        sourceTransactionId: 520, // not in scoped transactions
        targetTransactionId: 521,
        assetSymbol: 'BTC' as Currency,
        sourceAssetId: 'exchange:test:btc',
        targetAssetId: 'exchange:test:btc',
        sourceAmount: parseDecimal('1'),
        targetAmount: parseDecimal('1'),
        sourceMovementFingerprint: 'missing-source-fp',
        targetMovementFingerprint: targetMovementFp,
        linkType: 'exchange_to_exchange',
        confidenceScore: parseDecimal('1'),
        matchCriteria: {
          assetMatch: true,
          amountSimilarity: parseDecimal('1'),
          timingValid: true,
          timingHours: 0,
        },
        status: 'confirmed',
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      sourceAssetId: 'exchange:test:btc',
      sourceMovementAmount: parseDecimal('1'),
      sourceMovementFingerprint: 'missing-source-fp',
      targetAssetId: 'exchange:test:btc',
      targetMovementAmount: parseDecimal('1'),
      targetMovementFingerprint: targetMovementFp,
    };

    const transfers = makeTransferSet([link]);
    const usdConversionRateProvider = createFxProvider({ CAD: '1.40' });

    const error = assertErr(
      await buildValidatedTransferTargetFeeAdjustments({
        scopedTransactions: [scopedDeposit],
        validatedTransfers: transfers,
        usdConversionRateProvider,
        identityConfig,
      })
    );

    expect(error.message).toContain('Transfer source transaction 520 not found');
  });
});

// ---------------------------------------------------------------------------
// buildSameAssetTransferFeeAdjustments
// ---------------------------------------------------------------------------

describe('buildSameAssetTransferFeeAdjustments', () => {
  it('builds same-asset fee adjustments for a validated transfer link', async () => {
    const withdrawalTx = buildTransaction({
      id: 600,
      datetime: '2024-07-01T12:00:00Z',
      outflows: [{ assetSymbol: 'BTC', amount: '1', netAmount: '0.999', price: '60000' }],
      fees: [
        createFee('BTC', '0.001', {
          priceAmount: '60000',
          scope: 'network',
          settlement: 'on-chain',
        }),
      ],
    });
    const depositTx = buildTransaction({
      id: 601,
      accountId: 2,
      datetime: '2024-07-01T12:05:00Z',
      inflows: [{ assetSymbol: 'BTC', amount: '0.999', price: '60000' }],
    });

    const scopedWithdrawal = buildScopedTransaction(withdrawalTx);
    const scopedDeposit = buildScopedTransaction(depositTx);

    const sourceMovementFp = scopedWithdrawal.movements.outflows[0]!.movementFingerprint;
    const targetMovementFp = scopedDeposit.movements.inflows[0]!.movementFingerprint;

    const link: ValidatedScopedTransferLink = {
      isPartialMatch: false,
      link: {
        id: 80,
        sourceTransactionId: 600,
        targetTransactionId: 601,
        assetSymbol: 'BTC' as Currency,
        sourceAssetId: 'exchange:test:btc',
        targetAssetId: 'exchange:test:btc',
        sourceAmount: parseDecimal('0.999'),
        targetAmount: parseDecimal('0.999'),
        sourceMovementFingerprint: sourceMovementFp,
        targetMovementFingerprint: targetMovementFp,
        linkType: 'exchange_to_exchange',
        confidenceScore: parseDecimal('1'),
        matchCriteria: {
          assetMatch: true,
          amountSimilarity: parseDecimal('1'),
          timingValid: true,
          timingHours: 0,
        },
        status: 'confirmed',
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      sourceAssetId: 'exchange:test:btc',
      sourceMovementAmount: parseDecimal('0.999'),
      sourceMovementFingerprint: sourceMovementFp,
      targetAssetId: 'exchange:test:btc',
      targetMovementAmount: parseDecimal('0.999'),
      targetMovementFingerprint: targetMovementFp,
    };

    const transfers = makeTransferSet([link]);
    const usdConversionRateProvider = createFxProvider({ CAD: '1.40' });

    const events = assertOk(
      await buildSameAssetTransferFeeAdjustments({
        scopedTransactions: [scopedWithdrawal, scopedDeposit],
        validatedTransfers: transfers,
        feeOnlyInternalCarryovers: [],
        usdConversionRateProvider,
        identityConfig,
      })
    );

    // Should produce fee adjustment events for the same-asset on-chain fee
    expect(events.length).toBeGreaterThanOrEqual(1);
    const feeAdj = events[0]!;
    expect(feeAdj.kind).toBe('fee-adjustment');
    expect(feeAdj.adjustmentType).toBe('same-asset-transfer-fee-add-to-basis');
    expect(feeAdj.assetSymbol).toBe('BTC');
    expect(feeAdj.provenanceKind).toBe('validated-link');
  });

  it('returns empty events when there is no same-asset on-chain fee', async () => {
    const withdrawalTx = buildTransaction({
      id: 610,
      datetime: '2024-07-01T12:00:00Z',
      outflows: [{ assetSymbol: 'BTC', amount: '1', price: '60000' }],
      // No same-asset on-chain fee
    });
    const depositTx = buildTransaction({
      id: 611,
      accountId: 2,
      datetime: '2024-07-01T12:05:00Z',
      inflows: [{ assetSymbol: 'BTC', amount: '1', price: '60000' }],
    });

    const scopedWithdrawal = buildScopedTransaction(withdrawalTx);
    const scopedDeposit = buildScopedTransaction(depositTx);

    const sourceMovementFp = scopedWithdrawal.movements.outflows[0]!.movementFingerprint;
    const targetMovementFp = scopedDeposit.movements.inflows[0]!.movementFingerprint;

    const link: ValidatedScopedTransferLink = {
      isPartialMatch: false,
      link: {
        id: 81,
        sourceTransactionId: 610,
        targetTransactionId: 611,
        assetSymbol: 'BTC' as Currency,
        sourceAssetId: 'exchange:test:btc',
        targetAssetId: 'exchange:test:btc',
        sourceAmount: parseDecimal('1'),
        targetAmount: parseDecimal('1'),
        sourceMovementFingerprint: sourceMovementFp,
        targetMovementFingerprint: targetMovementFp,
        linkType: 'exchange_to_exchange',
        confidenceScore: parseDecimal('1'),
        matchCriteria: {
          assetMatch: true,
          amountSimilarity: parseDecimal('1'),
          timingValid: true,
          timingHours: 0,
        },
        status: 'confirmed',
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      sourceAssetId: 'exchange:test:btc',
      sourceMovementAmount: parseDecimal('1'),
      sourceMovementFingerprint: sourceMovementFp,
      targetAssetId: 'exchange:test:btc',
      targetMovementAmount: parseDecimal('1'),
      targetMovementFingerprint: targetMovementFp,
    };

    const transfers = makeTransferSet([link]);
    const usdConversionRateProvider = createFxProvider({ CAD: '1.40' });

    const events = assertOk(
      await buildSameAssetTransferFeeAdjustments({
        scopedTransactions: [scopedWithdrawal, scopedDeposit],
        validatedTransfers: transfers,
        feeOnlyInternalCarryovers: [],
        usdConversionRateProvider,
        identityConfig,
      })
    );

    expect(events).toHaveLength(0);
  });

  it('builds fee adjustments from fee-only carryovers', async () => {
    const sourceTx = buildTransaction({
      id: 620,
      datetime: '2024-07-01T12:00:00Z',
      outflows: [{ assetSymbol: 'BTC', amount: '1', price: '60000' }],
      fees: [
        createFee('BTC', '0.001', {
          priceAmount: '60000',
          scope: 'network',
          settlement: 'on-chain',
        }),
      ],
    });
    const targetTx = buildTransaction({
      id: 621,
      accountId: 2,
      datetime: '2024-07-01T12:05:00Z',
      inflows: [{ assetSymbol: 'BTC', amount: '1', price: '60000' }],
    });

    const scopedSource = buildScopedTransaction(sourceTx);
    const scopedTarget = buildScopedTransaction(targetTx);
    const sourceMovementFp = scopedSource.movements.outflows[0]!.movementFingerprint;
    const targetMovementFp = scopedTarget.movements.inflows[0]!.movementFingerprint;

    const carryover: FeeOnlyInternalCarryover = {
      assetId: 'exchange:test:btc',
      assetSymbol: 'BTC' as Currency,
      fee: {
        assetId: 'exchange:test:btc',
        assetSymbol: 'BTC' as Currency,
        amount: parseDecimal('0.001'),
        movementFingerprint: 'movement:test:carryover:fee:2',
        scope: 'network',
        settlement: 'on-chain',
        priceAtTxTime: createPriceAtTxTime('60000'),
        originalTransactionId: 620,
      },
      retainedQuantity: parseDecimal('1'),
      sourceTransactionId: 620,
      sourceMovementFingerprint: sourceMovementFp,
      targets: [
        {
          targetTransactionId: 621,
          targetMovementFingerprint: targetMovementFp,
          quantity: parseDecimal('1'),
        },
      ],
    };

    const usdConversionRateProvider = createFxProvider({ CAD: '1.40' });

    const events = assertOk(
      await buildSameAssetTransferFeeAdjustments({
        scopedTransactions: [scopedSource, scopedTarget],
        validatedTransfers: emptyTransferSet(),
        feeOnlyInternalCarryovers: [carryover],
        usdConversionRateProvider,
        identityConfig,
      })
    );

    expect(events.length).toBeGreaterThanOrEqual(1);
    const feeAdj = events[0]!;
    expect(feeAdj.kind).toBe('fee-adjustment');
    expect(feeAdj.adjustmentType).toBe('same-asset-transfer-fee-add-to-basis');
    expect(feeAdj.provenanceKind).toBe('fee-only-carryover');
  });
});
