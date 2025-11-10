import type { SourceMetadata } from '@exitbook/core';
import { ok, type Result } from 'neverthrow';

import type { NormalizationError } from '../../../../shared/blockchain/index.js';
import { calculateGasFeeBigInt } from '../../receipt-utils.js';
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
 */
export function transformInternalTransaction(
  rawData: RoutescanInternalTransaction,
  nativeCurrency: string,
  _sourceContext: SourceMetadata
): Result<EvmTransaction, NormalizationError> {
  const timestamp = rawData.timeStamp.getTime();

  return ok({
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
  });
}

/**
 * Transforms Routescan normal transaction to normalized EvmTransaction
 */
export function transformNormalTransaction(
  rawData: RoutescanTransaction,
  nativeCurrency: string,
  _sourceContext: SourceMetadata
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

  return ok(transaction);
}

/**
 * Transforms Routescan token transfer to normalized EvmTransaction
 */
export function transformTokenTransfer(
  rawData: RoutescanTokenTransfer,
  nativeCurrency: string,
  _sourceContext: SourceMetadata
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

  return ok(transaction);
}

/**
 * Maps any type of Routescan transaction to normalized EvmTransaction
 */
export function mapRoutescanTransaction(
  rawData: RoutescanTransaction | RoutescanInternalTransaction | RoutescanTokenTransfer,
  nativeCurrency: string,
  sourceContext: SourceMetadata
): Result<EvmTransaction, NormalizationError> {
  // Type discrimination: token transfers have tokenSymbol, internal transactions have traceId, normal transactions have nonce

  if ('tokenSymbol' in rawData) {
    return transformTokenTransfer(rawData, nativeCurrency, sourceContext);
  }

  if ('traceId' in rawData) {
    return transformInternalTransaction(rawData, nativeCurrency, sourceContext);
  }

  return transformNormalTransaction(rawData, nativeCurrency, sourceContext);
}
