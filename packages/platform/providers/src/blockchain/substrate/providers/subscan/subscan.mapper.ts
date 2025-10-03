import type { RawTransactionMetadata, ImportSessionMetadata } from '@exitbook/data';
import { Decimal } from 'decimal.js';
import { type Result, err, ok } from 'neverthrow';

import { BaseRawDataMapper } from '../../../../core/blockchain/base-raw-data-mapper.ts';
import { RegisterTransactionMapper } from '../../../../core/blockchain/index.ts';
import type { NormalizationError } from '../../../../ports/blockchain-normalizer.interface.ts';
import { SUBSTRATE_CHAINS } from '../../chain-registry.js';
import { SubstrateTransactionSchema } from '../../schemas.js';
import type { SubstrateTransaction } from '../../types.js';

import { SubscanTransferSchema } from './subscan.schemas.js';
import type { SubscanTransferAugmented } from './subscan.types.js';

@RegisterTransactionMapper('subscan')
export class SubscanTransactionMapper extends BaseRawDataMapper<SubscanTransferAugmented, SubstrateTransaction> {
  protected readonly inputSchema = SubscanTransferSchema;
  protected readonly outputSchema = SubstrateTransactionSchema;

  protected mapInternal(
    rawData: SubscanTransferAugmented,
    _metadata: RawTransactionMetadata,
    sessionContext: ImportSessionMetadata
  ): Result<SubstrateTransaction, NormalizationError> {
    // Extract addresses from rich session context (similar to Bitcoin's approach)
    // Use derivedAddresses for SS58 variants, fallback to address for backward compatibility
    const addresses = sessionContext.derivedAddresses || (sessionContext.address ? [sessionContext.address] : []);
    const relevantAddresses = new Set(addresses);

    // Get chain-specific info from augmented fields
    const nativeCurrency = rawData._nativeCurrency;
    const nativeDecimals = rawData._nativeDecimals;

    // Determine chain from native currency
    // DOT = polkadot, KSM = kusama (when kusama config is added)
    const chainKey = nativeCurrency === 'DOT' ? 'polkadot' : nativeCurrency === 'KSM' ? 'kusama' : undefined;

    if (!chainKey) {
      return err({ message: `Unable to determine chain from currency: ${nativeCurrency}`, type: 'error' });
    }

    const chainConfig = SUBSTRATE_CHAINS[chainKey as keyof typeof SUBSTRATE_CHAINS];
    if (!chainConfig) {
      return err({
        message: `Unsupported Substrate chain in SubscanTransactionMapper: ${chainKey} (currency: ${nativeCurrency})`,
        type: 'error',
      });
    }

    // Check if transaction involves any of our addresses
    const isFromUser = relevantAddresses.has(rawData.from);
    const isToUser = relevantAddresses.has(rawData.to);

    if (!isFromUser && !isToUser) {
      return err({
        message: `Transaction not relevant to user addresses: ${Array.from(relevantAddresses).join(', ')}`,
        type: 'error',
      });
    }

    // Convert single SubscanTransfer directly to SubstrateTransaction
    const transaction = this.convertSubscanTransaction(
      rawData,
      relevantAddresses,
      chainConfig,
      nativeCurrency,
      nativeDecimals
    );

    if (!transaction) {
      return err({
        message: `Failed to convert transaction for addresses: ${Array.from(relevantAddresses).join(', ')}`,
        type: 'error',
      });
    }

    return ok(transaction);
  }

  private convertSubscanTransaction(
    transfer: SubscanTransferAugmented,
    relevantAddresses: Set<string>,
    chainConfig: (typeof SUBSTRATE_CHAINS)[keyof typeof SUBSTRATE_CHAINS],
    nativeCurrency: string,
    nativeDecimals: number
  ): SubstrateTransaction | undefined {
    try {
      const isFromUser = relevantAddresses.has(transfer.from);
      const isToUser = relevantAddresses.has(transfer.to);

      if (!isFromUser && !isToUser) {
        return undefined; // Not relevant to this address
      }

      const amount = new Decimal(transfer.amount || '0');
      const divisor = new Decimal(10).pow(nativeDecimals);
      const amountInMainUnit = amount.dividedBy(divisor);

      const fee = new Decimal(transfer.fee || '0');
      const feeInMainUnit = fee.dividedBy(divisor);

      return {
        // Value information
        amount: amountInMainUnit.toString(),
        // Block context
        blockHeight: transfer.block_num,
        blockId: transfer.hash, // Use transaction hash as block identifier

        // Chain identification
        chainName: chainConfig.chainName,
        currency: nativeCurrency,

        // Substrate-specific information
        extrinsicIndex: transfer.extrinsic_index,
        // Fee information
        feeAmount: feeInMainUnit.toString(),

        feeCurrency: nativeCurrency,
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
      };
    } catch (error) {
      console.warn(
        `Failed to convert Subscan transaction - Transfer: ${JSON.stringify(transfer)}, Error: ${String(error)}`
      );
      return undefined;
    }
  }
}
