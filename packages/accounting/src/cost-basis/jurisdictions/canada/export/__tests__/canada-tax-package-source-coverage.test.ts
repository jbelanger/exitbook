import { type Currency, parseDecimal } from '@exitbook/foundation';
import { assertErr, assertOk } from '@exitbook/foundation/test-utils';
import { describe, expect, it } from 'vitest';

import type { CanadaCostBasisWorkflowResult } from '../../../../workflow/workflow-result-types.js';
import type {
  CanadaAcquisitionEvent,
  CanadaDispositionEvent,
  CanadaTaxInputContext,
  CanadaTaxInputEvent,
  CanadaTaxReport,
  CanadaTaxReportAcquisition,
  CanadaTaxReportDisposition,
  CanadaTaxReportTransfer,
} from '../../../canada/tax/canada-tax-types.js';
import { collectCanadaTaxPackageSourceCoverage } from '../canada-tax-package-source-coverage.js';

const dummyValuation = {
  taxCurrency: 'CAD' as const,
  storagePriceAmount: parseDecimal('50000'),
  storagePriceCurrency: 'USD' as Currency,
  quotedPriceAmount: parseDecimal('50000'),
  quotedPriceCurrency: 'USD' as Currency,
  unitValueCad: parseDecimal('68000'),
  totalValueCad: parseDecimal('68000'),
  valuationSource: 'stored-price' as const,
};

function makeReportAcquisition(id: string, transactionId: number): CanadaTaxReportAcquisition {
  return {
    id,
    acquisitionEventId: `evt-${id}`,
    transactionId,
    taxPropertyKey: 'btc',
    assetSymbol: 'BTC' as Currency,
    acquiredAt: new Date('2024-01-01'),
    quantityAcquired: parseDecimal('1'),
    remainingQuantity: parseDecimal('1'),
    totalCostCad: parseDecimal('68000'),
    remainingAllocatedAcbCad: parseDecimal('68000'),
    costBasisPerUnitCad: parseDecimal('68000'),
  };
}

function makeReportDisposition(id: string, transactionId: number): CanadaTaxReportDisposition {
  return {
    id,
    dispositionEventId: `evt-${id}`,
    transactionId,
    taxPropertyKey: 'btc',
    assetSymbol: 'BTC' as Currency,
    disposedAt: new Date('2024-06-01'),
    quantityDisposed: parseDecimal('0.5'),
    proceedsCad: parseDecimal('40000'),
    costBasisCad: parseDecimal('34000'),
    gainLossCad: parseDecimal('6000'),
    deniedLossCad: parseDecimal('0'),
    taxableGainLossCad: parseDecimal('6000'),
    acbPerUnitCad: parseDecimal('68000'),
  };
}

function makeReportTransfer(
  id: string,
  transactionId: number,
  options?: {
    linkId?: number | undefined;
    sourceTransactionId?: number | undefined;
    targetTransactionId?: number | undefined;
  }
): CanadaTaxReportTransfer {
  return {
    id,
    direction: 'out',
    transactionId,
    taxPropertyKey: 'btc',
    assetSymbol: 'BTC' as Currency,
    transferredAt: new Date('2024-03-01'),
    quantity: parseDecimal('0.5'),
    carriedAcbCad: parseDecimal('34000'),
    carriedAcbPerUnitCad: parseDecimal('68000'),
    feeAdjustmentCad: parseDecimal('0'),
    sourceTransactionId: options?.sourceTransactionId,
    targetTransactionId: options?.targetTransactionId,
    linkId: options?.linkId,
  };
}

function makeEmptyTaxReport(overrides?: Partial<CanadaTaxReport>): CanadaTaxReport {
  return {
    calculationId: 'calc-1',
    taxCurrency: 'CAD',
    acquisitions: [],
    dispositions: [],
    transfers: [],
    superficialLossAdjustments: [],
    summary: {
      totalProceedsCad: parseDecimal('0'),
      totalCostBasisCad: parseDecimal('0'),
      totalGainLossCad: parseDecimal('0'),
      totalTaxableGainLossCad: parseDecimal('0'),
      totalDeniedLossCad: parseDecimal('0'),
    },
    displayContext: {
      transferMarketValueCadByTransferId: new Map(),
    },
    ...overrides,
  };
}

