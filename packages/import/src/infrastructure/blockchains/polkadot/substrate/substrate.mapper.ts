import type { ImportSessionMetadata } from '@exitbook/import/app/ports/processors.js';
import { Decimal } from 'decimal.js';
import { type Result, err, ok } from 'neverthrow';

import { RegisterTransactionMapper } from '../../../shared/processors/processor-registry.js';
import { BaseRawDataMapper } from '../../shared/base-raw-data-mapper.js';
import type { SubstrateTransaction } from '../substrate-types.js';

import { SubscanTransferSchema } from './substrate.schemas.js';
import { SUBSTRATE_CHAINS } from './substrate.types.js';
import type {
  SubscanTransfer,
  SubstrateAccountInfo,
  SubstrateChainConfig,
  TaostatsTransaction,
} from './substrate.types.ts';

@RegisterTransactionMapper('subscan')
export class SubstrateTransactionMapper extends BaseRawDataMapper<SubscanTransfer, SubstrateTransaction> {
  protected readonly schema = SubscanTransferSchema;

  protected mapInternal(
    rawData: SubscanTransfer,
    sessionContext: ImportSessionMetadata
  ): Result<SubstrateTransaction, string> {
    // Extract addresses from rich session context (similar to Bitcoin's approach)
    // Use derivedAddresses for SS58 variants, fallback to address for backward compatibility
    const addresses = sessionContext.derivedAddresses || (sessionContext.address ? [sessionContext.address] : []);
    const relevantAddresses = new Set(addresses);
    const chainConfig = SUBSTRATE_CHAINS['polkadot'];

    if (!chainConfig) {
      return err(`Unsupported Substrate chain in SubscanTransactionMapper`);
    }

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
  ): SubstrateTransaction | undefined {
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

      return {
        // Value information
        amount: amountInMainUnit.toString(),
        // Block context
        blockHeight: transfer.block_num || 0,
        blockId: transfer.block_hash || '',
        call: transfer.call,

        // Chain identification
        chainName: chainConfig.name,
        currency: chainConfig.tokenSymbol,

        // Substrate-specific information
        extrinsicIndex: transfer.extrinsic_index,
        // Fee information
        feeAmount: feeInMainUnit.toString(),

        feeCurrency: chainConfig.tokenSymbol,
        // Transaction flow data
        from: transfer.from,

        // Core transaction data
        id: transfer.hash,
        module: transfer.module,

        providerId: 'subscan',
        ss58Format: chainConfig.ss58Format,
        status: transfer.success ? 'success' : 'failed',

        timestamp: transfer.block_timestamp * 1000, // Convert to milliseconds

        to: transfer.to,
        // Transaction type classification
        type: 'transfer',
      };
    } catch (error) {
      console.warn(
        `Failed to convert Subscan transaction - Transfer: ${JSON.stringify(transfer)}, Error: ${String(error)}`
      );
      return undefined;
    }
  }
}
