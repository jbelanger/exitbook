import { parseCurrency, parseDecimal } from '@exitbook/foundation';
import { assertOk } from '@exitbook/foundation/test-utils';
import { describe, expect, it } from 'vitest';

import type { StandardLedgerCostBasisWorkflowResult } from '../../workflow/workflow-result-types.js';
import { StoredStandardLedgerCostBasisArtifactSchema } from '../artifact-storage-schemas.js';
import { fromStoredStandardLedgerArtifact, toStoredStandardLedgerArtifact } from '../standard-ledger-artifact-codec.js';

const BTC = assertOk(parseCurrency('BTC'));
const ETH = assertOk(parseCurrency('ETH'));

describe('standard ledger artifact codec', () => {
  it('round-trips ledger-native standard workflow results without transaction ids', () => {
    const artifact = makeStandardLedgerWorkflowResult();
    const stored = toStoredStandardLedgerArtifact(artifact);
    const parsed = StoredStandardLedgerCostBasisArtifactSchema.parse(stored);
    const restored = fromStoredStandardLedgerArtifact(parsed);

    expect(stored.kind).toBe('standard-ledger-workflow');
    expect(JSON.stringify(stored)).not.toContain('TransactionId');
    expect(JSON.stringify(stored)).not.toContain('transactionId');
    expect(restored.kind).toBe('standard-ledger-workflow');
    expect(restored.calculation.totalGainLoss.toFixed()).toBe('50');
    expect(restored.projection.exclusionFingerprint).toBe('accounting-exclusions:test');
    expect(restored.projection.projectionBlockers[0]?.scope).toBe('posting');
    expect(restored.projection.operationBlockers[0]?.sourceProjectionBlocker?.scope).toBe('posting');
    expect(restored.engineResult.lots[0]?.totalCostBasis?.toFixed()).toBe('100');
    expect(restored.engineResult.disposals[0]?.slices[0]?.costBasis?.toFixed()).toBe('50');
    expect(restored.engineResult.disposals[0]?.provenance.postingFingerprint).toBe('posting:sell');
    expect(restored.engineResult.carries[0]?.sourceLegs[0]?.quantity.toFixed()).toBe('0.25');
    expect(restored.engineResult.blockers[0]?.sourceOperationBlocker?.sourceProjectionBlocker?.scope).toBe('posting');
    expect(restored.executionMeta.eventIds).toEqual(['event:buy', 'event:sell']);
  });
});

