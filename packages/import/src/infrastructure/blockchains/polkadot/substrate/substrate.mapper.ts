import { Decimal } from 'decimal.js';
import { type Result, err, ok } from 'neverthrow';

import type { ImportSessionMetadata } from '../../../../app/ports/processors.ts';
import type { UniversalBlockchainTransaction } from '../../../../app/ports/raw-data-mappers.ts';
import { RegisterTransactionMapper } from '../../../shared/processors/processor-registry.ts';
import { BaseRawDataMapper } from '../../shared/base-raw-data-mapper.ts';

import { SubscanTransferSchema } from './substrate.schemas.ts';
import type {
  SubscanTransfer,
  SubstrateAccountInfo,
  SubstrateChainConfig,
  TaostatsTransaction,
} from './substrate.types.ts';
import { SUBSTRATE_CHAINS } from './substrate.types.ts';

@RegisterTransactionMapper('subscan')
export class SubstrateTransactionMapper extends BaseRawDataMapper<SubscanTransfer, UniversalBlockchainTransaction> {
  protected readonly schema = SubscanTransferSchema;

  protected mapInternal(
    rawData: SubscanTransfer,
    sessionContext: ImportSessionMetadata
  ): Result<UniversalBlockchainTransaction, string> {
    // Extract addresses from rich session context (similar to Bitcoin's approach)
    // Use derivedAddresses for SS58 variants, fallback to address for backward compatibility
    const addresses = sessionContext.derivedAddresses || (sessionContext.address ? [sessionContext.address] : []);
    const relevantAddresses = new Set(addresses);
    const chainConfig = SUBSTRATE_CHAINS['polkadot'];

    // Check if transaction involves any of our addresses
    const isFromUser = relevantAddresses.has(rawData.from);
    const isToUser = relevantAddresses.has(rawData.to);

    if (!isFromUser && !isToUser) {
      return err(`Transaction not relevant to user addresses: ${Array.from(relevantAddresses).join(', ')}`);
    }

    // Convert single SubscanTransfer directly to UniversalBlockchainTransaction
    // Pass all relevant addresses for proper matching
    const transaction = this.convertSubscanTransaction(rawData, relevantAddresses, chainConfig);

    if (!transaction) {
      return err(`Failed to convert transaction for addresses: ${Array.from(relevantAddresses).join(', ')}`);
    }

    return ok(transaction);
  }

  private convertSubscanTransaction(
    transfer: SubscanTransfer,
    relevantAddresses: Set<string>,
    chainConfig: SubstrateChainConfig
  ): UniversalBlockchainTransaction | undefined {
    try {
      const isFromUser = relevantAddresses.has(transfer.from);
      const isToUser = relevantAddresses.has(transfer.to);

      if (!isFromUser && !isToUser) {
        return undefined; // Not relevant to this address
      }

      const amount = new Decimal(transfer.amount || '0');
      const divisor = new Decimal(10).pow(chainConfig.tokenDecimals);
      const amountInMainUnit = amount.dividedBy(divisor);

      const fee = new Decimal(transfer.fee || '0');
      const feeInMainUnit = fee.dividedBy(divisor);

      const type = isFromUser ? 'transfer_out' : 'transfer_in';

      return {
        amount: amountInMainUnit.toString(),
        blockHeight: transfer.block_num || 0,
        blockId: transfer.block_hash || '',
        currency: chainConfig.tokenSymbol,
        feeAmount: feeInMainUnit.toString(),
        feeCurrency: chainConfig.tokenSymbol,
        from: transfer.from,
        id: transfer.hash,
        providerId: 'subscan',
        status: transfer.success ? 'success' : 'failed',
        timestamp: transfer.block_timestamp * 1000, // Convert to milliseconds
        to: transfer.to,
        type: type === 'transfer_out' ? 'transfer_out' : 'transfer_in',
      };
    } catch (error) {
      console.warn(
        `Failed to convert Subscan transaction - Transfer: ${JSON.stringify(transfer)}, Error: ${String(error)}`
      );
      return undefined;
    }
  }
}
