import type { ProcessedTransaction, ProcessingError } from '@crypto/core';

import type { TransactionProcessedEvent, TransactionRejectedEvent } from '../../../domain/events/transaction-events.ts';

import type { ProcessTransactionCommand } from './process-transaction.command.ts';

/**
 * Create TransactionProcessedEvent
 */
export function createTransactionProcessedEvent(
  command: ProcessTransactionCommand,
  transaction: ProcessedTransaction
): TransactionProcessedEvent {
  return {
    importSessionId: command.importSessionId,
    movementCount: transaction.movements.length,
    requestId: command.requestId,
    source: command.source,
    timestamp: new Date().toISOString(),
    transactionId: transaction.id,
    type: 'TransactionProcessed',
  };
}

/**
 * Create TransactionRejectedEvent
 */
export function createTransactionRejectedEvent(
  command: ProcessTransactionCommand,
  error: ProcessingError
): TransactionRejectedEvent {
  return {
    importSessionId: command.importSessionId,
    reason: error.message,
    requestId: command.requestId,
    source: command.source,
    timestamp: new Date().toISOString(),
    type: 'TransactionRejected',
  };
}
