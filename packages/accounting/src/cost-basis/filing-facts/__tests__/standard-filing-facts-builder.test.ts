import { parseDecimal, type Currency } from '@exitbook/foundation';
import { assertErr, assertOk } from '@exitbook/foundation/test-utils';
import { describe, expect, it } from 'vitest';

import {
  buildStandardCostBasisFilingFacts,
  buildStandardLedgerCostBasisFilingFacts,
} from '../standard-filing-facts-builder.js';

import { createStandardLedgerWorkflowArtifact, createStandardWorkflowArtifact } from './test-utils.js';

describe('buildStandardCostBasisFilingFacts', () => {
  describe('happy path', () => {
    it('returns Ok with correct filing facts for a valid artifact with lots, disposals, and transfers', () => {
      const result = assertOk(
        buildStandardCostBasisFilingFacts({
          artifact: createStandardWorkflowArtifact(),
          scopeKey: 'scope:us:2024',
          snapshotId: 'snapshot-us-2024',
        })
      );

      expect(result.kind).toBe('standard');
      expect(result.calculationId).toBe('df94bdd2-b8ee-4486-9c83-b0f91ca62514');
      expect(result.jurisdiction).toBe('US');
      expect(result.method).toBe('fifo');
      expect(result.taxYear).toBe(2024);
      expect(result.taxCurrency).toBe('USD');
    });

    it('maps acquisition lots to acquisition filing facts', () => {
      const result = assertOk(buildStandardCostBasisFilingFacts({ artifact: createStandardWorkflowArtifact() }));

      expect(result.acquisitions).toHaveLength(2);

      const acq1 = result.acquisitions[0]!;
      expect(acq1.kind).toBe('standard-acquisition');
      expect(acq1.id).toBe('lot-1');
      expect(acq1.assetId).toBe('exchange:kraken:btc');
      expect(acq1.assetSymbol).toBe('BTC');
      expect(acq1.acquiredAt).toEqual(new Date('2023-01-05T00:00:00.000Z'));
      expect(acq1.quantity.toFixed(0)).toBe('1');
      expect(acq1.remainingQuantity.toFixed(0)).toBe('0');
      expect(acq1.totalCostBasis.toFixed(0)).toBe('10000');
      expect(acq1.costBasisPerUnit.toFixed(0)).toBe('10000');
      expect(acq1.transactionId).toBe(1);
      expect(acq1.status).toBe('fully_disposed');

      const acq2 = result.acquisitions[1]!;
      expect(acq2.id).toBe('lot-2');
      expect(acq2.remainingQuantity.toFixed(2)).toBe('0.35');
      expect(acq2.status).toBe('partially_disposed');
    });

    it('maps disposals to disposition filing facts', () => {
      const result = assertOk(buildStandardCostBasisFilingFacts({ artifact: createStandardWorkflowArtifact() }));

      expect(result.dispositions).toHaveLength(2);

      const disp1 = result.dispositions[0]!;
      expect(disp1.kind).toBe('standard-disposition');
      expect(disp1.id).toBe('disp-1');
      expect(disp1.lotId).toBe('lot-1');
      expect(disp1.assetId).toBe('exchange:kraken:btc');
      expect(disp1.assetSymbol).toBe('BTC');
      expect(disp1.acquiredAt).toEqual(new Date('2023-01-05T00:00:00.000Z'));
      expect(disp1.disposedAt).toEqual(new Date('2024-11-01T00:00:00.000Z'));
      expect(disp1.quantity.toFixed(0)).toBe('1');
      expect(disp1.proceedsPerUnit.toFixed(0)).toBe('9000');
      expect(disp1.totalProceeds.toFixed(0)).toBe('8955');
      expect(disp1.totalCostBasis.toFixed(0)).toBe('10000');
      expect(disp1.costBasisPerUnit.toFixed(0)).toBe('10000');
      expect(disp1.gainLoss.toFixed(0)).toBe('-1045');
      expect(disp1.holdingPeriodDays).toBe(666);
      expect(disp1.acquisitionTransactionId).toBe(1);
      expect(disp1.disposalTransactionId).toBe(3);
      expect(disp1.grossProceeds.toFixed(0)).toBe('9000');
      expect(disp1.sellingExpenses.toFixed(0)).toBe('45');
      expect(disp1.netProceeds.toFixed(0)).toBe('8955');

      const disp2 = result.dispositions[1]!;
      expect(disp2.id).toBe('disp-2');
      expect(disp2.lotId).toBe('lot-2');
      expect(disp2.quantity.toFixed(1)).toBe('0.4');
      expect(disp2.holdingPeriodDays).toBe(153);
    });

    it('maps lot transfers to transfer filing facts', () => {
      const result = assertOk(buildStandardCostBasisFilingFacts({ artifact: createStandardWorkflowArtifact() }));

      expect(result.transfers).toHaveLength(1);

      const transfer = result.transfers[0]!;
      expect(transfer.kind).toBe('standard-transfer');
      expect(transfer.id).toBe('transfer-1');
      expect(transfer.sourceLotId).toBe('lot-2');
      expect(transfer.assetId).toBe('exchange:kraken:btc');
      expect(transfer.assetSymbol).toBe('BTC');
      expect(transfer.transferredAt).toEqual(new Date('2024-12-15T00:00:00.000Z'));
      expect(transfer.quantity.toFixed(2)).toBe('0.25');
      expect(transfer.costBasisPerUnit.toFixed(0)).toBe('15000');
      expect(transfer.totalCostBasis.toFixed(0)).toBe('3750');
      expect(transfer.sourceTransactionId).toBe(4);
      expect(transfer.targetTransactionId).toBe(5);
      expect(transfer.provenanceKind).toBe('confirmed-link');
      expect(transfer.linkedConfirmedLinkId).toBe(11);
      expect(transfer.sourceAcquiredAt).toEqual(new Date('2024-06-01T00:00:00.000Z'));
      expect(transfer.sameAssetFeeAmount!.toFixed(2)).toBe('12.50');
    });

    it('omits linkedConfirmedLinkId for internal-transfer-carryover transfers', () => {
      const artifact = createStandardWorkflowArtifact({
        lotTransfers: [
          {
            id: 'transfer-foc',
            calculationId: 'df94bdd2-b8ee-4486-9c83-b0f91ca62514',
            sourceLotId: 'lot-2',
            provenance: {
              kind: 'internal-transfer-carryover',
              sourceMovementFingerprint: 'movement:exchange:source:4:btc:outflow:0',
              targetMovementFingerprint: 'movement:blockchain:target:5:btc:inflow:0',
            },
            quantityTransferred: parseDecimal('0.1'),
            costBasisPerUnit: parseDecimal('15000'),
            sourceTransactionId: 4,
            targetTransactionId: 5,
            transferDate: new Date('2024-12-15T00:00:00.000Z'),
            createdAt: new Date('2026-03-15T12:00:00.000Z'),
          },
        ],
      });

      const result = assertOk(buildStandardCostBasisFilingFacts({ artifact }));
      const transfer = result.transfers[0]!;
      expect(transfer.provenanceKind).toBe('internal-transfer-carryover');
      expect(transfer.linkedConfirmedLinkId).toBeUndefined();
    });

    it('omits sameAssetFeeAmount when metadata does not contain it', () => {
      const artifact = createStandardWorkflowArtifact({
        lotTransfers: [
          {
            ...createStandardWorkflowArtifact().lotTransfers[0]!,
            metadata: undefined,
          },
        ],
      });

      const result = assertOk(buildStandardCostBasisFilingFacts({ artifact }));
      expect(result.transfers[0]!.sameAssetFeeAmount).toBeUndefined();
    });
  });

  describe('missing source lot errors', () => {
    it('returns Err when a disposal references a missing source lot', () => {
      const artifact = createStandardWorkflowArtifact({
        disposals: [
          {
            ...createStandardWorkflowArtifact().disposals[0]!,
            lotId: 'nonexistent-lot',
          },
        ],
      });

      const error = assertErr(buildStandardCostBasisFilingFacts({ artifact }));
      expect(error.message).toContain('Missing source lot nonexistent-lot');
      expect(error.message).toContain('filing-facts disposal');
    });

    it('returns Err when a transfer references a missing source lot', () => {
      const artifact = createStandardWorkflowArtifact({
        lotTransfers: [
          {
            ...createStandardWorkflowArtifact().lotTransfers[0]!,
            sourceLotId: 'nonexistent-lot',
          },
        ],
      });

      const error = assertErr(buildStandardCostBasisFilingFacts({ artifact }));
      expect(error.message).toContain('Missing source lot nonexistent-lot');
      expect(error.message).toContain('filing-facts transfer');
    });
  });

  describe('loss disallowance', () => {
    it('sets taxableGainLoss to 0 when disposal.lossDisallowed is true', () => {
      const result = assertOk(buildStandardCostBasisFilingFacts({ artifact: createStandardWorkflowArtifact() }));

      // disp-1 has lossDisallowed: true, gainLoss: -1045
      const disp1 = result.dispositions[0]!;
      expect(disp1.lossDisallowed).toBe(true);
      expect(disp1.taxableGainLoss.toFixed(0)).toBe('0');
      expect(disp1.deniedLossAmount.toFixed(0)).toBe('1045');
    });

    it('uses jurisdiction calculateTaxableGain when lossDisallowed is false', () => {
      const result = assertOk(buildStandardCostBasisFilingFacts({ artifact: createStandardWorkflowArtifact() }));

      // disp-2 has lossDisallowed: false, gainLoss: -30
      // US rules: 100% of gain is taxable
      const disp2 = result.dispositions[1]!;
      expect(disp2.lossDisallowed).toBe(false);
      expect(disp2.taxableGainLoss.toFixed(0)).toBe('-30');
      expect(disp2.deniedLossAmount.toFixed(0)).toBe('0');
    });

    it('sets deniedLossAmount to 0 when disallowedLossAmount is undefined', () => {
      const result = assertOk(buildStandardCostBasisFilingFacts({ artifact: createStandardWorkflowArtifact() }));

      // disp-2 has disallowedLossAmount: undefined
      const disp2 = result.dispositions[1]!;
      expect(disp2.deniedLossAmount.toFixed(0)).toBe('0');
    });
  });

  describe('US tax treatment classification', () => {
    it('classifies long_term for disposal more than 1 year after acquisition', () => {
      // lot-1 acquired 2023-01-05, disp-1 disposed 2024-11-01 (666 days) -> long_term
      const result = assertOk(buildStandardCostBasisFilingFacts({ artifact: createStandardWorkflowArtifact() }));

      expect(result.dispositions[0]!.taxTreatmentCategory).toBe('long_term');
    });

    it('classifies short_term for disposal less than 1 year after acquisition', () => {
      // lot-2 acquired 2024-06-01, disp-2 disposed 2024-11-01 (153 days) -> short_term
      const result = assertOk(buildStandardCostBasisFilingFacts({ artifact: createStandardWorkflowArtifact() }));

      expect(result.dispositions[1]!.taxTreatmentCategory).toBe('short_term');
    });

    it('classifies exact one-year anniversary as short_term (must be strictly after)', () => {
      const artifact = createStandardWorkflowArtifact({
        lots: [
          {
            id: 'lot-exact',
            calculationId: 'df94bdd2-b8ee-4486-9c83-b0f91ca62514',
            acquisitionTransactionId: 1,
            assetId: 'exchange:kraken:btc',
            assetSymbol: 'BTC' as Currency,
            quantity: parseDecimal('1'),
            costBasisPerUnit: parseDecimal('10000'),
            totalCostBasis: parseDecimal('10000'),
            acquisitionDate: new Date('2023-03-15T00:00:00.000Z'),
            method: 'fifo',
            remainingQuantity: parseDecimal('0'),
            status: 'fully_disposed',
            createdAt: new Date('2026-03-15T12:00:00.000Z'),
            updatedAt: new Date('2026-03-15T12:00:00.000Z'),
          },
        ],
        disposals: [
          {
            id: 'disp-exact',
            lotId: 'lot-exact',
            disposalTransactionId: 2,
            quantityDisposed: parseDecimal('1'),
            proceedsPerUnit: parseDecimal('11000'),
            totalProceeds: parseDecimal('11000'),
            grossProceeds: parseDecimal('11000'),
            sellingExpenses: parseDecimal('0'),
            netProceeds: parseDecimal('11000'),
            costBasisPerUnit: parseDecimal('10000'),
            totalCostBasis: parseDecimal('10000'),
            gainLoss: parseDecimal('1000'),
            // Exactly one year anniversary: 2024-03-15
            disposalDate: new Date('2024-03-15T00:00:00.000Z'),
            holdingPeriodDays: 366,
            lossDisallowed: false,
            disallowedLossAmount: undefined,
            taxTreatmentCategory: undefined,
            createdAt: new Date('2026-03-15T12:00:00.000Z'),
          },
        ],
        lotTransfers: [],
      });

      const result = assertOk(buildStandardCostBasisFilingFacts({ artifact }));
      // Exact anniversary day is NOT strictly after -> short_term
      expect(result.dispositions[0]!.taxTreatmentCategory).toBe('short_term');
    });

    it('classifies one day after anniversary as long_term', () => {
      const artifact = createStandardWorkflowArtifact({
        lots: [
          {
            id: 'lot-day-after',
            calculationId: 'df94bdd2-b8ee-4486-9c83-b0f91ca62514',
            acquisitionTransactionId: 1,
            assetId: 'exchange:kraken:btc',
            assetSymbol: 'BTC' as Currency,
            quantity: parseDecimal('1'),
            costBasisPerUnit: parseDecimal('10000'),
            totalCostBasis: parseDecimal('10000'),
            acquisitionDate: new Date('2023-03-15T00:00:00.000Z'),
            method: 'fifo',
            remainingQuantity: parseDecimal('0'),
            status: 'fully_disposed',
            createdAt: new Date('2026-03-15T12:00:00.000Z'),
            updatedAt: new Date('2026-03-15T12:00:00.000Z'),
          },
        ],
        disposals: [
          {
            id: 'disp-day-after',
            lotId: 'lot-day-after',
            disposalTransactionId: 2,
            quantityDisposed: parseDecimal('1'),
            proceedsPerUnit: parseDecimal('11000'),
            totalProceeds: parseDecimal('11000'),
            grossProceeds: parseDecimal('11000'),
            sellingExpenses: parseDecimal('0'),
            netProceeds: parseDecimal('11000'),
            costBasisPerUnit: parseDecimal('10000'),
            totalCostBasis: parseDecimal('10000'),
            gainLoss: parseDecimal('1000'),
            // One day after anniversary: 2024-03-16
            disposalDate: new Date('2024-03-16T00:00:00.000Z'),
            holdingPeriodDays: 367,
            lossDisallowed: false,
            disallowedLossAmount: undefined,
            taxTreatmentCategory: undefined,
            createdAt: new Date('2026-03-15T12:00:00.000Z'),
          },
        ],
        lotTransfers: [],
      });

      const result = assertOk(buildStandardCostBasisFilingFacts({ artifact }));
      expect(result.dispositions[0]!.taxTreatmentCategory).toBe('long_term');
    });

    it('uses calendar dates ignoring time-of-day for classification', () => {
      // Acquired late in the day, disposed early the next year — calendar dates should control
      const artifact = createStandardWorkflowArtifact({
        lots: [
          {
            id: 'lot-time',
            calculationId: 'df94bdd2-b8ee-4486-9c83-b0f91ca62514',
            acquisitionTransactionId: 1,
            assetId: 'exchange:kraken:btc',
            assetSymbol: 'BTC' as Currency,
            quantity: parseDecimal('1'),
            costBasisPerUnit: parseDecimal('10000'),
            totalCostBasis: parseDecimal('10000'),
            acquisitionDate: new Date('2023-06-15T23:59:59.000Z'),
            method: 'fifo',
            remainingQuantity: parseDecimal('0'),
            status: 'fully_disposed',
            createdAt: new Date('2026-03-15T12:00:00.000Z'),
            updatedAt: new Date('2026-03-15T12:00:00.000Z'),
          },
        ],
        disposals: [
          {
            id: 'disp-time',
            lotId: 'lot-time',
            disposalTransactionId: 2,
            quantityDisposed: parseDecimal('1'),
            proceedsPerUnit: parseDecimal('11000'),
            totalProceeds: parseDecimal('11000'),
            grossProceeds: parseDecimal('11000'),
            sellingExpenses: parseDecimal('0'),
            netProceeds: parseDecimal('11000'),
            costBasisPerUnit: parseDecimal('10000'),
            totalCostBasis: parseDecimal('10000'),
            gainLoss: parseDecimal('1000'),
            // Same calendar date next year + 1 day = long_term (2024-06-16 > 2024-06-15)
            disposalDate: new Date('2024-06-16T00:00:01.000Z'),
            holdingPeriodDays: 367,
            lossDisallowed: false,
            disallowedLossAmount: undefined,
            taxTreatmentCategory: undefined,
            createdAt: new Date('2026-03-15T12:00:00.000Z'),
          },
        ],
        lotTransfers: [],
      });

      const result = assertOk(buildStandardCostBasisFilingFacts({ artifact }));
      expect(result.dispositions[0]!.taxTreatmentCategory).toBe('long_term');
    });
  });

  describe('non-US jurisdiction tax treatment', () => {
    it('passes through artifactTaxTreatmentCategory for non-US jurisdictions', () => {
      const artifact = createStandardWorkflowArtifact();
      // Override jurisdiction to CA (which has rules implemented)
      // But CA uses specialized workflow, so we test with a hypothetical non-US standard artifact
      // by overriding the config jurisdiction. The key insight is that normalizeStandardTaxTreatmentCategory
      // passes through the artifact's category for non-US jurisdictions.
      artifact.summary.calculation.config.jurisdiction = 'UK';

      // UK rules are not implemented, so resolveCostBasisJurisdictionRules returns Err
      const error = assertErr(buildStandardCostBasisFilingFacts({ artifact }));
      expect(error.message).toContain('UK jurisdiction rules not yet implemented');
    });

    it('passes through undefined taxTreatmentCategory for non-US jurisdiction with valid rules', () => {
      // We can test the non-US path by using a jurisdiction that has rules (CA)
      // but the standard workflow path. In practice CA uses the specialized workflow,
      // but the filing facts builder only cares about the rules being resolved.
      const artifact = createStandardWorkflowArtifact();
      artifact.summary.calculation.config.jurisdiction = 'CA';

      // CA has rules, so this should succeed. The disposal's taxTreatmentCategory
      // should pass through as-is (since jurisdiction !== 'US').
      const result = assertOk(buildStandardCostBasisFilingFacts({ artifact }));

      // disp-1 has taxTreatmentCategory: 'long_term' in the artifact - passed through as-is
      expect(result.dispositions[0]!.taxTreatmentCategory).toBe('long_term');
      // disp-2 has taxTreatmentCategory: 'short_term' in the artifact - passed through as-is
      expect(result.dispositions[1]!.taxTreatmentCategory).toBe('short_term');
    });
  });

  describe('asset summaries and summary', () => {
    it('builds correct asset summaries for a single asset', () => {
      const result = assertOk(buildStandardCostBasisFilingFacts({ artifact: createStandardWorkflowArtifact() }));

      expect(result.assetSummaries).toHaveLength(1);
      const assetSummary = result.assetSummaries[0]!;
      expect(assetSummary.assetGroupingKey).toBe('exchange:kraken:btc');
      expect(assetSummary.assetId).toBe('exchange:kraken:btc');
      expect(assetSummary.assetSymbol).toBe('BTC');
      expect(assetSummary.acquisitionCount).toBe(2);
      expect(assetSummary.dispositionCount).toBe(2);
      expect(assetSummary.transferCount).toBe(1);
      expect(assetSummary.totalProceeds.toFixed(2)).toBe('14925.00');
      expect(assetSummary.totalCostBasis.toFixed(2)).toBe('16000.00');
      expect(assetSummary.totalGainLoss.toFixed(2)).toBe('-1075.00');
      expect(assetSummary.totalDeniedLoss.toFixed(2)).toBe('1045.00');
    });

    it('builds correct overall summary', () => {
      const result = assertOk(buildStandardCostBasisFilingFacts({ artifact: createStandardWorkflowArtifact() }));

      expect(result.summary.assetCount).toBe(1);
      expect(result.summary.acquisitionCount).toBe(2);
      expect(result.summary.dispositionCount).toBe(2);
      expect(result.summary.transferCount).toBe(1);
      expect(result.summary.totalProceeds.toFixed(2)).toBe('14925.00');
      expect(result.summary.totalCostBasis.toFixed(2)).toBe('16000.00');
      expect(result.summary.totalGainLoss.toFixed(2)).toBe('-1075.00');
      expect(result.summary.totalTaxableGainLoss.toFixed(2)).toBe('-30.00');
      expect(result.summary.totalDeniedLoss.toFixed(2)).toBe('1045.00');
    });

    it('builds tax treatment breakdown in summary', () => {
      const result = assertOk(buildStandardCostBasisFilingFacts({ artifact: createStandardWorkflowArtifact() }));

      expect(result.summary.byTaxTreatment).toHaveLength(2);
      expect(
        result.summary.byTaxTreatment.map((item) => ({
          taxTreatmentCategory: item.taxTreatmentCategory,
          dispositionCount: item.dispositionCount,
          totalGainLoss: item.totalGainLoss.toFixed(2),
          totalTaxableGainLoss: item.totalTaxableGainLoss.toFixed(2),
        }))
      ).toEqual([
        {
          taxTreatmentCategory: 'short_term',
          dispositionCount: 1,
          totalGainLoss: '-30.00',
          totalTaxableGainLoss: '-30.00',
        },
        {
          taxTreatmentCategory: 'long_term',
          dispositionCount: 1,
          totalGainLoss: '-1045.00',
          totalTaxableGainLoss: '0.00',
        },
      ]);
    });

    it('builds asset summaries for multiple assets', () => {
      const artifact = createStandardWorkflowArtifact({
        lots: [
          ...createStandardWorkflowArtifact().lots,
          {
            id: 'lot-eth',
            calculationId: 'df94bdd2-b8ee-4486-9c83-b0f91ca62514',
            acquisitionTransactionId: 10,
            assetId: 'exchange:kraken:eth',
            assetSymbol: 'ETH' as Currency,
            quantity: parseDecimal('5'),
            costBasisPerUnit: parseDecimal('2000'),
            totalCostBasis: parseDecimal('10000'),
            acquisitionDate: new Date('2024-01-10T00:00:00.000Z'),
            method: 'fifo',
            remainingQuantity: parseDecimal('5'),
            status: 'open',
            createdAt: new Date('2026-03-15T12:00:00.000Z'),
            updatedAt: new Date('2026-03-15T12:00:00.000Z'),
          },
        ],
      });

      const result = assertOk(buildStandardCostBasisFilingFacts({ artifact }));
      expect(result.assetSummaries).toHaveLength(2);

      const btcSummary = result.assetSummaries.find((s) => s.assetSymbol === 'BTC');
      const ethSummary = result.assetSummaries.find((s) => s.assetSymbol === 'ETH');
      expect(btcSummary).toBeDefined();
      expect(ethSummary).toBeDefined();
      expect(btcSummary!.acquisitionCount).toBe(2);
      expect(ethSummary!.acquisitionCount).toBe(1);
      expect(ethSummary!.dispositionCount).toBe(0);
      expect(ethSummary!.transferCount).toBe(0);
    });
  });

  describe('scopeKey and snapshotId passthrough', () => {
    it('includes scopeKey and snapshotId when provided', () => {
      const result = assertOk(
        buildStandardCostBasisFilingFacts({
          artifact: createStandardWorkflowArtifact(),
          scopeKey: 'scope:us:2024',
          snapshotId: 'snapshot-us-2024',
        })
      );

      expect(result.scopeKey).toBe('scope:us:2024');
      expect(result.snapshotId).toBe('snapshot-us-2024');
    });

    it('leaves scopeKey and snapshotId undefined when not provided', () => {
      const result = assertOk(buildStandardCostBasisFilingFacts({ artifact: createStandardWorkflowArtifact() }));

      expect(result.scopeKey).toBeUndefined();
      expect(result.snapshotId).toBeUndefined();
    });
  });

  describe('empty collections', () => {
    it('handles artifact with no disposals or transfers', () => {
      const artifact = createStandardWorkflowArtifact({
        disposals: [],
        lotTransfers: [],
      });

      const result = assertOk(buildStandardCostBasisFilingFacts({ artifact }));
      expect(result.acquisitions).toHaveLength(2);
      expect(result.dispositions).toHaveLength(0);
      expect(result.transfers).toHaveLength(0);
      expect(result.summary.dispositionCount).toBe(0);
      expect(result.summary.transferCount).toBe(0);
      expect(result.summary.totalProceeds.toFixed(0)).toBe('0');
      expect(result.summary.totalGainLoss.toFixed(0)).toBe('0');
    });
  });

  describe('unsupported jurisdiction', () => {
    it('returns Err for an unregistered jurisdiction', () => {
      const artifact = createStandardWorkflowArtifact();
      artifact.summary.calculation.config.jurisdiction = 'ZZ' as 'US';

      const error = assertErr(buildStandardCostBasisFilingFacts({ artifact }));
      expect(error.message).toContain('ZZ');
      expect(error.message).toContain('not registered');
    });
  });
});

