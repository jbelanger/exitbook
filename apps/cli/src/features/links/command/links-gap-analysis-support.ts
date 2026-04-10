import type { DataSession } from '@exitbook/data/session';
import { resultDoAsync, type Result } from '@exitbook/foundation';

import type { LinkGapAnalysis } from '../links-gap-model.js';

import { analyzeLinkGaps } from './view/links-gap-analysis.js';

type LinksGapAnalysisDatabase = Pick<DataSession, 'accounts' | 'transactionLinks' | 'transactions'>;

export interface LoadLinksGapAnalysisOptions {
  excludedAssetIds?: ReadonlySet<string> | undefined;
  resolvedTransactionFingerprints?: ReadonlySet<string> | undefined;
}

export async function loadLinksGapAnalysis(
  database: LinksGapAnalysisDatabase,
  profileId: number,
  options: LoadLinksGapAnalysisOptions = {}
): Promise<Result<LinkGapAnalysis, Error>> {
  return resultDoAsync(async function* () {
    const transactions = yield* await database.transactions.findAll({ profileId });
    const links = yield* await database.transactionLinks.findAll({ profileId });
    const accounts = yield* await database.accounts.findAll({ profileId });

    return analyzeLinkGaps(transactions, links, {
      accounts,
      excludedAssetIds: options.excludedAssetIds,
      resolvedTransactionFingerprints: options.resolvedTransactionFingerprints,
    });
  });
}
