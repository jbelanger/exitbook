/* eslint-disable unicorn/no-null -- Kysely queries require null for IS NULL checks */
import {
  AssetMovementSchema,
  Currency,
  FeeMovementSchema,
  TransactionNoteSchema,
  parseDecimal,
  type AssetMovement,
  type FeeMovement,
  type TransactionStatus,
  type UniversalTransactionData,
  wrapError,
} from '@exitbook/core';
import { getLogger, type Logger } from '@exitbook/logger';
import type { Insertable, Selectable } from 'kysely';
import type { Result } from 'neverthrow';
import { err, ok } from 'neverthrow';
import { z } from 'zod';

import type { TransactionMovementsTable, TransactionsTable } from '../schema/database-schema.js';
import type { KyselyDB } from '../storage/database.js';

import { parseWithSchema, serializeToJson, withControlledTransaction } from './query-utils.js';
import { generateDeterministicTransactionHash } from './transaction-id-utils.js';

/**
 * Filters for querying transactions.
 */
export interface TransactionFilters {
  sourceName?: string | undefined;
  since?: number | undefined;
  accountId?: number | undefined;
  accountIds?: number[] | undefined;
  includeExcluded?: boolean | undefined;
}

/**
 * Full transaction projection filters.
 */
export interface FullTransactionFilters extends TransactionFilters {
  projection?: 'full' | undefined;
}

/**
 * Summary transaction projection filters.
 */
export interface SummaryTransactionFilters extends TransactionFilters {
  projection: 'summary';
}

/**
 * Lightweight transaction summary without movements/fees.
 */
export interface TransactionSummary {
  id: number;
  accountId: number;
  externalId: string;
  datetime: string;
  timestamp: number;
  source: string;
  sourceType: string;
  status: TransactionStatus;
  from?: string | undefined;
  to?: string | undefined;
  operation: { category: string; type: string };
  isSpam?: boolean | undefined;
  excludedFromAccounting?: boolean | undefined;
  blockchain?: { name: string; transaction_hash: string } | undefined;
}

type MovementRow = Selectable<TransactionMovementsTable>;

function validatePriceDataForPersistence(
  inflows: AssetMovement[],
  outflows: AssetMovement[],
  fees: FeeMovement[],
  context: string
): Result<void, Error> {
  const inflowsValidation = z.array(AssetMovementSchema).safeParse(inflows);
  if (!inflowsValidation.success) {
    return err(new Error(`Invalid inflow movement data for ${context}: ${inflowsValidation.error.message}`));
  }

  const outflowsValidation = z.array(AssetMovementSchema).safeParse(outflows);
  if (!outflowsValidation.success) {
    return err(new Error(`Invalid outflow movement data for ${context}: ${outflowsValidation.error.message}`));
  }

  const feesValidation = z.array(FeeMovementSchema).safeParse(fees);
  if (!feesValidation.success) {
    return err(new Error(`Invalid fee data for ${context}: ${feesValidation.error.message}`));
  }

  return ok(undefined);
}

function assetMovementToRow(
  movement: AssetMovement,
  transactionId: number,
  position: number,
  movementType: 'inflow' | 'outflow'
): Result<Insertable<TransactionMovementsTable>, Error> {
  if (!movement.grossAmount) {
    return err(
      new Error(
        `Movement missing required field 'grossAmount'. ` +
          `Processors must be updated to emit new fee semantics. ` +
          `Asset: ${movement.assetSymbol}`
      )
    );
  }

  const row: Insertable<TransactionMovementsTable> = {
    transaction_id: transactionId,
    position,
    movement_type: movementType,
    asset_id: movement.assetId,
    asset_symbol: movement.assetSymbol,
    gross_amount: movement.grossAmount.toFixed(),
    net_amount: (movement.netAmount ?? movement.grossAmount).toFixed(),
    fee_amount: null,
    fee_scope: null,
    fee_settlement: null,
    price_amount: movement.priceAtTxTime?.price.amount.toFixed() ?? null,
    price_currency: movement.priceAtTxTime?.price.currency.toString() ?? null,
    price_source: movement.priceAtTxTime?.source ?? null,
    price_fetched_at: movement.priceAtTxTime?.fetchedAt
      ? new Date(movement.priceAtTxTime.fetchedAt).toISOString()
      : null,
    price_granularity: movement.priceAtTxTime?.granularity ?? null,
    fx_rate_to_usd: movement.priceAtTxTime?.fxRateToUSD?.toFixed() ?? null,
    fx_source: movement.priceAtTxTime?.fxSource ?? null,
    fx_timestamp: movement.priceAtTxTime?.fxTimestamp
      ? new Date(movement.priceAtTxTime.fxTimestamp).toISOString()
      : null,
  };

  return ok(row);
}

