import type { AssetReviewSummary, TransactionLink, Transaction } from '@exitbook/core';
import { resultDoAsync, type Result } from '@exitbook/foundation';
import { getLogger } from '@exitbook/logger';
import type { IPriceProviderRuntime } from '@exitbook/price-providers';

import {
  assertNoAccountingLayerAssetsRequireReview,
  type AccountingExclusionPolicy,
} from '../../../../accounting-layer.js';
import { buildScopedAccountingLayerFromTransactions } from '../../../../accounting-layer/build-accounting-layer-from-transactions.js';
import { validateTransferLinks } from '../../../../accounting-layer/validated-transfer-links.js';
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
    const preparedAccountingLayer = yield* buildScopedAccountingLayerFromTransactions(
      params.transactions,
      logger,
      params.accountingExclusionPolicy
    );
    yield* assertNoAccountingLayerAssetsRequireReview(
      preparedAccountingLayer.accountingLayer,
      params.assetReviewSummaries
    );

    const validatedTransfers = yield* validateTransferLinks(
      preparedAccountingLayer.accountingLayer.accountingTransactionViews,
      params.confirmedLinks
    );
    const inputContext = yield* await buildCanadaTaxInputContext({
      accountingLayer: preparedAccountingLayer.accountingLayer,
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
