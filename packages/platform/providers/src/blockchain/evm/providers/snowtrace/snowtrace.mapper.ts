import type { RawTransactionMetadata } from '@exitbook/core';
import type { ImportSessionMetadata } from '@exitbook/data';
import type { Result } from 'neverthrow';
import { ok } from 'neverthrow';

import { BaseRawDataMapper } from '../../../../core/blockchain/base/mapper.ts';
import { RegisterTransactionMapper } from '../../../../core/blockchain/index.ts';
import type { NormalizationError } from '../../../../core/blockchain/index.ts';
import { EvmTransactionSchema } from '../../schemas.js';
import type { EvmTransaction } from '../../types.js';

import { SnowtraceAnyTransactionSchema } from './snowtrace.schemas.js';
import type { SnowtraceInternalTransaction, SnowtraceTransaction, SnowtraceTokenTransfer } from './snowtrace.types.js';

@RegisterTransactionMapper('snowtrace')
export class SnowtraceTransactionMapper extends BaseRawDataMapper<
  SnowtraceTransaction | SnowtraceInternalTransaction | SnowtraceTokenTransfer,
  EvmTransaction
> {
  protected readonly inputSchema = SnowtraceAnyTransactionSchema;
  protected readonly outputSchema = EvmTransactionSchema;

  protected mapInternal(
    rawData: SnowtraceTransaction | SnowtraceInternalTransaction | SnowtraceTokenTransfer,
    _metadata: RawTransactionMetadata,
    _sessionContext: ImportSessionMetadata
  ): Result<EvmTransaction, NormalizationError> {
    // Type discrimination handled by SnowtraceAnyTransactionSchema discriminated union
    // Token transfers have tokenSymbol, internal transactions have traceId, normal transactions have nonce

    if ('tokenSymbol' in rawData) {
      return this.transformTokenTransfer(rawData);
    }

    if ('traceId' in rawData) {
      return this.transformInternalTransaction(rawData);
    }

    return this.transformNormalTransaction(rawData);
  }

  private transformInternalTransaction(
    rawData: SnowtraceInternalTransaction
  ): Result<EvmTransaction, NormalizationError> {
    const timestamp = rawData.timeStamp.getTime();

    return ok({
      amount: rawData.value,
      blockHeight: parseInt(rawData.blockNumber),
      currency: 'AVAX',
      from: rawData.from,
      id: rawData.hash,
      providerId: 'snowtrace',
      status: rawData.isError === '0' ? 'success' : 'failed',
      timestamp,
      to: rawData.to,
      traceId: rawData.traceId,
      type: 'internal',
    });
  }

  private transformNormalTransaction(rawData: SnowtraceTransaction): Result<EvmTransaction, NormalizationError> {
    const timestamp = rawData.timeStamp.getTime();

    const transaction: EvmTransaction = {
      amount: rawData.value,
      blockHeight: parseInt(rawData.blockNumber),
      blockId: rawData.blockHash,
      currency: 'AVAX',
      from: rawData.from,
      gasPrice: rawData.gasPrice,
      gasUsed: rawData.gasUsed,
      id: rawData.hash,
      providerId: 'snowtrace',
      status: rawData.txreceipt_status === '1' ? 'success' : 'failed',
      timestamp,
      to: rawData.to,
      type: rawData.functionName ? 'contract_call' : 'transfer',
    };

    // Add optional fields
    if (rawData.functionName) {
      transaction.functionName = rawData.functionName;
    }
    if (rawData.input && rawData.input.length >= 10) {
      transaction.inputData = rawData.input;
      transaction.methodId = rawData.input.slice(0, 10); // First 4 bytes + 0x
    }

    // Calculate gas fee
    if (rawData.gasUsed && rawData.gasPrice) {
      const gasUsed = BigInt(rawData.gasUsed);
      const gasPrice = BigInt(rawData.gasPrice);
      transaction.feeAmount = (gasUsed * gasPrice).toString();
      transaction.feeCurrency = 'AVAX';
    }

    return ok(transaction);
  }

  private transformTokenTransfer(rawData: SnowtraceTokenTransfer): Result<EvmTransaction, NormalizationError> {
    const timestamp = rawData.timeStamp.getTime();

    const transaction: EvmTransaction = {
      amount: rawData.value,
      blockHeight: parseInt(rawData.blockNumber),
      blockId: rawData.blockHash,
      currency: rawData.tokenSymbol,
      from: rawData.from,
      gasPrice: rawData.gasPrice,
      gasUsed: rawData.gasUsed,
      id: rawData.hash,
      providerId: 'snowtrace',
      status: 'success',
      timestamp,
      to: rawData.to,
      tokenAddress: rawData.contractAddress,
      tokenDecimals: parseInt(rawData.tokenDecimal),
      tokenSymbol: rawData.tokenSymbol,
      tokenType: 'erc20', // Assume ERC-20 for Snowtrace token transfers
      type: 'token_transfer',
    };

    // Calculate gas fee
    if (rawData.gasUsed && rawData.gasPrice) {
      const gasUsed = BigInt(rawData.gasUsed);
      const gasPrice = BigInt(rawData.gasPrice);
      transaction.feeAmount = (gasUsed * gasPrice).toString();
      transaction.feeCurrency = 'AVAX';
    }

    return ok(transaction);
  }
}
