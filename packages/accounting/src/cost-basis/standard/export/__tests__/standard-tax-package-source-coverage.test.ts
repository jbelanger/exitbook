import { type Currency, parseDecimal } from '@exitbook/foundation';
import { assertErr, assertOk } from '@exitbook/foundation/test-utils';
import { describe, expect, it } from 'vitest';

import type { AcquisitionLot, LotDisposal, LotTransfer } from '../../../model/types.js';
import type { StandardCostBasisWorkflowResult } from '../../../workflow/workflow-result-types.js';
import { collectStandardTaxPackageSourceCoverage } from '../standard-tax-package-source-coverage.js';

function createLot(id: string, acquisitionTransactionId: number): AcquisitionLot {
  return {
    id,
    calculationId: 'calc-1',
    acquisitionTransactionId,
    assetId: 'test:btc',
    assetSymbol: 'BTC' as Currency,
    quantity: parseDecimal('1'),
    costBasisPerUnit: parseDecimal('50000'),
    totalCostBasis: parseDecimal('50000'),
    acquisitionDate: new Date('2024-01-01'),
    method: 'fifo',
    remainingQuantity: parseDecimal('1'),
    status: 'open',
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

function createDisposal(id: string, lotId: string, disposalTransactionId: number): LotDisposal {
  return {
    id,
    lotId,
    disposalTransactionId,
    quantityDisposed: parseDecimal('0.5'),
    proceedsPerUnit: parseDecimal('60000'),
    totalProceeds: parseDecimal('30000'),
    grossProceeds: parseDecimal('30000'),
    sellingExpenses: parseDecimal('0'),
    netProceeds: parseDecimal('30000'),
    costBasisPerUnit: parseDecimal('50000'),
    totalCostBasis: parseDecimal('25000'),
    gainLoss: parseDecimal('5000'),
    disposalDate: new Date('2024-06-01'),
    holdingPeriodDays: 152,
    createdAt: new Date(),
  };
}

function createLotTransfer(
  id: string,
  sourceLotId: string,
  sourceTransactionId: number,
  targetTransactionId: number,
  provenance: LotTransfer['provenance']
): LotTransfer {
  return {
    id,
    calculationId: 'calc-1',
    sourceLotId,
    provenance,
    quantityTransferred: parseDecimal('0.5'),
    costBasisPerUnit: parseDecimal('50000'),
    sourceTransactionId,
    targetTransactionId,
    transferDate: new Date('2024-03-01'),
    createdAt: new Date(),
  };
}

function buildArtifact(
  lots: AcquisitionLot[],
  disposals: LotDisposal[],
  lotTransfers: LotTransfer[]
): StandardCostBasisWorkflowResult {
  return {
    kind: 'standard-workflow',
    summary: {
      calculation: {
        id: '00000000-0000-0000-0000-000000000001',
        calculationDate: new Date('2024-12-31T23:59:59Z'),
        config: {
          method: 'fifo',
          jurisdiction: 'US',
          taxYear: 2024,
          currency: 'USD',
        },
        totalProceeds: parseDecimal('0'),
        totalCostBasis: parseDecimal('0'),
        totalGainLoss: parseDecimal('0'),
        totalTaxableGainLoss: parseDecimal('0'),
        assetsProcessed: ['BTC'],
        transactionsProcessed: 0,
        lotsCreated: lots.length,
        disposalsProcessed: disposals.length,
        status: 'completed',
        createdAt: new Date('2024-12-31T23:59:59Z'),
        completedAt: new Date('2024-12-31T23:59:59Z'),
      },
      lotsCreated: lots.length,
      disposalsProcessed: disposals.length,
      totalCapitalGainLoss: parseDecimal('0'),
      totalTaxableGainLoss: parseDecimal('0'),
      assetsProcessed: ['BTC'],
      lots,
      disposals,
      lotTransfers,
    },
    lots,
    disposals,
    lotTransfers,
    executionMeta: { missingPricesCount: 0, missingPriceTransactionIds: [], retainedTransactionIds: [] },
  };
}

describe('collectStandardTaxPackageSourceCoverage', () => {
  it('collects transaction refs from lots', () => {
    const lot = createLot('lot-1', 100);
    const artifact = buildArtifact([lot], [], []);

    const result = assertOk(collectStandardTaxPackageSourceCoverage(artifact));

    expect(result.transactionRefs).toHaveLength(1);
    expect(result.transactionRefs[0]).toEqual({
      transactionId: 100,
      reference: 'standard lot lot-1 acquisition',
    });
    expect(result.confirmedLinkRefs).toHaveLength(0);
  });

  it('collects transaction refs from disposals and their source lots', () => {
    const lot = createLot('lot-1', 100);
    const disposal = createDisposal('disp-1', 'lot-1', 200);
    const artifact = buildArtifact([lot], [disposal], []);

    const result = assertOk(collectStandardTaxPackageSourceCoverage(artifact));

    // 1 from the lot + 2 from the disposal (disposal tx + source lot acquisition tx)
    expect(result.transactionRefs).toHaveLength(3);
    expect(result.transactionRefs).toEqual(
      expect.arrayContaining([
        { transactionId: 200, reference: 'standard disposal disp-1' },
        { transactionId: 100, reference: 'standard disposal disp-1 lot lot-1' },
      ])
    );
  });

  it('returns error when disposal references a missing lot', () => {
    const lot = createLot('lot-1', 100);
    const disposal = createDisposal('disp-1', 'lot-missing', 200);
    const artifact = buildArtifact([lot], [disposal], []);

    const result = assertErr(collectStandardTaxPackageSourceCoverage(artifact));

    expect(result.message).toContain('Missing source lot lot-missing');
    expect(result.message).toContain('disp-1');
  });

  it('collects transaction refs and confirmed link refs from lot transfers with confirmed-link provenance', () => {
    const lot = createLot('lot-1', 100);
    const transfer = createLotTransfer('xfer-1', 'lot-1', 100, 300, {
      kind: 'confirmed-link',
      linkId: 42,
      sourceMovementFingerprint: 'src-fp',
      targetMovementFingerprint: 'tgt-fp',
    });
    const artifact = buildArtifact([lot], [], [transfer]);

    const result = assertOk(collectStandardTaxPackageSourceCoverage(artifact));

    // 1 from the lot + 2 from the transfer (source + target tx)
    expect(result.transactionRefs).toHaveLength(3);
    expect(result.transactionRefs).toEqual(
      expect.arrayContaining([
        { transactionId: 100, reference: 'standard transfer xfer-1 source' },
        { transactionId: 300, reference: 'standard transfer xfer-1 target' },
      ])
    );
    expect(result.confirmedLinkRefs).toEqual([{ linkId: 42, reference: 'standard transfer xfer-1' }]);
  });

  it('does not add confirmed link ref for internal-transfer-carryover transfer provenance', () => {
    const lot = createLot('lot-1', 100);
    const transfer = createLotTransfer('xfer-1', 'lot-1', 100, 300, {
      kind: 'internal-transfer-carryover',
      sourceMovementFingerprint: 'src-fp',
      targetMovementFingerprint: 'tgt-fp',
    });
    const artifact = buildArtifact([lot], [], [transfer]);

    const result = assertOk(collectStandardTaxPackageSourceCoverage(artifact));

    expect(result.confirmedLinkRefs).toHaveLength(0);
    // Still collects transaction refs
    expect(result.transactionRefs).toEqual(
      expect.arrayContaining([
        { transactionId: 100, reference: 'standard transfer xfer-1 source' },
        { transactionId: 300, reference: 'standard transfer xfer-1 target' },
      ])
    );
  });

  it('returns error when transfer references a missing source lot', () => {
    const lot = createLot('lot-1', 100);
    const transfer = createLotTransfer('xfer-1', 'lot-missing', 100, 300, {
      kind: 'internal-transfer-carryover',
      sourceMovementFingerprint: 'src-fp',
      targetMovementFingerprint: 'tgt-fp',
    });
    const artifact = buildArtifact([lot], [], [transfer]);

    const result = assertErr(collectStandardTaxPackageSourceCoverage(artifact));

    expect(result.message).toContain('Missing source lot lot-missing');
    expect(result.message).toContain('xfer-1');
  });

  it('returns empty refs for empty artifact', () => {
    const artifact = buildArtifact([], [], []);

    const result = assertOk(collectStandardTaxPackageSourceCoverage(artifact));

    expect(result.transactionRefs).toHaveLength(0);
    expect(result.confirmedLinkRefs).toHaveLength(0);
  });
});
