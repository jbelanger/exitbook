import { err, type Result } from '@exitbook/core';

import { closePricesDatabase, createPricesDatabase, initializePricesDatabase } from './database.js';
import { createPriceQueries, type PriceQueries } from './queries/price-queries.js';

export async function withPricesQueries<T>(
  databasePath: string,
  fn: (queries: PriceQueries) => Promise<Result<T, Error>>
): Promise<Result<T, Error>> {
  const dbResult = createPricesDatabase(databasePath);
  if (dbResult.isErr()) {
    return err(new Error(`Failed to create prices database: ${dbResult.error.message}`));
  }

  const db = dbResult.value;
  let result: Result<T, Error>;
  let closeError: Error | undefined;
  try {
    const migrationResult = await initializePricesDatabase(db);
    if (migrationResult.isErr()) {
      return err(new Error(`Failed to initialize prices database: ${migrationResult.error.message}`));
    }

    result = await fn(createPriceQueries(db));
  } finally {
    const closeResult = await closePricesDatabase(db);
    if (closeResult.isErr()) {
      closeError = closeResult.error;
    }
  }

  if (closeError) {
    return err(closeError);
  }

  return result;
}
