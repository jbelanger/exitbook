/* eslint-disable unicorn/no-null -- Kysely insert payloads use null for nullable columns */
import {
  AssetMovementDraftSchema,
  FeeMovementDraftSchema,
  TransactionDiagnosticSchema,
  UserNoteSchema,
  buildAssetMovementCanonicalMaterial,
  buildFeeMovementCanonicalMaterial,
  computeMovementFingerprint,
  type AssetMovementDraft,
  type FeeMovementDraft,
  type TransactionDraft,
} from '@exitbook/core';
import type { Result } from '@exitbook/foundation';
import { err, ok } from '@exitbook/foundation';
import type { Insertable } from '@exitbook/sqlite';
import { z } from 'zod';

import type { TransactionMovementsTable, TransactionsTable } from '../database-schema.js';
import type { KyselyDB } from '../database.js';
import { serializeToJson } from '../utils/json-column-codec.js';
import { deriveTransactionFingerprint } from '../utils/transaction-id-utils.js';

interface BuildInsertValuesResult {
  insertValues: Insertable<TransactionsTable>;
  txFingerprint: string;
}

interface CanonicalMovementEntry<TMovement> {
  canonicalMaterial: string;
  duplicateOccurrence: number;
  movement: TMovement;
}

export async function resolveExistingTransactionConflict(
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

export function validatePriceDataForPersistence(
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

  return ok({
    transaction_id: transactionId,
    movement_type: movementType,
    movement_fingerprint: movementFingerprint,
    asset_id: movement.assetId,
    asset_symbol: movement.assetSymbol,
    movement_role: movement.movementRole ?? 'principal',
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
  });
}

function feeMovementToRow(
  fee: FeeMovementDraft,
  transactionId: number,
  movementFingerprint: string
): Result<Insertable<TransactionMovementsTable>, Error> {
  return ok({
    transaction_id: transactionId,
    movement_type: 'fee',
    movement_fingerprint: movementFingerprint,
    asset_id: fee.assetId,
    asset_symbol: fee.assetSymbol,
    movement_role: null,
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
  });
}

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

export function buildMovementRows(
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
    if (result.isErr()) {
      return err(result.error);
    }
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
    if (result.isErr()) {
      return err(result.error);
    }
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
    if (result.isErr()) {
      return err(result.error);
    }
    rows.push(result.value);
  }

  return ok(rows);
}

export function buildInsertValues(
  transaction: TransactionDraft,
  accountFingerprint: string,
  accountId: number,
  createdAt?: string
): Result<BuildInsertValuesResult, Error> {
  if (transaction.diagnostics !== undefined) {
    const diagnosticsValidation = z.array(TransactionDiagnosticSchema).safeParse(transaction.diagnostics);
    if (!diagnosticsValidation.success) {
      return err(new Error(`Invalid diagnostics: ${diagnosticsValidation.error.message}`));
    }
  }

  if (transaction.userNotes !== undefined) {
    const userNotesValidation = z.array(UserNoteSchema).safeParse(transaction.userNotes);
    if (!userNotesValidation.success) {
      return err(new Error(`Invalid userNotes: ${userNotesValidation.error.message}`));
    }
  }

  const inflows = transaction.movements.inflows ?? [];
  const outflows = transaction.movements.outflows ?? [];
  const fees = transaction.fees ?? [];

  const validationResult = validatePriceDataForPersistence(
    inflows,
    outflows,
    fees,
    `transaction ${transaction.platformKey} at ${transaction.datetime}`
  );
  if (validationResult.isErr()) {
    return err(validationResult.error);
  }

  const diagnosticsJsonResult =
    transaction.diagnostics && transaction.diagnostics.length > 0
      ? serializeToJson(transaction.diagnostics)
      : ok(undefined);
  if (diagnosticsJsonResult.isErr()) {
    return err(diagnosticsJsonResult.error);
  }

  const userNotesJsonResult =
    transaction.userNotes && transaction.userNotes.length > 0 ? serializeToJson(transaction.userNotes) : ok(undefined);
  if (userNotesJsonResult.isErr()) {
    return err(userNotesJsonResult.error);
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
      diagnostics_json: diagnosticsJsonResult.value ?? null,
      user_notes_json: userNotesJsonResult.value ?? null,
      is_spam: transaction.isSpam ?? false,
      excluded_from_accounting: transaction.excludedFromAccounting ?? false,
      platform_key: transaction.platformKey,
      platform_kind: transaction.platformKind,
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
