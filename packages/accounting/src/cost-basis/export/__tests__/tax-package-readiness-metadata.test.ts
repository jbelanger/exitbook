import type { AssetReviewSummary } from '@exitbook/core';
import { parseDecimal } from '@exitbook/core';
import { describe, expect, it } from 'vitest';

import type { TaxPackageBuildContext } from '../tax-package-build-context.js';
import { deriveTaxPackageReadinessMetadata } from '../tax-package-readiness-metadata.js';

import { createCanadaPackageBuildContext, createStandardWorkflowArtifact } from './test-utils.js';

describe('deriveTaxPackageReadinessMetadata', () => {
  it('derives live Canada readiness signals from retained transactions and tax-report transfers', () => {
    const context = createCanadaPackageBuildContext();
    const retainedTransaction = context.sourceContext.transactionsById.get(11);
    if (!retainedTransaction) {
      throw new Error('Missing retained transaction for readiness metadata test');
    }

    retainedTransaction.notes = [
      {
        type: 'classification_uncertain',
        message: 'Needs review',
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
        'test:btc',
        {
          assetId: 'test:btc',
          reviewStatus: 'needs-review',
          referenceStatus: 'matched',
          evidenceFingerprint: 'asset-review:v1:btc',
          confirmationIsStale: false,
          accountingBlocked: true,
          warningSummary: 'Suspicious asset evidence',
          evidence: [
            {
              kind: 'spam-flag',
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
      fxFallbackCount: 0,
      incompleteTransferLinkCount: 1,
      unknownTransactionClassificationCount: 1,
      unresolvedAssetReviewCount: 1,
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
      fxFallbackCount: 3,
      incompleteTransferLinkCount: 0,
      unknownTransactionClassificationCount: 0,
      unresolvedAssetReviewCount: 0,
    });
  });
});
