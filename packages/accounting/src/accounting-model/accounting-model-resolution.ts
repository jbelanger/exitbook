import type { Transaction } from '@exitbook/core';
import { err, ok, type Result } from '@exitbook/foundation';

import type { AccountingEntry, AssetAccountingEntry, FeeAccountingEntry } from './accounting-entry-types.js';
import type {
  AccountingAssetEntryView,
  AccountingFeeEntryView,
  AccountingModelBuildResult,
  AccountingTransactionView,
  InternalTransferCarryover,
  InternalTransferCarryoverTargetBinding,
} from './accounting-model-types.js';

export interface AccountingAssetEntryResolution {
  entry: AssetAccountingEntry;
  movement: ResolvedAccountingAssetMovementView;
  provenanceBinding: AssetAccountingEntry['provenanceBindings'][number];
  processedTransaction: Transaction;
  transactionView?: AccountingTransactionView | undefined;
}

export interface AccountingFeeEntryResolution {
  entry: FeeAccountingEntry;
  fee: AccountingFeeEntryView;
  provenanceBinding: FeeAccountingEntry['provenanceBindings'][number];
  transactionView: AccountingTransactionView;
}

export interface ResolvedInternalTransferCarryoverTarget {
  binding: InternalTransferCarryoverTargetBinding;
  target: AccountingAssetEntryResolution;
}

export interface ResolvedInternalTransferCarryover {
  carryover: InternalTransferCarryover;
  fee?: AccountingFeeEntryResolution | undefined;
  source: AccountingAssetEntryResolution;
  targets: readonly ResolvedInternalTransferCarryoverTarget[];
}

interface AccountingAssetMovementRef {
  movement: ResolvedAccountingAssetMovementView;
  processedTransaction: Transaction;
  transactionView?: AccountingTransactionView | undefined;
}

interface AccountingFeeRef {
  fee: AccountingFeeEntryView;
  transactionView: AccountingTransactionView;
}

export interface AccountingModelIndexes {
  entriesByEntryFingerprint: Map<string, AccountingEntry>;
  feeRefsByMovementFingerprint: Map<string, AccountingFeeRef>;
  inflowRefsByMovementFingerprint: Map<string, AccountingAssetMovementRef>;
  outflowRefsByMovementFingerprint: Map<string, AccountingAssetMovementRef>;
  processedInflowRefsByMovementFingerprint: Map<string, AccountingAssetMovementRef>;
  processedOutflowRefsByMovementFingerprint: Map<string, AccountingAssetMovementRef>;
  transactionViewsByTransactionId: Map<number, AccountingTransactionView>;
}

export interface ResolvedAccountingAssetMovementView {
  assetId: string;
  assetSymbol: AccountingAssetEntryView['assetSymbol'];
  grossQuantity: AccountingAssetEntryView['grossQuantity'];
  movementFingerprint: string;
  netQuantity?: AccountingAssetEntryView['netQuantity'];
  priceAtTxTime?: AccountingAssetEntryView['priceAtTxTime'];
  role: AccountingAssetEntryView['role'];
  sourceKind: 'accounting_transaction_view' | 'processed_transaction';
}

