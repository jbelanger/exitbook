/* eslint-disable unicorn/no-null -- Kysely queries require null for IS NULL checks */
import type { AssetMovement, FeeMovement, TransactionStatus, UniversalTransactionData } from '@exitbook/core';
import { AssetMovementSchema, FeeMovementSchema, TransactionNoteSchema, wrapError } from '@exitbook/core';
import type { Insertable, Selectable, Updateable } from 'kysely';
import type { Result } from 'neverthrow';
import { err, ok } from 'neverthrow';
import { z } from 'zod';

import type { TransactionsTable } from '../schema/database-schema.js';
import type { KyselyDB } from '../storage/database.js';

import { BaseRepository } from './base-repository.js';
import { generateDeterministicTransactionHash } from './transaction-id-utils.js';
import type { ITransactionRepository, TransactionFilters } from './transaction-repository.interface.js';

/**
 * Validate and normalize movement to ensure all required fields exist
 *
 * Clean break implementation - grossAmount is required, no legacy field support.
 * Processors MUST emit grossAmount. netAmount defaults to grossAmount when not specified.
 */
function normalizeMovement(movement: AssetMovement): Result<AssetMovement, Error> {
  // Require grossAmount - fail fast if processor didn't update
  if (!movement.grossAmount) {
    return err(
      new Error(
        `Movement missing required field 'grossAmount'. ` +
          `Processors must be updated to emit new fee semantics. ` +
          `Asset: ${movement.asset}`
      )
    );
  }

  // Default: netAmount = grossAmount (valid for most transactions with no on-chain fees)
  const netAmount = movement.netAmount ?? movement.grossAmount;

  return ok({
    ...movement,
    grossAmount: movement.grossAmount,
    netAmount,
  });
}

/**
 * Kysely-based repository for transaction database operations.
 * Handles storage and retrieval of UniversalTransactionData entities using type-safe queries.
 */
export class TransactionRepository extends BaseRepository implements ITransactionRepository {
  constructor(db: KyselyDB) {
    super(db, 'TransactionRepository');
  }

  async save(
    transaction: Omit<UniversalTransactionData, 'id' | 'accountId'>,
    accountId: number
  ): Promise<Result<number, Error>> {
    try {
      const valuesResult = this.buildInsertValues(transaction, accountId);
      if (valuesResult.isErr()) {
        return err(valuesResult.error);
      }

      const values = valuesResult.value;

      const result = await this.db
        .insertInto('transactions')
        .values(values)
        .onConflict((oc) =>
          // For blockchain transactions, conflict on unique index (account_id, blockchain_transaction_hash)
          // For exchange transactions, we don't have a unique constraint, so this won't trigger
          oc.doNothing()
        )
        .returning('id')
        .executeTakeFirst();

      // If no result, the insert was skipped due to a conflict (duplicate transaction)
      // Find and return the existing transaction's ID
      if (!result) {
        // For blockchain transactions, look up by blockchain_transaction_hash
        if (values.blockchain_transaction_hash) {
          const existing = await this.db
            .selectFrom('transactions')
            .select('id')
            .where('account_id', '=', accountId)
            .where('blockchain_transaction_hash', '=', values.blockchain_transaction_hash)
            .executeTakeFirst();

          if (existing) {
            return ok(existing.id);
          }
        }

        // If we couldn't find the existing transaction, return an error
        // This should not happen in normal operation
        return err(new Error('Transaction insert skipped due to conflict, but existing transaction not found'));
      }

      return ok(result.id);
    } catch (error) {
      return wrapError(error, 'Failed to save transaction');
    }
  }