function makeInputContext(overrides?: Partial<CanadaTaxInputContext>): CanadaTaxInputContext {
  return {
    taxCurrency: 'CAD',
    inputTransactionIds: [],
    validatedTransferLinkIds: [],
    internalTransferCarryoverSourceTransactionIds: [],
    inputEvents: [],
    ...overrides,
  };
}

function makeArtifact(taxReport: CanadaTaxReport, inputContext?: CanadaTaxInputContext): CanadaCostBasisWorkflowResult {
  return {
    kind: 'canada-workflow',
    calculation: {
      id: 'calc-1',
      calculationDate: new Date(),
      method: 'average-cost',
      jurisdiction: 'CA',
      taxYear: 2024,
      displayCurrency: 'CAD' as Currency,
      taxCurrency: 'CAD',
      startDate: new Date('2024-01-01'),
      endDate: new Date('2024-12-31'),
      transactionsProcessed: 0,
      assetsProcessed: [],
    },
    taxReport,
    inputContext,
    executionMeta: { missingPricesCount: 0, missingPriceTransactionIds: [], retainedTransactionIds: [] },
  };
}

function makeInputEvent(
  eventId: string,
  kind: CanadaTaxInputEvent['kind'],
  transactionId: number,
  options?: {
    linkId?: number | undefined;
    provenanceKind?: CanadaTaxInputEvent['provenanceKind'] | undefined;
    sourceTransactionId?: number | undefined;
  }
): CanadaTaxInputEvent {
  const base = {
    eventId,
    transactionId,
    timestamp: new Date('2024-01-01'),
    assetId: 'test:btc',
    assetIdentityKey: 'btc',
    taxPropertyKey: 'btc',
    assetSymbol: 'BTC' as Currency,
    valuation: dummyValuation,
    provenanceKind: options?.provenanceKind ?? ('movement' as const),
    linkId: options?.linkId,
    sourceTransactionId: options?.sourceTransactionId,
  };

  if (kind === 'acquisition') {
    return { ...base, kind: 'acquisition', quantity: parseDecimal('1') } as CanadaAcquisitionEvent;
  }

  return { ...base, kind: 'disposition', quantity: parseDecimal('0.5') } as CanadaDispositionEvent;
}