export function buildAccountingModelIndexes(
  accountingModel: AccountingModelBuildResult
): Result<AccountingModelIndexes, Error> {
  const entriesByEntryFingerprint = new Map<string, AccountingEntry>();
  for (const entry of accountingModel.entries) {
    const existing = entriesByEntryFingerprint.get(entry.entryFingerprint);
    if (existing) {
      return err(new Error(`Duplicate accounting entry fingerprint ${entry.entryFingerprint}`));
    }

    entriesByEntryFingerprint.set(entry.entryFingerprint, entry);
  }

  const inflowRefsByMovementFingerprint = new Map<string, AccountingAssetMovementRef>();
  const outflowRefsByMovementFingerprint = new Map<string, AccountingAssetMovementRef>();
  const feeRefsByMovementFingerprint = new Map<string, AccountingFeeRef>();
  const processedInflowRefsByMovementFingerprint = new Map<string, AccountingAssetMovementRef>();
  const processedOutflowRefsByMovementFingerprint = new Map<string, AccountingAssetMovementRef>();
  const transactionViewsByTransactionId = new Map<number, AccountingTransactionView>();

  for (const transactionView of accountingModel.accountingTransactionViews) {
    const transactionId = transactionView.processedTransaction.id;
    if (transactionViewsByTransactionId.has(transactionId)) {
      return err(new Error(`Duplicate accounting transaction view for transaction ${transactionId}`));
    }
    transactionViewsByTransactionId.set(transactionId, transactionView);

    const inflowIndexResult = indexAssetMovements(
      inflowRefsByMovementFingerprint,
      transactionView,
      transactionView.inflows
    );
    if (inflowIndexResult.isErr()) {
      return err(inflowIndexResult.error);
    }

    const outflowIndexResult = indexAssetMovements(
      outflowRefsByMovementFingerprint,
      transactionView,
      transactionView.outflows
    );
    if (outflowIndexResult.isErr()) {
      return err(outflowIndexResult.error);
    }

    for (const fee of transactionView.fees) {
      const existing = feeRefsByMovementFingerprint.get(fee.movementFingerprint);
      if (existing) {
        return err(
          new Error(
            `Duplicate accounting fee movement fingerprint ${fee.movementFingerprint} for transactions ` +
              `${existing.transactionView.processedTransaction.id} and ${transactionId}`
          )
        );
      }

      feeRefsByMovementFingerprint.set(fee.movementFingerprint, {
        fee,
        transactionView,
      });
    }
  }

  const processedMovementIndexResult = indexProcessedTransactions(
    processedInflowRefsByMovementFingerprint,
    processedOutflowRefsByMovementFingerprint,
    accountingModel.processedTransactions
  );
  if (processedMovementIndexResult.isErr()) {
    return err(processedMovementIndexResult.error);
  }

  return ok({
    entriesByEntryFingerprint,
    feeRefsByMovementFingerprint,
    inflowRefsByMovementFingerprint,
    outflowRefsByMovementFingerprint,
    processedInflowRefsByMovementFingerprint,
    processedOutflowRefsByMovementFingerprint,
    transactionViewsByTransactionId,
  });
}

export function resolveAssetAccountingEntry(
  indexes: AccountingModelIndexes,
  entryOrFingerprint: AssetAccountingEntry | string
): Result<AccountingAssetEntryResolution, Error> {
  const entryResult = resolveEntry(indexes, entryOrFingerprint);
  if (entryResult.isErr()) {
    return err(entryResult.error);
  }

  const entry = entryResult.value;
  if (entry.kind === 'fee') {
    return err(new Error(`Accounting entry ${entry.entryFingerprint} is a fee entry, not an asset entry`));
  }

  if (entry.provenanceBindings.length !== 1) {
    return err(
      new Error(
        `Accounting asset entry ${entry.entryFingerprint} requires exactly one provenance binding to resolve back to a movement`
      )
    );
  }

  const provenanceBinding = entry.provenanceBindings[0]!;
  const [primaryMovementRefs, fallbackMovementRefs] =
    entry.kind === 'asset_inflow'
      ? ([indexes.inflowRefsByMovementFingerprint, indexes.processedInflowRefsByMovementFingerprint] as const)
      : ([indexes.outflowRefsByMovementFingerprint, indexes.processedOutflowRefsByMovementFingerprint] as const);
  const movementRef =
    primaryMovementRefs.get(provenanceBinding.movementFingerprint) ??
    fallbackMovementRefs.get(provenanceBinding.movementFingerprint);
  if (!movementRef) {
    return err(
      new Error(
        `Accounting asset entry ${entry.entryFingerprint} references unknown movement ${provenanceBinding.movementFingerprint}`
      )
    );
  }

  if (movementRef.processedTransaction.txFingerprint !== provenanceBinding.txFingerprint) {
    return err(
      new Error(
        `Accounting asset entry ${entry.entryFingerprint} transaction fingerprint mismatch: ` +
          `binding ${provenanceBinding.txFingerprint}, resolved movement transaction ` +
          `${movementRef.processedTransaction.txFingerprint}`
      )
    );
  }

  if (movementRef.movement.assetId !== entry.assetId) {
    return err(
      new Error(
        `Accounting asset entry ${entry.entryFingerprint} asset mismatch: entry ${entry.assetId}, movement ${movementRef.movement.assetId}`
      )
    );
  }

  if (provenanceBinding.quantity.gt(entry.quantity)) {
    return err(
      new Error(
        `Accounting asset entry ${entry.entryFingerprint} provenance quantity ${provenanceBinding.quantity.toFixed()} ` +
          `cannot exceed entry quantity ${entry.quantity.toFixed()}`
      )
    );
  }

  return ok({
    entry,
    movement: movementRef.movement,
    processedTransaction: movementRef.processedTransaction,
    provenanceBinding,
    transactionView: movementRef.transactionView,
  });
}

