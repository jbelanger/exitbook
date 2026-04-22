import type { Transaction } from '@exitbook/core';

import { deriveOperationLabel, type DerivedOperationLabel } from '../labels/derive-operation-label.js';

const TRANSFER_SEND_OVERRIDE_LABELS = new Set(['asset migration/send', 'bridge/send']);
const TRANSFER_RECEIVE_OVERRIDE_LABELS = new Set(['asset migration/receive', 'bridge/receive']);

function resolveDerivedOperation(
  transaction: Pick<Transaction, 'operation'>,
  derivedOperation: Pick<DerivedOperationLabel, 'label'> | undefined
): Pick<DerivedOperationLabel, 'label'> {
  return derivedOperation ?? deriveOperationLabel(transaction);
}

export function hasTransferDirectionOverrideLabel(label: string): boolean {
  return TRANSFER_SEND_OVERRIDE_LABELS.has(label) || TRANSFER_RECEIVE_OVERRIDE_LABELS.has(label);
}

export function hasTransactionTransferDirectionOverride(
  transaction: Pick<Transaction, 'operation'>,
  derivedOperation?: Pick<DerivedOperationLabel, 'label'>
): boolean {
  const operation = resolveDerivedOperation(transaction, derivedOperation);
  return hasTransferDirectionOverrideLabel(operation.label);
}

export function hasTransactionTransferSendIntent(
  transaction: Pick<Transaction, 'operation'>,
  derivedOperation?: Pick<DerivedOperationLabel, 'label'>
): boolean {
  const operation = resolveDerivedOperation(transaction, derivedOperation);

  if (TRANSFER_SEND_OVERRIDE_LABELS.has(operation.label)) {
    return true;
  }

  if (TRANSFER_RECEIVE_OVERRIDE_LABELS.has(operation.label)) {
    return false;
  }

  return (
    transaction.operation.category === 'transfer' &&
    (transaction.operation.type === 'withdrawal' || transaction.operation.type === 'transfer')
  );
}

export function hasTransactionTransferReceiveIntent(
  transaction: Pick<Transaction, 'operation'>,
  derivedOperation?: Pick<DerivedOperationLabel, 'label'>
): boolean {
  const operation = resolveDerivedOperation(transaction, derivedOperation);

  if (TRANSFER_RECEIVE_OVERRIDE_LABELS.has(operation.label)) {
    return true;
  }

  if (TRANSFER_SEND_OVERRIDE_LABELS.has(operation.label)) {
    return false;
  }

  return (
    transaction.operation.category === 'transfer' &&
    (transaction.operation.type === 'deposit' || transaction.operation.type === 'transfer')
  );
}

export function hasTransactionTransferIntent(
  transaction: Pick<Transaction, 'operation'>,
  derivedOperation?: Pick<DerivedOperationLabel, 'label'>
): boolean {
  const operation = resolveDerivedOperation(transaction, derivedOperation);

  if (hasTransactionTransferDirectionOverride(transaction, operation)) {
    return true;
  }

  return transaction.operation.category === 'transfer';
}