describe('collectCanadaTaxPackageSourceCoverage', () => {
  it('returns error when inputContext is missing', () => {
    const artifact = makeArtifact(makeEmptyTaxReport(), undefined);

    const result = assertErr(collectCanadaTaxPackageSourceCoverage(artifact));

    expect(result.message).toContain('missing inputContext');
  });

  it('collects transaction refs from acquisitions', () => {
    const acq = makeReportAcquisition('acq-1', 100);
    const report = makeEmptyTaxReport({ acquisitions: [acq] });
    const artifact = makeArtifact(report, makeInputContext());

    const result = assertOk(collectCanadaTaxPackageSourceCoverage(artifact));

    expect(result.transactionRefs).toEqual(
      expect.arrayContaining([{ transactionId: 100, reference: 'Canada acquisition acq-1' }])
    );
  });

  it('collects transaction refs from dispositions', () => {
    const disp = makeReportDisposition('disp-1', 200);
    const report = makeEmptyTaxReport({ dispositions: [disp] });
    const artifact = makeArtifact(report, makeInputContext());

    const result = assertOk(collectCanadaTaxPackageSourceCoverage(artifact));

    expect(result.transactionRefs).toEqual(
      expect.arrayContaining([{ transactionId: 200, reference: 'Canada disposition disp-1' }])
    );
  });

  it('collects transaction refs and confirmed link refs from transfers', () => {
    const transfer = makeReportTransfer('xfer-1', 300, {
      sourceTransactionId: 301,
      targetTransactionId: 302,
      linkId: 42,
    });
    const report = makeEmptyTaxReport({ transfers: [transfer] });
    const artifact = makeArtifact(report, makeInputContext());

    const result = assertOk(collectCanadaTaxPackageSourceCoverage(artifact));

    expect(result.transactionRefs).toEqual(
      expect.arrayContaining([
        { transactionId: 300, reference: 'Canada transfer xfer-1' },
        { transactionId: 301, reference: 'Canada transfer xfer-1 source' },
        { transactionId: 302, reference: 'Canada transfer xfer-1 target' },
      ])
    );
    expect(result.confirmedLinkRefs).toEqual(
      expect.arrayContaining([{ linkId: 42, reference: 'Canada transfer xfer-1' }])
    );
  });

  it('does not add optional transfer fields when undefined', () => {
    const transfer = makeReportTransfer('xfer-2', 400);
    const report = makeEmptyTaxReport({ transfers: [transfer] });
    const artifact = makeArtifact(report, makeInputContext());

    const result = assertOk(collectCanadaTaxPackageSourceCoverage(artifact));

    // Only the main transaction ref, no source/target/link refs
    expect(result.transactionRefs).toEqual([{ transactionId: 400, reference: 'Canada transfer xfer-2' }]);
    expect(result.confirmedLinkRefs).toHaveLength(0);
  });

  it('collects refs from inputContext transaction ids', () => {
    const artifact = makeArtifact(makeEmptyTaxReport(), makeInputContext({ inputTransactionIds: [500, 501] }));

    const result = assertOk(collectCanadaTaxPackageSourceCoverage(artifact));

    expect(result.transactionRefs).toEqual(
      expect.arrayContaining([
        { transactionId: 500, reference: 'Canada inputContext transaction 500' },
        { transactionId: 501, reference: 'Canada inputContext transaction 501' },
      ])
    );
  });

  it('collects confirmed link refs from inputContext validated transfer link ids', () => {
    const artifact = makeArtifact(makeEmptyTaxReport(), makeInputContext({ validatedTransferLinkIds: [10, 11] }));

    const result = assertOk(collectCanadaTaxPackageSourceCoverage(artifact));

    expect(result.confirmedLinkRefs).toEqual(
      expect.arrayContaining([
        { linkId: 10, reference: 'Canada inputContext validated transfer link 10' },
        { linkId: 11, reference: 'Canada inputContext validated transfer link 11' },
      ])
    );
  });

  it('collects transaction refs from inputContext internal transfer carryover source transaction ids', () => {
    const artifact = makeArtifact(
      makeEmptyTaxReport(),
      makeInputContext({ internalTransferCarryoverSourceTransactionIds: [600] })
    );

    const result = assertOk(collectCanadaTaxPackageSourceCoverage(artifact));

    expect(result.transactionRefs).toEqual(
      expect.arrayContaining([
        {
          transactionId: 600,
          reference: 'Canada inputContext internal transfer carryover source transaction 600',
        },
      ])
    );
  });

  it('collects refs from inputContext input events with validated-link provenance', () => {
    const event = makeInputEvent('evt-1', 'acquisition', 700, {
      provenanceKind: 'validated-link',
      linkId: 55,
      sourceTransactionId: 701,
    });
    const artifact = makeArtifact(makeEmptyTaxReport(), makeInputContext({ inputEvents: [event] }));

    const result = assertOk(collectCanadaTaxPackageSourceCoverage(artifact));

    expect(result.transactionRefs).toEqual(
      expect.arrayContaining([
        { transactionId: 700, reference: 'Canada input event evt-1' },
        { transactionId: 701, reference: 'Canada input event evt-1 source' },
      ])
    );
    expect(result.confirmedLinkRefs).toEqual(
      expect.arrayContaining([{ linkId: 55, reference: 'Canada input event evt-1' }])
    );
  });

  it('returns error when validated-link input event is missing linkId', () => {
    const event = makeInputEvent('evt-bad', 'acquisition', 800, {
      provenanceKind: 'validated-link',
      linkId: undefined,
    });
    const artifact = makeArtifact(makeEmptyTaxReport(), makeInputContext({ inputEvents: [event] }));

    const result = assertErr(collectCanadaTaxPackageSourceCoverage(artifact));

    expect(result.message).toContain('Missing confirmed link id');
    expect(result.message).toContain('evt-bad');
  });

  it('does not add source transaction ref for input event without sourceTransactionId', () => {
    const event = makeInputEvent('evt-2', 'disposition', 900, {
      provenanceKind: 'movement',
    });
    const artifact = makeArtifact(makeEmptyTaxReport(), makeInputContext({ inputEvents: [event] }));

    const result = assertOk(collectCanadaTaxPackageSourceCoverage(artifact));

    // Only the main event transaction ref
    const eventRefs = result.transactionRefs.filter((r) => r.reference.includes('evt-2'));
    expect(eventRefs).toEqual([{ transactionId: 900, reference: 'Canada input event evt-2' }]);
    expect(result.confirmedLinkRefs).toHaveLength(0);
  });
});