  async saveBatch(
    transactions: Omit<UniversalTransactionData, 'id' | 'accountId'>[],
    accountId: number
  ): Promise<Result<{ duplicates: number; saved: number }, Error>> {
    if (transactions.length === 0) {
      return ok({ saved: 0, duplicates: 0 });
    }

    const createdAt = this.getCurrentDateTimeForDB();
    const insertValues: Insertable<TransactionsTable>[] = [];

    for (const [index, transaction] of transactions.entries()) {
      const valuesResult = this.buildInsertValues(transaction, accountId, createdAt);
      if (valuesResult.isErr()) {
        return err(new Error(`Transaction index-${index}: ${valuesResult.error.message}`));
      }
      insertValues.push(valuesResult.value);
    }

    try {
      const result = await this.withTransaction(async (trx) => {
        let saved = 0;
        let duplicates = 0;

        for (const values of insertValues) {
          const insertResult = await trx
            .insertInto('transactions')
            .values(values)
            .onConflict((oc) => oc.doNothing())
            .returning('id')
            .executeTakeFirst();

          if (!insertResult) {
            if (values.blockchain_transaction_hash) {
              const existing = await trx
                .selectFrom('transactions')
                .select('id')
                .where('account_id', '=', accountId)
                .where('blockchain_transaction_hash', '=', values.blockchain_transaction_hash)
                .executeTakeFirst();

              if (existing) {
                saved++;
                duplicates++;
                continue;
              }
            }

            throw new Error('Transaction insert skipped due to conflict, but existing transaction not found');
          }

          saved++;
        }

        return { saved, duplicates };
      });

      return ok(result);
    } catch (error) {
      return wrapError(error, 'Failed to save transaction batch');
    }
  }

  async getTransactions(filters?: TransactionFilters): Promise<Result<UniversalTransactionData[], Error>> {
    try {
      let query = this.db.selectFrom('transactions').selectAll();

      // Add WHERE conditions if provided
      if (filters) {
        if (filters.sourceName) {
          query = query.where('source_name', '=', filters.sourceName);
        }

        if (filters.since) {
          // Convert Unix timestamp to ISO string for comparison
          const sinceDate = new Date(filters.since * 1000).toISOString();
          query = query.where('created_at', '>=', sinceDate as unknown as string);
        }

        if (filters.accountId !== undefined) {
          query = query.where('account_id', '=', filters.accountId);
        } else if (filters.accountIds !== undefined && filters.accountIds.length > 0) {
          query = query.where('account_id', 'in', filters.accountIds);
        }
      }

      // By default, exclude transactions marked as excluded_from_accounting (scam tokens, etc.)
      // unless explicitly requested
      if (!filters?.includeExcluded) {
        query = query.where('excluded_from_accounting', '=', false);
      }

      // Order by transaction datetime ascending (oldest to newest)
      query = query.orderBy('transaction_datetime', 'asc');

      const rows = await query.execute();

      // Convert rows to domain models, failing fast on any parse errors
      const transactions: UniversalTransactionData[] = [];
      for (const row of rows) {
        const result = this.toUniversalTransaction(row);
        if (result.isErr()) {
          return err(result.error);
        }
        transactions.push(result.value);
      }

      return ok(transactions);
    } catch (error) {
      return wrapError(error, 'Failed to retrieve transactions');
    }
  }

  async findById(id: number): Promise<Result<UniversalTransactionData | undefined, Error>> {
    try {
      const row = await this.db.selectFrom('transactions').selectAll().where('id', '=', id).executeTakeFirst();

      if (!row) {
        return ok(undefined);
      }

      const result = this.toUniversalTransaction(row);
      if (result.isErr()) {
        return err(result.error);
      }

      return ok(result.value);
    } catch (error) {
      return wrapError(error, 'Failed to retrieve transaction by ID');
    }
  }

