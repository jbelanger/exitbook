import type { AssetReviewSummary } from '@exitbook/core';
import { parseDecimal, type Currency } from '@exitbook/foundation';
import { describe, expect, it } from 'vitest';

import type { TaxPackageBuildContext } from '../tax-package-build-context.js';
import { deriveTaxPackageReadinessMetadata } from '../tax-package-readiness-metadata.js';

import {
  createCanadaPackageBuildContext,
  createStandardPackageBuildContext,
  createStandardWorkflowArtifact,
} from './test-utils.js';

describe('deriveTaxPackageReadinessMetadata', () => {
  it('derives live Canada readiness signals from tax-relevant transactions and tax-report transfers', () => {
    const context = createCanadaPackageBuildContext();
    const retainedTransaction = context.sourceContext.transactionsById.get(11);
    if (!retainedTransaction) {
      throw new Error('Missing retained transaction for readiness metadata test');
    }

    retainedTransaction.diagnostics = [
      {
        code: 'classification_uncertain',
        message: 'Needs review',
        severity: 'warning',
      },
      {
        code: 'allocation_uncertain',
        message: 'Per-asset proceeds split is not exact',
        severity: 'warning',
      },
    ];

    if (context.workflowResult.kind !== 'canada-workflow') {
      throw new Error('Expected canada-workflow test fixture');
    }
    context.workflowResult.taxReport.transfers[0] = {
      ...context.workflowResult.taxReport.transfers[0]!,
      linkId: undefined,
      targetTransactionId: undefined,
    };

    const assetReviewSummaries = new Map<string, AssetReviewSummary>([
      [
        'exchange:kraken:btc',
        {
          assetId: 'exchange:kraken:btc',
          reviewStatus: 'needs-review',
          referenceStatus: 'matched',
          evidenceFingerprint: 'asset-review:v1:btc',
          confirmationIsStale: false,
          accountingBlocked: true,
          warningSummary: 'Suspicious asset evidence',
          evidence: [
            {
              kind: 'scam-diagnostic',
              severity: 'error',
              message: 'Flagged for review',
            },
          ],
        },
      ],
    ]);

    expect(
      deriveTaxPackageReadinessMetadata({
        context,
        assetReviewSummaries,
      })
    ).toEqual({
      allocationUncertainCount: 1,
      allocationUncertainDetails: [
        {
          diagnosticCode: 'allocation_uncertain',
          diagnosticMessage: 'Per-asset proceeds split is not exact',
          operationCategory: retainedTransaction.operation.category,
          operationType: retainedTransaction.operation.type,
          reference: retainedTransaction.txFingerprint,
          platformKey: retainedTransaction.platformKey,
          transactionDatetime: retainedTransaction.datetime,
          transactionId: retainedTransaction.id,
        },
      ],
      fxFallbackCount: 0,
      incompleteTransferLinkCount: 1,
      incompleteTransferLinkDetails: [
        {
          assetSymbol: 'BTC',
          rowId: 'transfer-1',
          sourcePlatformKey: retainedTransaction.platformKey,
          sourceTransactionId: 11,
          targetPlatformKey: undefined,
          targetTransactionId: undefined,
          transactionDatetime: '2024-03-10T00:00:00.000Z',
          transactionId: 11,
        },
      ],
      unknownTransactionClassificationCount: 1,
      unknownTransactionClassificationDetails: [
        {
          diagnosticCode: 'classification_uncertain',
          diagnosticMessage: 'Needs review',
          operationCategory: retainedTransaction.operation.category,
          operationType: retainedTransaction.operation.type,
          reference: retainedTransaction.txFingerprint,
          platformKey: retainedTransaction.platformKey,
          transactionDatetime: retainedTransaction.datetime,
          transactionId: retainedTransaction.id,
        },
      ],
      unresolvedAssetReviewCount: 1,
    });
  });

  it('ignores retained Canada transactions that do not participate in tax input semantics', () => {
    const context = createCanadaPackageBuildContext();
    const sourceTransaction = context.sourceContext.transactionsById.get(11);
    if (!sourceTransaction) {
      throw new Error('Missing source transaction for Canada readiness scope regression test');
    }

    context.sourceContext.transactionsById.set(99, {
      ...sourceTransaction,
      id: 99,
      txFingerprint: 'cardano-wallet-scope-only',
      platformKey: 'cardano',
      datetime: '2024-07-25T20:32:02.000Z',
      diagnostics: [
        {
          code: 'classification_uncertain',
          message: 'Wallet-scoped staking withdrawal cannot be attributed to one derived address.',
          severity: 'warning',
        },
        {
          code: 'allocation_uncertain',
          message: 'Residual staking reward component is known at wallet scope only.',
          severity: 'warning',
        },
      ],
      movements: {
        inflows: [
          {
            assetId: 'blockchain:cardano:native',
            assetSymbol: 'ADA' as Currency,
            grossAmount: parseDecimal('10.524451'),
            netAmount: parseDecimal('10.524451'),
            movementFingerprint: 'movement:cardano:99:ada:inflow:0',
          },
        ],
        outflows: [],
      },
      fees: [],
    });
    context.workflowResult.executionMeta.retainedTransactionIds.push(99);

    const metadata = deriveTaxPackageReadinessMetadata({
      context,
      assetReviewSummaries: new Map<string, AssetReviewSummary>([
        [
          'blockchain:cardano:native',
          {
            assetId: 'blockchain:cardano:native',
            reviewStatus: 'needs-review',
            referenceStatus: 'matched',
            evidenceFingerprint: 'asset-review:v1:ada',
            confirmationIsStale: false,
            accountingBlocked: true,
            warningSummary: 'Ignored for this readiness slice',
            evidence: [
              {
                kind: 'same-symbol-ambiguity',
                severity: 'warning',
                message: 'Ignored test evidence',
              },
            ],
          },
        ],
      ]),
    });

    expect(metadata).toMatchObject({
      allocationUncertainCount: 0,
      allocationUncertainDetails: [],
      unknownTransactionClassificationCount: 0,
      unknownTransactionClassificationDetails: [],
      unresolvedAssetReviewCount: 0,
    });
  });

  it('counts standard-report fallback FX rows when a display report used fallback conversion', () => {
    const workflowResult = createStandardWorkflowArtifact({
      report: {
        calculationId: 'calc-1',
        displayCurrency: 'CAD',
        originalCurrency: 'USD',
        disposals: [
          {
            fxConversion: {
              originalCurrency: 'USD',
              displayCurrency: 'CAD',
              fxRate: parseDecimal('1'),
              fxSource: 'fallback',
              fxFetchedAt: new Date('2024-01-01T00:00:00.000Z'),
            },
          },
        ],
        lots: [
          {
            fxUnavailable: true,
            fxConversion: {
              originalCurrency: 'USD',
              displayCurrency: 'CAD',
              fxRate: parseDecimal('1'),
              fxSource: 'fallback',
              fxFetchedAt: new Date('2024-01-01T00:00:00.000Z'),
            },
          },
        ],
        lotTransfers: [
          {
            fxConversion: {
              originalCurrency: 'USD',
              displayCurrency: 'CAD',
              fxRate: parseDecimal('1'),
              fxSource: 'fallback',
              fxFetchedAt: new Date('2024-01-01T00:00:00.000Z'),
            },
          },
        ],
        summary: {
          totalCostBasis: parseDecimal('1'),
          totalGainLoss: parseDecimal('1'),
          totalProceeds: parseDecimal('1'),
          totalTaxableGainLoss: parseDecimal('1'),
        },
        originalSummary: {
          totalCostBasis: parseDecimal('1'),
          totalGainLoss: parseDecimal('1'),
          totalProceeds: parseDecimal('1'),
          totalTaxableGainLoss: parseDecimal('1'),
        },
      } as never,
    });

    const context: TaxPackageBuildContext = {
      artifactRef: {
        calculationId: 'calc-1',
        scopeKey: 'scope:us:2024',
        snapshotId: 'snapshot-1',
      },
      workflowResult,
      sourceContext: {
        transactionsById: new Map(),
        accountsById: new Map(),
        confirmedLinksById: new Map(),
      },
    };

    expect(deriveTaxPackageReadinessMetadata({ context })).toMatchObject({
      allocationUncertainCount: 0,
      allocationUncertainDetails: [],
      fxFallbackCount: 3,
      incompleteTransferLinkCount: 0,
      incompleteTransferLinkDetails: [],
      unknownTransactionClassificationCount: 0,
      unknownTransactionClassificationDetails: [],
      unresolvedAssetReviewCount: 0,
    });
  });

  it('ignores retained standard-workflow transactions that do not back lots, disposals, or transfers', () => {
    const context = createStandardPackageBuildContext();
    const sourceTransaction = context.sourceContext.transactionsById.get(3);
    if (!sourceTransaction) {
      throw new Error('Missing source transaction for standard readiness scope regression test');
    }

    context.sourceContext.transactionsById.set(99, {
      ...sourceTransaction,
      id: 99,
      txFingerprint: 'ignored-standard-retained',
      diagnostics: [
        {
          code: 'classification_failed',
          message: 'Provider payload is inconsistent for operation classification.',
          severity: 'error',
        },
      ],
    });
    context.workflowResult.executionMeta.retainedTransactionIds.push(99);

    expect(deriveTaxPackageReadinessMetadata({ context })).toMatchObject({
      unknownTransactionClassificationCount: 0,
      unknownTransactionClassificationDetails: [],
    });
  });

  it('does not surface fee-only standard carryovers as incomplete transfer linking', () => {
    const context = createStandardPackageBuildContext();
    if (context.workflowResult.kind !== 'standard-workflow') {
      throw new Error('Expected standard-workflow test fixture');
    }

    context.workflowResult.lotTransfers[0] = {
      ...context.workflowResult.lotTransfers[0]!,
      provenance: {
        kind: 'internal-transfer-carryover',
        sourceMovementFingerprint: 'movement:exchange:source:4:btc:outflow:0',
        targetMovementFingerprint: 'movement:blockchain:target:5:btc:inflow:0',
      },
    };

    expect(deriveTaxPackageReadinessMetadata({ context })).toMatchObject({
      allocationUncertainCount: 0,
      allocationUncertainDetails: [],
      fxFallbackCount: 0,
      incompleteTransferLinkCount: 0,
      incompleteTransferLinkDetails: [],
      unknownTransactionClassificationCount: 0,
      unknownTransactionClassificationDetails: [],
      unresolvedAssetReviewCount: 0,
    });
  });

  it('does not surface Canada fee-only carryovers as incomplete transfer linking', () => {
    const context = createCanadaPackageBuildContext();
    if (context.workflowResult.kind !== 'canada-workflow') {
      throw new Error('Expected canada-workflow test fixture');
    }

    context.workflowResult.taxReport.transfers[0] = {
      ...context.workflowResult.taxReport.transfers[0]!,
      linkId: undefined,
    };
    context.workflowResult.inputContext!.inputEvents[3] = {
      ...context.workflowResult.inputContext!.inputEvents[3]!,
      provenanceKind: 'internal-transfer-carryover',
    };

    expect(deriveTaxPackageReadinessMetadata({ context })).toMatchObject({
      allocationUncertainCount: 0,
      allocationUncertainDetails: [],
      fxFallbackCount: 0,
      incompleteTransferLinkCount: 0,
      incompleteTransferLinkDetails: [],
      unknownTransactionClassificationCount: 0,
      unknownTransactionClassificationDetails: [],
      unresolvedAssetReviewCount: 0,
    });
  });
});
