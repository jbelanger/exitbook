import type { TransactionLink, UniversalTransactionData } from '@exitbook/core';
import { err, ok, type Result } from '@exitbook/core';
import { getLogger } from '@exitbook/logger';

import type { IFxRateProvider } from '../../price-enrichment/shared/types.js';
import { getJurisdictionConfig } from '../jurisdictions/jurisdiction-configs.js';
import { buildCostBasisScopedTransactions } from '../matching/build-cost-basis-scoped-transactions.js';
import { validateScopedTransferLinks } from '../matching/validated-scoped-transfer-links.js';
import type { TaxAssetIdentityPolicy } from '../shared/types.js';

import { runCanadaAcbEngine } from './canada-acb-engine.js';
import { buildCanadaTaxInputContext } from './canada-tax-context-builder.js';
import type { CanadaAcbEngineResult, CanadaTaxInputContext } from './canada-tax-types.js';

const logger = getLogger('canada-acb-workflow');

export interface CanadaAcbWorkflowResult {
  acbEngineResult: CanadaAcbEngineResult;
  inputContext: CanadaTaxInputContext;
}

export interface CanadaAcbWorkflowOptions {
  taxAssetIdentityPolicy?: TaxAssetIdentityPolicy | undefined;
}

export async function runCanadaAcbWorkflow(
  transactions: UniversalTransactionData[],
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

  const validatedLinksResult = validateScopedTransferLinks(scopedResult.value.transactions, confirmedLinks);
  if (validatedLinksResult.isErr()) {
    return err(validatedLinksResult.error);
  }

  const inputContextResult = await buildCanadaTaxInputContext(
    scopedResult.value.transactions,
    validatedLinksResult.value,
    scopedResult.value.feeOnlyInternalCarryovers,
    fxProvider,
    {
      taxAssetIdentityPolicy: options?.taxAssetIdentityPolicy ?? canadaConfig.taxAssetIdentityPolicy,
    }
  );
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