  /**
   * Find transactions with movements or fees that need price data
   * Optionally filter by specific asset(s)
   */
  async findTransactionsNeedingPrices(assetFilter?: string[]): Promise<Result<UniversalTransactionData[], Error>> {
    try {
      const query = this.db
        .selectFrom('transactions')
        .selectAll()
        .where((eb) =>
          eb.and([
            eb.or([
              eb('movements_inflows', 'is not', null),
              eb('movements_outflows', 'is not', null),
              eb('fees', 'is not', null),
            ]),
            eb('excluded_from_accounting', '=', false),
          ])
        );

      const rows = await query.execute();

      // Convert rows to domain models
      const transactions: UniversalTransactionData[] = [];
      for (const row of rows) {
        const result = this.toUniversalTransaction(row);
        if (result.isErr()) {
          return err(result.error);
        }
        transactions.push(result.value);
      }

      // Filter transactions that have movements or fees without priceAtTxTime
      const transactionsNeedingPrices = transactions.filter((tx) => {
        const allMovements = [...(tx.movements.inflows ?? []), ...(tx.movements.outflows ?? []), ...(tx.fees ?? [])];

        // Check if any movement is missing priceAtTxTime or has tentative non-USD price
        return allMovements.some((movement) => {
          // If asset filter is provided, only check movements matching the filter
          if (assetFilter && assetFilter.length > 0) {
            if (!assetFilter.includes(movement.asset)) {
              return false;
            }
          }

          // Movement needs price if:
          // 1. No price at all, OR
          // 2. Price source is 'fiat-execution-tentative' (not yet normalized to USD)
          // This ensures Stage 3 fetch runs as fallback if Stage 2 FX normalization fails
          //
          // Note: We do NOT skip fiat currencies here because Pass 0 needs to stamp identity
          // prices on fiat movements (1 USD = 1 USD, 1 CAD = 1 CAD, etc.)
          return !movement.priceAtTxTime || movement.priceAtTxTime.source === 'fiat-execution-tentative';
        });
      });

      return ok(transactionsNeedingPrices);
    } catch (error) {
      return wrapError(error, 'Failed to find transactions needing prices');
    }
  }

  /**
   * Update a transaction's movements and fees with enriched price data
   * @param transaction - The enriched transaction with price data
   */
  async updateMovementsWithPrices(transaction: UniversalTransactionData): Promise<Result<void, Error>> {
    try {
      const inflows = transaction.movements.inflows ?? [];
      const outflows = transaction.movements.outflows ?? [];

      // Build update object using Kysely's Updateable type
      const updateData: Partial<Updateable<TransactionsTable>> = {
        movements_inflows: (inflows.length > 0 ? this.serializeToJson(inflows) : null) as string | null,
        movements_outflows: (outflows.length > 0 ? this.serializeToJson(outflows) : null) as string | null,
        fees: (transaction.fees && transaction.fees.length > 0 ? this.serializeToJson(transaction.fees) : null) as
          | string
          | null,
        updated_at: this.getCurrentDateTimeForDB(),
      };

      // Update transaction with enriched movements and fees
      const result = await this.db
        .updateTable('transactions')
        .set(updateData)
        .where('id', '=', transaction.id)
        .executeTakeFirst();

      // Verify transaction exists (0 rows updated means ID was invalid)
      if (result.numUpdatedRows === 0n) {
        return err(new Error(`Transaction ${transaction.id} not found`));
      }

      return ok(undefined);
    } catch (error) {
      return wrapError(error, 'Failed to update movements with prices');
    }
  }

  async deleteBySource(sourceName: string): Promise<Result<number, Error>> {
    try {
      const result = await this.db.deleteFrom('transactions').where('source_name', '=', sourceName).executeTakeFirst();
      return ok(Number(result.numDeletedRows));
    } catch (error) {
      return wrapError(error, 'Failed to delete transactions by source');
    }
  }

  async countAll(): Promise<Result<number, Error>> {
    try {
      const result = await this.db
        .selectFrom('transactions')
        .select(({ fn }) => [fn.count<number>('id').as('count')])
        .executeTakeFirst();
      return ok(result?.count ?? 0);
    } catch (error) {
      return wrapError(error, 'Failed to count all transactions');
    }
  }

