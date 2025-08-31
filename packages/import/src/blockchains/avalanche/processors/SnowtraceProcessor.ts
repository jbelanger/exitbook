import { Result, err, ok } from 'neverthrow';

import { BaseProviderProcessor } from '../../../shared/processors/base-provider-processor.ts';
import type { ImportSessionMetadata } from '../../../shared/processors/interfaces.ts';
import { RegisterProcessor } from '../../../shared/processors/processor-registry.ts';
import type { UniversalBlockchainTransaction } from '../../shared/types.ts';
import { SnowtraceAnyTransactionSchema } from '../schemas.ts';
import type { SnowtraceInternalTransaction, SnowtraceTokenTransfer, SnowtraceTransaction } from '../types.ts';

export type SnowtraceRawData = {
  internal: SnowtraceInternalTransaction[];
  normal: SnowtraceTransaction[];
};

@RegisterProcessor('snowtrace')
export class SnowtraceProcessor extends BaseProviderProcessor<
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

  protected transformValidated(
    rawData: SnowtraceTransaction | SnowtraceInternalTransaction | SnowtraceTokenTransfer,
    _sessionContext: ImportSessionMetadata
  ): Result<UniversalBlockchainTransaction[], string> {
    // More robust transaction type detection with fallbacks

    // Check for token transfer first (most specific)
    if ('tokenSymbol' in rawData && rawData.tokenSymbol) {
      return this.transformTokenTransfer(rawData);
    }

    // Check for internal transaction
    if ('traceId' in rawData && rawData.traceId) {
      return this.transformInternalTransaction(rawData);
    }

    // Check for normal transaction (txreceipt_status is optional)
    if ('txreceipt_status' in rawData || ('blockHash' in rawData && 'nonce' in rawData)) {
      return this.transformNormalTransaction(rawData);
    }

    // Fallback: try to detect based on available fields
    const fields = Object.keys(rawData);

    // Has token-specific fields
    if (fields.includes('tokenName') || fields.includes('tokenDecimal') || fields.includes('contractAddress')) {
      return this.transformTokenTransfer(rawData as unknown as SnowtraceTokenTransfer);
    }

    // Has internal transaction fields
    if (fields.includes('type') || fields.includes('errCode')) {
      return this.transformInternalTransaction(rawData as unknown as SnowtraceInternalTransaction);
    }

    // Has normal transaction fields
    if (fields.includes('gasPrice') || fields.includes('gasUsed') || fields.includes('gas')) {
      return this.transformNormalTransaction(rawData as unknown as SnowtraceTransaction);
    }

    // Last resort: log the structure for debugging
    const availableFields = fields.join(', ');
    return err(`Unknown transaction type. Available fields: ${availableFields}`);
  }
}
