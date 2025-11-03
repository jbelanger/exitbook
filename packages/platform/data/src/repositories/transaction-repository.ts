/* eslint-disable unicorn/no-null -- Kysely queries require null for IS NULL checks */
import type { AssetMovement, UniversalTransaction, TransactionStatus } from '@exitbook/core';
import {
  AssetMovementSchema,
  Currency,
  NoteMetadataSchema,
  TransactionMetadataSchema,
  wrapError,
} from '@exitbook/core';
import type { Selectable, Updateable } from 'kysely';
import type { Result } from 'neverthrow';
import { err, ok } from 'neverthrow';
import { v4 as uuidv4 } from 'uuid';
import { z } from 'zod';

import type { TransactionsTable } from '../schema/database-schema.js';
import type { KyselyDB } from '../storage/database.js';

import { BaseRepository } from './base-repository.js';
import type { ITransactionRepository, TransactionFilters } from './transaction-repository.interface.ts';

/**
 * Kysely-based repository for transaction database operations.
 * Handles storage and retrieval of UniversalTransaction entities using type-safe queries.
 */
export class TransactionRepository extends BaseRepository implements ITransactionRepository {
  constructor(db: KyselyDB) {
    super(db, 'TransactionRepository');
  }

  async save(transaction: UniversalTransaction, dataSourceId: number) {
    return this.saveTransaction(transaction, dataSourceId);
  }