  /**
   * Count transactions by account IDs
   * Filters transactions WHERE account_id IN (accountIds)
   */
  async countByAccountIds(accountIds: number[]): Promise<Result<number, Error>> {
    try {
      if (accountIds.length === 0) {
        return ok(0);
      }

      const result = await this.db
        .selectFrom('transactions')
        .select(({ fn }) => [fn.count<number>('id').as('count')])
        .where('account_id', 'in', accountIds)
        .executeTakeFirst();
      return ok(result?.count ?? 0);
    } catch (error) {
      return wrapError(error, 'Failed to count transactions by account IDs');
    }
  }

  /**
   * Delete transactions by account IDs
   * Deletes transactions WHERE account_id IN (accountIds)
   */
  async deleteByAccountIds(accountIds: number[]): Promise<Result<number, Error>> {
    try {
      if (accountIds.length === 0) {
        return ok(0);
      }
      const result = await this.db.deleteFrom('transactions').where('account_id', 'in', accountIds).executeTakeFirst();
      return ok(Number(result.numDeletedRows));
    } catch (error) {
      return wrapError(error, 'Failed to delete transactions by account IDs');
    }
  }

  async deleteAll(): Promise<Result<number, Error>> {
    try {
      const result = await this.db.deleteFrom('transactions').executeTakeFirst();
      return ok(Number(result.numDeletedRows));
    } catch (error) {
      return wrapError(error, 'Failed to delete all transactions');
    }
  }

  private buildInsertValues(
    transaction: Omit<UniversalTransactionData, 'id' | 'accountId'>,
    accountId: number,
    createdAt?: string
  ): Result<Insertable<TransactionsTable>, Error> {
    // Validate notes before saving
    if (transaction.notes !== undefined) {
      const notesValidation = z.array(TransactionNoteSchema).safeParse(transaction.notes);
      if (!notesValidation.success) {
        return err(new Error(`Invalid notes: ${notesValidation.error.message}`));
      }
    }

    // Normalize movements: ensure gross/net fields exist
    const normalizedInflows: AssetMovement[] = [];
    for (const inflow of transaction.movements.inflows ?? []) {
      const result = normalizeMovement(inflow);
      if (result.isErr()) {
        return err(result.error);
      }
      normalizedInflows.push(result.value);
    }

    const normalizedOutflows: AssetMovement[] = [];
    for (const outflow of transaction.movements.outflows ?? []) {
      const result = normalizeMovement(outflow);
      if (result.isErr()) {
        return err(result.error);
      }
      normalizedOutflows.push(result.value);
    }

    return ok({
      created_at: createdAt ?? this.getCurrentDateTimeForDB(),
      external_id: transaction.externalId || generateDeterministicTransactionHash(transaction),
      from_address: transaction.from ?? null,
      account_id: accountId,
      notes_json:
        (transaction.notes && transaction.notes.length > 0 ? this.serializeToJson(transaction.notes) : null) ?? null,
      is_spam: transaction.isSpam ?? false,
      excluded_from_accounting: transaction.excludedFromAccounting ?? transaction.isSpam ?? false,
      source_name: transaction.source,
      source_type: transaction.blockchain ? 'blockchain' : 'exchange',
      to_address: transaction.to ?? null,
      transaction_datetime: transaction.datetime
        ? new Date(transaction.datetime).toISOString()
        : new Date().toISOString(),
      transaction_status: transaction.status,

      // Serialize normalized movements
      movements_inflows: (normalizedInflows.length > 0 ? this.serializeToJson(normalizedInflows) : null) ?? null,
      movements_outflows: (normalizedOutflows.length > 0 ? this.serializeToJson(normalizedOutflows) : null) ?? null,

      // Serialize fees array
      fees: (transaction.fees && transaction.fees.length > 0 ? this.serializeToJson(transaction.fees) : null) ?? null,

      // Enhanced operation classification
      operation_category: transaction.operation?.category ?? null,
      operation_type: transaction.operation?.type ?? null,

      // Blockchain metadata
      blockchain_name: transaction.blockchain?.name ?? null,
      blockchain_block_height: transaction.blockchain?.block_height ?? null,
      blockchain_transaction_hash: transaction.blockchain?.transaction_hash ?? null,
      blockchain_is_confirmed: transaction.blockchain?.is_confirmed ?? null,
    });
  }