function makeStandardLedgerWorkflowResult(): StandardLedgerCostBasisWorkflowResult {
  const calculationId = 'calculation:ledger:test';
  const postingBlocker = {
    scope: 'posting' as const,
    reason: 'missing_relationship' as const,
    sourceActivityFingerprint: 'activity:blocked',
    journalFingerprint: 'journal:blocked',
    postingFingerprint: 'posting:blocked',
    assetId: 'blockchain:bitcoin:native',
    assetSymbol: BTC,
    postingQuantity: parseDecimal('1'),
    blockedQuantity: parseDecimal('1'),
    relationshipStableKeys: [],
    message: 'blocked posting',
  };
  const operationBlocker = {
    blockerId: 'operation-blocker:blocked',
    reason: 'missing_relationship' as const,
    propagation: 'after-fence' as const,
    affectedChainKeys: ['btc'],
    inputEventIds: ['event:blocked'],
    sourceProjectionBlocker: postingBlocker,
    message: 'blocked operation',
  };

  return {
    kind: 'standard-ledger-workflow',
    calculation: {
      id: calculationId,
      calculationDate: new Date('2026-01-03T00:00:00.000Z'),
      config: {
        method: 'fifo',
        jurisdiction: 'US',
        taxYear: 2026,
        currency: 'USD',
        startDate: new Date('2026-01-01T00:00:00.000Z'),
        endDate: new Date('2026-12-31T23:59:59.000Z'),
      },
      startDate: new Date('2026-01-01T00:00:00.000Z'),
      endDate: new Date('2026-12-31T23:59:59.000Z'),
      totalProceeds: parseDecimal('100'),
      totalCostBasis: parseDecimal('50'),
      totalGainLoss: parseDecimal('50'),
      totalTaxableGainLoss: parseDecimal('50'),
      assetsProcessed: ['BTC'],
      eventsProjected: 2,
      operationsProcessed: 2,
      lotsCreated: 1,
      disposalsProcessed: 1,
      blockersProduced: 1,
      status: 'completed',
      createdAt: new Date('2026-01-03T00:00:00.000Z'),
      completedAt: new Date('2026-01-03T00:00:01.000Z'),
    },
    projection: {
      eventIds: ['event:buy', 'event:sell'],
      operationIds: ['operation:buy', 'operation:sell'],
      projectionBlockers: [postingBlocker],
      operationBlockers: [operationBlocker],
      excludedPostings: [
        {
          reason: 'asset_excluded',
          sourceActivityFingerprint: 'activity:excluded',
          journalFingerprint: 'journal:excluded',
          postingFingerprint: 'posting:excluded',
          assetId: 'blockchain:ethereum:native',
          assetSymbol: ETH,
          postingQuantity: parseDecimal('0.01'),
          message: 'excluded posting',
        },
      ],
      exclusionFingerprint: 'accounting-exclusions:test',
    },
    engineResult: {
      lots: [
        {
          id: 'standard-ledger-lot:operation:buy',
          calculationId,
          chainKey: 'btc',
          assetId: 'blockchain:bitcoin:native',
          assetSymbol: BTC,
          basisStatus: 'priced',
          costBasisPerUnit: parseDecimal('100'),
          totalCostBasis: parseDecimal('100'),
          originalQuantity: parseDecimal('1'),
          remainingQuantity: parseDecimal('0.5'),
          acquisitionDate: new Date('2026-01-01T00:00:00.000Z'),
          provenance: {
            kind: 'acquire-operation',
            operationId: 'operation:buy',
            sourceEventId: 'event:buy',
            sourceActivityFingerprint: 'activity:buy',
            ownerAccountId: 1,
            journalFingerprint: 'journal:buy',
            journalKind: 'trade',
            postingFingerprint: 'posting:buy',
            postingRole: 'principal',
          },
        },
      ],
      disposals: [
        {
          id: 'standard-ledger-disposal:operation:sell',
          calculationId,
          operationId: 'operation:sell',
          chainKey: 'btc',
          assetId: 'blockchain:bitcoin:native',
          assetSymbol: BTC,
          quantity: parseDecimal('0.5'),
          grossProceeds: parseDecimal('100'),
          costBasis: parseDecimal('50'),
          gainLoss: parseDecimal('50'),
          disposalDate: new Date('2026-01-02T00:00:00.000Z'),
          provenance: {
            kind: 'dispose-operation',
            operationId: 'operation:sell',
            sourceEventId: 'event:sell',
            sourceActivityFingerprint: 'activity:sell',
            ownerAccountId: 1,
            journalFingerprint: 'journal:sell',
            journalKind: 'trade',
            postingFingerprint: 'posting:sell',
            postingRole: 'principal',
          },
          slices: [
            {
              lotId: 'standard-ledger-lot:operation:buy',
              quantity: parseDecimal('0.5'),
              acquisitionDate: new Date('2026-01-01T00:00:00.000Z'),
              basisStatus: 'priced',
              costBasis: parseDecimal('50'),
              costBasisPerUnit: parseDecimal('100'),
            },
          ],
        },
      ],
      carries: [
        {
          id: 'standard-ledger-carry:operation:carry',
          calculationId,
          operationId: 'operation:carry',
          kind: 'cross-chain',
          relationshipKind: 'bridge',
          relationshipStableKey: 'relationship:carry',
          slices: [
            {
              sourceChainKey: 'btc',
              sourceLotId: 'standard-ledger-lot:operation:buy',
              sourceQuantity: parseDecimal('0.25'),
              targetChainKey: 'eth',
              targetLotId: 'standard-ledger-lot:operation:carry:target:1',
              targetQuantity: parseDecimal('0.25'),
              basisStatus: 'priced',
              costBasis: parseDecimal('25'),
            },
          ],
          sourceLegs: [
            {
              allocationId: 1,
              sourceEventId: 'event:carry:source',
              timestamp: new Date('2026-01-02T12:00:00.000Z'),
              sourceActivityFingerprint: 'activity:carry:source',
              ownerAccountId: 1,
              journalFingerprint: 'journal:carry:source',
              journalKind: 'transfer',
              postingFingerprint: 'posting:carry:source',
              postingRole: 'principal',
              chainKey: 'btc',
              assetId: 'blockchain:bitcoin:native',
              assetSymbol: BTC,
              quantity: parseDecimal('0.25'),
            },
          ],
          targetLegs: [
            {
              allocationId: 2,
              sourceEventId: 'event:carry:target',
              timestamp: new Date('2026-01-02T12:00:00.000Z'),
              sourceActivityFingerprint: 'activity:carry:target',
              ownerAccountId: 2,
              journalFingerprint: 'journal:carry:target',
              journalKind: 'transfer',
              postingFingerprint: 'posting:carry:target',
              postingRole: 'principal',
              chainKey: 'eth',
              assetId: 'blockchain:ethereum:native',
              assetSymbol: ETH,
              quantity: parseDecimal('0.25'),
            },
          ],
        },
      ],
      blockers: [
        {
          blockerId: 'calculation-blocker:blocked',
          reason: 'upstream_operation_blocker',
          propagation: 'after-fence',
          affectedChainKeys: ['btc'],
          inputEventIds: ['event:blocked'],
          inputOperationIds: ['operation:blocked'],
          message: 'calculation blocked',
          sourceOperationBlocker: operationBlocker,
        },
      ],
    },
    executionMeta: {
      calculationBlockerIds: ['calculation-blocker:blocked'],
      eventIds: ['event:buy', 'event:sell'],
      excludedPostingFingerprints: ['posting:excluded'],
      exclusionFingerprint: 'accounting-exclusions:test',
      operationBlockerIds: ['operation-blocker:blocked'],
      operationIds: ['operation:buy', 'operation:sell'],
      projectionBlockerMessages: ['blocked posting'],
    },
  };
}
