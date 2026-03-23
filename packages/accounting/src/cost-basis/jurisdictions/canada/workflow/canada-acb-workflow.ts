import type { AssetReviewSummary, TransactionLink, Transaction } from '@exitbook/core';
import { err, ok, type Result } from '@exitbook/foundation';
import { getLogger } from '@exitbook/logger';

import type { IFxRateProvider } from '../../../../price-enrichment/shared/types.js';
import type { TaxAssetIdentityPolicy } from '../../../model/types.js';
import { buildCostBasisScopedTransactions } from '../../../standard/matching/build-cost-basis-scoped-transactions.js';
import { validateScopedTransferLinks } from '../../../standard/matching/validated-scoped-transfer-links.js';
import type { AccountingExclusionPolicy } from '../../../standard/validation/accounting-exclusion-policy.js';
import { applyAccountingExclusionPolicy } from '../../../standard/validation/accounting-exclusion-policy.js';
import { assertNoScopedAssetsRequireReview } from '../../../standard/validation/asset-review-preflight.js';
import { getJurisdictionConfig } from '../../jurisdiction-configs.js';
import { buildCanadaTaxInputContext } from '../tax/canada-tax-context-builder.js';
import type { CanadaAcbEngineResult, CanadaTaxInputContext } from '../tax/canada-tax-types.js';

import { runCanadaAcbEngine } from './canada-acb-engine.js';

const logger = getLogger('canada-acb-workflow');

export interface CanadaAcbWorkflowResult {
  acbEngineResult: CanadaAcbEngineResult;
  inputContext: CanadaTaxInputContext;
}

export interface CanadaAcbWorkflowOptions {
  accountingExclusionPolicy?: AccountingExclusionPolicy | undefined;
  assetReviewSummaries?: ReadonlyMap<string, AssetReviewSummary> | undefined;
  relaxedTaxIdentitySymbols?: readonly string[] | undefined;
  taxAssetIdentityPolicy?: TaxAssetIdentityPolicy | undefined;
}

export async function runCanadaAcbWorkflow(
  transactions: Transaction[],
  confirmedLinks: TransactionLink[],
  fxProvider: IFxRateProvider,
  options?: CanadaAcbWorkflowOptions
): Promise<Result<CanadaAcbWorkflowResult, Error>> {
  const canadaConfig = getJurisdictionConfig('CA');
  if (!canadaConfig) {
    return err(new Error('Canada jurisdiction config is not registered'));
  }

  const scopedResult = buildCostBasisScopedTransactions(transactions, logger);
  if (scopedResult.isErr()) {
    return err(scopedResult.error);
  }

  const exclusionApplied = applyAccountingExclusionPolicy(scopedResult.value, options?.accountingExclusionPolicy);

  const assetReviewResult = assertNoScopedAssetsRequireReview(
    exclusionApplied.scopedBuildResult.transactions,
    options?.assetReviewSummaries
  );
  if (assetReviewResult.isErr()) {
    return err(assetReviewResult.error);
  }

  const validatedLinksResult = validateScopedTransferLinks(
    exclusionApplied.scopedBuildResult.transactions,
    confirmedLinks
  );
  if (validatedLinksResult.isErr()) {
    return err(validatedLinksResult.error);
  }

  const inputContextResult = await buildCanadaTaxInputContext({
    scopedTransactions: exclusionApplied.scopedBuildResult.transactions,
    validatedTransfers: validatedLinksResult.value,
    feeOnlyInternalCarryovers: exclusionApplied.scopedBuildResult.feeOnlyInternalCarryovers,
    fxProvider,
    identityConfig: {
      relaxedTaxIdentitySymbols: options?.relaxedTaxIdentitySymbols ?? canadaConfig.relaxedTaxIdentitySymbols,
      taxAssetIdentityPolicy: options?.taxAssetIdentityPolicy ?? canadaConfig.taxAssetIdentityPolicy,
    },
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
