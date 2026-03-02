/* eslint-disable unicorn/no-null -- null needed by Kysely */
import { CurrencySchema, DecimalSchema, wrapError } from '@exitbook/core';
import type { LinkableMovement, NewLinkableMovement } from '@exitbook/core';
import type { Selectable } from '@exitbook/sqlite';
import { err, ok, type Result } from 'neverthrow';

import type { LinkableMovementsTable } from '../database-schema.js';
import type { KyselyDB } from '../database.js';

import { BaseRepository } from './base-repository.js';

type LinkableMovementRow = Selectable<LinkableMovementsTable>;

function toLinkableMovement(row: LinkableMovementRow): Result<LinkableMovement, Error> {
  try {
    return ok({
      id: row.id,
      transactionId: row.transaction_id,
      accountId: row.account_id,
      sourceName: row.source_name,
      sourceType: row.source_type,
      assetId: row.asset_id,
      assetSymbol: CurrencySchema.parse(row.asset_symbol),
      direction: row.direction,
      amount: DecimalSchema.parse(row.amount),
      grossAmount: row.gross_amount ? DecimalSchema.parse(row.gross_amount) : undefined,
      timestamp: new Date(row.timestamp),
      blockchainTxHash: row.blockchain_tx_hash ?? undefined,
      fromAddress: row.from_address ?? undefined,
      toAddress: row.to_address ?? undefined,
      isInternal: Boolean(row.is_internal),
      utxoGroupId: row.utxo_group_id ?? undefined,
      excluded: Boolean(row.excluded),
    });
  } catch (error) {
    return err(error instanceof Error ? error : new Error(String(error)));
  }
}

export class LinkableMovementRepository extends BaseRepository {
  constructor(db: KyselyDB) {
    super(db, 'LinkableMovementRepository');
  }

  async createBatch(movements: NewLinkableMovement[]): Promise<Result<number, Error>> {
    try {
      if (movements.length === 0) return ok(0);

      // SQLite has a variable limit (~999), batch in chunks
      const CHUNK_SIZE = 100;
      let totalInserted = 0;

      for (let i = 0; i < movements.length; i += CHUNK_SIZE) {
        const chunk = movements.slice(i, i + CHUNK_SIZE);
        await this.db
          .insertInto('linkable_movements')
          .values(
            chunk.map((m) => ({
              transaction_id: m.transactionId,
              account_id: m.accountId,
              source_name: m.sourceName,
              source_type: m.sourceType,
              asset_id: m.assetId,
              asset_symbol: m.assetSymbol,
              direction: m.direction,
              amount: m.amount.toFixed(),
              gross_amount: m.grossAmount?.toFixed() ?? null,
              timestamp: m.timestamp.toISOString(),
              blockchain_tx_hash: m.blockchainTxHash ?? null,
              from_address: m.fromAddress ?? null,
              to_address: m.toAddress ?? null,
              is_internal: m.isInternal,
              utxo_group_id: m.utxoGroupId ?? null,
              excluded: m.excluded,
            }))
          )
          .execute();
        totalInserted += chunk.length;
      }

      return ok(totalInserted);
    } catch (error) {
      return wrapError(error, 'Failed to batch insert linkable movements');
    }
  }

  async findAll(filters?: {
    direction?: 'in' | 'out' | undefined;
    excluded?: boolean | undefined;
  }): Promise<Result<LinkableMovement[], Error>> {
    try {
      let query = this.db.selectFrom('linkable_movements').selectAll();

      if (filters?.direction !== undefined) {
        query = query.where('direction', '=', filters.direction);
      }
      if (filters?.excluded !== undefined) {
        query = query.where('excluded', '=', filters.excluded);
      }

      const rows = await query.execute();
      const movements: LinkableMovement[] = [];
      for (const row of rows as LinkableMovementRow[]) {
        const result = toLinkableMovement(row);
        if (result.isErr()) return err(result.error);
        movements.push(result.value);
      }
      return ok(movements);
    } catch (error) {
      return wrapError(error, 'Failed to find linkable movements');
    }
  }

  async deleteAll(): Promise<Result<void, Error>> {
    try {
      await this.db.deleteFrom('linkable_movements').execute();
      return ok(undefined);
    } catch (error) {
      return wrapError(error, 'Failed to delete linkable movements');
    }
  }

  async count(): Promise<Result<number, Error>> {
    try {
      const result = await this.db
        .selectFrom('linkable_movements')
        .select(this.db.fn.countAll<number>().as('count'))
        .executeTakeFirstOrThrow();
      return ok(result.count);
    } catch (error) {
      return wrapError(error, 'Failed to count linkable movements');
    }
  }
}