function feeMovementToRow(
  fee: FeeMovement,
  transactionId: number,
  position: number
): Result<Insertable<TransactionMovementsTable>, Error> {
  const row: Insertable<TransactionMovementsTable> = {
    transaction_id: transactionId,
    position,
    movement_type: 'fee',
    asset_id: fee.assetId,
    asset_symbol: fee.assetSymbol,
    gross_amount: null,
    net_amount: null,
    fee_amount: fee.amount.toFixed(),
    fee_scope: fee.scope,
    fee_settlement: fee.settlement,
    price_amount: fee.priceAtTxTime?.price.amount.toFixed() ?? null,
    price_currency: fee.priceAtTxTime?.price.currency.toString() ?? null,
    price_source: fee.priceAtTxTime?.source ?? null,
    price_fetched_at: fee.priceAtTxTime?.fetchedAt ? new Date(fee.priceAtTxTime.fetchedAt).toISOString() : null,
    price_granularity: fee.priceAtTxTime?.granularity ?? null,
    fx_rate_to_usd: fee.priceAtTxTime?.fxRateToUSD?.toFixed() ?? null,
    fx_source: fee.priceAtTxTime?.fxSource ?? null,
    fx_timestamp: fee.priceAtTxTime?.fxTimestamp ? new Date(fee.priceAtTxTime.fxTimestamp).toISOString() : null,
  };

  return ok(row);
}

function rowToAssetMovement(row: MovementRow): Result<AssetMovement, Error> {
  if (row.movement_type !== 'inflow' && row.movement_type !== 'outflow') {
    return err(new Error(`Expected inflow/outflow row, got ${row.movement_type}`));
  }

  if (!row.gross_amount) {
    return err(new Error(`Movement row missing gross_amount (id: ${row.id})`));
  }

  const movement: AssetMovement = {
    assetId: row.asset_id,
    assetSymbol: row.asset_symbol,
    grossAmount: parseDecimal(row.gross_amount),
    netAmount: row.net_amount ? parseDecimal(row.net_amount) : parseDecimal(row.gross_amount),
  };

  if (row.price_amount && row.price_currency && row.price_source && row.price_fetched_at) {
    movement.priceAtTxTime = {
      price: {
        amount: parseDecimal(row.price_amount),
        currency: Currency.create(row.price_currency),
      },
      source: row.price_source,
      fetchedAt: new Date(row.price_fetched_at),
      granularity: row.price_granularity ?? undefined,
      fxRateToUSD: row.fx_rate_to_usd ? parseDecimal(row.fx_rate_to_usd) : undefined,
      fxSource: row.fx_source ?? undefined,
      fxTimestamp: row.fx_timestamp ? new Date(row.fx_timestamp) : undefined,
    };
  }

  const validation = AssetMovementSchema.safeParse(movement);
  if (!validation.success) {
    return err(new Error(`Movement row failed schema validation (id: ${row.id}): ${validation.error.message}`));
  }

  return ok(validation.data);
}

