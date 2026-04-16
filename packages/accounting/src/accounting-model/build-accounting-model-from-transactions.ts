import type { AssetMovement, FeeMovement, Transaction } from '@exitbook/core';
import { err, ok, parseDecimal, resultDo, type Result } from '@exitbook/foundation';
import type { Logger } from '@exitbook/logger';

import { computeAccountingEntryFingerprint } from './accounting-entry-fingerprint.js';
import type { AccountingEntry, AccountingEntryDraft } from './accounting-entry-types.js';
import { applyAccountingExclusionPolicy, type AccountingExclusionPolicy } from './accounting-exclusion-policy.js';
import type {
  AccountingAssetEntryView,
  AccountingFeeEntryView,
  AccountingModelBuildResult,
  AccountingDerivationDependency,
  AccountingTransactionView,
  InternalTransferCarryover,
  InternalTransferCarryoverTargetBinding,
} from './accounting-model-types.js';
import {
  prepareAccountingTransactions,
  type PreparedAccountingBuildResult,
  type InternalTransferCarryoverDraft,
} from './prepare-accounting-transactions.js';

/**
 * Build the canonical accounting model from processed transactions.
 *
 * The first implementation intentionally reuses the existing cost-basis
 * same-hash reductions because they are the current trusted deterministic
 * accounting reconstruction for mixed UTXO transfer quantities.
 */
export function buildAccountingModelFromTransactions(
  transactions: Transaction[],
  logger: Logger,
  accountingExclusionPolicy?: AccountingExclusionPolicy
): Result<AccountingModelBuildResult, Error> {
  return resultDo(function* () {
    const preparedBuildResult = yield* prepareAccountingTransactions(transactions, logger);
    const exclusionApplied = applyAccountingExclusionPolicy(preparedBuildResult, accountingExclusionPolicy);
    return yield* buildAccountingModelFromPreparedBuild(exclusionApplied.preparedBuildResult);
  });
}

export function buildAccountingModelFromPreparedBuild(
  preparedBuildResult: PreparedAccountingBuildResult
): Result<AccountingModelBuildResult, Error> {
  const accountingTransactionViews: AccountingTransactionView[] = [];
  const transactionById = new Map<number, Transaction>(
    preparedBuildResult.inputTransactions.map((transaction) => [transaction.id, transaction])
  );
  const entries: AccountingEntry[] = [];
  const inflowEntryByMovementFingerprint = new Map<string, AccountingEntry>();
  const feeEntryByMovementFingerprint = new Map<string, AccountingEntry>();

  for (const preparedTransaction of preparedBuildResult.transactions) {
    const inflows: AccountingAssetEntryView[] = [];
    for (const inflow of preparedTransaction.movements.inflows) {
      const entryResult = buildAssetAccountingEntry(preparedTransaction.tx, 'asset_inflow', inflow);
      if (entryResult.isErr()) {
        return err(entryResult.error);
      }

      if (!entryResult.value) {
        continue;
      }

      entries.push(entryResult.value);
      inflowEntryByMovementFingerprint.set(inflow.movementFingerprint, entryResult.value);
      inflows.push({
        assetId: inflow.assetId,
        assetSymbol: inflow.assetSymbol,
        entryFingerprint: entryResult.value.entryFingerprint,
        grossQuantity: inflow.grossAmount,
        movementFingerprint: inflow.movementFingerprint,
        netQuantity: inflow.netAmount,
        priceAtTxTime: inflow.priceAtTxTime,
        role: inflow.movementRole ?? 'principal',
      });
    }

    const outflows: AccountingAssetEntryView[] = [];
    for (const outflow of preparedTransaction.movements.outflows) {
      const entryResult = buildAssetAccountingEntry(preparedTransaction.tx, 'asset_outflow', outflow);
      if (entryResult.isErr()) {
        return err(entryResult.error);
      }

      if (!entryResult.value) {
        continue;
      }

      entries.push(entryResult.value);
      outflows.push({
        assetId: outflow.assetId,
        assetSymbol: outflow.assetSymbol,
        entryFingerprint: entryResult.value.entryFingerprint,
        grossQuantity: outflow.grossAmount,
        movementFingerprint: outflow.movementFingerprint,
        netQuantity: outflow.netAmount,
        priceAtTxTime: outflow.priceAtTxTime,
        role: outflow.movementRole ?? 'principal',
      });
    }

    const fees: AccountingFeeEntryView[] = [];
    for (const fee of preparedTransaction.fees) {
      const entryResult = buildFeeAccountingEntry(preparedTransaction.tx, fee);
      if (entryResult.isErr()) {
        return err(entryResult.error);
      }

      if (!entryResult.value) {
        continue;
      }

      entries.push(entryResult.value);
      feeEntryByMovementFingerprint.set(fee.movementFingerprint, entryResult.value);
      fees.push({
        assetId: fee.assetId,
        assetSymbol: fee.assetSymbol,
        entryFingerprint: entryResult.value.entryFingerprint,
        feeScope: fee.scope,
        feeSettlement: fee.settlement,
        movementFingerprint: fee.movementFingerprint,
        priceAtTxTime: fee.priceAtTxTime,
        quantity: fee.amount,
      });
    }

    accountingTransactionViews.push({
      fees,
      inflows,
      outflows,
      processedTransaction: preparedTransaction.tx,
    });
  }

  const sortedCarryovers = [...preparedBuildResult.internalTransferCarryoverDrafts].sort(compareCarryoverIdentity);
  const sourceEntryByMovementFingerprint = new Map<string, AccountingEntry>();

  for (const carryover of sortedCarryovers) {
    const sourceTransaction = transactionById.get(carryover.sourceTransactionId);
    if (!sourceTransaction) {
      return err(
        new Error(`Accounting carryover source transaction ${carryover.sourceTransactionId} not found in input set`)
      );
    }

    const sourceEntryResult = buildCarryoverSourceAccountingEntry(sourceTransaction, carryover);
    if (sourceEntryResult.isErr()) {
      return err(sourceEntryResult.error);
    }

    entries.push(sourceEntryResult.value);
    sourceEntryByMovementFingerprint.set(carryover.sourceMovementFingerprint, sourceEntryResult.value);
  }

  const internalTransferCarryovers: InternalTransferCarryover[] = [];
  for (const carryover of sortedCarryovers) {
    const sourceEntry = sourceEntryByMovementFingerprint.get(carryover.sourceMovementFingerprint);
    if (!sourceEntry) {
      return err(
        new Error(
          `Accounting carryover source entry ${carryover.sourceMovementFingerprint} was not materialized successfully`
        )
      );
    }

    const targetBindingsResult = buildInternalTransferCarryoverTargetBindings(
      carryover,
      sourceEntry,
      inflowEntryByMovementFingerprint
    );
    if (targetBindingsResult.isErr()) {
      return err(targetBindingsResult.error);
    }

    const feeEntryFingerprintResult = resolveCarryoverFeeEntryFingerprint(carryover, feeEntryByMovementFingerprint);
    if (feeEntryFingerprintResult.isErr()) {
      return err(feeEntryFingerprintResult.error);
    }

    internalTransferCarryovers.push({
      sourceEntryFingerprint: sourceEntry.entryFingerprint,
      targetBindings: targetBindingsResult.value,
      feeEntryFingerprint: feeEntryFingerprintResult.value,
    });
  }

  const derivationDependenciesResult = buildDerivationDependencies(preparedBuildResult, transactionById);
  if (derivationDependenciesResult.isErr()) {
    return err(derivationDependenciesResult.error);
  }

  return ok({
    accountingTransactionViews,
    processedTransactions: preparedBuildResult.inputTransactions,
    entries,
    derivationDependencies: derivationDependenciesResult.value,
    internalTransferCarryovers,
  });
}

