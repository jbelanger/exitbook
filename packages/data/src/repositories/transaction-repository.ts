/* eslint-disable unicorn/no-null -- repository contracts preserve nullable persistence semantics */
import { type Transaction, type TransactionDraft } from '@exitbook/core';
import { wrapError } from '@exitbook/foundation';
import type { Result } from '@exitbook/foundation';
import { err, ok } from '@exitbook/foundation';

import type { KyselyDB } from '../database.js';
import { chunkItems, SQLITE_SAFE_IN_BATCH_SIZE } from '../utils/sqlite-batching.js';

import { loadValidatedAccountFingerprint } from './account-identity-support.js';
import { BaseRepository } from './base-repository.js';
import {
  materializeTransactionNoteOverrides,
  type MaterializeTransactionNoteOverridesParams,
  rowToTransaction,
  type MovementRow,
} from './transaction-materialization-support.js';
import {
  buildInsertValues,
  buildMovementRows,
  resolveExistingTransactionConflict,
  validatePriceDataForPersistence,
} from './transaction-persistence-support.js';
import { countTransactionRows, findTransactionRows, type TransactionQueryParams } from './transaction-query-support.js';

const MOVEMENT_LOOKUP_BATCH_SIZE = SQLITE_SAFE_IN_BATCH_SIZE;

export class TransactionRepository extends BaseRepository {
  constructor(db: KyselyDB) {
    super(db, 'transaction-repository');
  }

  /**
   * Save a single transaction with its movements.
   * Transaction-agnostic: executes directly on this.db.
   * Callers that need atomicity should use DataSession.executeInTransaction().
   */
  async create(transaction: TransactionDraft, accountId: number): Promise<Result<number, Error>> {
    const accountFingerprintResult = await loadValidatedAccountFingerprint(this.db, accountId);
    if (accountFingerprintResult.isErr()) {
      return err(accountFingerprintResult.error);
    }

    const valuesResult = buildInsertValues(transaction, accountFingerprintResult.value, accountId);
    if (valuesResult.isErr()) {
      return err(valuesResult.error);
    }

    const { insertValues: values, txFingerprint } = valuesResult.value;

    try {
      const txResult = await this.db
        .insertInto('transactions')
        .values(values)
        .onConflict((oc) => oc.doNothing())
        .returning('id')
        .executeTakeFirst();

      if (!txResult) {
        const existingResult = await resolveExistingTransactionConflict(this.db, {
          blockchainTransactionHash:
            values.blockchain_transaction_hash === undefined ? null : values.blockchain_transaction_hash,
          txFingerprint,
        });
        if (existingResult.isErr()) {
          return err(existingResult.error);
        }

        return ok(existingResult.value);
      }

      const transactionId = txResult.id;

      const movementRowsResult = buildMovementRows(transaction, transactionId, txFingerprint);
      if (movementRowsResult.isErr()) {
        return err(movementRowsResult.error);
      }

      const movementRows = movementRowsResult.value;
      if (movementRows.length > 0) {
        await this.db.insertInto('transaction_movements').values(movementRows).execute();
      }

      return ok(transactionId);
    } catch (error) {
      return wrapError(error, 'Failed to save transaction');
    }
  }

