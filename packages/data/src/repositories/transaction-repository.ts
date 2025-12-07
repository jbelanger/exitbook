/* eslint-disable unicorn/no-null -- Kysely queries require null for IS NULL checks */
import type { AssetMovement, FeeMovement, UniversalTransaction, TransactionStatus } from '@exitbook/core';
import {
  AssetMovementSchema,
  FeeMovementSchema,
  NoteMetadataSchema,
  TransactionMetadataSchema,
  wrapError,
} from '@exitbook/core';
import type { Selectable, Updateable } from 'kysely';
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
 * Handles storage and retrieval of UniversalTransaction entities using type-safe queries.
 */
export class TransactionRepository extends BaseRepository implements ITransactionRepository {
  constructor(db: KyselyDB) {
    super(db, 'TransactionRepository');
  }

  async save(transaction: UniversalTransaction, accountId: number) {
    return this.saveTransaction(transaction, accountId);
  }

  async saveTransaction(transaction: UniversalTransaction, accountId: number) {
    try {
      // Validate metadata before saving
      if (transaction.metadata !== undefined) {
        const metadataValidation = TransactionMetadataSchema.safeParse(transaction.metadata);
        if (!metadataValidation.success) {
          return err(new Error(`Invalid transaction metadata: ${metadataValidation.error.message}`));
        }
      }

      // Validate note metadata before saving
      if (transaction.note?.metadata !== undefined) {
        const noteMetadataValidation = NoteMetadataSchema.safeParse(transaction.note.metadata);
        if (!noteMetadataValidation.success) {
          return err(new Error(`Invalid note metadata: ${noteMetadataValidation.error.message}`));
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

      const rawDataJson = this.serializeToJson(transaction) ?? '{}';

      // Serialize fees array
      const feesJson =
        transaction.fees && transaction.fees.length > 0 ? this.serializeToJson(transaction.fees) : undefined;

      const result = await this.db
        .insertInto('transactions')
        .values({
          created_at: this.getCurrentDateTimeForDB(),
          external_id: (transaction.metadata?.hash ||
            transaction.externalId ||
            generateDeterministicTransactionHash(transaction)) as string,
          from_address: transaction.from,
          account_id: accountId,
          note_message: transaction.note?.message,
          note_metadata: transaction.note?.metadata ? this.serializeToJson(transaction.note.metadata) : undefined,
          note_severity: transaction.note?.severity,
          note_type: transaction.note?.type,
          excluded_from_accounting: transaction.excludedFromAccounting ?? transaction.note?.type === 'SCAM_TOKEN',
          raw_normalized_data: rawDataJson,
          source_id: transaction.source,
          source_type: transaction.blockchain ? 'blockchain' : 'exchange',
          to_address: transaction.to,
          transaction_datetime: transaction.datetime
            ? new Date(transaction.datetime).toISOString()
            : new Date().toISOString(),
          transaction_status: transaction.status,

          // Serialize normalized movements
          movements_inflows: normalizedInflows.length > 0 ? this.serializeToJson(normalizedInflows) : undefined,
          movements_outflows: normalizedOutflows.length > 0 ? this.serializeToJson(normalizedOutflows) : undefined,

          // Serialize fees array
          fees: feesJson,

          // Enhanced operation classification
          operation_category: transaction.operation?.category,
          operation_type: transaction.operation?.type,

          // Blockchain metadata
          blockchain_name: transaction.blockchain?.name,
          blockchain_block_height: transaction.blockchain?.block_height,
          blockchain_transaction_hash: transaction.blockchain?.transaction_hash,
          blockchain_is_confirmed: transaction.blockchain?.is_confirmed,
        })
        .onConflict((oc) =>
          // For blockchain transactions, conflict on unique index (account_id, blockchain_transaction_hash)
          // For exchange transactions, we don't have a unique constraint, so this won't trigger
          oc.doNothing()
        )
        .returning('id')
        .executeTakeFirstOrThrow();

      return ok(result.id);
    } catch (error) {
      return wrapError(error, 'Failed to save transaction');
    }
  }

  async getTransactions(filters?: TransactionFilters): Promise<Result<UniversalTransaction[], Error>> {
    try {
      let query = this.db.selectFrom('transactions').selectAll();

      // Add WHERE conditions if provided
      if (filters) {
        if (filters.sourceId) {
          query = query.where('source_id', '=', filters.sourceId);
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
      const transactions: UniversalTransaction[] = [];
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

  async findById(id: number): Promise<Result<UniversalTransaction | null, Error>> {
    try {
      const row = await this.db.selectFrom('transactions').selectAll().where('id', '=', id).executeTakeFirst();

      if (!row) {
        return ok(null);
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
  async findTransactionsNeedingPrices(assetFilter?: string[]): Promise<Result<UniversalTransaction[], Error>> {
    try {
      const query = this.db
        .selectFrom('transactions')
        .selectAll()
        .where((eb) =>
          eb.and([
            eb.or([eb('movements_inflows', 'is not', null), eb('movements_outflows', 'is not', null)]),
            eb('excluded_from_accounting', '=', false),
          ])
        );

      const rows = await query.execute();

      // Convert rows to domain models
      const transactions: UniversalTransaction[] = [];
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
  async updateMovementsWithPrices(transaction: UniversalTransaction): Promise<Result<void, Error>> {
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

  async deleteBySource(sourceId: string): Promise<Result<number, Error>> {
    try {
      const result = await this.db.deleteFrom('transactions').where('source_id', '=', sourceId).executeTakeFirst();
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

  /**
   * Convert database row to UniversalTransaction domain model
   */
  private toUniversalTransaction(row: Selectable<TransactionsTable>): Result<UniversalTransaction, Error> {
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

    // Parse metadata from raw_normalized_data if present (validate with schema)
    const metadataResult = this.parseWithSchema(row.raw_normalized_data, TransactionMetadataSchema);
    if (metadataResult.isErr()) {
      return err(metadataResult.error);
    }

    const status: TransactionStatus = row.transaction_status;

    // Build UniversalTransaction
    const transaction: UniversalTransaction = {
      id: row.id,
      externalId: row.external_id ?? `${row.source_id}-${row.id}`,
      datetime,
      timestamp,
      source: row.source_id,
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
      metadata: metadataResult.value,
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

    // Add note if present
    if (row.note_type) {
      const noteMetadataResult = this.parseWithSchema(row.note_metadata, NoteMetadataSchema);
      if (noteMetadataResult.isErr()) {
        return err(noteMetadataResult.error);
      }

      transaction.note = {
        type: row.note_type,
        message: row.note_message ?? '',
        severity: row.note_severity ?? undefined,
        metadata: noteMetadataResult.value,
      };
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
   * Schema validation via FeeMovementSchema.refine() ensures:
   * - Required fields (scope, settlement) are present
   * - Invalid combinations are rejected (e.g., on-chain + platform)
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
