import { parseDecimal, type Currency } from '@exitbook/core';
import { assertOk } from '@exitbook/core/test-utils';
import { describe, expect, it } from 'vitest';

import { buildCanadaCostBasisFilingFacts } from '../canada-filing-facts-builder.js';

import { createCanadaWorkflowArtifact } from './test-utils.js';

describe('buildCanadaCostBasisFilingFacts', () => {
  describe('top-level metadata', () => {
    it('maps calculation metadata from the workflow artifact', () => {
      const artifact = createCanadaWorkflowArtifact();
      const result = assertOk(buildCanadaCostBasisFilingFacts({ artifact }));

      expect(result.kind).toBe('canada');
      expect(result.calculationId).toBe('0f93f130-e4d6-4d67-9458-84875b0f868a');
      expect(result.jurisdiction).toBe('CA');
      expect(result.method).toBe('average-cost');
      expect(result.taxYear).toBe(2024);
      expect(result.taxCurrency).toBe('CAD');
    });

    it('includes scopeKey and snapshotId when provided', () => {
      const result = assertOk(
        buildCanadaCostBasisFilingFacts({
          artifact: createCanadaWorkflowArtifact(),
          scopeKey: 'scope:ca:2024',
          snapshotId: 'snap-ca-2024',
        })
      );

      expect(result.scopeKey).toBe('scope:ca:2024');
      expect(result.snapshotId).toBe('snap-ca-2024');
    });

    it('leaves scopeKey and snapshotId undefined when not provided', () => {
      const result = assertOk(buildCanadaCostBasisFilingFacts({ artifact: createCanadaWorkflowArtifact() }));

      expect(result.scopeKey).toBeUndefined();
      expect(result.snapshotId).toBeUndefined();
    });
  });

  describe('acquisitions mapping', () => {
    it('maps acquisition fields from the tax report', () => {
      const result = assertOk(buildCanadaCostBasisFilingFacts({ artifact: createCanadaWorkflowArtifact() }));

      expect(result.acquisitions).toHaveLength(1);
      const acq = result.acquisitions[0]!;
      expect(acq.kind).toBe('canada-acquisition');
      expect(acq.id).toBe('layer-1');
      expect(acq.acquisitionEventId).toBe('acq-1');
      expect(acq.taxPropertyKey).toBe('BTC');
      expect(acq.assetSymbol).toBe('BTC');
      expect(acq.acquiredAt).toEqual(new Date('2024-01-10T00:00:00.000Z'));
      expect(acq.quantity.toFixed(0)).toBe('1');
      expect(acq.remainingQuantity.toFixed(1)).toBe('0.4');
      expect(acq.totalCostBasis.toFixed(0)).toBe('50000');
      expect(acq.remainingAllocatedCostBasis.toFixed(0)).toBe('20000');
      expect(acq.costBasisPerUnit.toFixed(0)).toBe('50000');
      expect(acq.transactionId).toBe(10);
    });

    it('maps multiple acquisitions', () => {
      const artifact = createCanadaWorkflowArtifact({
        taxReport: {
          ...createCanadaWorkflowArtifact().taxReport,
          acquisitions: [
            ...createCanadaWorkflowArtifact().taxReport.acquisitions,
            {
              id: 'layer-2',
              acquisitionEventId: 'acq-2',
              transactionId: 13,
              taxPropertyKey: 'ETH',
              assetSymbol: 'ETH' as Currency,
              acquiredAt: new Date('2024-05-01T00:00:00.000Z'),
              quantityAcquired: parseDecimal('10'),
              remainingQuantity: parseDecimal('10'),
              totalCostCad: parseDecimal('40000'),
              remainingAllocatedAcbCad: parseDecimal('40000'),
              costBasisPerUnitCad: parseDecimal('4000'),
            },
          ],
        },
      });

      const result = assertOk(buildCanadaCostBasisFilingFacts({ artifact }));
      expect(result.acquisitions).toHaveLength(2);
      expect(result.acquisitions[1]!.id).toBe('layer-2');
      expect(result.acquisitions[1]!.assetSymbol).toBe('ETH');
    });
  });

  describe('dispositions mapping', () => {
    it('maps disposition fields from the tax report', () => {
      const result = assertOk(buildCanadaCostBasisFilingFacts({ artifact: createCanadaWorkflowArtifact() }));

      expect(result.dispositions).toHaveLength(1);
      const disp = result.dispositions[0]!;
      expect(disp.kind).toBe('canada-disposition');
      expect(disp.id).toBe('disp-1');
      expect(disp.dispositionEventId).toBe('disp-1');
      expect(disp.taxPropertyKey).toBe('BTC');
      expect(disp.assetSymbol).toBe('BTC');
      expect(disp.disposedAt).toEqual(new Date('2024-03-10T00:00:00.000Z'));
      expect(disp.quantity.toFixed(1)).toBe('0.6');
      expect(disp.totalProceeds.toFixed(0)).toBe('36000');
      expect(disp.totalCostBasis.toFixed(0)).toBe('30000');
      expect(disp.costBasisPerUnit.toFixed(0)).toBe('50000');
      expect(disp.gainLoss.toFixed(0)).toBe('6000');
      expect(disp.taxableGainLoss.toFixed(0)).toBe('3050');
      expect(disp.deniedLossAmount.toFixed(0)).toBe('100');
      expect(disp.transactionId).toBe(11);
    });

    it('computes proceedsPerUnit by dividing proceeds by quantity', () => {
      const result = assertOk(buildCanadaCostBasisFilingFacts({ artifact: createCanadaWorkflowArtifact() }));

      const disp = result.dispositions[0]!;
      // proceedsCad (36000) / quantityDisposed (0.6) = 60000
      expect(disp.proceedsPerUnit.toFixed(2)).toBe('60000.00');
    });

    it('uses raw proceeds as proceedsPerUnit when quantityDisposed is zero', () => {
      const artifact = createCanadaWorkflowArtifact({
        taxReport: {
          ...createCanadaWorkflowArtifact().taxReport,
          dispositions: [
            {
              id: 'disp-zero-qty',
              dispositionEventId: 'disp-zero-qty',
              transactionId: 11,
              taxPropertyKey: 'BTC',
              assetSymbol: 'BTC' as Currency,
              disposedAt: new Date('2024-03-10T00:00:00.000Z'),
              quantityDisposed: parseDecimal('0'),
              proceedsCad: parseDecimal('500'),
              costBasisCad: parseDecimal('0'),
              gainLossCad: parseDecimal('500'),
              deniedLossCad: parseDecimal('0'),
              taxableGainLossCad: parseDecimal('250'),
              acbPerUnitCad: parseDecimal('0'),
            },
          ],
        },
      });

      const result = assertOk(buildCanadaCostBasisFilingFacts({ artifact }));
      const disp = result.dispositions[0]!;
      expect(disp.proceedsPerUnit.toFixed(0)).toBe('500');
    });
  });

  describe('transfers mapping', () => {
    it('maps transfer fields from the tax report', () => {
      const result = assertOk(buildCanadaCostBasisFilingFacts({ artifact: createCanadaWorkflowArtifact() }));

      expect(result.transfers).toHaveLength(1);
      const transfer = result.transfers[0]!;
      expect(transfer.kind).toBe('canada-transfer');
      expect(transfer.id).toBe('transfer-1');
      expect(transfer.direction).toBe('internal');
      expect(transfer.taxPropertyKey).toBe('BTC');
      expect(transfer.assetSymbol).toBe('BTC');
      expect(transfer.transferredAt).toEqual(new Date('2024-03-10T00:00:00.000Z'));
      expect(transfer.quantity.toFixed(1)).toBe('0.2');
      expect(transfer.totalCostBasis.toFixed(0)).toBe('10000');
      expect(transfer.costBasisPerUnit.toFixed(0)).toBe('50000');
      expect(transfer.transactionId).toBe(11);
      expect(transfer.sourceTransferEventId).toBe('transfer-out-1');
      expect(transfer.targetTransferEventId).toBe('transfer-in-1');
      expect(transfer.sourceTransactionId).toBe(11);
      expect(transfer.targetTransactionId).toBe(12);
      expect(transfer.linkedConfirmedLinkId).toBe(9);
      expect(transfer.feeAdjustment.toFixed(0)).toBe('25');
    });
  });

  describe('superficial loss adjustments mapping', () => {
    it('maps superficial loss adjustment fields from the tax report', () => {
      const result = assertOk(buildCanadaCostBasisFilingFacts({ artifact: createCanadaWorkflowArtifact() }));

      expect(result.superficialLossAdjustments).toHaveLength(1);
      const adj = result.superficialLossAdjustments[0]!;
      expect(adj.kind).toBe('canada-superficial-loss-adjustment');
      expect(adj.id).toBe('sla-1');
      expect(adj.taxPropertyKey).toBe('BTC');
      expect(adj.assetSymbol).toBe('BTC');
      expect(adj.adjustedAt).toEqual(new Date('2024-03-15T00:00:00.000Z'));
      expect(adj.deniedLossAmount.toFixed(0)).toBe('100');
      expect(adj.deniedQuantity.toFixed(1)).toBe('0.1');
      expect(adj.relatedDispositionId).toBe('disp-1');
      expect(adj.substitutedPropertyAcquisitionId).toBe('layer-1');
    });

    it('handles empty superficial loss adjustments', () => {
      const artifact = createCanadaWorkflowArtifact({
        taxReport: {
          ...createCanadaWorkflowArtifact().taxReport,
          superficialLossAdjustments: [],
        },
      });

      const result = assertOk(buildCanadaCostBasisFilingFacts({ artifact }));
      expect(result.superficialLossAdjustments).toHaveLength(0);
    });
  });

  describe('summary and asset summaries', () => {
    it('builds summary from mapped filing facts', () => {
      const result = assertOk(buildCanadaCostBasisFilingFacts({ artifact: createCanadaWorkflowArtifact() }));

      expect(result.summary.assetCount).toBe(1);
      expect(result.summary.acquisitionCount).toBe(1);
      expect(result.summary.dispositionCount).toBe(1);
      expect(result.summary.transferCount).toBe(1);
      expect(result.summary.totalProceeds.toFixed(0)).toBe('36000');
      expect(result.summary.totalCostBasis.toFixed(0)).toBe('30000');
      expect(result.summary.totalGainLoss.toFixed(0)).toBe('6000');
      expect(result.summary.totalTaxableGainLoss.toFixed(0)).toBe('3050');
      expect(result.summary.totalDeniedLoss.toFixed(0)).toBe('100');
      // Canada does not use tax treatment categories
      expect(result.summary.byTaxTreatment).toEqual([]);
    });

    it('builds asset summaries grouped by taxPropertyKey', () => {
      const result = assertOk(buildCanadaCostBasisFilingFacts({ artifact: createCanadaWorkflowArtifact() }));

      expect(result.assetSummaries).toHaveLength(1);
      const summary = result.assetSummaries[0]!;
      expect(summary.assetGroupingKey).toBe('BTC');
      expect(summary.taxPropertyKey).toBe('BTC');
      expect(summary.assetSymbol).toBe('BTC');
      expect(summary.acquisitionCount).toBe(1);
      expect(summary.dispositionCount).toBe(1);
      expect(summary.transferCount).toBe(1);
    });
  });

  describe('empty collections', () => {
    it('handles artifact with no dispositions, transfers, or adjustments', () => {
      const artifact = createCanadaWorkflowArtifact({
        taxReport: {
          ...createCanadaWorkflowArtifact().taxReport,
          dispositions: [],
          transfers: [],
          superficialLossAdjustments: [],
        },
      });

      const result = assertOk(buildCanadaCostBasisFilingFacts({ artifact }));
      expect(result.dispositions).toHaveLength(0);
      expect(result.transfers).toHaveLength(0);
      expect(result.superficialLossAdjustments).toHaveLength(0);
      expect(result.summary.dispositionCount).toBe(0);
      expect(result.summary.transferCount).toBe(0);
    });
  });
});