function buildAssetAccountingEntry(
  transaction: Transaction,
  kind: 'asset_inflow' | 'asset_outflow',
  movement: AssetMovement
): Result<AccountingEntry | undefined, Error> {
  const quantity = movement.netAmount ?? movement.grossAmount;

  if (quantity.isZero()) {
    return ok(undefined);
  }

  if (quantity.lt(0)) {
    return err(
      new Error(
        `Accounting asset entry quantity must be non-negative: transaction ${transaction.id}, movement ${movement.movementFingerprint}`
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

function buildFeeAccountingEntry(
  transaction: Transaction,
  fee: FeeMovement
): Result<AccountingEntry | undefined, Error> {
  if (fee.amount.isZero()) {
    return ok(undefined);
  }

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

function buildCarryoverSourceAccountingEntry(
  transaction: Transaction,
  carryover: InternalTransferCarryoverDraft
): Result<AccountingEntry, Error> {
  if (!carryover.retainedQuantity.gt(0)) {
    return err(
      new Error(
        `Internal transfer carryover retained quantity must be positive: transaction ${transaction.id}, movement ${carryover.sourceMovementFingerprint}`
      )
    );
  }

  const draft: AccountingEntryDraft = {
    kind: 'asset_outflow',
    assetId: carryover.assetId,
    assetSymbol: carryover.assetSymbol,
    quantity: carryover.retainedQuantity,
    role: 'principal',
    provenanceBindings: [
      {
        txFingerprint: transaction.txFingerprint,
        movementFingerprint: carryover.sourceMovementFingerprint,
        quantity: carryover.retainedQuantity,
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

function buildInternalTransferCarryoverTargetBindings(
  carryover: InternalTransferCarryoverDraft,
  sourceEntry: AccountingEntry,
  inflowEntryByMovementFingerprint: Map<string, AccountingEntry>
): Result<InternalTransferCarryoverTargetBinding[], Error> {
  const targetBindings: InternalTransferCarryoverTargetBinding[] = [];
  let totalTargetQuantity = parseDecimal('0');

  for (const target of [...carryover.targets].sort(compareCarryoverTargetIdentity)) {
    const targetEntry = inflowEntryByMovementFingerprint.get(target.targetMovementFingerprint);
    if (!targetEntry) {
      return err(
        new Error(
          `Internal transfer carryover target entry ${target.targetMovementFingerprint} was not materialized successfully`
        )
      );
    }

    if (targetEntry.assetId !== sourceEntry.assetId) {
      return err(
        new Error(
          `Internal transfer carryover target asset mismatch: source ${sourceEntry.assetId}, target ${targetEntry.assetId}`
        )
      );
    }

    if (!targetEntry.quantity.eq(target.quantity)) {
      return err(
        new Error(
          `Internal transfer carryover target quantity mismatch: target entry ${targetEntry.quantity.toFixed()} != carryover ${target.quantity.toFixed()}`
        )
      );
    }

    targetBindings.push({
      quantity: target.quantity,
      targetEntryFingerprint: targetEntry.entryFingerprint,
    });
    totalTargetQuantity = totalTargetQuantity.plus(target.quantity);
  }

  if (!totalTargetQuantity.eq(sourceEntry.quantity)) {
    return err(
      new Error(
        `Internal transfer carryover target quantity ${totalTargetQuantity.toFixed()} does not match source quantity ${sourceEntry.quantity.toFixed()}`
      )
    );
  }

  return ok(targetBindings);
}

function resolveCarryoverFeeEntryFingerprint(
  carryover: InternalTransferCarryoverDraft,
  feeEntryByMovementFingerprint: Map<string, AccountingEntry>
): Result<string | undefined, Error> {
  if (!carryover.fee.amount.gt(0)) {
    return ok(undefined);
  }

  const feeEntry = feeEntryByMovementFingerprint.get(carryover.fee.movementFingerprint);
  if (!feeEntry) {
    return err(
      new Error(
        `Internal transfer carryover fee entry ${carryover.fee.movementFingerprint} was not materialized successfully`
      )
    );
  }

  if (feeEntry.assetId !== carryover.assetId) {
    return err(
      new Error(
        `Internal transfer carryover fee asset mismatch: carryover ${carryover.assetId}, fee entry ${feeEntry.assetId}`
      )
    );
  }

  if (!feeEntry.quantity.eq(carryover.fee.amount)) {
    return err(
      new Error(
        `Internal transfer carryover fee quantity mismatch: fee entry ${feeEntry.quantity.toFixed()} != carryover ${carryover.fee.amount.toFixed()}`
      )
    );
  }

  return ok(feeEntry.entryFingerprint);
}

function buildDerivationDependencies(
  preparedBuildResult: PreparedAccountingBuildResult,
  transactionById: Map<number, Transaction>
): Result<AccountingDerivationDependency[], Error> {
  const dependencies: AccountingDerivationDependency[] = [];
  const seenKeys = new Set<string>();

  for (const preparedTransaction of preparedBuildResult.transactions) {
    for (const dependencyTransactionId of preparedTransaction.rebuildDependencyTransactionIds) {
      const supportingTransaction = transactionById.get(dependencyTransactionId);
      if (!supportingTransaction) {
        return err(
          new Error(`Accounting derivation dependency transaction ${dependencyTransactionId} not found in input set`)
        );
      }

      const key = `${preparedTransaction.tx.txFingerprint}|${supportingTransaction.txFingerprint}`;
      if (seenKeys.has(key)) {
        continue;
      }

      seenKeys.add(key);
      dependencies.push({
        ownerTxFingerprint: preparedTransaction.tx.txFingerprint,
        supportingTxFingerprint: supportingTransaction.txFingerprint,
        reason: 'same_hash_internal_scoping',
      });
    }
  }

  dependencies.sort((left, right) => {
    const ownerComparison = left.ownerTxFingerprint.localeCompare(right.ownerTxFingerprint);
    if (ownerComparison !== 0) {
      return ownerComparison;
    }

    return left.supportingTxFingerprint.localeCompare(right.supportingTxFingerprint);
  });

  return ok(dependencies);
}

function compareCarryoverIdentity(left: InternalTransferCarryoverDraft, right: InternalTransferCarryoverDraft): number {
  const sourceTransactionComparison = left.sourceTransactionId - right.sourceTransactionId;
  if (sourceTransactionComparison !== 0) {
    return sourceTransactionComparison;
  }

  return left.sourceMovementFingerprint.localeCompare(right.sourceMovementFingerprint);
}

function compareCarryoverTargetIdentity(
  left: InternalTransferCarryoverDraft['targets'][number],
  right: InternalTransferCarryoverDraft['targets'][number]
): number {
  const transactionComparison = left.targetTransactionId - right.targetTransactionId;
  if (transactionComparison !== 0) {
    return transactionComparison;
  }

  const movementComparison = left.targetMovementFingerprint.localeCompare(right.targetMovementFingerprint);
  if (movementComparison !== 0) {
    return movementComparison;
  }

  return left.quantity.toFixed().localeCompare(right.quantity.toFixed());
}
