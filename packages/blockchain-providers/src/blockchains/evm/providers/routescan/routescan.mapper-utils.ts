import type { SourceMetadata } from '@exitbook/core';
import { ok, type Result } from 'neverthrow';

import type { NormalizationError } from '../../../../core/index.js';
import { withValidation } from '../../../../core/index.js';
import { calculateGasFeeBigInt } from '../../receipt-utils.js';
import { EvmTransactionSchema } from '../../schemas.js';
import type { EvmTransaction } from '../../types.js';
import { extractMethodId, getTransactionTypeFromFunctionName, normalizeEvmAddress } from '../../utils.js';

import {
  RoutescanAnyTransactionSchema,
  RoutescanInternalTransactionSchema,
  RoutescanTransactionSchema,
  RoutescanTokenTransferSchema,
  type RoutescanInternalTransaction,
  type RoutescanTransaction,
  type RoutescanTokenTransfer,
} from './routescan.schemas.js';

/**
 * Pure functions for Routescan transaction mapping
 * Following the Functional Core / Imperative Shell pattern
 */

/**
 * Transforms Routescan internal transaction to normalized EvmTransaction (internal)
 */
function transformInternalTransactionInternal(
  rawData: RoutescanInternalTransaction,
  _sourceContext: SourceMetadata,
  nativeCurrency: string
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
 * Transforms Routescan normal transaction to normalized EvmTransaction (internal)
 */
function transformNormalTransactionInternal(
  rawData: RoutescanTransaction,
  _sourceContext: SourceMetadata,
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

  return ok(transaction);
}

/**
 * Transforms Routescan token transfer to normalized EvmTransaction (internal)
 */
function transformTokenTransferInternal(
  rawData: RoutescanTokenTransfer,
  _sourceContext: SourceMetadata,
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

  return ok(transaction);
}

/**
 * Maps any type of Routescan transaction to normalized EvmTransaction (internal)
 */
function mapRoutescanTransactionInternal(
  rawData: RoutescanTransaction | RoutescanInternalTransaction | RoutescanTokenTransfer,
  sourceContext: SourceMetadata,
  nativeCurrency: string
): Result<EvmTransaction, NormalizationError> {
  // Type discrimination: token transfers have tokenSymbol, internal transactions have traceId, normal transactions have nonce

  if ('tokenSymbol' in rawData) {
    return transformTokenTransferInternal(rawData, sourceContext, nativeCurrency);
  }

  if ('traceId' in rawData) {
    return transformInternalTransactionInternal(rawData, sourceContext, nativeCurrency);
  }

  return transformNormalTransactionInternal(rawData, sourceContext, nativeCurrency);
}

/**
 * Transforms Routescan internal transaction to normalized EvmTransaction with validation
 */
export const transformInternalTransaction = withValidation(
  RoutescanInternalTransactionSchema,
  EvmTransactionSchema,
  'RoutescanInternalTransaction'
)(transformInternalTransactionInternal);

/**
 * Transforms Routescan normal transaction to normalized EvmTransaction with validation
 */
export const transformNormalTransaction = withValidation(
  RoutescanTransactionSchema,
  EvmTransactionSchema,
  'RoutescanTransaction'
)(transformNormalTransactionInternal);

/**
 * Transforms Routescan token transfer to normalized EvmTransaction with validation
 */
export const transformTokenTransfer = withValidation(
  RoutescanTokenTransferSchema,
  EvmTransactionSchema,
  'RoutescanTokenTransfer'
)(transformTokenTransferInternal);

/**
 * Maps any type of Routescan transaction to normalized EvmTransaction with validation
 */
export const mapRoutescanTransaction = withValidation(
  RoutescanAnyTransactionSchema,
  EvmTransactionSchema,
  'RoutescanTransaction'
)(mapRoutescanTransactionInternal);