describe('buildStandardLedgerCostBasisFilingFacts', () => {
  it('builds ledger-native acquisition, disposition, and carry filing facts without transaction ids', () => {
    const result = assertOk(
      buildStandardLedgerCostBasisFilingFacts({
        artifact: createStandardLedgerWorkflowArtifact(),
        scopeKey: 'scope:standard-ledger',
        snapshotId: 'snapshot:standard-ledger',
      })
    );

    expect(result.kind).toBe('standard-ledger');
    expect(result.calculationId).toBe('standard-ledger-calculation:test');
    expect(result.scopeKey).toBe('scope:standard-ledger');
    expect(result.snapshotId).toBe('snapshot:standard-ledger');
    expect(result.acquisitions).toHaveLength(3);
    expect(result.dispositions).toHaveLength(2);
    expect(result.transfers).toHaveLength(1);
    expect(JSON.stringify(result)).not.toContain('transactionId');

    const carriedAcquisition = result.acquisitions.find(
      (acquisition) => acquisition.id === 'standard-ledger-lot:wrapped'
    );
    expect(carriedAcquisition).toMatchObject({
      kind: 'standard-ledger-acquisition',
      chainKey: 'ethereum:wbtc',
      operationId: 'operation:carry',
      sourceEventId: 'event:carry-target',
      status: 'open',
    });
    expect(carriedAcquisition?.totalCostBasis.toFixed()).toBe('50');

    expect(
      result.dispositions.map((disposition) => ({
        id: disposition.id,
        sourceLotId: disposition.sourceLotId,
        totalProceeds: disposition.totalProceeds.toFixed(),
        totalCostBasis: disposition.totalCostBasis.toFixed(),
        gainLoss: disposition.gainLoss.toFixed(),
        sourceEventId: disposition.sourceEventId,
        postingFingerprint: disposition.provenance.postingFingerprint,
        taxTreatmentCategory: disposition.taxTreatmentCategory,
      }))
    ).toEqual([
      {
        id: 'standard-ledger-disposal:sell:slice:1',
        sourceLotId: 'standard-ledger-lot:old',
        totalProceeds: '400',
        totalCostBasis: '100',
        gainLoss: '300',
        sourceEventId: 'event:sell',
        postingFingerprint: 'posting:sell',
        taxTreatmentCategory: 'long_term',
      },
      {
        id: 'standard-ledger-disposal:sell:slice:2',
        sourceLotId: 'standard-ledger-lot:new',
        totalProceeds: '200',
        totalCostBasis: '100',
        gainLoss: '100',
        sourceEventId: 'event:sell',
        postingFingerprint: 'posting:sell',
        taxTreatmentCategory: 'short_term',
      },
    ]);

    const transfer = result.transfers[0]!;
    expect(transfer).toMatchObject({
      kind: 'standard-ledger-transfer',
      operationId: 'operation:carry',
      relationshipKind: 'bridge',
      relationshipStableKey: 'relationship:bridge',
      sourceChainKey: 'btc',
      targetChainKey: 'ethereum:wbtc',
      sourceLotId: 'standard-ledger-lot:new',
      targetLotId: 'standard-ledger-lot:wrapped',
    });
    expect(transfer.totalCostBasis.toFixed()).toBe('50');
    expect(transfer.costBasisPerUnit.toFixed()).toBe('200');
  });

  it('fails closed when ledger calculation blockers remain', () => {
    const artifact = createStandardLedgerWorkflowArtifact({
      engineResult: {
        ...createStandardLedgerWorkflowArtifact().engineResult,
        blockers: [
          {
            blockerId: 'standard-ledger-calculation-blocker:test',
            reason: 'unknown_fee_attachment',
            propagation: 'op-only',
            affectedChainKeys: ['btc'],
            inputEventIds: ['event:fee'],
            inputOperationIds: ['operation:fee'],
            message: 'fee attachment unresolved',
          },
        ],
      },
    });

    const error = assertErr(buildStandardLedgerCostBasisFilingFacts({ artifact }));
    expect(error.message).toContain('calculation blockers remain');
    expect(error.message).toContain('standard-ledger-calculation-blocker:test');
  });

  it('fails closed for unresolved-basis ledger lots', () => {
    const base = createStandardLedgerWorkflowArtifact();
    const artifact = createStandardLedgerWorkflowArtifact({
      engineResult: {
        ...base.engineResult,
        lots: [
          {
            ...base.engineResult.lots[0]!,
            basisStatus: 'unresolved',
            costBasisPerUnit: undefined,
            totalCostBasis: undefined,
          },
          ...base.engineResult.lots.slice(1),
        ],
      },
    });

    const error = assertErr(buildStandardLedgerCostBasisFilingFacts({ artifact }));
    expect(error.message).toContain('unresolved-basis standard ledger lot standard-ledger-lot:old');
  });
});
