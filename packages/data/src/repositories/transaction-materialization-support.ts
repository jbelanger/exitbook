import {
  AssetMovementSchema,
  FeeMovementSchema,
  TransactionNoteSchema,
  buildAssetMovementCanonicalMaterial,
  buildFeeMovementCanonicalMaterial,
  type AssetMovement,
  type FeeMovement,
  type Transaction,
  type TransactionMaterializationScope,
  type TransactionNote,
} from '@exitbook/core';
import { CurrencySchema, parseDecimal } from '@exitbook/foundation';
import type { Result } from '@exitbook/foundation';
import { err, ok } from '@exitbook/foundation';
import type { Logger } from '@exitbook/logger';
import type { Selectable } from '@exitbook/sqlite';
import { z } from 'zod';

import type { TransactionMovementsTable, TransactionsTable } from '../database-schema.js';
import type { KyselyDB } from '../database.js';
import { withControlledTransaction } from '../utils/controlled-transaction.js';
import { parseWithSchema, serializeToJson } from '../utils/json-column-codec.js';
import { chunkItems, SQLITE_SAFE_IN_BATCH_SIZE } from '../utils/sqlite-batching.js';

export type MovementRow = Selectable<TransactionMovementsTable>;

interface WarningLogger {
  warn(context: unknown, message: string): void;
}

export interface MaterializeTransactionNoteOverridesParams extends TransactionMaterializationScope {
  notesByFingerprint: ReadonlyMap<string, string>;
}

const MATERIALIZED_OVERRIDE_STORE_USER_NOTE_TYPE = 'user_note';
const MATERIALIZED_OVERRIDE_STORE_USER_NOTE_SOURCE = 'override-store';

function normalizeSqliteBoolean(value: boolean | number | null | undefined): boolean {
  if (typeof value === 'boolean') {
    return value;
  }

  return value === 1;
}

function parseStoredNotes(notesJson: string | null): Result<TransactionNote[] | undefined, Error> {
  if (!notesJson) {
    return ok(undefined);
  }

  return parseWithSchema(notesJson, z.array(TransactionNoteSchema));
}

function isMaterializedOverrideStoreUserNote(note: TransactionNote): boolean {
  return (
    note.type === MATERIALIZED_OVERRIDE_STORE_USER_NOTE_TYPE &&
    note.metadata?.['source'] === MATERIALIZED_OVERRIDE_STORE_USER_NOTE_SOURCE
  );
}