  /**
   * Save a batch of transactions with their movements.
   * Transaction-agnostic: executes directly on this.db.
   * Callers that need atomicity should use DataSession.executeInTransaction().
   */
  async createBatch(
    transactions: TransactionDraft[],
    accountId: number
  ): Promise<Result<{ duplicates: number; saved: number }, Error>> {
    if (transactions.length === 0) {
      return ok({ saved: 0, duplicates: 0 });
    }

    const createdAt = new Date().toISOString();
    const accountFingerprintResult = await loadValidatedAccountFingerprint(this.db, accountId);
    if (accountFingerprintResult.isErr()) {
      return err(accountFingerprintResult.error);
    }

    try {
      let saved = 0;
      let duplicates = 0;

      for (const [index, transaction] of transactions.entries()) {
        const valuesResult = buildInsertValues(transaction, accountFingerprintResult.value, accountId, createdAt);
        if (valuesResult.isErr()) {
          return err(new Error(`Transaction index-${index}: ${valuesResult.error.message}`));
        }
        const { insertValues: values, txFingerprint } = valuesResult.value;

        const txResult = await this.db
          .insertInto('transactions')
          .values(values)
          .onConflict((oc) => oc.doNothing())
          .returning('id')
          .executeTakeFirst();

        let transactionId: number;
        let isDuplicate = false;

        if (!txResult) {
          const existingResult = await resolveExistingTransactionConflict(this.db, {
            blockchainTransactionHash:
              values.blockchain_transaction_hash === undefined ? null : values.blockchain_transaction_hash,
            txFingerprint,
          });
          if (existingResult.isErr()) {
            return err(existingResult.error);
          }

          transactionId = existingResult.value;
          isDuplicate = true;
          duplicates++;
        } else {
          transactionId = txResult.id;
        }

        if (!isDuplicate) {
          const movementRowsResult = buildMovementRows(transaction, transactionId, txFingerprint);
          if (movementRowsResult.isErr()) {
            return err(movementRowsResult.error);
          }

          const movementRows = movementRowsResult.value;
          if (movementRows.length > 0) {
            await this.db.insertInto('transaction_movements').values(movementRows).execute();
          }
        }

        if (!isDuplicate) {
          saved++;
        }
      }

      return ok({ saved, duplicates });
    } catch (error) {
      return wrapError(error, 'Failed to save transaction batch');
    }
  }

