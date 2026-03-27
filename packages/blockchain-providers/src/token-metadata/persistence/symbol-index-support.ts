import { wrapError, type Result } from '@exitbook/foundation';
import { err, ok } from '@exitbook/foundation';
import type { Logger } from '@exitbook/logger';
import type { Kysely } from '@exitbook/sqlite';

import type { TokenMetadataDatabase } from './schema.js';

export async function upsertSymbolIndex(
  db: Kysely<TokenMetadataDatabase>,
  logger: Logger,
  blockchain: string,
  symbol: string,
  contractAddress: string
): Promise<Result<void, Error>> {
  try {
    const existing = await db
      .selectFrom('symbol_index')
      .select('contract_address')
      .where('blockchain', '=', blockchain)
      .where('symbol', '=', symbol)
      .where('contract_address', '=', contractAddress)
      .executeTakeFirst();

    if (!existing) {
      await db
        .insertInto('symbol_index')
        .values({
          blockchain,
          symbol,
          contract_address: contractAddress,
          created_at: new Date().toISOString(),
        })
        .execute();
    }

    return ok(undefined);
  } catch (error) {
    logger.error({ error, blockchain, symbol, contractAddress }, 'Failed to upsert symbol index');
    return wrapError(error, 'Failed to upsert symbol index');
  }
}

export async function deleteSymbolIndex(
  db: Kysely<TokenMetadataDatabase>,
  logger: Logger,
  blockchain: string,
  symbol: string,
  contractAddress: string
): Promise<Result<void, Error>> {
  try {
    await db
      .deleteFrom('symbol_index')
      .where('blockchain', '=', blockchain)
      .where('symbol', '=', symbol)
      .where('contract_address', '=', contractAddress)
      .execute();

    return ok(undefined);
  } catch (error) {
    logger.error({ error, blockchain, symbol, contractAddress }, 'Failed to delete symbol index');
    return wrapError(error, 'Failed to delete symbol index');
  }
}

export async function listContractsForSymbol(
  db: Kysely<TokenMetadataDatabase>,
  blockchain: string,
  symbol: string
): Promise<Result<string[], Error>> {
  try {
    const rows = await db
      .selectFrom('symbol_index')
      .select('contract_address')
      .where('blockchain', '=', blockchain)
      .where('symbol', '=', symbol)
      .execute();

    return ok(rows.map((row) => row.contract_address));
  } catch (error) {
    return err(error instanceof Error ? error : new Error(String(error)));
  }
}