function rowToFeeMovement(row: MovementRow): Result<FeeMovement, Error> {
  if (row.movement_type !== 'fee') {
    return err(new Error(`Expected fee row, got ${row.movement_type}`));
  }

  if (!row.fee_amount || !row.fee_scope || !row.fee_settlement) {
    return err(new Error(`Fee row missing required fields (id: ${row.id})`));
  }

  const fee: FeeMovement = {
    assetId: row.asset_id,
    assetSymbol: row.asset_symbol,
    amount: parseDecimal(row.fee_amount),
    scope: row.fee_scope,
    settlement: row.fee_settlement,
  };

  if (row.price_amount && row.price_currency && row.price_source && row.price_fetched_at) {
    fee.priceAtTxTime = {
      price: {
        amount: parseDecimal(row.price_amount),
        currency: Currency.create(row.price_currency),
      },
      source: row.price_source,
      fetchedAt: new Date(row.price_fetched_at),
      granularity: row.price_granularity ?? undefined,
      fxRateToUSD: row.fx_rate_to_usd ? parseDecimal(row.fx_rate_to_usd) : undefined,
      fxSource: row.fx_source ?? undefined,
      fxTimestamp: row.fx_timestamp ? new Date(row.fx_timestamp) : undefined,
    };
  }

  const validation = FeeMovementSchema.safeParse(fee);
  if (!validation.success) {
    return err(new Error(`Fee row failed schema validation (id: ${row.id}): ${validation.error.message}`));
  }

  return ok(validation.data);
}

function buildMovementRows(
  transaction: Omit<UniversalTransactionData, 'id' | 'accountId'>,
  transactionId: number
): Result<Insertable<TransactionMovementsTable>[], Error> {
  const inflows = transaction.movements.inflows ?? [];
  const outflows = transaction.movements.outflows ?? [];
  const fees = transaction.fees ?? [];

  const validationResult = validatePriceDataForPersistence(inflows, outflows, fees, `transaction ${transactionId}`);
  if (validationResult.isErr()) {
    return err(validationResult.error);
  }

  const rows: Insertable<TransactionMovementsTable>[] = [];
  let position = 0;

  for (const inflow of inflows) {
    const result = assetMovementToRow(inflow, transactionId, position++, 'inflow');
    if (result.isErr()) return err(result.error);
    rows.push(result.value);
  }

  for (const outflow of outflows) {
    const result = assetMovementToRow(outflow, transactionId, position++, 'outflow');
    if (result.isErr()) return err(result.error);
    rows.push(result.value);
  }

  for (const fee of fees) {
    const result = feeMovementToRow(fee, transactionId, position++);
    if (result.isErr()) return err(result.error);
    rows.push(result.value);
  }

  return ok(rows);
}

class TransactionQueriesRepository {
  private readonly logger: Logger;

  constructor(private readonly db: KyselyDB) {
    this.logger = getLogger('transaction-queries');
  }

  async save(
    transaction: Omit<UniversalTransactionData, 'id' | 'accountId'>,
    accountId: number
  ): Promise<Result<number, Error>> {
    const valuesResult = this.buildInsertValues(transaction, accountId);
    if (valuesResult.isErr()) {
      return err(valuesResult.error);
    }

    const values = valuesResult.value;

    return withControlledTransaction(
      this.db,
      this.logger,
      async (trx) => {
        const txResult = await trx
          .insertInto('transactions')
          .values(values)
          .onConflict((oc) => oc.doNothing())
          .returning('id')
          .executeTakeFirst();

        if (!txResult) {
          if (values.blockchain_transaction_hash) {
            const existing = await trx
              .selectFrom('transactions')
              .select('id')
              .where('account_id', '=', accountId)
              .where('blockchain_transaction_hash', '=', values.blockchain_transaction_hash)
              .executeTakeFirst();

            if (existing) {
              return ok(existing.id);
            }
          }
          return err(new Error('Transaction insert skipped due to conflict, but existing transaction not found'));
        }

        const transactionId = txResult.id;

        const movementRowsResult = buildMovementRows(transaction, transactionId);
        if (movementRowsResult.isErr()) {
          return err(movementRowsResult.error);
        }

        const movementRows = movementRowsResult.value;
        if (movementRows.length > 0) {
          await trx.insertInto('transaction_movements').values(movementRows).execute();
        }

        return ok(transactionId);
      },
      'Failed to save transaction'
    );
  }

