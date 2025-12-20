import { type Result } from 'neverthrow';

import { generateUniqueTransactionEventId, type NormalizationError } from '../../../../core/index.js';
import { validateOutput } from '../../../../core/index.js';
import { calculateGasFeeBigInt } from '../../receipt-utils.js';
import { EvmTransactionSchema } from '../../schemas.js';
import type { EvmTransaction } from '../../types.js';
import { extractMethodId, getTransactionTypeFromFunctionName, normalizeEvmAddress } from '../../utils.js';

import type {
  RoutescanInternalTransaction,
  RoutescanTransaction,
  RoutescanTokenTransfer,
} from './routescan.schemas.js';

/**
 * Pure functions for Routescan transaction mapping
 * Following the Functional Core / Imperative Shell pattern
 */

/**
 * Transforms Routescan internal transaction to normalized EvmTransaction
 * Input data is pre-validated by HTTP client schema validation
 */
export function transformInternalTransaction(
  rawData: RoutescanInternalTransaction,
  nativeCurrency: string
): Result<EvmTransaction, NormalizationError> {
  const timestamp = rawData.timeStamp.getTime();
  const from = normalizeEvmAddress(rawData.from) ?? '';
  const to = normalizeEvmAddress(rawData.to);

  const transaction: EvmTransaction = {
    amount: rawData.value,
    blockHeight: parseInt(rawData.blockNumber),
    currency: nativeCurrency,
    eventId: generateUniqueTransactionEventId({
      amount: rawData.value,
      currency: nativeCurrency,
      from,
      id: rawData.hash,
      timestamp,
      to,
      traceId: rawData.traceId,
      type: 'internal',
    }),
    from,
    id: rawData.hash,
    providerName: 'routescan',
    status: rawData.isError === '0' ? 'success' : 'failed',
    timestamp,
    to,
    traceId: rawData.traceId,
    type: 'internal',
  };

  return validateOutput(transaction, EvmTransactionSchema, 'RoutescanInternalTransaction');
}

/**
 * Transforms Routescan normal transaction to normalized EvmTransaction
 * Input data is pre-validated by HTTP client schema validation
 */
export function transformNormalTransaction(
  rawData: RoutescanTransaction,
  nativeCurrency: string
): Result<EvmTransaction, NormalizationError> {
  const timestamp = rawData.timeStamp.getTime();
  const transactionType = getTransactionTypeFromFunctionName(rawData.functionName);
  const from = normalizeEvmAddress(rawData.from) ?? '';
  const to = normalizeEvmAddress(rawData.to);

  const transaction: EvmTransaction = {
    amount: rawData.value,
    blockHeight: parseInt(rawData.blockNumber),
    blockId: rawData.blockHash,
    currency: nativeCurrency,
    eventId: generateUniqueTransactionEventId({
      amount: rawData.value,
      currency: nativeCurrency,
      from,
      id: rawData.hash,
      timestamp,
      to,
      type: transactionType,
    }),
    from,
    gasPrice: rawData.gasPrice,
    gasUsed: rawData.gasUsed,
    id: rawData.hash,
    providerName: 'routescan',
    status: rawData.txreceipt_status === '1' ? 'success' : 'failed',
    timestamp,
    to,
    type: transactionType,
  };

  // Add optional fields
  if (rawData.functionName) {
    transaction.functionName = rawData.functionName;
  }
  const methodId = extractMethodId(rawData.input);
  if (methodId) {
    transaction.inputData = rawData.input;
    transaction.methodId = methodId;
  }

  // Calculate gas fee
  if (rawData.gasUsed && rawData.gasPrice) {
    transaction.feeAmount = calculateGasFeeBigInt(rawData.gasUsed, rawData.gasPrice);
    transaction.feeCurrency = nativeCurrency;
  }

  return validateOutput(transaction, EvmTransactionSchema, 'RoutescanTransaction');
}

/**
 * Transforms Routescan token transfer to normalized EvmTransaction
 * Input data is pre-validated by HTTP client schema validation
 */
export function transformTokenTransfer(
  rawData: RoutescanTokenTransfer,
  nativeCurrency: string
): Result<EvmTransaction, NormalizationError> {
  const timestamp = rawData.timeStamp.getTime();
  const from = normalizeEvmAddress(rawData.from) ?? '';
  const to = normalizeEvmAddress(rawData.to);
  const tokenAddress = normalizeEvmAddress(rawData.contractAddress);

  const transaction: EvmTransaction = {
    amount: rawData.value,
    blockHeight: parseInt(rawData.blockNumber),
    blockId: rawData.blockHash,
    // Use contract address for currency to keep eventId stable across providers.
    currency: tokenAddress ?? rawData.contractAddress,
    eventId: generateUniqueTransactionEventId({
      amount: rawData.value,
      currency: tokenAddress ?? rawData.contractAddress,
      from,
      id: rawData.hash,
      timestamp,
      to,
      tokenAddress,
      type: 'token_transfer',
    }),
    from,
    gasPrice: rawData.gasPrice,
    gasUsed: rawData.gasUsed,
    id: rawData.hash,
    providerName: 'routescan',
    status: 'success',
    timestamp,
    to,
    tokenAddress,
    tokenDecimals: parseInt(rawData.tokenDecimal),
    tokenSymbol: rawData.tokenSymbol,
    tokenType: 'erc20', // Assume ERC-20 for Routescan token transfers
    type: 'token_transfer',
  };

  // Calculate gas fee
  if (rawData.gasUsed && rawData.gasPrice) {
    transaction.feeAmount = calculateGasFeeBigInt(rawData.gasUsed, rawData.gasPrice);
    transaction.feeCurrency = nativeCurrency;
  }

  return validateOutput(transaction, EvmTransactionSchema, 'RoutescanTokenTransfer');
}

/**
 * Maps any type of Routescan transaction to normalized EvmTransaction
 * Input data is pre-validated by HTTP client schema validation
 */
export function mapRoutescanTransaction(
  rawData: RoutescanTransaction | RoutescanInternalTransaction | RoutescanTokenTransfer,
  nativeCurrency: string
): Result<EvmTransaction, NormalizationError> {
  // Type discrimination: token transfers have tokenSymbol, internal transactions have traceId, normal transactions have nonce

  if ('tokenSymbol' in rawData) {
    return transformTokenTransfer(rawData, nativeCurrency);
  }

  if ('traceId' in rawData) {
    return transformInternalTransaction(rawData, nativeCurrency);
  }

  return transformNormalTransaction(rawData, nativeCurrency);
}
