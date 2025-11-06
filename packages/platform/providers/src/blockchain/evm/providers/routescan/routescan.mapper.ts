import type { SourceMetadata } from '@exitbook/core';
import type { Result } from 'neverthrow';
import { ok } from 'neverthrow';

import { BaseRawDataMapper } from '../../../../shared/blockchain/base/mapper.js';
import type { NormalizationError } from '../../../../shared/blockchain/index.js';
import { extractMethodId, getTransactionTypeFromFunctionName } from '../../mapper-utils.js';
import { calculateGasFeeBigInt } from '../../receipt-utils.js';
import { EvmTransactionSchema } from '../../schemas.js';
import type { EvmTransaction } from '../../types.js';
import { normalizeEvmAddress } from '../../utils.js';

import {
  RoutescanAnyTransactionSchema,
  type RoutescanInternalTransaction,
  type RoutescanTransaction,
  type RoutescanTokenTransfer,
} from './routescan.schemas.js';

/**
 * Metadata required for mapping Routescan transactions
 */
export interface RoutescanMapperContext {
  nativeCurrency: string;
}

export class RoutescanTransactionMapper extends BaseRawDataMapper<
  RoutescanTransaction | RoutescanInternalTransaction | RoutescanTokenTransfer,
  EvmTransaction
> {
  protected readonly inputSchema = RoutescanAnyTransactionSchema;
  protected readonly outputSchema = EvmTransactionSchema;

  private readonly nativeCurrency: string;

  constructor(context: RoutescanMapperContext) {
    super();
    this.nativeCurrency = context.nativeCurrency;
  }

  protected mapInternal(
    rawData: RoutescanTransaction | RoutescanInternalTransaction | RoutescanTokenTransfer,
    _sourceContext: SourceMetadata
  ): Result<EvmTransaction, NormalizationError> {
    // Type discrimination: token transfers have tokenSymbol, internal transactions have traceId, normal transactions have nonce

    if ('tokenSymbol' in rawData) {
      return this.transformTokenTransfer(rawData);
    }

    if ('traceId' in rawData) {
      return this.transformInternalTransaction(rawData);
    }

    return this.transformNormalTransaction(rawData);
  }

  private transformInternalTransaction(
    rawData: RoutescanInternalTransaction
  ): Result<EvmTransaction, NormalizationError> {
    const timestamp = rawData.timeStamp.getTime();

    return ok({
      amount: rawData.value,
      blockHeight: parseInt(rawData.blockNumber),
      currency: this.nativeCurrency,
      from: normalizeEvmAddress(rawData.from) ?? '',
      id: rawData.hash,
      providerId: 'routescan',
      status: rawData.isError === '0' ? 'success' : 'failed',
      timestamp,
      to: normalizeEvmAddress(rawData.to),
      traceId: rawData.traceId,
      type: 'internal',
    });
  }

  private transformNormalTransaction(rawData: RoutescanTransaction): Result<EvmTransaction, NormalizationError> {
    const timestamp = rawData.timeStamp.getTime();

    const transaction: EvmTransaction = {
      amount: rawData.value,
      blockHeight: parseInt(rawData.blockNumber),
      blockId: rawData.blockHash,
      currency: this.nativeCurrency,
      from: normalizeEvmAddress(rawData.from) ?? '',
      gasPrice: rawData.gasPrice,
      gasUsed: rawData.gasUsed,
      id: rawData.hash,
      providerId: 'routescan',
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
      transaction.feeCurrency = this.nativeCurrency;
    }

    return ok(transaction);
  }

  private transformTokenTransfer(rawData: RoutescanTokenTransfer): Result<EvmTransaction, NormalizationError> {
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
      providerId: 'routescan',
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
      transaction.feeCurrency = this.nativeCurrency;
    }

    return ok(transaction);
  }
}
