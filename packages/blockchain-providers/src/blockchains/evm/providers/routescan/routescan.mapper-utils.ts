import type { ImportSessionMetadata } from '@exitbook/core';
import { type Result } from 'neverthrow';

import type { NormalizationError } from '../../../../core/index.js';
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
  _sourceContext: ImportSessionMetadata,
  nativeCurrency: string
): Result<EvmTransaction, NormalizationError> {
  const timestamp = rawData.timeStamp.getTime();

  const transaction: EvmTransaction = {
    amount: rawData.value,
    blockHeight: parseInt(rawData.blockNumber),
    currency: nativeCurrency,
    from: normalizeEvmAddress(rawData.from) ?? '',
    id: rawData.hash,
    providerName: 'routescan',
    status: rawData.isError === '0' ? 'success' : 'failed',
    timestamp,
    to: normalizeEvmAddress(rawData.to),
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
  _sourceContext: ImportSessionMetadata,
  nativeCurrency: string
): Result<EvmTransaction, NormalizationError> {
  const timestamp = rawData.timeStamp.getTime();

  const transaction: EvmTransaction = {
    amount: rawData.value,
    blockHeight: parseInt(rawData.blockNumber),
    blockId: rawData.blockHash,
    currency: nativeCurrency,
    from: normalizeEvmAddress(rawData.from) ?? '',
    gasPrice: rawData.gasPrice,
    gasUsed: rawData.gasUsed,
    id: rawData.hash,
    providerName: 'routescan',
    status: rawData.txreceipt_status === '1' ? 'success' : 'failed',
    timestamp,
    to: normalizeEvmAddress(rawData.to),
    type: getTransactionTypeFromFunctionName(rawData.functionName),
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
  _sourceContext: ImportSessionMetadata,
  nativeCurrency: string
): Result<EvmTransaction, NormalizationError> {
  const timestamp = rawData.timeStamp.getTime();

  const transaction: EvmTransaction = {
    amount: rawData.value,
    blockHeight: parseInt(rawData.blockNumber),
    blockId: rawData.blockHash,
    currency: rawData.tokenSymbol,
    from: normalizeEvmAddress(rawData.from) ?? '',
    gasPrice: rawData.gasPrice,
    gasUsed: rawData.gasUsed,
    id: rawData.hash,
    providerName: 'routescan',
    status: 'success',
    timestamp,
    to: normalizeEvmAddress(rawData.to),
    tokenAddress: normalizeEvmAddress(rawData.contractAddress),
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
  sourceContext: ImportSessionMetadata,
  nativeCurrency: string
): Result<EvmTransaction, NormalizationError> {
  // Type discrimination: token transfers have tokenSymbol, internal transactions have traceId, normal transactions have nonce

  if ('tokenSymbol' in rawData) {
    return transformTokenTransfer(rawData, sourceContext, nativeCurrency);
  }

  if ('traceId' in rawData) {
    return transformInternalTransaction(rawData, sourceContext, nativeCurrency);
  }

  return transformNormalTransaction(rawData, sourceContext, nativeCurrency);
}