export function resolveFeeAccountingEntry(
  indexes: AccountingModelIndexes,
  entryOrFingerprint: FeeAccountingEntry | string
): Result<AccountingFeeEntryResolution, Error> {
  const entryResult = resolveEntry(indexes, entryOrFingerprint);
  if (entryResult.isErr()) {
    return err(entryResult.error);
  }

  const entry = entryResult.value;
  if (entry.kind !== 'fee') {
    return err(new Error(`Accounting entry ${entry.entryFingerprint} is an asset entry, not a fee entry`));
  }

  if (entry.provenanceBindings.length !== 1) {
    return err(
      new Error(
        `Accounting fee entry ${entry.entryFingerprint} requires exactly one provenance binding to resolve back to a fee`
      )
    );
  }

  const provenanceBinding = entry.provenanceBindings[0]!;
  const feeRef = indexes.feeRefsByMovementFingerprint.get(provenanceBinding.movementFingerprint);
  if (!feeRef) {
    return err(
      new Error(
        `Accounting fee entry ${entry.entryFingerprint} references unknown fee movement ${provenanceBinding.movementFingerprint}`
      )
    );
  }

  if (feeRef.transactionView.processedTransaction.txFingerprint !== provenanceBinding.txFingerprint) {
    return err(
      new Error(
        `Accounting fee entry ${entry.entryFingerprint} transaction fingerprint mismatch: ` +
          `binding ${provenanceBinding.txFingerprint}, resolved fee transaction ` +
          `${feeRef.transactionView.processedTransaction.txFingerprint}`
      )
    );
  }

  if (feeRef.fee.assetId !== entry.assetId) {
    return err(
      new Error(
        `Accounting fee entry ${entry.entryFingerprint} asset mismatch: entry ${entry.assetId}, fee ${feeRef.fee.assetId}`
      )
    );
  }

  if (!provenanceBinding.quantity.eq(entry.quantity)) {
    return err(
      new Error(
        `Accounting fee entry ${entry.entryFingerprint} provenance quantity ${provenanceBinding.quantity.toFixed()} ` +
          `must match fee entry quantity ${entry.quantity.toFixed()}`
      )
    );
  }

  return ok({
    entry,
    fee: feeRef.fee,
    provenanceBinding,
    transactionView: feeRef.transactionView,
  });
}

export function resolveInternalTransferCarryovers(
  accountingModel: AccountingModelBuildResult
): Result<ResolvedInternalTransferCarryover[], Error> {
  const indexesResult = buildAccountingModelIndexes(accountingModel);
  if (indexesResult.isErr()) {
    return err(indexesResult.error);
  }

  const indexes = indexesResult.value;
  const resolvedCarryovers: ResolvedInternalTransferCarryover[] = [];

  for (const carryover of accountingModel.internalTransferCarryovers) {
    const sourceResult = resolveAssetAccountingEntry(indexes, carryover.sourceEntryFingerprint);
    if (sourceResult.isErr()) {
      return err(sourceResult.error);
    }

    const targets: ResolvedInternalTransferCarryoverTarget[] = [];
    let totalTargetQuantity = sourceResult.value.entry.quantity.minus(sourceResult.value.entry.quantity);
    for (const binding of carryover.targetBindings) {
      const targetResult = resolveAssetAccountingEntry(indexes, binding.targetEntryFingerprint);
      if (targetResult.isErr()) {
        return err(targetResult.error);
      }

      if (targetResult.value.entry.kind !== 'asset_inflow') {
        return err(
          new Error(
            `Internal transfer carryover target ${binding.targetEntryFingerprint} must resolve to an inflow entry`
          )
        );
      }

      if (!targetResult.value.entry.quantity.eq(binding.quantity)) {
        return err(
          new Error(
            `Internal transfer carryover target ${binding.targetEntryFingerprint} quantity mismatch: ` +
              `binding ${binding.quantity.toFixed()} != entry ${targetResult.value.entry.quantity.toFixed()}`
          )
        );
      }

      targets.push({
        binding,
        target: targetResult.value,
      });
      totalTargetQuantity = totalTargetQuantity.plus(binding.quantity);
    }

    if (!totalTargetQuantity.eq(sourceResult.value.entry.quantity)) {
      return err(
        new Error(
          `Internal transfer carryover target quantity ${totalTargetQuantity.toFixed()} does not match source quantity ` +
            `${sourceResult.value.entry.quantity.toFixed()}`
        )
      );
    }

    const feeResult =
      carryover.feeEntryFingerprint !== undefined
        ? resolveFeeAccountingEntry(indexes, carryover.feeEntryFingerprint)
        : ok(undefined);
    if (feeResult.isErr()) {
      return err(feeResult.error);
    }

    resolvedCarryovers.push({
      carryover,
      fee: feeResult.value,
      source: sourceResult.value,
      targets,
    });
  }

  return ok(resolvedCarryovers);
}

