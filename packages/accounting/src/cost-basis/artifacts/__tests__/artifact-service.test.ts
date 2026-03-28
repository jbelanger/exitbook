import { ok, parseDecimal, type Currency } from '@exitbook/foundation';
import { describe, expect, it, vi } from 'vitest';

import type {
  CostBasisDependencyWatermark,
  CostBasisSnapshotRecord,
  ICostBasisArtifactStore,
  ICostBasisContextReader,
} from '../../../ports/cost-basis-persistence.js';
import type { CostBasisWorkflow, CostBasisWorkflowResult } from '../../workflow/cost-basis-workflow.js';
import { CostBasisArtifactService } from '../artifact-service.js';
import {
  COST_BASIS_CALCULATION_ENGINE_VERSION,
  COST_BASIS_STORAGE_SCHEMA_VERSION,
  buildCostBasisScopeKey,
} from '../artifact-snapshot-storage.js';

const dependencyWatermark: CostBasisDependencyWatermark = {
  links: { status: 'fresh', lastBuiltAt: new Date('2026-03-14T12:00:00.000Z') },
  assetReview: { status: 'fresh', lastBuiltAt: new Date('2026-03-14T12:00:01.000Z') },
  pricesLastMutatedAt: new Date('2026-03-14T12:00:02.000Z'),
  exclusionFingerprint: 'excluded-assets:none',
};

const config = {
  method: 'fifo' as const,
  jurisdiction: 'US' as const,
  taxYear: 2024,
  currency: 'USD' as const,
  startDate: new Date('2024-01-01T00:00:00.000Z'),
  endDate: new Date('2024-12-31T23:59:59.999Z'),
};

function createStandardWorkflowResult(): Extract<CostBasisWorkflowResult, { kind: 'standard-workflow' }> {
  return {
    kind: 'standard-workflow',
    summary: {
      calculation: {
        id: '5fe73d65-4b4d-4a57-9289-90913db37373',
        calculationDate: new Date('2026-03-14T12:00:00.000Z'),
        config: config,
        startDate: config.startDate,
        endDate: config.endDate,
        totalProceeds: parseDecimal('12000'),
        totalCostBasis: parseDecimal('10000'),
        totalGainLoss: parseDecimal('2000'),
        totalTaxableGainLoss: parseDecimal('2000'),
        assetsProcessed: ['BTC'],
        transactionsProcessed: 2,
        lotsCreated: 1,
        disposalsProcessed: 1,
        status: 'completed',
        createdAt: new Date('2026-03-14T12:00:00.000Z'),
        completedAt: new Date('2026-03-14T12:00:00.000Z'),
      },
      lotsCreated: 1,
      disposalsProcessed: 1,
      totalCapitalGainLoss: parseDecimal('2000'),
      totalTaxableGainLoss: parseDecimal('2000'),
      assetsProcessed: ['BTC'],
      lots: [
        {
          id: 'e5395915-08e0-42d8-bb24-b495fd42f68c',
          calculationId: '5fe73d65-4b4d-4a57-9289-90913db37373',
          acquisitionTransactionId: 1,
          assetId: 'exchange:kraken:btc',
          assetSymbol: 'BTC' as Currency,
          quantity: parseDecimal('1'),
          costBasisPerUnit: parseDecimal('10000'),
          totalCostBasis: parseDecimal('10000'),
          acquisitionDate: new Date('2024-01-01T12:00:00.000Z'),
          method: 'fifo',
          remainingQuantity: parseDecimal('0'),
          status: 'fully_disposed',
          createdAt: new Date('2026-03-14T12:00:00.000Z'),
          updatedAt: new Date('2026-03-14T12:00:00.000Z'),
        },
      ],
      disposals: [
        {
          id: '01f4a5ab-f7c7-42d3-93f1-8360ab1d767d',
          lotId: 'e5395915-08e0-42d8-bb24-b495fd42f68c',
          disposalTransactionId: 2,
          quantityDisposed: parseDecimal('1'),
          proceedsPerUnit: parseDecimal('12000'),
          totalProceeds: parseDecimal('12000'),
          grossProceeds: parseDecimal('12000'),
          sellingExpenses: parseDecimal('0'),
          netProceeds: parseDecimal('12000'),
          costBasisPerUnit: parseDecimal('10000'),
          totalCostBasis: parseDecimal('10000'),
          gainLoss: parseDecimal('2000'),
          disposalDate: new Date('2024-02-01T12:00:00.000Z'),
          holdingPeriodDays: 31,
          createdAt: new Date('2026-03-14T12:00:00.000Z'),
        },
      ],
      lotTransfers: [],
    },
    lots: [],
    disposals: [],
    lotTransfers: [],
    executionMeta: {
      missingPricesCount: 1,
      retainedTransactionIds: [1, 2],
    },
  };
}

