import type { Result } from '@exitbook/core';

import { withPricesQueries } from '../persistence/with-prices-queries.js';

export async function readLatestPriceMutationAt(databasePath: string): Promise<Result<Date | undefined, Error>> {
  return withPricesQueries(databasePath, (queries) => queries.getLatestMutationAt());
}