  /**
   * Convert database row to UniversalTransactionData domain model
   */
  private toUniversalTransaction(row: Selectable<TransactionsTable>): Result<UniversalTransactionData, Error> {
    // Parse timestamp from datetime
    const datetime = row.transaction_datetime;
    const timestamp = new Date(datetime).getTime();

    // Parse movements
    const inflowsResult = this.parseMovements(row.movements_inflows as string | null);
    if (inflowsResult.isErr()) {
      return err(inflowsResult.error);
    }

    const outflowsResult = this.parseMovements(row.movements_outflows as string | null);
    if (outflowsResult.isErr()) {
      return err(outflowsResult.error);
    }

    // Parse fees array
    const feesResult = this.parseFees(row.fees as string | null);
    if (feesResult.isErr()) {
      return err(feesResult.error);
    }

    const status: TransactionStatus = row.transaction_status;

    // Build UniversalTransactionData
    const transaction: UniversalTransactionData = {
      id: row.id,
      accountId: row.account_id,
      externalId: row.external_id ?? `${row.source_name}-${row.id}`,
      datetime,
      timestamp,
      source: row.source_name,
      status,
      from: row.from_address ?? undefined,
      to: row.to_address ?? undefined,
      movements: {
        inflows: inflowsResult.value,
        outflows: outflowsResult.value,
      },
      fees: feesResult.value,
      operation: {
        category: row.operation_category ?? 'transfer',
        type: row.operation_type ?? 'transfer',
      },
      isSpam: row.is_spam ? true : undefined,
      excludedFromAccounting: row.excluded_from_accounting ? true : undefined,
    };

    // Add blockchain data if present
    if (row.blockchain_name) {
      transaction.blockchain = {
        name: row.blockchain_name,
        transaction_hash: row.blockchain_transaction_hash ?? '',
        is_confirmed: row.blockchain_is_confirmed ?? false,
        block_height: row.blockchain_block_height ?? undefined,
      };
    }

    // Add notes if present
    if (row.notes_json) {
      const notesResult = this.parseWithSchema(row.notes_json, z.array(TransactionNoteSchema));
      if (notesResult.isErr()) {
        return err(notesResult.error);
      }
      transaction.notes = notesResult.value;
    }

    return ok(transaction);
  }

  /**
   * Parse movements from JSON
   */
  private parseMovements(jsonString: string | null): Result<AssetMovement[], Error> {
    if (!jsonString) {
      return ok([]);
    }

    try {
      const parsed: unknown = JSON.parse(jsonString);
      const result = z.array(AssetMovementSchema).safeParse(parsed);

      if (!result.success) {
        return err(new Error(`Failed to parse movements JSON: ${result.error.message}`));
      }

      // Normalize and validate all movements
      const normalizedMovements: AssetMovement[] = [];
      for (const movement of result.data) {
        const normalizeResult = normalizeMovement(movement);
        if (normalizeResult.isErr()) {
          return err(normalizeResult.error);
        }
        normalizedMovements.push(normalizeResult.value);
      }

      return ok(normalizedMovements);
    } catch (error) {
      return err(
        new Error(`Failed to parse movements JSON: ${error instanceof Error ? error.message : String(error)}`)
      );
    }
  }

  /**
   * Parse fees array from JSON column
   *
   * Schema validation via FeeMovementSchema ensures required fields (scope, settlement) are present.
   */
  private parseFees(jsonString: string | null): Result<FeeMovement[], Error> {
    if (!jsonString) {
      return ok([]);
    }

    try {
      const parsed: unknown = JSON.parse(jsonString);
      const result = z.array(FeeMovementSchema).safeParse(parsed);

      if (!result.success) {
        return err(new Error(`Failed to parse fees JSON: ${result.error.message}`));
      }

      return ok(result.data);
    } catch (error) {
      return err(new Error(`Failed to parse fees JSON: ${error instanceof Error ? error.message : String(error)}`));
    }
  }
}
