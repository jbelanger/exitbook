import type { AssetMovement, FeeMovement, Transaction } from '@exitbook/core';
import { err, ok, type Result } from '@exitbook/foundation';
import type { Logger } from '@exitbook/logger';

import { buildCostBasisScopedTransactions } from '../cost-basis/standard/matching/build-cost-basis-scoped-transactions.js';

import { computeAccountingEntryFingerprint } from './accounting-entry-fingerprint.js';
import type { AccountingEntry, AccountingEntryDraft } from './accounting-entry-types.js';

/**
 * Build canonical accounting entries from processed transactions.
 *
 * The first implementation intentionally reuses the existing cost-basis
 * same-hash reductions because they are the current trusted deterministic
 * accounting reconstruction for mixed UTXO transfer quantities.
 */
export function buildAccountingEntriesFromTransactions(
  transactions: Transaction[],
  logger: Logger
): Result<AccountingEntry[], Error> {
  const scopedResult = buildCostBasisScopedTransactions(transactions, logger);
  if (scopedResult.isErr()) {
    return err(scopedResult.error);
  }

  const entries: AccountingEntry[] = [];

  for (const scopedTransaction of scopedResult.value.transactions) {
    for (const inflow of scopedTransaction.movements.inflows) {
      const entryResult = buildAssetAccountingEntry(scopedTransaction.tx, 'asset_inflow', inflow);
      if (entryResult.isErr()) {
        return err(entryResult.error);
      }
      entries.push(entryResult.value);
    }

    for (const outflow of scopedTransaction.movements.outflows) {
      const entryResult = buildAssetAccountingEntry(scopedTransaction.tx, 'asset_outflow', outflow);
      if (entryResult.isErr()) {
        return err(entryResult.error);
      }
      entries.push(entryResult.value);
    }

    for (const fee of scopedTransaction.fees) {
      const entryResult = buildFeeAccountingEntry(scopedTransaction.tx, fee);
      if (entryResult.isErr()) {
        return err(entryResult.error);
      }
      entries.push(entryResult.value);
    }
  }

  return ok(entries);
}

function buildAssetAccountingEntry(
  transaction: Transaction,
  kind: 'asset_inflow' | 'asset_outflow',
  movement: AssetMovement
): Result<AccountingEntry, Error> {
  const quantity = movement.netAmount ?? movement.grossAmount;

  if (!quantity.gt(0)) {
    return err(
      new Error(
        `Accounting asset entry quantity must be positive: transaction ${transaction.id}, movement ${movement.movementFingerprint}`
      )
    );
  }

  const draft: AccountingEntryDraft = {
    kind,
    assetId: movement.assetId,
    assetSymbol: movement.assetSymbol,
    quantity,
    role: movement.movementRole ?? 'principal',
    provenanceBindings: [
      {
        txFingerprint: transaction.txFingerprint,
        movementFingerprint: movement.movementFingerprint,
        quantity,
      },
    ],
  };

  const fingerprintResult = computeAccountingEntryFingerprint(draft);
  if (fingerprintResult.isErr()) {
    return err(fingerprintResult.error);
  }

  return ok({
    ...draft,
    entryFingerprint: fingerprintResult.value,
  });
}

function buildFeeAccountingEntry(transaction: Transaction, fee: FeeMovement): Result<AccountingEntry, Error> {
  if (!fee.amount.gt(0)) {
    return err(
      new Error(`Accounting fee entry quantity must be positive: transaction ${transaction.id}, fee ${fee.assetId}`)
    );
  }

  const draft: AccountingEntryDraft = {
    kind: 'fee',
    assetId: fee.assetId,
    assetSymbol: fee.assetSymbol,
    quantity: fee.amount,
    feeScope: fee.scope,
    feeSettlement: fee.settlement,
    provenanceBindings: [
      {
        txFingerprint: transaction.txFingerprint,
        movementFingerprint: fee.movementFingerprint,
        quantity: fee.amount,
      },
    ],
  };

  const fingerprintResult = computeAccountingEntryFingerprint(draft);
  if (fingerprintResult.isErr()) {
    return err(fingerprintResult.error);
  }

  return ok({
    ...draft,
    entryFingerprint: fingerprintResult.value,
  });
}