  async saveBatch(
    transactions: Omit<UniversalTransactionData, 'id' | 'accountId'>[],
    accountId: number
  ): Promise<Result<{ duplicates: number; saved: number }, Error>> {
    if (transactions.length === 0) {
      return ok({ saved: 0, duplicates: 0 });
    }

    const createdAt = new Date().toISOString();

    return withControlledTransaction(
      this.db,
      this.logger,
      async (trx) => {
        let saved = 0;
        let duplicates = 0;

        for (const [index, transaction] of transactions.entries()) {
          const valuesResult = this.buildInsertValues(transaction, accountId, createdAt);
          if (valuesResult.isErr()) {
            return err(new Error(`Transaction index-${index}: ${valuesResult.error.message}`));
          }
          const values = valuesResult.value;

          const txResult = await trx
            .insertInto('transactions')
            .values(values)
            .onConflict((oc) => oc.doNothing())
            .returning('id')
            .executeTakeFirst();

          let transactionId: number;
          let isDuplicate = false;

          if (!txResult) {
            if (values.blockchain_transaction_hash) {
              const existing = await trx
                .selectFrom('transactions')
                .select('id')
                .where('account_id', '=', accountId)
                .where('blockchain_transaction_hash', '=', values.blockchain_transaction_hash)
                .executeTakeFirst();

              if (existing) {
                transactionId = existing.id;
                isDuplicate = true;
                duplicates++;
              } else {
                return err(new Error('Transaction insert skipped due to conflict, but existing transaction not found'));
              }
            } else {
              return err(new Error('Transaction insert skipped due to conflict, but existing transaction not found'));
            }
          } else {
            transactionId = txResult.id;
          }

          if (!isDuplicate) {
            const movementRowsResult = buildMovementRows(transaction, transactionId);
            if (movementRowsResult.isErr()) {
              return err(movementRowsResult.error);
            }

            const movementRows = movementRowsResult.value;
            if (movementRows.length > 0) {
              await trx.insertInto('transaction_movements').values(movementRows).execute();
            }
          }

          saved++;
        }

        return ok({ saved, duplicates });
      },
      'Failed to save transaction batch'
    );
  }