  async findAll(filters?: TransactionQueryParams): Promise<Result<Transaction[], Error>> {
    try {
      const rows = await findTransactionRows(this.db, filters ?? {});

      const transactionIds = rows.map((r) => r.id);
      const movementsMapResult = await this.findMovementsForIds(transactionIds);
      if (movementsMapResult.isErr()) {
        return err(movementsMapResult.error);
      }
      const movementsMap = movementsMapResult.value;

      const transactions: Transaction[] = [];
      for (const row of rows) {
        const movementRows = movementsMap.get(row.id) ?? [];
        const result = rowToTransaction(row, movementRows, this.logger);
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

  async findById(id: number, profileId?: number): Promise<Result<Transaction | undefined, Error>> {
    try {
      let query = this.db
        .selectFrom('transactions')
        .innerJoin('accounts', 'accounts.id', 'transactions.account_id')
        .selectAll('transactions')
        .where('transactions.id', '=', id);

      if (profileId !== undefined) {
        query = query.where('accounts.profile_id', '=', profileId);
      }

      const row = await query.executeTakeFirst();

      if (!row) {
        return ok(undefined);
      }

      const movementsResult = await this.findMovementsForIds([id]);
      if (movementsResult.isErr()) {
        return err(movementsResult.error);
      }
      const movementRows = movementsResult.value.get(id) ?? [];

      const result = rowToTransaction(row, movementRows, this.logger);
      if (result.isErr()) {
        return err(result.error);
      }

      return ok(result.value);
    } catch (error) {
      return wrapError(error, 'Failed to retrieve transaction by ID');
    }
  }

  async findNeedingPrices(assetFilter?: string[], profileId?: number): Promise<Result<Transaction[], Error>> {
    try {
      let query = this.db
        .selectFrom('transactions')
        .innerJoin('accounts', 'accounts.id', 'transactions.account_id')
        .selectAll('transactions')
        .where('transactions.excluded_from_accounting', '=', false);

      if (profileId !== undefined) {
        query = query.where('accounts.profile_id', '=', profileId);
      }

      const rows = await query.execute();

      if (rows.length === 0) {
        return ok([]);
      }

      const transactionIds = rows.map((r) => r.id);
      const movementsMapResult = await this.findMovementsForIds(transactionIds);
      if (movementsMapResult.isErr()) {
        return err(movementsMapResult.error);
      }
      const movementsMap = movementsMapResult.value;

      const transactions: Transaction[] = [];
      for (const row of rows) {
        const movementRows = movementsMap.get(row.id) ?? [];
        const result = rowToTransaction(row, movementRows, this.logger);
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

  /**
   * Update movements with enriched price data.
   * Transaction-agnostic: executes directly on this.db.
   * Callers that need atomicity should use DataSession.executeInTransaction().
   */
  async updateMovementsWithPrices(transaction: Transaction): Promise<Result<void, Error>> {
    const validationResult = validatePriceDataForPersistence(
      transaction.movements.inflows ?? [],
      transaction.movements.outflows ?? [],
      transaction.fees ?? [],
      `transaction ${transaction.id}`
    );
    if (validationResult.isErr()) {
      return err(validationResult.error);
    }

    try {
      const txExists = await this.db
        .selectFrom('transactions')
        .select(['id', 'tx_fingerprint'])
        .where('id', '=', transaction.id)
        .executeTakeFirst();

      if (!txExists) {
        return err(new Error(`Transaction ${transaction.id} not found`));
      }

      await this.db.deleteFrom('transaction_movements').where('transaction_id', '=', transaction.id).execute();

      const transactionForMovementRebuild = {
        ...transaction,
        id: undefined,
        accountId: undefined,
      } as Omit<Transaction, 'id' | 'accountId'>;

      const movementRowsResult = buildMovementRows(
        transactionForMovementRebuild,
        transaction.id,
        txExists.tx_fingerprint
      );
      if (movementRowsResult.isErr()) {
        return err(movementRowsResult.error);
      }

      const movementRows = movementRowsResult.value;
      if (movementRows.length > 0) {
        await this.db.insertInto('transaction_movements').values(movementRows).execute();
      }

      await this.db
        .updateTable('transactions')
        .set({ updated_at: new Date().toISOString() })
        .where('id', '=', transaction.id)
        .execute();

      return ok(undefined);
    } catch (error) {
      return wrapError(error, 'Failed to update movements with prices');
    }
  }

  async materializeTransactionNoteOverrides(
    params: MaterializeTransactionNoteOverridesParams
  ): Promise<Result<number, Error>> {
    return materializeTransactionNoteOverrides(this.db, this.logger, params);
  }

  async count(filters?: TransactionQueryParams): Promise<Result<number, Error>> {
    try {
      return ok(await countTransactionRows(this.db, filters ?? {}));
    } catch (error) {
      return wrapError(error, 'Failed to count transactions');
    }
  }

  async deleteByAccountIds(accountIds: number[]): Promise<Result<number, Error>> {
    try {
      if (accountIds.length === 0) {
        return ok(0);
      }
      let deletedCount = 0;
      for (const accountIdBatch of chunkItems(accountIds, SQLITE_SAFE_IN_BATCH_SIZE)) {
        const result = await this.db
          .deleteFrom('transactions')
          .where('account_id', 'in', accountIdBatch)
          .executeTakeFirst();
        deletedCount += Number(result.numDeletedRows);
      }
      return ok(deletedCount);
    } catch (error) {
      return wrapError(error, 'Failed to delete transactions by account IDs');
    }
  }

  async findLatestCreatedAt(profileId?: number): Promise<Result<Date | null, Error>> {
    try {
      let query = this.db
        .selectFrom('transactions')
        .innerJoin('accounts', 'accounts.id', 'transactions.account_id')
        .select(({ fn }) => [fn.max<string>('transactions.created_at').as('latest')]);

      if (profileId !== undefined) {
        query = query.where('accounts.profile_id', '=', profileId);
      }

      const result = await query.executeTakeFirst();

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

  private async findMovementsForIds(transactionIds: number[]): Promise<Result<Map<number, MovementRow[]>, Error>> {
    if (transactionIds.length === 0) {
      return ok(new Map());
    }

    try {
      const map = new Map<number, MovementRow[]>();

      for (const transactionIdBatch of chunkItems(transactionIds, MOVEMENT_LOOKUP_BATCH_SIZE)) {
        const rows = await this.db
          .selectFrom('transaction_movements')
          .selectAll()
          .where('transaction_id', 'in', transactionIdBatch)
          .orderBy('transaction_id', 'asc')
          .execute();

        for (const row of rows) {
          const existing = map.get(row.transaction_id);
          if (existing) {
            existing.push(row);
          } else {
            map.set(row.transaction_id, [row]);
          }
        }
      }

      return ok(map);
    } catch (error) {
      return wrapError(error, 'Failed to load movements for transactions');
    }
  }
}
