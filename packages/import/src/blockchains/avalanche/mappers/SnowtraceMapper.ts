import { Result, ok } from 'neverthrow';

import type { ImportSessionMetadata } from '../../../shared/processors/interfaces.ts';
import { RegisterTransactionMapper } from '../../../shared/processors/processor-registry.ts';
import { BaseRawDataMapper } from '../../shared/base-raw-data-mapper.ts';
import type { UniversalBlockchainTransaction } from '../../shared/types.ts';
import { SnowtraceAnyTransactionSchema } from '../schemas.ts';
import type { SnowtraceInternalTransaction, SnowtraceTokenTransfer, SnowtraceTransaction } from '../types.ts';

export type SnowtraceRawData = {
  internal: SnowtraceInternalTransaction[];
  normal: SnowtraceTransaction[];
};

@RegisterTransactionMapper('snowtrace')
export class SnowtraceTransactionMapper extends BaseRawDataMapper<
  SnowtraceTransaction | SnowtraceInternalTransaction | SnowtraceTokenTransfer
> {
  protected readonly schema = SnowtraceAnyTransactionSchema;

  private transformInternalTransaction(
    rawData: SnowtraceInternalTransaction
  ): Result<UniversalBlockchainTransaction[], string> {
    const timestamp = parseInt(rawData.timeStamp) * 1000;

    return ok([
      {
        amount: rawData.value,
        blockHeight: parseInt(rawData.blockNumber),
        currency: 'AVAX',
        from: rawData.from,
        id: rawData.hash,
        providerId: 'snowtrace',
        status: rawData.isError === '0' ? 'success' : 'failed',
        timestamp,
        to: rawData.to,
        type: 'internal',
      },
    ]);
  }

  private transformNormalTransaction(rawData: SnowtraceTransaction): Result<UniversalBlockchainTransaction[], string> {
    const timestamp = parseInt(rawData.timeStamp) * 1000;

    // Calculate fee from gas data
    let feeAmount: string | undefined;
    if (rawData.gasUsed && rawData.gasPrice) {
      const gasUsed = BigInt(rawData.gasUsed);
      const gasPrice = BigInt(rawData.gasPrice);
      feeAmount = (gasUsed * gasPrice).toString();
    }

    const transaction: UniversalBlockchainTransaction = {
      amount: rawData.value,
      blockHeight: parseInt(rawData.blockNumber),
      blockId: rawData.blockHash,
      currency: 'AVAX',
      from: rawData.from,
      id: rawData.hash,
      providerId: 'snowtrace',
      status: rawData.txreceipt_status === '1' ? 'success' : 'failed',
      timestamp,
      to: rawData.to,
      type: rawData.functionName ? 'contract_call' : 'transfer',
    };

    if (feeAmount) {
      transaction.feeAmount = feeAmount;
      transaction.feeCurrency = 'AVAX';
    }

    return ok([transaction]);
  }

  private transformTokenTransfer(rawData: SnowtraceTokenTransfer): Result<UniversalBlockchainTransaction[], string> {
    const timestamp = parseInt(rawData.timeStamp) * 1000;

    // Calculate fee from gas data
    let feeAmount: string | undefined;
    if (rawData.gasUsed && rawData.gasPrice) {
      const gasUsed = BigInt(rawData.gasUsed);
      const gasPrice = BigInt(rawData.gasPrice);
      feeAmount = (gasUsed * gasPrice).toString();
    }

    const transaction: UniversalBlockchainTransaction = {
      amount: rawData.value,
      blockHeight: parseInt(rawData.blockNumber),
      blockId: rawData.blockHash,
      currency: rawData.tokenSymbol,
      from: rawData.from,
      id: rawData.hash,
      providerId: 'snowtrace',
      status: 'success',
      timestamp,
      to: rawData.to,
      tokenAddress: rawData.contractAddress,
      tokenDecimals: parseInt(rawData.tokenDecimal),
      tokenSymbol: rawData.tokenSymbol,
      type: 'token_transfer',
    };

    if (feeAmount) {
      transaction.feeAmount = feeAmount;
      transaction.feeCurrency = 'AVAX';
    }

    return ok([transaction]);
  }

  protected mapInternal(
    rawData: SnowtraceTransaction | SnowtraceInternalTransaction | SnowtraceTokenTransfer,
    _sessionContext: ImportSessionMetadata
  ): Result<UniversalBlockchainTransaction[], string> {
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
}