function createStoredSnapshot(artifactJson = '{"bad"'): CostBasisSnapshotRecord {
  const scopeKey = buildCostBasisScopeKey(config);
  return {
    scopeKey,
    snapshotId: '8e596a8b-a0dc-4f08-ae45-a8517bf0b3a7',
    storageSchemaVersion: COST_BASIS_STORAGE_SCHEMA_VERSION,
    calculationEngineVersion: COST_BASIS_CALCULATION_ENGINE_VERSION,
    artifactKind: 'standard',
    linksBuiltAt: dependencyWatermark.links.lastBuiltAt!,
    assetReviewBuiltAt: dependencyWatermark.assetReview.lastBuiltAt!,
    pricesLastMutatedAt: dependencyWatermark.pricesLastMutatedAt,
    exclusionFingerprint: dependencyWatermark.exclusionFingerprint,
    calculationId: '5fe73d65-4b4d-4a57-9289-90913db37373',
    jurisdiction: 'US',
    method: 'fifo',
    taxYear: 2024,
    displayCurrency: 'USD',
    startDate: '2024-01-01T00:00:00.000Z',
    endDate: '2024-12-31T23:59:59.999Z',
    artifactJson,
    debugJson: '{"kind":"standard-workflow","scopedTransactionIds":[1,2],"appliedConfirmedLinkIds":[]}',
    createdAt: new Date('2026-03-14T12:00:02.000Z'),
    updatedAt: new Date('2026-03-14T12:00:02.000Z'),
  };
}