function indexAssetMovements(
  index: Map<string, AccountingAssetMovementRef>,
  transactionView: AccountingTransactionView,
  movements: readonly AccountingAssetEntryView[]
): Result<void, Error> {
  for (const movement of movements) {
    const existing = index.get(movement.movementFingerprint);
    if (existing) {
      return err(
        new Error(
          `Duplicate accounting asset movement fingerprint ${movement.movementFingerprint} for transactions ` +
            `${existing.processedTransaction.id} and ${transactionView.processedTransaction.id}`
        )
      );
    }

    index.set(movement.movementFingerprint, {
      movement: {
        assetId: movement.assetId,
        assetSymbol: movement.assetSymbol,
        grossQuantity: movement.grossQuantity,
        movementFingerprint: movement.movementFingerprint,
        netQuantity: movement.netQuantity,
        priceAtTxTime: movement.priceAtTxTime,
        role: movement.role,
        sourceKind: 'accounting_transaction_view',
      },
      processedTransaction: transactionView.processedTransaction,
      transactionView,
    });
  }

  return ok(undefined);
}

function indexProcessedTransactions(
  inflowIndex: Map<string, AccountingAssetMovementRef>,
  outflowIndex: Map<string, AccountingAssetMovementRef>,
  processedTransactions: readonly Transaction[]
): Result<void, Error> {
  for (const transaction of processedTransactions) {
    for (const inflow of transaction.movements.inflows ?? []) {
      const existing = inflowIndex.get(inflow.movementFingerprint);
      if (existing) {
        return err(
          new Error(
            `Duplicate processed inflow movement fingerprint ${inflow.movementFingerprint} for transactions ` +
              `${existing.processedTransaction.id} and ${transaction.id}`
          )
        );
      }

      inflowIndex.set(inflow.movementFingerprint, {
        movement: {
          assetId: inflow.assetId,
          assetSymbol: inflow.assetSymbol,
          grossQuantity: inflow.grossAmount,
          movementFingerprint: inflow.movementFingerprint,
          netQuantity: inflow.netAmount,
          priceAtTxTime: inflow.priceAtTxTime,
          role: inflow.movementRole ?? 'principal',
          sourceKind: 'processed_transaction',
        },
        processedTransaction: transaction,
      });
    }

    for (const outflow of transaction.movements.outflows ?? []) {
      const existing = outflowIndex.get(outflow.movementFingerprint);
      if (existing) {
        return err(
          new Error(
            `Duplicate processed outflow movement fingerprint ${outflow.movementFingerprint} for transactions ` +
              `${existing.processedTransaction.id} and ${transaction.id}`
          )
        );
      }

      outflowIndex.set(outflow.movementFingerprint, {
        movement: {
          assetId: outflow.assetId,
          assetSymbol: outflow.assetSymbol,
          grossQuantity: outflow.grossAmount,
          movementFingerprint: outflow.movementFingerprint,
          netQuantity: outflow.netAmount,
          priceAtTxTime: outflow.priceAtTxTime,
          role: outflow.movementRole ?? 'principal',
          sourceKind: 'processed_transaction',
        },
        processedTransaction: transaction,
      });
    }
  }

  return ok(undefined);
}

function resolveEntry(
  indexes: AccountingModelIndexes,
  entryOrFingerprint: AccountingEntry | string
): Result<AccountingEntry, Error> {
  if (typeof entryOrFingerprint !== 'string') {
    return ok(entryOrFingerprint);
  }

  const entry = indexes.entriesByEntryFingerprint.get(entryOrFingerprint);
  if (!entry) {
    return err(new Error(`Accounting entry ${entryOrFingerprint} not found`));
  }

  return ok(entry);
}