function projectOverrideStoreUserNote(
  existingNotes: TransactionNote[] | undefined,
  overrideNote: string | undefined
): TransactionNote[] | undefined {
  const preservedNotes = (existingNotes ?? []).filter((note) => !isMaterializedOverrideStoreUserNote(note));

  if (!overrideNote) {
    return preservedNotes.length > 0 ? preservedNotes : undefined;
  }

  return [
    ...preservedNotes,
    {
      type: MATERIALIZED_OVERRIDE_STORE_USER_NOTE_TYPE,
      message: overrideNote,
      metadata: {
        actor: 'user',
        source: MATERIALIZED_OVERRIDE_STORE_USER_NOTE_SOURCE,
      },
    } satisfies TransactionNote,
  ];
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
    assetSymbol: CurrencySchema.parse(row.asset_symbol),
    movementFingerprint: row.movement_fingerprint,
    grossAmount: parseDecimal(row.gross_amount),
    netAmount: row.net_amount ? parseDecimal(row.net_amount) : parseDecimal(row.gross_amount),
  };

  if (row.price_amount && row.price_currency && row.price_source && row.price_fetched_at) {
    movement.priceAtTxTime = {
      price: {
        amount: parseDecimal(row.price_amount),
        currency: CurrencySchema.parse(row.price_currency),
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
    assetSymbol: CurrencySchema.parse(row.asset_symbol),
    movementFingerprint: row.movement_fingerprint,
    amount: parseDecimal(row.fee_amount),
    scope: row.fee_scope,
    settlement: row.fee_settlement,
  };

  if (row.price_amount && row.price_currency && row.price_source && row.price_fetched_at) {
    fee.priceAtTxTime = {
      price: {
        amount: parseDecimal(row.price_amount),
        currency: CurrencySchema.parse(row.price_currency),
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

function parseDuplicateOccurrenceFromMovementFingerprint(movementFingerprint: string): Result<number, Error> {
  const lastColonIndex = movementFingerprint.lastIndexOf(':');
  if (lastColonIndex === -1) {
    return err(new Error(`Invalid movement fingerprint format: ${movementFingerprint}`));
  }

  const occurrenceText = movementFingerprint.slice(lastColonIndex + 1);
  const duplicateOccurrence = Number.parseInt(occurrenceText, 10);
  if (!Number.isInteger(duplicateOccurrence) || duplicateOccurrence <= 0) {
    return err(new Error(`Invalid movement duplicate occurrence in fingerprint: ${movementFingerprint}`));
  }

  return ok(duplicateOccurrence);
}

function buildMovementRowCanonicalMaterial(row: MovementRow): Result<string, Error> {
  if (row.movement_type === 'inflow' || row.movement_type === 'outflow') {
    if (!row.gross_amount) {
      return err(new Error(`Movement row ${row.id} missing gross_amount`));
    }

    return ok(
      buildAssetMovementCanonicalMaterial({
        movementType: row.movement_type,
        assetId: row.asset_id,
        grossAmount: parseDecimal(row.gross_amount),
        netAmount: row.net_amount ? parseDecimal(row.net_amount) : undefined,
      })
    );
  }

  if (!row.fee_amount || !row.fee_scope || !row.fee_settlement) {
    return err(new Error(`Fee row ${row.id} missing canonical identity fields`));
  }

  return ok(
    buildFeeMovementCanonicalMaterial({
      assetId: row.asset_id,
      amount: parseDecimal(row.fee_amount),
      scope: row.fee_scope,
      settlement: row.fee_settlement,
    })
  );
}

function sortMovementRowsByCanonicalIdentity(rows: MovementRow[]): Result<MovementRow[], Error> {
  const sortableRows: {
    canonicalMaterial: string;
    duplicateOccurrence: number;
    row: MovementRow;
  }[] = [];

  for (const row of rows) {
    const canonicalMaterialResult = buildMovementRowCanonicalMaterial(row);
    if (canonicalMaterialResult.isErr()) {
      return err(canonicalMaterialResult.error);
    }

    const duplicateOccurrenceResult = parseDuplicateOccurrenceFromMovementFingerprint(row.movement_fingerprint);
    if (duplicateOccurrenceResult.isErr()) {
      return err(duplicateOccurrenceResult.error);
    }

    sortableRows.push({
      canonicalMaterial: canonicalMaterialResult.value,
      duplicateOccurrence: duplicateOccurrenceResult.value,
      row,
    });
  }

  sortableRows.sort(
    (left, right) =>
      left.canonicalMaterial.localeCompare(right.canonicalMaterial) ||
      left.duplicateOccurrence - right.duplicateOccurrence ||
      left.row.id - right.row.id
  );

  return ok(sortableRows.map((entry) => entry.row));
}

export function rowToTransaction(
  row: Selectable<TransactionsTable>,
  movementRows: MovementRow[],
  logger: WarningLogger
): Result<Transaction, Error> {
  const datetime = row.transaction_datetime;
  const timestamp = new Date(datetime).getTime();

  const inflowRowsResult = sortMovementRowsByCanonicalIdentity(
    movementRows.filter((movementRow) => movementRow.movement_type === 'inflow')
  );
  if (inflowRowsResult.isErr()) {
    return err(new Error(`Transaction ${row.id} inflow ordering failed: ${inflowRowsResult.error.message}`));
  }

  const outflowRowsResult = sortMovementRowsByCanonicalIdentity(
    movementRows.filter((movementRow) => movementRow.movement_type === 'outflow')
  );
  if (outflowRowsResult.isErr()) {
    return err(new Error(`Transaction ${row.id} outflow ordering failed: ${outflowRowsResult.error.message}`));
  }

  const feeRowsResult = sortMovementRowsByCanonicalIdentity(
    movementRows.filter((movementRow) => movementRow.movement_type === 'fee')
  );
  if (feeRowsResult.isErr()) {
    return err(new Error(`Transaction ${row.id} fee ordering failed: ${feeRowsResult.error.message}`));
  }

  const inflows: AssetMovement[] = [];
  for (const movementRow of inflowRowsResult.value) {
    const result = rowToAssetMovement(movementRow);
    if (result.isErr()) {
      logger.warn({ error: result.error, movementId: movementRow.id, transactionId: row.id }, 'Failed to parse inflow');
      return err(
        new Error(`Transaction ${row.id} inflow parse failed (movement ${movementRow.id}): ${result.error.message}`)
      );
    }
    inflows.push(result.value);
  }

  const outflows: AssetMovement[] = [];
  for (const movementRow of outflowRowsResult.value) {
    const result = rowToAssetMovement(movementRow);
    if (result.isErr()) {
      logger.warn(
        { error: result.error, movementId: movementRow.id, transactionId: row.id },
        'Failed to parse outflow'
      );
      return err(
        new Error(`Transaction ${row.id} outflow parse failed (movement ${movementRow.id}): ${result.error.message}`)
      );
    }
    outflows.push(result.value);
  }

  const fees: FeeMovement[] = [];
  for (const movementRow of feeRowsResult.value) {
    const result = rowToFeeMovement(movementRow);
    if (result.isErr()) {
      logger.warn({ error: result.error, movementId: movementRow.id, transactionId: row.id }, 'Failed to parse fee');
      return err(
        new Error(`Transaction ${row.id} fee parse failed (movement ${movementRow.id}): ${result.error.message}`)
      );
    }
    fees.push(result.value);
  }

  const transaction: Transaction = {
    id: row.id,
    accountId: row.account_id,
    txFingerprint: row.tx_fingerprint,
    datetime,
    timestamp,
    platformKey: row.platform_key,
    platformKind: row.platform_kind,
    status: row.transaction_status,
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
      is_confirmed: normalizeSqliteBoolean(row.blockchain_is_confirmed as boolean | number | null | undefined),
      block_height: row.blockchain_block_height ?? undefined,
    };
  }

  if (row.notes_json) {
    const notesResult = parseStoredNotes(row.notes_json as string | null);
    if (notesResult.isErr()) {
      logger.warn({ error: notesResult.error, transactionId: row.id }, 'Failed to parse notes');
      return err(new Error(`Transaction ${row.id} notes parse failed: ${notesResult.error.message}`));
    }

    if (notesResult.value && notesResult.value.length > 0) {
      transaction.notes = notesResult.value;
    }
  }

  const validation = z
    .object({
      id: z.number(),
      accountId: z.number(),
      txFingerprint: z.string(),
      datetime: z.string(),
      timestamp: z.number(),
      platformKey: z.string(),
      platformKind: z.string(),
      status: z.string(),
      movements: z.object({
        inflows: z.array(AssetMovementSchema),
        outflows: z.array(AssetMovementSchema),
      }),
      fees: z.array(FeeMovementSchema),
      operation: z.object({
        category: z.string(),
        type: z.string(),
      }),
    })
    .safeParse(transaction);

  if (!validation.success) {
    return err(new Error(`Transaction ${row.id} failed schema validation: ${validation.error.message}`));
  }

  return ok(transaction);
}

function serializeMaterializedNotes(notes: TransactionNote[] | undefined): Result<string | undefined, Error> {
  return notes ? serializeToJson(notes) : ok(undefined);
}

export async function materializeTransactionNoteOverrides(
  db: KyselyDB,
  logger: Logger,
  params: MaterializeTransactionNoteOverridesParams
): Promise<Result<number, Error>> {
  if (params.accountIds !== undefined && params.accountIds.length === 0) {
    return ok(0);
  }

  if (params.transactionIds !== undefined && params.transactionIds.length === 0) {
    return ok(0);
  }

  return withControlledTransaction(
    db,
    logger,
    async (trx) => {
      const rowsById = new Map<number, { id: number; notes_json: unknown; tx_fingerprint: string }>();
      const batchedTransactionIds =
        params.transactionIds && params.transactionIds.length > SQLITE_SAFE_IN_BATCH_SIZE
          ? chunkItems(params.transactionIds, SQLITE_SAFE_IN_BATCH_SIZE)
          : [params.transactionIds];
      const batchedAccountIds =
        !params.transactionIds && params.accountIds && params.accountIds.length > SQLITE_SAFE_IN_BATCH_SIZE
          ? chunkItems(params.accountIds, SQLITE_SAFE_IN_BATCH_SIZE)
          : [params.accountIds];

      for (const transactionIdBatch of batchedTransactionIds) {
        for (const accountIdBatch of batchedAccountIds) {
          let batchedQuery = trx.selectFrom('transactions').select(['id', 'tx_fingerprint', 'notes_json']);

          if (accountIdBatch) {
            batchedQuery = batchedQuery.where('account_id', 'in', accountIdBatch);
          }

          if (transactionIdBatch) {
            batchedQuery = batchedQuery.where('id', 'in', transactionIdBatch);
          }

          const rows = await batchedQuery.execute();
          for (const row of rows) {
            rowsById.set(row.id, row);
          }
        }
      }

      const rows = [...rowsById.values()].sort((left, right) => left.id - right.id);
      let updatedCount = 0;

      for (const row of rows) {
        const existingNotesResult = parseStoredNotes(row.notes_json as string | null);
        if (existingNotesResult.isErr()) {
          return err(
            new Error(`Failed to parse notes for transaction ${row.id}: ${existingNotesResult.error.message}`)
          );
        }

        const nextNotes = projectOverrideStoreUserNote(
          existingNotesResult.value,
          params.notesByFingerprint.get(row.tx_fingerprint)
        );

        if (JSON.stringify(existingNotesResult.value ?? []) === JSON.stringify(nextNotes ?? [])) {
          continue;
        }

        const notesJsonResult = serializeMaterializedNotes(nextNotes);
        if (notesJsonResult.isErr()) {
          return err(
            new Error(`Failed to serialize notes for transaction ${row.id}: ${notesJsonResult.error.message}`)
          );
        }

        await trx
          .updateTable('transactions')
          .set({
            // eslint-disable-next-line unicorn/no-null -- clearing persisted JSON column requires null
            notes_json: notesJsonResult.value ?? null,
            updated_at: new Date().toISOString(),
          })
          .where('id', '=', row.id)
          .execute();

        updatedCount++;
      }

      return ok(updatedCount);
    },
    'Failed to materialize transaction note overrides'
  );
}
