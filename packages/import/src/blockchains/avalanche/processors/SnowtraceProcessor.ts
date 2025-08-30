import { Result, err, ok } from 'neverthrow';

import { BaseProviderProcessor } from '../../../shared/processors/base-provider-processor.ts';
import type { ImportSessionMetadata } from '../../../shared/processors/interfaces.ts';
import { RegisterProcessor } from '../../../shared/processors/processor-registry.ts';
import { SnowtraceTransactionSchema } from '../schemas.ts';
import type {
  AvalancheTransaction,
  SnowtraceInternalTransaction,
  SnowtraceTokenTransfer,
  SnowtraceTransaction,
} from '../types.ts';

export type SnowtraceRawData = {
  internal: SnowtraceInternalTransaction[];
  normal: SnowtraceTransaction[];
};

@RegisterProcessor('snowtrace')
export class SnowtraceProcessor extends BaseProviderProcessor<
  SnowtraceTransaction | SnowtraceInternalTransaction | SnowtraceTokenTransfer
> {
  protected readonly schema = SnowtraceTransactionSchema;

  private transformInternalTransaction(rawData: SnowtraceInternalTransaction): Result<AvalancheTransaction, string> {
    const timestamp = parseInt(rawData.timeStamp) * 1000;

    return ok({
      blockNumber: parseInt(rawData.blockNumber),
      contractAddress: rawData.contractAddress,
      errCode: rawData.errCode,
      from: rawData.from,
      gas: parseInt(rawData.gas),
      gasUsed: parseInt(rawData.gasUsed),
      hash: rawData.hash,
      input: rawData.input,
      isError: rawData.isError === '1',
      providerId: 'snowtrace',
      status: rawData.isError === '0' ? 'success' : 'failed',
      symbol: 'AVAX',
      timestamp,
      to: rawData.to,
      traceId: rawData.traceId,
      type: 'internal',
      value: rawData.value,
    });
  }

  private transformNormalTransaction(rawData: SnowtraceTransaction): Result<AvalancheTransaction, string> {
    const timestamp = parseInt(rawData.timeStamp) * 1000;

    return ok({
      blockHash: rawData.blockHash,
      blockNumber: parseInt(rawData.blockNumber),
      confirmations: parseInt(rawData.confirmations),
      cumulativeGasUsed: parseInt(rawData.cumulativeGasUsed),
      from: rawData.from,
      functionName: rawData.functionName,
      gas: parseInt(rawData.gas),
      gasPrice: rawData.gasPrice,
      gasUsed: parseInt(rawData.gasUsed),
      hash: rawData.hash,
      input: rawData.input,
      isError: rawData.isError === '1',
      methodId: rawData.methodId,
      nonce: rawData.nonce,
      providerId: 'snowtrace',
      status: rawData.txreceipt_status === '1' ? 'success' : 'failed',
      symbol: 'AVAX',
      timestamp,
      to: rawData.to,
      transactionIndex: parseInt(rawData.transactionIndex),
      type: 'normal',
      value: rawData.value,
    });
  }

  private transformTokenTransfer(rawData: SnowtraceTokenTransfer): Result<AvalancheTransaction, string> {
    const timestamp = parseInt(rawData.timeStamp) * 1000;

    return ok({
      blockHash: rawData.blockHash,
      blockNumber: parseInt(rawData.blockNumber),
      confirmations: parseInt(rawData.confirmations),
      contractAddress: rawData.contractAddress,
      cumulativeGasUsed: parseInt(rawData.cumulativeGasUsed),
      from: rawData.from,
      gas: parseInt(rawData.gas),
      gasPrice: rawData.gasPrice,
      gasUsed: parseInt(rawData.gasUsed),
      hash: rawData.hash,
      input: rawData.input,
      nonce: rawData.nonce,
      providerId: 'snowtrace',
      status: 'success',
      symbol: rawData.tokenSymbol,
      timestamp,
      to: rawData.to,
      tokenDecimal: parseInt(rawData.tokenDecimal),
      tokenName: rawData.tokenName,
      transactionIndex: parseInt(rawData.transactionIndex),
      type: 'token',
      value: rawData.value,
    });
  }

  protected transformValidated(
    rawData: SnowtraceTransaction | SnowtraceInternalTransaction | SnowtraceTokenTransfer,
    _sessionContext: ImportSessionMetadata
  ): Result<AvalancheTransaction, string> {
    // Determine transaction type and convert accordingly
    if ('txreceipt_status' in rawData) {
      // Normal transaction
      return this.transformNormalTransaction(rawData);
    } else if ('traceId' in rawData) {
      // Internal transaction
      return this.transformInternalTransaction(rawData);
    } else if ('tokenSymbol' in rawData) {
      // Token transfer
      return this.transformTokenTransfer(rawData);
    } else {
      return err('Unknown transaction type');
    }
  }
}