  async getTransactions(filters: SummaryTransactionFilters): Promise<Result<TransactionSummary[], Error>>;
  async getTransactions(filters?: FullTransactionFilters): Promise<Result<UniversalTransactionData[], Error>>;
  async getTransactions(
    filters?: FullTransactionFilters | SummaryTransactionFilters
  ): Promise<Result<UniversalTransactionData[] | TransactionSummary[], Error>> {
    try {
      const projection = filters?.projection ?? 'full';

      let query = this.db.selectFrom('transactions').selectAll();

      if (filters) {
        if (filters.sourceName) {
          query = query.where('source_name', '=', filters.sourceName);
        }

        if (filters.since) {
          const sinceDate = new Date(filters.since * 1000).toISOString();
          query = query.where('created_at', '>=', sinceDate as unknown as string);
        }

        if (filters.accountId !== undefined) {
          query = query.where('account_id', '=', filters.accountId);
        } else if (filters.accountIds !== undefined && filters.accountIds.length > 0) {
          query = query.where('account_id', 'in', filters.accountIds);
        }
      }

      if (!filters?.includeExcluded) {
        query = query.where('excluded_from_accounting', '=', false);
      }

      query = query.orderBy('transaction_datetime', 'asc');

      const rows = await query.execute();

      // Summary projection: skip movement JOIN and parsing
      if (projection === 'summary') {
        const summaries: TransactionSummary[] = [];
        for (const row of rows) {
          summaries.push(this.toTransactionSummary(row));
        }
        return ok(summaries);
      }

      // Full projection: JOIN movements and parse
      const transactionIds = rows.map((r) => r.id);
      const movementsMapResult = await this.loadMovementsForTransactions(transactionIds);
      if (movementsMapResult.isErr()) {
        return err(movementsMapResult.error);
      }
      const movementsMap = movementsMapResult.value;

      const transactions: UniversalTransactionData[] = [];
      for (const row of rows) {
        const movementRows = movementsMap.get(row.id) ?? [];
        const result = this.toUniversalTransaction(row, movementRows);
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

      const movementsResult = await this.loadMovementsForTransactions([id]);
      if (movementsResult.isErr()) {
        return err(movementsResult.error);
      }
      const movementRows = movementsResult.value.get(id) ?? [];

      const result = this.toUniversalTransaction(row, movementRows);
      if (result.isErr()) {
        return err(result.error);
      }

      return ok(result.value);
    } catch (error) {
      return wrapError(error, 'Failed to retrieve transaction by ID');
    }
  }

  async findTransactionsNeedingPrices(assetFilter?: string[]): Promise<Result<UniversalTransactionData[], Error>> {
    try {
      const query = this.db.selectFrom('transactions').selectAll().where('excluded_from_accounting', '=', false);

      const rows = await query.execute();

      if (rows.length === 0) {
        return ok([]);
      }

      const transactionIds = rows.map((r) => r.id);
      const movementsMapResult = await this.loadMovementsForTransactions(transactionIds);
      if (movementsMapResult.isErr()) {
        return err(movementsMapResult.error);
      }
      const movementsMap = movementsMapResult.value;

      const transactions: UniversalTransactionData[] = [];
      for (const row of rows) {
        const movementRows = movementsMap.get(row.id) ?? [];
        const result = this.toUniversalTransaction(row, movementRows);
        if (result.isErr()) {
          return err(result.error);
        }
        transactions.push(result.value);
      }

      const transactionsNeedingPrices = transactions.filter((tx) => {
        const allMovements = [...(tx.movements.inflows ?? []), ...(tx.movements.outflows ?? []), ...(tx.fees ?? [])];

        return allMovements.some((movement) => {
          if (assetFilter && assetFilter.length > 0) {
            if (!assetFilter.includes(movement.assetSymbol)) {
              return false;
            }
          }

          return !movement.priceAtTxTime || movement.priceAtTxTime.source === 'fiat-execution-tentative';
        });
      });

      return ok(transactionsNeedingPrices);
    } catch (error) {
      return wrapError(error, 'Failed to find transactions needing prices');
    }
  }

  async updateMovementsWithPrices(transaction: UniversalTransactionData): Promise<Result<void, Error>> {
    const validationResult = validatePriceDataForPersistence(
      transaction.movements.inflows ?? [],
      transaction.movements.outflows ?? [],
      transaction.fees ?? [],
      `transaction ${transaction.id}`
    );
    if (validationResult.isErr()) {
      return err(validationResult.error);
    }

    return withControlledTransaction(
      this.db,
      this.logger,
      async (trx) => {
        const txExists = await trx
          .selectFrom('transactions')
          .select('id')
          .where('id', '=', transaction.id)
          .executeTakeFirst();

        if (!txExists) {
          return err(new Error(`Transaction ${transaction.id} not found`));
        }

        await trx.deleteFrom('transaction_movements').where('transaction_id', '=', transaction.id).execute();

        const transactionForMovementRebuild = {
          ...transaction,
          id: undefined,
          accountId: undefined,
        } as Omit<UniversalTransactionData, 'id' | 'accountId'>;

        const movementRowsResult = buildMovementRows(transactionForMovementRebuild, transaction.id);
        if (movementRowsResult.isErr()) {
          return err(movementRowsResult.error);
        }

        const movementRows = movementRowsResult.value;
        if (movementRows.length > 0) {
          await trx.insertInto('transaction_movements').values(movementRows).execute();
        }

        await trx
          .updateTable('transactions')
          .set({ updated_at: new Date().toISOString() })
          .where('id', '=', transaction.id)
          .execute();

        return ok(undefined);
      },
      'Failed to update movements with prices'
    );
  }

  /**
   * Count transactions with optional filtering.
   * Reuses TransactionFilters type for consistent filtering logic.
   */
  async countTransactions(filters?: TransactionFilters): Promise<Result<number, Error>> {
    try {
      let query = this.db.selectFrom('transactions').select(({ fn }) => [fn.count<number>('id').as('count')]);

      if (filters) {
        if (filters.sourceName) {
          query = query.where('source_name', '=', filters.sourceName);
        }

        if (filters.since) {
          const sinceDate = new Date(filters.since * 1000).toISOString();
          query = query.where('created_at', '>=', sinceDate as unknown as string);
        }

        if (filters.accountId !== undefined) {
          query = query.where('account_id', '=', filters.accountId);
        } else if (filters.accountIds !== undefined && filters.accountIds.length > 0) {
          query = query.where('account_id', 'in', filters.accountIds);
        } else if (filters.accountIds !== undefined && filters.accountIds.length === 0) {
          return ok(0);
        }

        if (!filters.includeExcluded) {
          query = query.where('excluded_from_accounting', '=', false);
        }
      } else {
        // Default: exclude accounting-excluded transactions
        query = query.where('excluded_from_accounting', '=', false);
      }

      const result = await query.executeTakeFirst();
      return ok(result?.count ?? 0);
    } catch (error) {
      return wrapError(error, 'Failed to count transactions');
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

  async getLatestCreatedAt(): Promise<Result<Date | null, Error>> {
    try {
      const result = await this.db
        .selectFrom('transactions')
        .select(({ fn }) => [fn.max<string>('created_at').as('latest')])
        .executeTakeFirst();

      if (!result?.latest) {
        return ok(null);
      }

      return ok(new Date(result.latest));
    } catch (error) {
      return wrapError(error, 'Failed to get latest transaction created_at');
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
    if (transaction.notes !== undefined) {
      const notesValidation = z.array(TransactionNoteSchema).safeParse(transaction.notes);
      if (!notesValidation.success) {
        return err(new Error(`Invalid notes: ${notesValidation.error.message}`));
      }
    }

    const inflows = transaction.movements.inflows ?? [];
    const outflows = transaction.movements.outflows ?? [];
    const fees = transaction.fees ?? [];

    const validationResult = validatePriceDataForPersistence(
      inflows,
      outflows,
      fees,
      `externalId ${transaction.externalId || '[generated]'}`
    );
    if (validationResult.isErr()) {
      return err(validationResult.error);
    }

    const notesJsonResult =
      transaction.notes && transaction.notes.length > 0 ? serializeToJson(transaction.notes) : ok(undefined);
    if (notesJsonResult.isErr()) {
      return err(notesJsonResult.error);
    }

    return ok({
      created_at: createdAt ?? new Date().toISOString(),
      external_id: transaction.externalId || generateDeterministicTransactionHash(transaction),
      from_address: transaction.from ?? null,
      account_id: accountId,
      notes_json: notesJsonResult.value ?? null,
      is_spam: transaction.isSpam ?? false,
      excluded_from_accounting: transaction.excludedFromAccounting ?? transaction.isSpam ?? false,
      source_name: transaction.source,
      source_type: transaction.sourceType,
      to_address: transaction.to ?? null,
      transaction_datetime: transaction.datetime
        ? new Date(transaction.datetime).toISOString()
        : new Date().toISOString(),
      transaction_status: transaction.status,
      operation_category: transaction.operation?.category ?? null,
      operation_type: transaction.operation?.type ?? null,
      blockchain_name: transaction.blockchain?.name ?? null,
      blockchain_block_height: transaction.blockchain?.block_height ?? null,
      blockchain_transaction_hash: transaction.blockchain?.transaction_hash ?? null,
      blockchain_is_confirmed: transaction.blockchain?.is_confirmed ?? null,
    });
  }

  private async loadMovementsForTransactions(
    transactionIds: number[]
  ): Promise<Result<Map<number, MovementRow[]>, Error>> {
    if (transactionIds.length === 0) {
      return ok(new Map());
    }

    try {
      const rows = await this.db
        .selectFrom('transaction_movements')
        .selectAll()
        .where('transaction_id', 'in', transactionIds)
        .orderBy('transaction_id', 'asc')
        .orderBy('position', 'asc')
        .execute();

      const map = new Map<number, MovementRow[]>();
      for (const row of rows) {
        const existing = map.get(row.transaction_id);
        if (existing) {
          existing.push(row);
        } else {
          map.set(row.transaction_id, [row]);
        }
      }

      return ok(map);
    } catch (error) {
      return wrapError(error, 'Failed to load movements for transactions');
    }
  }

  private toTransactionSummary(row: Selectable<TransactionsTable>): TransactionSummary {
    const datetime = row.transaction_datetime;
    const timestamp = new Date(datetime).getTime();
    const status: TransactionStatus = row.transaction_status;

    const summary: TransactionSummary = {
      id: row.id,
      accountId: row.account_id,
      externalId: row.external_id ?? `${row.source_name}-${row.id}`,
      datetime,
      timestamp,
      source: row.source_name,
      sourceType: row.source_type,
      status,
      from: row.from_address ?? undefined,
      to: row.to_address ?? undefined,
      operation: {
        category: row.operation_category ?? 'transfer',
        type: row.operation_type ?? 'transfer',
      },
      isSpam: row.is_spam ? true : undefined,
      excludedFromAccounting: row.excluded_from_accounting ? true : undefined,
    };

    if (row.blockchain_name) {
      summary.blockchain = {
        name: row.blockchain_name,
        transaction_hash: row.blockchain_transaction_hash ?? '',
      };
    }

    return summary;
  }

  private toUniversalTransaction(
    row: Selectable<TransactionsTable>,
    movementRows: MovementRow[]
  ): Result<UniversalTransactionData, Error> {
    const datetime = row.transaction_datetime;
    const timestamp = new Date(datetime).getTime();

    const inflowRows = movementRows.filter((r) => r.movement_type === 'inflow');
    const outflowRows = movementRows.filter((r) => r.movement_type === 'outflow');
    const feeRows = movementRows.filter((r) => r.movement_type === 'fee');

    const inflows: AssetMovement[] = [];
    for (const r of inflowRows) {
      const result = rowToAssetMovement(r);
      if (result.isErr()) {
        this.logger.warn({ error: result.error, movementId: r.id, transactionId: row.id }, 'Failed to parse inflow');
        return err(new Error(`Transaction ${row.id} inflow parse failed (movement ${r.id}): ${result.error.message}`));
      }
      inflows.push(result.value);
    }

    const outflows: AssetMovement[] = [];
    for (const r of outflowRows) {
      const result = rowToAssetMovement(r);
      if (result.isErr()) {
        this.logger.warn({ error: result.error, movementId: r.id, transactionId: row.id }, 'Failed to parse outflow');
        return err(new Error(`Transaction ${row.id} outflow parse failed (movement ${r.id}): ${result.error.message}`));
      }
      outflows.push(result.value);
    }

    const fees: FeeMovement[] = [];
    for (const r of feeRows) {
      const result = rowToFeeMovement(r);
      if (result.isErr()) {
        this.logger.warn({ error: result.error, movementId: r.id, transactionId: row.id }, 'Failed to parse fee');
        return err(new Error(`Transaction ${row.id} fee parse failed (movement ${r.id}): ${result.error.message}`));
      }
      fees.push(result.value);
    }

    const status: TransactionStatus = row.transaction_status;

    const transaction: UniversalTransactionData = {
      id: row.id,
      accountId: row.account_id,
      externalId: row.external_id ?? `${row.source_name}-${row.id}`,
      datetime,
      timestamp,
      source: row.source_name,
      sourceType: row.source_type,
      status,
      from: row.from_address ?? undefined,
      to: row.to_address ?? undefined,
      movements: {
        inflows: inflows.length > 0 ? inflows : [],
        outflows: outflows.length > 0 ? outflows : [],
      },
      fees: fees.length > 0 ? fees : [],
      operation: {
        category: row.operation_category ?? 'transfer',
        type: row.operation_type ?? 'transfer',
      },
      isSpam: row.is_spam ? true : undefined,
      excludedFromAccounting: row.excluded_from_accounting ? true : undefined,
    };

    if (row.blockchain_name) {
      transaction.blockchain = {
        name: row.blockchain_name,
        transaction_hash: row.blockchain_transaction_hash ?? '',
        is_confirmed: row.blockchain_is_confirmed ?? false,
        block_height: row.blockchain_block_height ?? undefined,
      };
    }

    if (row.notes_json) {
      const notesResult = parseWithSchema(row.notes_json, z.array(TransactionNoteSchema));
      if (notesResult.isErr()) {
        return err(notesResult.error);
      }
      transaction.notes = notesResult.value;
    }

    return ok(transaction);
  }
}

export function createTransactionQueries(db: KyselyDB) {
  return new TransactionQueriesRepository(db);
}

export type TransactionQueries = ReturnType<typeof createTransactionQueries>;
