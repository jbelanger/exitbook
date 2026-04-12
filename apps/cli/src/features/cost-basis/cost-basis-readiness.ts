import {
  buildTaxPackageBuildContext,
  deriveTaxPackageReadinessMetadata,
  formatIncompleteTransferLinkingNotice,
  formatUnresolvedAssetReviewNotice,
  type CostBasisContext,
  type CostBasisWorkflowResult,
  type TaxPackageIncompleteTransferLinkDetail,
} from '@exitbook/accounting/cost-basis';
import type { AssetReviewSummary, Transaction } from '@exitbook/core';
import { resultTry, type Result } from '@exitbook/foundation';

import { formatTransactionFingerprintRef } from '../transactions/transaction-selector.js';

export type CostBasisReadinessWarningCode = 'INCOMPLETE_TRANSFER_LINKING' | 'UNRESOLVED_ASSET_REVIEW';
export type CostBasisReadinessWarningSeverity = 'warning' | 'blocked';

export interface CostBasisReadinessWarning {
  code: CostBasisReadinessWarningCode;
  commandHint?: string | undefined;
  count: number;
  detail?: string | undefined;
  message: string;
  recommendedAction?: string | undefined;
  severity: CostBasisReadinessWarningSeverity;
}

interface BuildCostBasisReadinessWarningsParams {
  artifact: CostBasisWorkflowResult;
  assetReviewSummaries: ReadonlyMap<string, AssetReviewSummary>;
  scopeKey: string;
  snapshotId?: string | undefined;
  sourceContext: CostBasisContext;
}

export function buildCostBasisReadinessWarnings(
  params: BuildCostBasisReadinessWarningsParams
): Result<CostBasisReadinessWarning[], Error> {
  return resultTry(function* () {
    const context = yield* buildTaxPackageBuildContext({
      artifact: params.artifact,
      sourceContext: params.sourceContext,
      scopeKey: params.scopeKey,
      snapshotId: params.snapshotId,
    });

    const metadata = deriveTaxPackageReadinessMetadata({
      context,
      assetReviewSummaries: params.assetReviewSummaries,
    });
    const unresolvedAssetReviewCount = metadata.unresolvedAssetReviewCount ?? 0;
    const incompleteTransferLinkCount = metadata.incompleteTransferLinkCount ?? 0;
    const incompleteTransferLinkGuidance = buildIncompleteTransferLinkGuidance(
      metadata.incompleteTransferLinkDetails ?? [],
      context.sourceContext.transactionsById
    );

    const warnings: CostBasisReadinessWarning[] = [];

    if (unresolvedAssetReviewCount > 0) {
      warnings.push({
        code: 'UNRESOLVED_ASSET_REVIEW',
        count: unresolvedAssetReviewCount,
        message: formatUnresolvedAssetReviewNotice(unresolvedAssetReviewCount),
        severity: 'blocked',
      });
    }

    if (incompleteTransferLinkCount > 0) {
      warnings.push({
        code: 'INCOMPLETE_TRANSFER_LINKING',
        commandHint: incompleteTransferLinkGuidance.commandHint,
        count: incompleteTransferLinkCount,
        detail: incompleteTransferLinkGuidance.detail,
        message: formatIncompleteTransferLinkingNotice(incompleteTransferLinkCount),
        recommendedAction: incompleteTransferLinkGuidance.recommendedAction,
        severity: 'warning',
      });
    }

    return warnings;
  }, 'Failed to derive cost basis readiness warnings');
}

function buildIncompleteTransferLinkGuidance(
  details: readonly TaxPackageIncompleteTransferLinkDetail[],
  transactionsById: ReadonlyMap<number, Transaction>
): Pick<CostBasisReadinessWarning, 'commandHint' | 'detail' | 'recommendedAction'> {
  const sample = details[0];
  if (!sample) {
    return {};
  }

  const sourceRef =
    sample.sourceTransactionId !== undefined
      ? buildTransactionRef(sample.sourceTransactionId, transactionsById)
      : undefined;
  const targetRef =
    sample.targetTransactionId !== undefined
      ? buildTransactionRef(sample.targetTransactionId, transactionsById)
      : undefined;
  const date = sample.transactionDatetime.slice(0, 10);
  const exampleContextLabel = buildExampleContextLabel(
    buildRouteLabel(sample.sourcePlatformKey, sample.targetPlatformKey),
    buildTransactionPairLabel(sample.sourceTransactionId, sample.targetTransactionId)
  );

  return {
    detail: `Example: ${sample.assetSymbol} on ${date}${exampleContextLabel ? ` (${exampleContextLabel})` : ''}.`,
    ...(sourceRef !== undefined && targetRef !== undefined
      ? {
          commandHint: `pnpm run dev links create ${sourceRef} ${targetRef} --asset ${sample.assetSymbol}`,
          recommendedAction: 'Create the missing confirmed link directly, then rerun cost basis.',
        }
      : {
          recommendedAction:
            'Review the affected transfer transactions and create the missing confirmed link directly with `pnpm run dev links create <source-ref> <target-ref> --asset <symbol>`, then rerun cost basis.',
        }),
  };
}

function buildTransactionRef(
  transactionId: number,
  transactionsById: ReadonlyMap<number, Transaction>
): string | undefined {
  const transaction = transactionsById.get(transactionId);
  return transaction ? formatTransactionFingerprintRef(transaction.txFingerprint) : undefined;
}

function buildRouteLabel(
  sourcePlatformKey?: string  ,
  targetPlatformKey?: string  
): string | undefined {
  if (sourcePlatformKey && targetPlatformKey) {
    return `${sourcePlatformKey} -> ${targetPlatformKey}`;
  }

  return sourcePlatformKey ?? targetPlatformKey;
}

function buildTransactionPairLabel(
  sourceTransactionId?: number  ,
  targetTransactionId?: number  
): string | undefined {
  if (sourceTransactionId !== undefined && targetTransactionId !== undefined) {
    return `tx ${sourceTransactionId} -> ${targetTransactionId}`;
  }

  if (sourceTransactionId !== undefined) {
    return `source tx ${sourceTransactionId}`;
  }

  if (targetTransactionId !== undefined) {
    return `target tx ${targetTransactionId}`;
  }

  return undefined;
}

function buildExampleContextLabel(
  route?: string  ,
  transactionPairLabel?: string  
): string | undefined {
  if (route && transactionPairLabel) {
    return `${route}, ${transactionPairLabel}`;
  }

  return route ?? transactionPairLabel;
}
