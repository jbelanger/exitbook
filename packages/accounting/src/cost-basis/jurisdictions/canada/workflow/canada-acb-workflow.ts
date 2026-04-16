import type { AssetReviewSummary, TransactionLink, Transaction } from '@exitbook/core';
import { resultDoAsync, type Result } from '@exitbook/foundation';
import { getLogger } from '@exitbook/logger';
import type { IPriceProviderRuntime } from '@exitbook/price-providers';

import {
  assertNoAccountingModelAssetsRequireReview,
  type AccountingExclusionPolicy,
} from '../../../../accounting-model.js';
import { buildAccountingModelFromTransactions } from '../../../../accounting-model/build-accounting-model-from-transactions.js';
import { validateTransferLinks } from '../../../../accounting-model/validated-transfer-links.js';
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
  return resultDoAsync(async function* () {
    const accountingModel = yield* buildAccountingModelFromTransactions(
      params.transactions,
      logger,
      params.accountingExclusionPolicy
    );
    yield* assertNoAccountingModelAssetsRequireReview(accountingModel, params.assetReviewSummaries);

    const validatedTransfers = yield* validateTransferLinks(
      accountingModel.accountingTransactionViews,
      params.confirmedLinks
    );
    const inputContext = yield* await buildCanadaTaxInputContext({
      accountingModel,
      validatedTransfers,
      priceRuntime: params.priceRuntime,
      identityConfig: {},
    });
    const acbEngineResult = yield* runCanadaAcbEngine(inputContext);

    return {
      inputContext,
      acbEngineResult,
    };
  });
}
