/* eslint-disable unicorn/no-null -- null needed by Kysely */
import { CurrencySchema, DecimalSchema, wrapError } from '@exitbook/core';
import type { NewUtxoConsolidatedMovement, UtxoConsolidatedMovement } from '@exitbook/core';
import type { Selectable } from '@exitbook/sqlite';
import { err, ok, type Result } from 'neverthrow';

import type { UtxoConsolidatedMovementsTable } from '../database-schema.js';
import type { KyselyDB } from '../database.js';

import { BaseRepository } from './base-repository.js';

type UtxoConsolidatedMovementRow = Selectable<UtxoConsolidatedMovementsTable>;

function toUtxoConsolidatedMovement(row: UtxoConsolidatedMovementRow): Result<UtxoConsolidatedMovement, Error> {
  try {
    return ok({
      id: row.id,
      transactionId: row.transaction_id,
      accountId: row.account_id,
      sourceName: row.source_name,
      assetSymbol: CurrencySchema.parse(row.asset_symbol),
      direction: row.direction,
      amount: DecimalSchema.parse(row.amount),
      grossAmount: row.gross_amount ? DecimalSchema.parse(row.gross_amount) : undefined,
      feeAmount: row.fee_amount ? DecimalSchema.parse(row.fee_amount) : undefined,
      feeAssetSymbol: row.fee_asset_symbol ? CurrencySchema.parse(row.fee_asset_symbol) : undefined,
      timestamp: new Date(row.timestamp),
      blockchainTxHash: row.blockchain_tx_hash,
      fromAddress: row.from_address ?? undefined,
      toAddress: row.to_address ?? undefined,
      consolidatedFrom: row.consolidated_from ? (JSON.parse(row.consolidated_from as string) as number[]) : undefined,
      createdAt: new Date(row.created_at),
    });
  } catch (error) {
    return err(error instanceof Error ? error : new Error(String(error)));
  }
}

export class UtxoConsolidatedMovementRepository extends BaseRepository {
  constructor(db: KyselyDB) {
    super(db, 'UtxoConsolidatedMovementRepository');
  }

  async createBatch(movements: NewUtxoConsolidatedMovement[]): Promise<Result<number, Error>> {
    try {
      if (movements.length === 0) return ok(0);

      const CHUNK_SIZE = 100;
      let totalInserted = 0;

      for (let i = 0; i < movements.length; i += CHUNK_SIZE) {
        const chunk = movements.slice(i, i + CHUNK_SIZE);
        await this.db
          .insertInto('utxo_consolidated_movements')
          .values(
            chunk.map((m) => ({
              transaction_id: m.transactionId,
              account_id: m.accountId,
              source_name: m.sourceName,
              asset_symbol: m.assetSymbol,
              direction: m.direction,
              amount: m.amount.toFixed(),
              gross_amount: m.grossAmount?.toFixed() ?? null,
              fee_amount: m.feeAmount?.toFixed() ?? null,
              fee_asset_symbol: m.feeAssetSymbol ?? null,
              timestamp: m.timestamp.toISOString(),
              blockchain_tx_hash: m.blockchainTxHash,
              from_address: m.fromAddress ?? null,
              to_address: m.toAddress ?? null,
              consolidated_from: m.consolidatedFrom ? JSON.stringify(m.consolidatedFrom) : null,
              created_at: new Date().toISOString(),
            }))
          )
          .execute();
        totalInserted += chunk.length;
      }

      return ok(totalInserted);
    } catch (error) {
      return wrapError(error, 'Failed to batch insert UTXO consolidated movements');
    }
  }

  async findAll(): Promise<Result<UtxoConsolidatedMovement[], Error>> {
    try {
      const rows = await this.db.selectFrom('utxo_consolidated_movements').selectAll().execute();
      const movements: UtxoConsolidatedMovement[] = [];
      for (const row of rows as UtxoConsolidatedMovementRow[]) {
        const result = toUtxoConsolidatedMovement(row);
        if (result.isErr()) return err(result.error);
        movements.push(result.value);
      }
      return ok(movements);
    } catch (error) {
      return wrapError(error, 'Failed to find UTXO consolidated movements');
    }
  }

  async deleteByAccountIds(accountIds: number[]): Promise<Result<void, Error>> {
    try {
      if (accountIds.length === 0) return ok(undefined);
      await this.db.deleteFrom('utxo_consolidated_movements').where('account_id', 'in', accountIds).execute();
      return ok(undefined);
    } catch (error) {
      return wrapError(error, 'Failed to delete UTXO consolidated movements by account IDs');
    }
  }

  async deleteAll(): Promise<Result<void, Error>> {
    try {
      await this.db.deleteFrom('utxo_consolidated_movements').execute();
      return ok(undefined);
    } catch (error) {
      return wrapError(error, 'Failed to delete UTXO consolidated movements');
    }
  }
}