describe('CostBasisArtifactService', () => {
  it('reuses a fresh readable snapshot without recomputing', async () => {
    const workflowResult = createStandardWorkflowResult();
    const freshSnapshot = createStoredSnapshot(
      JSON.stringify({
        kind: 'standard-workflow',
        calculation: {
          id: workflowResult.summary.calculation.id,
          calculationDate: workflowResult.summary.calculation.calculationDate.toISOString(),
          config: {
            method: 'fifo',
            currency: 'USD',
            jurisdiction: 'US',
            taxYear: 2024,
            startDate: '2024-01-01T00:00:00.000Z',
            endDate: '2024-12-31T23:59:59.999Z',
          },
          startDate: '2024-01-01T00:00:00.000Z',
          endDate: '2024-12-31T23:59:59.999Z',
          totalProceeds: '12000',
          totalCostBasis: '10000',
          totalGainLoss: '2000',
          totalTaxableGainLoss: '2000',
          assetsProcessed: ['BTC'],
          transactionsProcessed: 2,
          lotsCreated: 1,
          disposalsProcessed: 1,
          status: 'completed',
          createdAt: '2026-03-14T12:00:00.000Z',
          completedAt: '2026-03-14T12:00:00.000Z',
        },
        lotsCreated: 1,
        disposalsProcessed: 1,
        totalCapitalGainLoss: '2000',
        totalTaxableGainLoss: '2000',
        assetsProcessed: ['BTC'],
        lots: [],
        disposals: [],
        lotTransfers: [],
        executionMeta: {
          missingPricesCount: workflowResult.executionMeta.missingPricesCount,
          retainedTransactionIds: workflowResult.executionMeta.retainedTransactionIds,
        },
      })
    );

    const loadCostBasisContext = vi.fn();
    const contextReader: ICostBasisContextReader = {
      loadCostBasisContext,
    };
    const findLatest = vi.fn().mockResolvedValue(ok(freshSnapshot));
    const replaceLatest = vi.fn();
    const artifactStore: ICostBasisArtifactStore = {
      findLatest,
      replaceLatest,
    };
    const workflowExecute = vi.fn();
    const workflow = {
      execute: workflowExecute,
    } as unknown as CostBasisWorkflow;

    const service = new CostBasisArtifactService(contextReader, artifactStore, workflow);
    const result = await service.execute({ config, dependencyWatermark });

    expect(result.isOk()).toBe(true);
    if (result.isErr()) {
      throw result.error;
    }

    expect(result.value.rebuilt).toBe(false);
    expect(loadCostBasisContext).not.toHaveBeenCalled();
    expect(workflowExecute).not.toHaveBeenCalled();
    expect(replaceLatest).not.toHaveBeenCalled();
  });

  it('rebuilds when refresh is requested', async () => {
    const workflowResult = createStandardWorkflowResult();
    const loadCostBasisContext = vi.fn().mockResolvedValue(ok({ transactions: [], confirmedLinks: [], accounts: [] }));
    const contextReader: ICostBasisContextReader = {
      loadCostBasisContext,
    };
    const findLatest = vi.fn().mockResolvedValue(ok(undefined));
    const replaceLatest = vi.fn().mockResolvedValue(ok(undefined));
    const artifactStore: ICostBasisArtifactStore = {
      findLatest,
      replaceLatest,
    };
    const workflowExecute = vi.fn().mockResolvedValue(ok(workflowResult));
    const workflow = {
      execute: workflowExecute,
    } as unknown as CostBasisWorkflow;

    const service = new CostBasisArtifactService(contextReader, artifactStore, workflow);
    const result = await service.execute({ config, dependencyWatermark, refresh: true });

    expect(result.isOk()).toBe(true);
    if (result.isErr()) {
      throw result.error;
    }

    expect(result.value.rebuilt).toBe(true);
    expect(findLatest).not.toHaveBeenCalled();
    expect(loadCostBasisContext).toHaveBeenCalledTimes(1);
    expect(workflowExecute).toHaveBeenCalledTimes(1);
    expect(workflowExecute).toHaveBeenCalledWith(config, [], {
      accountingExclusionPolicy: undefined,
      assetReviewSummaries: undefined,
      missingPricePolicy: 'error',
    });
    expect(replaceLatest).toHaveBeenCalledTimes(1);
  });

  it('rebuilds when a fresh snapshot payload is unreadable', async () => {
    const workflowResult = createStandardWorkflowResult();
    const loadCostBasisContext = vi.fn().mockResolvedValue(ok({ transactions: [], confirmedLinks: [], accounts: [] }));
    const contextReader: ICostBasisContextReader = {
      loadCostBasisContext,
    };
    const findLatest = vi.fn().mockResolvedValue(ok(createStoredSnapshot()));
    const replaceLatest = vi.fn().mockResolvedValue(ok(undefined));
    const artifactStore: ICostBasisArtifactStore = {
      findLatest,
      replaceLatest,
    };
    const workflowExecute = vi.fn().mockResolvedValue(ok(workflowResult));
    const workflow = {
      execute: workflowExecute,
    } as unknown as CostBasisWorkflow;

    const service = new CostBasisArtifactService(contextReader, artifactStore, workflow);
    const result = await service.execute({ config, dependencyWatermark });

    expect(result.isOk()).toBe(true);
    if (result.isErr()) {
      throw result.error;
    }

    expect(result.value.rebuilt).toBe(true);
    expect(findLatest).toHaveBeenCalledTimes(1);
    expect(loadCostBasisContext).toHaveBeenCalledTimes(1);
    expect(workflowExecute).toHaveBeenCalledTimes(1);
    expect(replaceLatest).toHaveBeenCalledTimes(1);
  });
});
