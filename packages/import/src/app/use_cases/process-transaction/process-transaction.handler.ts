import type { ProcessedTransaction } from '@crypto/core';
import { validateMovementAmounts } from '@crypto/core';
import type { Result } from 'neverthrow';
import { ok, err } from 'neverthrow';

import { validateRequestId, createProcessingError, type ProcessingError } from '../../command-helpers.ts';

import type { ProcessTransactionCommand } from './process-transaction.command.ts';

/**
 * Minimal interfaces for raw data validation
 */
interface RawExchangeData {
  id: string;
  timestamp: string;
}

interface RawBlockchainData {
  hash: string;
  timestamp: string;
}

/**
 * Command Handler: Process Raw Transaction Data into ProcessedTransaction
 *
 * Converts raw blockchain/exchange transaction data into structured ProcessedTransaction
 * with unclassified movements, ready for purpose classification.
 */
export async function processTransactionCommand(
  command: ProcessTransactionCommand
): Promise<Result<ProcessedTransaction, ProcessingError>> {
  // 1. Validate command parameters
  const validationResult = validateProcessTransactionCommand(command);
  if (validationResult.isErr()) {
    return err(validationResult.error);
  }

  // 2. Process raw data based on source type
  const processingResult = await processRawTransactionData(command);
  if (processingResult.isErr()) {
    return processingResult;
  }

  const processedTransaction = processingResult.value;

  // 3. Validate business rules
  const businessValidationResult = validateTransactionBusinessRules(processedTransaction);
  if (businessValidationResult.isErr()) {
    return err(businessValidationResult.error);
  }

  return ok(processedTransaction);
}

/**
 * Validate command parameters
 */
function validateProcessTransactionCommand(command: ProcessTransactionCommand): Result<void, ProcessingError> {
  // Use shared validation helper
  const requestIdValidation = validateRequestId(command.requestId, (message, context) =>
    createProcessingError(message, context)
  );
  if (requestIdValidation.isErr()) {
    return requestIdValidation;
  }

  // Validate required fields
  if (!command.rawData) {
    return err(createProcessingError('Raw data is required', { requestId: command.requestId }));
  }

  if (!command.importSessionId?.trim()) {
    return err(createProcessingError('ImportSessionId must be non-empty string', { requestId: command.requestId }));
  }

  // Validate source
  if (!command.source?.kind || !['blockchain', 'exchange'].includes(command.source.kind)) {
    return err(
      createProcessingError('Source kind must be either "exchange" or "blockchain"', { requestId: command.requestId })
    );
  }

  // Validate source-specific requirements
  if (command.source.kind === 'exchange' && !command.source.venue) {
    return err(createProcessingError('Exchange source must specify venue', { requestId: command.requestId }));
  }

  if (command.source.kind === 'blockchain' && !command.source.chain) {
    return err(createProcessingError('Blockchain source must specify chain', { requestId: command.requestId }));
  }

  // Check supported venues/chains for MVP
  if (command.source.kind === 'exchange' && command.source.venue !== 'kraken') {
    return err(
      createProcessingError(`Unsupported exchange venue: ${command.source.venue}. MVP only supports: kraken`, {
        requestId: command.requestId,
      })
    );
  }

  if (command.source.kind === 'blockchain' && command.source.chain !== 'ethereum') {
    return err(
      createProcessingError(`Unsupported blockchain: ${command.source.chain}. MVP only supports: ethereum`, {
        requestId: command.requestId,
      })
    );
  }

  return ok();
}

/**
 * Process raw data based on source type
 */
async function processRawTransactionData(
  command: ProcessTransactionCommand
): Promise<Result<ProcessedTransaction, ProcessingError>> {
  if (command.source.kind === 'exchange') {
    return processExchangeData(command);
  } else if (command.source.kind === 'blockchain') {
    return processBlockchainData(command);
  }

  const sourceKind =
    typeof command.source === 'object' && command.source !== null && 'kind' in command.source
      ? String((command.source as { kind?: unknown }).kind)
      : 'unknown';
  return err(createProcessingError(`Unsupported source kind: ${sourceKind}`, { requestId: command.requestId }));
}

/**
 * Process exchange data
 */
async function processExchangeData(
  command: ProcessTransactionCommand
): Promise<Result<ProcessedTransaction, ProcessingError>> {
  // Type guard and validation for exchange data structure
  if (!hasRequiredExchangeFields(command.rawData)) {
    return err(
      createProcessingError('Exchange raw data missing required fields (id, timestamp)', {
        requestId: command.requestId,
      })
    );
  }

  const rawData = command.rawData;

  // Create basic ProcessedTransaction structure
  const processedTransaction: ProcessedTransaction = {
    id: String(rawData.id),
    movements: [], // Will be populated by actual processor implementation
    source: {
      externalId: String(rawData.id),
      importSessionId: command.importSessionId,
      kind: 'exchange',
      venue: (command.source as { kind: 'exchange'; venue: string }).venue,
    },
    timestamp: String(rawData.timestamp),
  };

  return Promise.resolve(ok(processedTransaction));
}

/**
 * Process blockchain data
 */
async function processBlockchainData(
  command: ProcessTransactionCommand
): Promise<Result<ProcessedTransaction, ProcessingError>> {
  // Type guard and validation for blockchain data structure
  if (!hasRequiredBlockchainFields(command.rawData)) {
    return err(
      createProcessingError('Blockchain raw data missing required fields (hash, timestamp)', {
        requestId: command.requestId,
      })
    );
  }

  const rawData = command.rawData;

  // Create basic ProcessedTransaction structure
  const processedTransaction: ProcessedTransaction = {
    id: String(rawData.hash),
    movements: [], // Will be populated by actual processor implementation
    source: {
      chain: (command.source as { chain: string; kind: 'blockchain' }).chain,
      importSessionId: command.importSessionId,
      kind: 'blockchain',
      txHash: String(rawData.hash),
    },
    timestamp: String(rawData.timestamp),
  };

  return Promise.resolve(ok(processedTransaction));
}

/**
 * Validate business rules
 */
function validateTransactionBusinessRules(transaction: ProcessedTransaction): Result<void, ProcessingError> {
  // Use Core's validation for movement amounts
  const amountValidation = validateMovementAmounts(transaction);
  if (amountValidation.isErr()) {
    return err(createProcessingError(amountValidation.error.message, { transactionId: transaction.id }));
  }

  // Validate movement directions
  for (const movement of transaction.movements) {
    if (!['IN', 'OUT'].includes(movement.direction)) {
      return err(
        createProcessingError(`Invalid movement direction: ${movement.direction}. Must be 'IN' or 'OUT'`, {
          transactionId: transaction.id,
        })
      );
    }
  }

  return ok();
}

/**
 * Type guard for exchange data
 */
function hasRequiredExchangeFields(data: unknown): data is RawExchangeData {
  return (
    data !== null &&
    data !== undefined &&
    typeof data === 'object' &&
    'id' in data &&
    'timestamp' in data &&
    typeof (data as Record<string, unknown>).id === 'string' &&
    typeof (data as Record<string, unknown>).timestamp === 'string'
  );
}

/**
 * Type guard for blockchain data
 */
function hasRequiredBlockchainFields(data: unknown): data is RawBlockchainData {
  return (
    data !== null &&
    data !== undefined &&
    typeof data === 'object' &&
    'hash' in data &&
    'timestamp' in data &&
    typeof (data as Record<string, unknown>).hash === 'string' &&
    typeof (data as Record<string, unknown>).timestamp === 'string'
  );
}
