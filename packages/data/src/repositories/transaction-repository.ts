/* eslint-disable unicorn/no-null -- Kysely queries require null for IS NULL checks */
import {
  AssetMovementDraftSchema,
  FeeMovementDraftSchema,
  AssetMovementSchema,
  FeeMovementSchema,
  TransactionNoteSchema,
  buildAssetMovementCanonicalMaterial,
  buildFeeMovementCanonicalMaterial,
  computeAccountFingerprint,
  type TransactionMaterializationScope,
  computeMovementFingerprint,
  type AssetMovementDraft,
  type FeeMovementDraft,
  type AssetMovement,
  type FeeMovement,
  type TransactionNote,
  type TransactionStatus,
  type Transaction,
  type TransactionDraft,
} from '@exitbook/core';
import { CurrencySchema, parseDecimal, wrapError } from '@exitbook/foundation';
import type { Result } from '@exitbook/foundation';
import { err, ok } from '@exitbook/foundation';
import type { Insertable, Selectable } from '@exitbook/sqlite';
import { z } from 'zod';

import type { TransactionMovementsTable, TransactionsTable } from '../database-schema.js';
import type { KyselyDB } from '../database.js';
import { parseWithSchema, serializeToJson, withControlledTransaction } from '../utils/db-utils.js';
import { chunkItems, SQLITE_SAFE_IN_BATCH_SIZE } from '../utils/sqlite-batching.js';
import { deriveTransactionFingerprint } from '../utils/transaction-id-utils.js';

import { BaseRepository } from './base-repository.js';

interface TransactionQueryParams {
  profileId?: number | undefined;
  platformKey?: string | undefined;
  since?: number | undefined;
  accountId?: number | undefined;
  accountIds?: number[] | undefined;
  includeExcluded?: boolean | undefined;
}

interface FullTransactionQueryParams extends TransactionQueryParams {
  projection?: 'full' | undefined;
}

interface SummaryTransactionQueryParams extends TransactionQueryParams {
  projection: 'summary';
}

interface MaterializeTransactionNoteOverridesParams extends TransactionMaterializationScope {
  notesByFingerprint: ReadonlyMap<string, string>;
}

