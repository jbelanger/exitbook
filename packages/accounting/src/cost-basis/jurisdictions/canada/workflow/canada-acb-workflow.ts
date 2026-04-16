import type { AssetReviewSummary, TransactionLink, Transaction } from '@exitbook/core';
import { err, ok, type Result } from '@exitbook/foundation';
import { getLogger } from '@exitbook/logger';
import type { IPriceProviderRuntime } from '@exitbook/price-providers';

import { buildAccountingLayerFromScopedBuild } from '../../../../accounting-layer/build-accounting-layer-from-transactions.js';
import { validateTransferLinks } from '../../../../accounting-layer/validated-transfer-links.js';
import { buildCostBasisScopedTransactions } from '../../../standard/matching/build-cost-basis-scoped-transactions.js';
import type { AccountingExclusionPolicy } from '../../../standard/validation/accounting-exclusion-policy.js';
import { applyAccountingExclusionPolicy } from '../../../standard/validation/accounting-exclusion-policy.js';
import { assertNoScopedAssetsRequireReview } from '../../../standard/validation/asset-review-preflight.js';
import { buildCanadaTaxInputContext } from '../tax/canada-tax-context-builder.js';
import type { CanadaAcbEngineResult, CanadaTaxInputContext } from '../tax/canada-tax-types.js';

import { runCanadaAcbEngine } from './canada-acb-engine.js';

const logger = getLogger('canada-acb-workflow');

interface CanadaAcbWorkflowResult {
  acbEngineResult: CanadaAcbEngineResult;
  inputContext: CanadaTaxInputContext;
}

export interface RunCanadaAcbWorkflowParams {
  transactions: Transaction[];
  confirmedLinks: TransactionLink[];
  priceRuntime: IPriceProviderRuntime;
  accountingExclusionPolicy?: AccountingExclusionPolicy | undefined;
  assetReviewSummaries?: ReadonlyMap<string, AssetReviewSummary> | undefined;
}

export async function runCanadaAcbWorkflow(
  params: RunCanadaAcbWorkflowParams
): Promise<Result<CanadaAcbWorkflowResult, Error>> {
  const scopedResult = buildCostBasisScopedTransactions(params.transactions, logger);
  if (scopedResult.isErr()) {
    return err(scopedResult.error);
  }

  const exclusionApplied = applyAccountingExclusionPolicy(scopedResult.value, params.accountingExclusionPolicy);

  const assetReviewResult = assertNoScopedAssetsRequireReview(
    exclusionApplied.scopedBuildResult.transactions,
    params.assetReviewSummaries
  );
  if (assetReviewResult.isErr()) {
    return err(assetReviewResult.error);
  }

  const accountingLayerResult = buildAccountingLayerFromScopedBuild(exclusionApplied.scopedBuildResult);
  if (accountingLayerResult.isErr()) {
    return err(accountingLayerResult.error);
  }

  const validatedLinksResult = validateTransferLinks(
    accountingLayerResult.value.accountingTransactionViews,
    params.confirmedLinks
  );
  if (validatedLinksResult.isErr()) {
    return err(validatedLinksResult.error);
  }

  const inputContextResult = await buildCanadaTaxInputContext({
    accountingLayer: accountingLayerResult.value,
    validatedTransfers: validatedLinksResult.value,
    priceRuntime: params.priceRuntime,
    identityConfig: {},
  });
  if (inputContextResult.isErr()) {
    return err(inputContextResult.error);
  }

  const acbEngineResult = runCanadaAcbEngine(inputContextResult.value);
  if (acbEngineResult.isErr()) {
    return err(acbEngineResult.error);
  }

  return ok({
    inputContext: inputContextResult.value,
    acbEngineResult: acbEngineResult.value,
  });
}