  async saveTransaction(transaction: UniversalTransaction, dataSourceId: number) {
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

      const rawDataJson = this.serializeToJson(transaction) ?? '{}';

      const result = await this.db
        .insertInto('transactions')
        .values({
          created_at: this.getCurrentDateTimeForDB(),
          external_id: (transaction.metadata?.hash ||
            transaction.externalId ||
            `${transaction.source}-${transaction.timestamp}-${uuidv4()}`) as string,
          from_address: transaction.from,
          data_source_id: dataSourceId,
          note_message: transaction.note?.message,
          note_metadata: transaction.note?.metadata ? this.serializeToJson(transaction.note.metadata) : undefined,
          note_severity: transaction.note?.severity,
          note_type: transaction.note?.type,
          excluded_from_accounting: transaction.note?.type === 'SCAM_TOKEN',
          raw_normalized_data: rawDataJson,
          source_id: transaction.source,
          source_type: transaction.blockchain ? 'blockchain' : 'exchange',
          to_address: transaction.to,
          transaction_datetime: transaction.datetime
            ? new Date(transaction.datetime).toISOString()
            : new Date().toISOString(),
          transaction_status: transaction.status,

          // Structured movements
          movements_inflows: transaction.movements?.inflows
            ? this.serializeToJson(transaction.movements.inflows)
            : undefined,
          movements_outflows: transaction.movements?.outflows
            ? this.serializeToJson(transaction.movements.outflows)
            : undefined,

          // Structured fees
          fees_network: transaction.fees?.network ? this.serializeToJson(transaction.fees.network) : undefined,
          fees_platform: transaction.fees?.platform ? this.serializeToJson(transaction.fees.platform) : undefined,

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
          oc.columns(['data_source_id', 'external_id']).doUpdateSet({
            from_address: (eb) => eb.ref('excluded.from_address'),
            note_message: (eb) => eb.ref('excluded.note_message'),
            note_metadata: (eb) => eb.ref('excluded.note_metadata'),
            note_severity: (eb) => eb.ref('excluded.note_severity'),
            note_type: (eb) => eb.ref('excluded.note_type'),
            excluded_from_accounting: (eb) => eb.ref('excluded.excluded_from_accounting'),
            raw_normalized_data: (eb) => eb.ref('excluded.raw_normalized_data'),
            to_address: (eb) => eb.ref('excluded.to_address'),
            transaction_datetime: (eb) => eb.ref('excluded.transaction_datetime'),
            transaction_status: (eb) => eb.ref('excluded.transaction_status'),
            updated_at: new Date().toISOString(),

            // Structured movements
            movements_inflows: (eb) => eb.ref('excluded.movements_inflows'),
            movements_outflows: (eb) => eb.ref('excluded.movements_outflows'),

            // Structured fees
            fees_network: (eb) => eb.ref('excluded.fees_network'),
            fees_platform: (eb) => eb.ref('excluded.fees_platform'),
            fees_total: (eb) => eb.ref('excluded.fees_total'),

            // Enhanced operation classification
            operation_category: (eb) => eb.ref('excluded.operation_category'),
            operation_type: (eb) => eb.ref('excluded.operation_type'),

            // Blockchain metadata
            blockchain_name: (eb) => eb.ref('excluded.blockchain_name'),
            blockchain_block_height: (eb) => eb.ref('excluded.blockchain_block_height'),
            blockchain_transaction_hash: (eb) => eb.ref('excluded.blockchain_transaction_hash'),
            blockchain_is_confirmed: (eb) => eb.ref('excluded.blockchain_is_confirmed'),
          })
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

        if (filters.sessionId !== undefined) {
          query = query.where('data_source_id', '=', filters.sessionId);
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
        const allMovements = [
          ...(tx.movements.inflows ?? []),
          ...(tx.movements.outflows ?? []),
          ...(tx.fees.platform ? [tx.fees.platform] : []),
          ...(tx.fees.network ? [tx.fees.network] : []),
        ];

        // Check if any movement is missing priceAtTxTime
        return allMovements.some((movement) => {
          // If asset filter is provided, only check movements matching the filter
          if (assetFilter && assetFilter.length > 0) {
            if (!assetFilter.includes(movement.asset)) {
              return false;
            }
          }

          // Skip fiat currencies - they don't need prices (they ARE the price)
          const currency = Currency.create(movement.asset);
          if (currency.isFiat()) {
            return false;
          }

          return !movement.priceAtTxTime;
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
        fees_platform: (transaction.fees.platform ? this.serializeToJson(transaction.fees.platform) : null) as
          | string
          | null,
        fees_network: (transaction.fees.network ? this.serializeToJson(transaction.fees.network) : null) as
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

      // eslint-disable-next-line unicorn/no-useless-undefined -- Explicitly return undefined for clarity
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
    const inflows = this.parseMovements(row.movements_inflows as string | null);
    const outflows = this.parseMovements(row.movements_outflows as string | null);

    // Parse fees
    const network = this.parseFee(row.fees_network as string | null);
    const platform = this.parseFee(row.fees_platform as string | null);

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
        inflows,
        outflows,
      },
      fees: {
        network: network ?? undefined,
        platform: platform ?? undefined,
      },
      operation: {
        category: row.operation_category ?? 'transfer',
        type: row.operation_type ?? 'transfer',
      },
      metadata: metadataResult.value,
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
   * Parse movements from JSON string stored in database
   */
  private parseMovements(jsonString: string | null): AssetMovement[] {
    if (!jsonString) {
      return [];
    }

    try {
      const parsed: unknown = JSON.parse(jsonString);
      const result = z.array(AssetMovementSchema).safeParse(parsed);

      if (!result.success) {
        this.logger.warn(
          {
            issues: result.error.issues,
            jsonString: jsonString.substring(0, 200),
          },
          'Failed to validate movements JSON'
        );
        return [];
      }

      return result.data;
    } catch (error) {
      this.logger.warn({ error, jsonString }, 'Failed to parse movements JSON');
      return [];
    }
  }

  /**
   * Parse fee from JSON string stored in database
   * Fees are stored as AssetMovement objects: { asset: string, amount: string, priceAtTxTime: PriceAtTxTime | undefined }
   */
  private parseFee(jsonString: string | null): AssetMovement | null {
    if (!jsonString) {
      return null;
    }

    try {
      const parsed: unknown = JSON.parse(jsonString);
      const result = AssetMovementSchema.safeParse(parsed);

      if (!result.success) {
        this.logger.warn({ error: result.error, jsonString }, 'Failed to validate fee JSON');
        return null;
      }

      return result.data;
    } catch (error) {
      this.logger.warn({ error, jsonString }, 'Failed to parse fee JSON');
      return null;
    }
  }
}