interface TransactionSummary {
  id: number;
  accountId: number;
  txFingerprint: string;
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
const MATERIALIZED_OVERRIDE_STORE_USER_NOTE_TYPE = 'user_note';
const MATERIALIZED_OVERRIDE_STORE_USER_NOTE_SOURCE = 'override-store';
const MOVEMENT_LOOKUP_BATCH_SIZE = SQLITE_SAFE_IN_BATCH_SIZE;

function validatePriceDataForPersistence(
  inflows: AssetMovementDraft[],
  outflows: AssetMovementDraft[],
  fees: FeeMovementDraft[],
  context: string
): Result<void, Error> {
  const inflowsValidation = z.array(AssetMovementDraftSchema).safeParse(inflows);
  if (!inflowsValidation.success) {
    return err(new Error(`Invalid inflow movement data for ${context}: ${inflowsValidation.error.message}`));
  }

  const outflowsValidation = z.array(AssetMovementDraftSchema).safeParse(outflows);
  if (!outflowsValidation.success) {
    return err(new Error(`Invalid outflow movement data for ${context}: ${outflowsValidation.error.message}`));
  }

  const feesValidation = z.array(FeeMovementDraftSchema).safeParse(fees);
  if (!feesValidation.success) {
    return err(new Error(`Invalid fee data for ${context}: ${feesValidation.error.message}`));
  }

  return ok(undefined);
}

function assetMovementToRow(
  movement: AssetMovementDraft,
  transactionId: number,
  movementFingerprint: string,
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
    movement_type: movementType,
    movement_fingerprint: movementFingerprint,
    asset_id: movement.assetId,
    asset_symbol: movement.assetSymbol,
    gross_amount: movement.grossAmount.toFixed(),
    net_amount: (movement.netAmount ?? movement.grossAmount).toFixed(),
    fee_amount: null,
    fee_scope: null,
    fee_settlement: null,
    price_amount: movement.priceAtTxTime?.price.amount.toFixed() ?? null,
    price_currency: movement.priceAtTxTime?.price.currency ?? null,
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
  fee: FeeMovementDraft,
  transactionId: number,
  movementFingerprint: string
): Result<Insertable<TransactionMovementsTable>, Error> {
  const row: Insertable<TransactionMovementsTable> = {
    transaction_id: transactionId,
    movement_type: 'fee',
    movement_fingerprint: movementFingerprint,
    asset_id: fee.assetId,
    asset_symbol: fee.assetSymbol,
    gross_amount: null,
    net_amount: null,
    fee_amount: fee.amount.toFixed(),
    fee_scope: fee.scope,
    fee_settlement: fee.settlement,
    price_amount: fee.priceAtTxTime?.price.amount.toFixed() ?? null,
    price_currency: fee.priceAtTxTime?.price.currency ?? null,
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

interface BuildInsertValuesResult {
  insertValues: Insertable<TransactionsTable>;
  txFingerprint: string;
}

interface CanonicalMovementEntry<TMovement> {
  canonicalMaterial: string;
  duplicateOccurrence: number;
  movement: TMovement;
}

async function loadAccountFingerprint(db: KyselyDB, accountId: number): Promise<Result<string, Error>> {
  const account = await db
    .selectFrom('accounts')
    .leftJoin('profiles', 'profiles.id', 'accounts.profile_id')
    .select(['accounts.account_type', 'accounts.platform_key', 'accounts.identifier', 'profiles.profile_key'])
    .where('accounts.id', '=', accountId)
    .executeTakeFirst();

  if (!account) {
    return err(new Error(`Account ${accountId} not found`));
  }

  if (!account.profile_key) {
    return err(new Error(`Account ${accountId} is missing a stable profile key`));
  }

  return computeAccountFingerprint({
    profileKey: account.profile_key,
    accountType: account.account_type,
    platformKey: account.platform_key,
    identifier: account.identifier,
  });
}

async function resolveExistingTransactionConflict(
  db: KyselyDB,
  params: { blockchainTransactionHash: string | null; txFingerprint: string }
): Promise<Result<number, Error>> {
  const existingByFingerprint = await db
    .selectFrom('transactions')
    .select(['id', 'tx_fingerprint', 'blockchain_transaction_hash'])
    .where('tx_fingerprint', '=', params.txFingerprint)
    .executeTakeFirst();

  if (existingByFingerprint) {
    if (
      params.blockchainTransactionHash &&
      existingByFingerprint.blockchain_transaction_hash &&
      existingByFingerprint.blockchain_transaction_hash !== params.blockchainTransactionHash
    ) {
      return err(
        new Error(
          `Transaction identity conflict for fingerprint ${params.txFingerprint}: existing blockchain hash ` +
            `${existingByFingerprint.blockchain_transaction_hash} does not match incoming ` +
            `${params.blockchainTransactionHash}`
        )
      );
    }

    return ok(existingByFingerprint.id);
  }

  return err(new Error(`Transaction conflict: no existing row matches fingerprint ${params.txFingerprint}`));
}

/** Caller must have already validated price data via `validatePriceDataForPersistence` (done in `buildInsertValues`). */
function compareCanonicalMovementEntries<TMovement>(
  left: CanonicalMovementEntry<TMovement>,
  right: CanonicalMovementEntry<TMovement>
): number {
  return (
    left.canonicalMaterial.localeCompare(right.canonicalMaterial) ||
    left.duplicateOccurrence - right.duplicateOccurrence
  );
}

function buildCanonicalMovementEntries<TMovement>(
  movements: readonly TMovement[],
  canonicalMaterialBuilder: (movement: TMovement) => string
): CanonicalMovementEntry<TMovement>[] {
  const duplicateCounts = new Map<string, number>();
  const entries = movements.map((movement) => {
    const canonicalMaterial = canonicalMaterialBuilder(movement);
    const duplicateOccurrence = (duplicateCounts.get(canonicalMaterial) ?? 0) + 1;
    duplicateCounts.set(canonicalMaterial, duplicateOccurrence);

    return {
      canonicalMaterial,
      duplicateOccurrence,
      movement,
    };
  });

  return entries.sort(compareCanonicalMovementEntries);
}

function buildMovementRows(
  transaction: TransactionDraft,
  transactionId: number,
  txFingerprint: string
): Result<Insertable<TransactionMovementsTable>[], Error> {
  const inflows = transaction.movements.inflows ?? [];
  const outflows = transaction.movements.outflows ?? [];
  const fees = transaction.fees ?? [];

  const rows: Insertable<TransactionMovementsTable>[] = [];

  const inflowEntries = buildCanonicalMovementEntries(inflows, (movement) =>
    buildAssetMovementCanonicalMaterial({
      movementType: 'inflow',
      assetId: movement.assetId,
      grossAmount: movement.grossAmount,
      netAmount: movement.netAmount,
    })
  );
  for (const inflowEntry of inflowEntries) {
    const movementFingerprintResult = computeMovementFingerprint({
      txFingerprint,
      canonicalMaterial: inflowEntry.canonicalMaterial,
      duplicateOccurrence: inflowEntry.duplicateOccurrence,
    });
    if (movementFingerprintResult.isErr()) {
      return err(movementFingerprintResult.error);
    }

    const result = assetMovementToRow(inflowEntry.movement, transactionId, movementFingerprintResult.value, 'inflow');
    if (result.isErr()) return err(result.error);
    rows.push(result.value);
  }

  const outflowEntries = buildCanonicalMovementEntries(outflows, (movement) =>
    buildAssetMovementCanonicalMaterial({
      movementType: 'outflow',
      assetId: movement.assetId,
      grossAmount: movement.grossAmount,
      netAmount: movement.netAmount,
    })
  );
  for (const outflowEntry of outflowEntries) {
    const movementFingerprintResult = computeMovementFingerprint({
      txFingerprint,
      canonicalMaterial: outflowEntry.canonicalMaterial,
      duplicateOccurrence: outflowEntry.duplicateOccurrence,
    });
    if (movementFingerprintResult.isErr()) {
      return err(movementFingerprintResult.error);
    }

    const result = assetMovementToRow(outflowEntry.movement, transactionId, movementFingerprintResult.value, 'outflow');
    if (result.isErr()) return err(result.error);
    rows.push(result.value);
  }

  const feeEntries = buildCanonicalMovementEntries(fees, (fee) =>
    buildFeeMovementCanonicalMaterial({
      assetId: fee.assetId,
      amount: fee.amount,
      scope: fee.scope,
      settlement: fee.settlement,
    })
  );
  for (const feeEntry of feeEntries) {
    const movementFingerprintResult = computeMovementFingerprint({
      txFingerprint,
      canonicalMaterial: feeEntry.canonicalMaterial,
      duplicateOccurrence: feeEntry.duplicateOccurrence,
    });
    if (movementFingerprintResult.isErr()) {
      return err(movementFingerprintResult.error);
    }

    const result = feeMovementToRow(feeEntry.movement, transactionId, movementFingerprintResult.value);
    if (result.isErr()) return err(result.error);
    rows.push(result.value);
  }

  return ok(rows);
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

function buildInsertValues(
  transaction: TransactionDraft,
  accountFingerprint: string,
  accountId: number,
  createdAt?: string
): Result<BuildInsertValuesResult, Error> {
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
    `transaction ${transaction.source} at ${transaction.datetime}`
  );
  if (validationResult.isErr()) {
    return err(validationResult.error);
  }

  const notesJsonResult =
    transaction.notes && transaction.notes.length > 0 ? serializeToJson(transaction.notes) : ok(undefined);
  if (notesJsonResult.isErr()) {
    return err(notesJsonResult.error);
  }

  const txFingerprintResult = deriveTransactionFingerprint(transaction, accountFingerprint);
  if (txFingerprintResult.isErr()) {
    return err(txFingerprintResult.error);
  }
  const txFingerprint = txFingerprintResult.value;

  return ok({
    insertValues: {
      created_at: createdAt ?? new Date().toISOString(),
      tx_fingerprint: txFingerprint,
      from_address: transaction.from ?? null,
      account_id: accountId,
      notes_json: notesJsonResult.value ?? null,
      is_spam: transaction.isSpam ?? false,
      excluded_from_accounting: transaction.excludedFromAccounting ?? false,
      platform_key: transaction.source,
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
    },
    txFingerprint,
  });
}

function toTransactionSummary(row: Selectable<TransactionsTable>): TransactionSummary {
  const datetime = row.transaction_datetime;
  const timestamp = new Date(datetime).getTime();
  const status: TransactionStatus = row.transaction_status;

  const summary: TransactionSummary = {
    id: row.id,
    accountId: row.account_id,
    txFingerprint: row.tx_fingerprint,
    datetime,
    timestamp,
    source: row.platform_key,
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
    const accountFingerprintResult = await loadAccountFingerprint(this.db, accountId);
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
          blockchainTransactionHash: values.blockchain_transaction_hash ?? null,
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
    const accountFingerprintResult = await loadAccountFingerprint(this.db, accountId);
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
            blockchainTransactionHash: values.blockchain_transaction_hash ?? null,
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

  findAll(filters: SummaryTransactionQueryParams): Promise<Result<TransactionSummary[], Error>>;
  findAll(filters?: FullTransactionQueryParams): Promise<Result<Transaction[], Error>>;
  async findAll(
    filters?: FullTransactionQueryParams | SummaryTransactionQueryParams
  ): Promise<Result<Transaction[] | TransactionSummary[], Error>> {
    try {
      const projection = filters?.projection ?? 'full';

      let query = this.db
        .selectFrom('transactions')
        .innerJoin('accounts', 'accounts.id', 'transactions.account_id')
        .selectAll('transactions');

      if (filters) {
        if (filters.profileId !== undefined) {
          query = query.where('accounts.profile_id', '=', filters.profileId);
        }

        if (filters.platformKey) {
          query = query.where('transactions.platform_key', '=', filters.platformKey);
        }

        if (filters.since) {
          const sinceDate = new Date(filters.since * 1000).toISOString();
          query = query.where('transactions.created_at', '>=', sinceDate as unknown as string);
        }

        if (filters.accountId !== undefined) {
          query = query.where('transactions.account_id', '=', filters.accountId);
        } else if (filters.accountIds !== undefined && filters.accountIds.length > 0) {
          query = query.where('transactions.account_id', 'in', filters.accountIds);
        }
      }

      if (!filters?.includeExcluded) {
        query = query.where('transactions.excluded_from_accounting', '=', false);
      }

      query = query.orderBy('transactions.transaction_datetime', 'asc');

      let rows: Selectable<TransactionsTable>[] = [];
      if (
        filters?.accountId === undefined &&
        filters?.accountIds !== undefined &&
        filters.accountIds.length > SQLITE_SAFE_IN_BATCH_SIZE
      ) {
        for (const accountIdBatch of chunkItems(filters.accountIds, SQLITE_SAFE_IN_BATCH_SIZE)) {
          let batchedQuery = this.db
            .selectFrom('transactions')
            .innerJoin('accounts', 'accounts.id', 'transactions.account_id')
            .selectAll('transactions');

          if (filters.profileId !== undefined) {
            batchedQuery = batchedQuery.where('accounts.profile_id', '=', filters.profileId);
          }

          if (filters.platformKey) {
            batchedQuery = batchedQuery.where('transactions.platform_key', '=', filters.platformKey);
          }

          if (filters.since) {
            const sinceDate = new Date(filters.since * 1000).toISOString();
            batchedQuery = batchedQuery.where('transactions.created_at', '>=', sinceDate as unknown as string);
          }

          batchedQuery = batchedQuery.where('transactions.account_id', 'in', accountIdBatch);

          if (!filters.includeExcluded) {
            batchedQuery = batchedQuery.where('transactions.excluded_from_accounting', '=', false);
          }

          rows.push(...(await batchedQuery.orderBy('transactions.transaction_datetime', 'asc').execute()));
        }
        rows.sort((left, right) => left.transaction_datetime.localeCompare(right.transaction_datetime));
      } else {
        rows = await query.execute();
      }

      if (projection === 'summary') {
        const summaries: TransactionSummary[] = [];
        for (const row of rows) {
          summaries.push(toTransactionSummary(row));
        }
        return ok(summaries);
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
        const result = this.toTransaction(row, movementRows);
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

      const result = this.toTransaction(row, movementRows);
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
        const result = this.toTransaction(row, movementRows);
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
    if (params.accountIds !== undefined && params.accountIds.length === 0) {
      return ok(0);
    }

    if (params.transactionIds !== undefined && params.transactionIds.length === 0) {
      return ok(0);
    }

    return withControlledTransaction(
      this.db,
      this.logger,
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

          const notesJsonResult = nextNotes ? serializeToJson(nextNotes) : ok(undefined);
          if (notesJsonResult.isErr()) {
            return err(
              new Error(`Failed to serialize notes for transaction ${row.id}: ${notesJsonResult.error.message}`)
            );
          }

          await trx
            .updateTable('transactions')
            .set({
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

  async count(filters?: TransactionQueryParams): Promise<Result<number, Error>> {
    try {
      let query = this.db
        .selectFrom('transactions')
        .innerJoin('accounts', 'accounts.id', 'transactions.account_id')
        .select(({ fn }) => [fn.count<number>('transactions.id').as('count')]);

      if (filters) {
        if (filters.profileId !== undefined) {
          query = query.where('accounts.profile_id', '=', filters.profileId);
        }

        if (filters.platformKey) {
          query = query.where('transactions.platform_key', '=', filters.platformKey);
        }

        if (filters.since) {
          const sinceDate = new Date(filters.since * 1000).toISOString();
          query = query.where('transactions.created_at', '>=', sinceDate as unknown as string);
        }

        if (filters.accountId !== undefined) {
          query = query.where('transactions.account_id', '=', filters.accountId);
        } else if (filters.accountIds !== undefined && filters.accountIds.length > 0) {
          if (filters.accountIds.length > SQLITE_SAFE_IN_BATCH_SIZE) {
            let totalCount = 0;
            for (const accountIdBatch of chunkItems(filters.accountIds, SQLITE_SAFE_IN_BATCH_SIZE)) {
              let batchedQuery = this.db
                .selectFrom('transactions')
                .innerJoin('accounts', 'accounts.id', 'transactions.account_id')
                .select(({ fn }) => [fn.count<number>('transactions.id').as('count')]);

              if (filters.profileId !== undefined) {
                batchedQuery = batchedQuery.where('accounts.profile_id', '=', filters.profileId);
              }

              if (filters.platformKey) {
                batchedQuery = batchedQuery.where('transactions.platform_key', '=', filters.platformKey);
              }

              if (filters.since) {
                const sinceDate = new Date(filters.since * 1000).toISOString();
                batchedQuery = batchedQuery.where('transactions.created_at', '>=', sinceDate as unknown as string);
              }

              batchedQuery = batchedQuery.where('transactions.account_id', 'in', accountIdBatch);

              if (!filters.includeExcluded) {
                batchedQuery = batchedQuery.where('transactions.excluded_from_accounting', '=', false);
              }

              const result = await batchedQuery.executeTakeFirst();
              totalCount += result?.count ?? 0;
            }

            return ok(totalCount);
          }

          query = query.where('transactions.account_id', 'in', filters.accountIds);
        } else if (filters.accountIds !== undefined && filters.accountIds.length === 0) {
          return ok(0);
        }

        if (!filters.includeExcluded) {
          query = query.where('transactions.excluded_from_accounting', '=', false);
        }
      } else {
        query = query.where('transactions.excluded_from_accounting', '=', false);
      }

      const result = await query.executeTakeFirst();
      return ok(result?.count ?? 0);
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

  private toTransaction(row: Selectable<TransactionsTable>, movementRows: MovementRow[]): Result<Transaction, Error> {
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

    const inflowRows = inflowRowsResult.value;
    const outflowRows = outflowRowsResult.value;
    const feeRows = feeRowsResult.value;

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

    const transaction: Transaction = {
      id: row.id,
      accountId: row.account_id,
      txFingerprint: row.tx_fingerprint,
      datetime,
      timestamp,
      source: row.platform_key,
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
      const notesResult = parseStoredNotes(row.notes_json as string | null);
      if (notesResult.isErr()) {
        return err(notesResult.error);
      }
      transaction.notes = notesResult.value;
    }

    return ok(transaction);
  }
}
