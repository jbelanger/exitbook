import { parseDecimal } from '@exitbook/core';
import type { SourceMetadata } from '@exitbook/core';
import { type Result, err, ok } from 'neverthrow';

import { BaseRawDataMapper } from '../../../../shared/blockchain/base/mapper.ts';
import type { NormalizationError } from '../../../../shared/blockchain/index.ts';
import { SUBSTRATE_CHAINS } from '../../chain-registry.js';
import { SubstrateTransactionSchema } from '../../schemas.js';
import type { SubstrateTransaction } from '../../types.js';

import { SubscanTransferSchema, type SubscanTransferAugmented } from './subscan.schemas.js';

export class SubscanTransactionMapper extends BaseRawDataMapper<SubscanTransferAugmented, SubstrateTransaction> {
  protected readonly inputSchema = SubscanTransferSchema;
  protected readonly outputSchema = SubstrateTransactionSchema;

  protected mapInternal(
    rawData: SubscanTransferAugmented,
    sourceContext: SourceMetadata
  ): Result<SubstrateTransaction, NormalizationError> {
    // Use derivedAddresses for SS58 variants, fallback to address for backward compatibility
    const addresses = sourceContext.derivedAddresses || (sourceContext.address ? [sourceContext.address] : []);
    const relevantAddresses = new Set(addresses);

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

      // Subscan returns amount in human-readable format while fee is already in raw units.
      const decimalsMultiplier = parseDecimal('10').pow(nativeDecimals);
      const amountHuman = parseDecimal(transfer.amount || '0');

      // Subscan `amount` field is already in main units. Convert back to smallest units
      const amountPlanck = amountHuman.times(decimalsMultiplier);

      const feePlanck = parseDecimal(transfer.fee || '0');

      return {
        // Value information
        amount: amountPlanck.toFixed(0),
        // Block context
        blockHeight: transfer.block_num,
        blockId: transfer.hash, // Use transaction hash as block identifier

        // Chain identification
        chainName: chainConfig.chainName,
        currency: nativeCurrency,

        // Substrate-specific information
        extrinsicIndex: transfer.extrinsic_index,
        // Fee information
        feeAmount: feePlanck.toFixed(),

        feeCurrency: nativeCurrency,
        // Transaction flow data
        from: transfer.from,

        // Core transaction data
        id: transfer.hash,
        module: transfer.module,

        providerId: 'subscan',
        ss58Format: chainConfig.ss58Format,
        status: transfer.success ? 'success' : 'failed',

        timestamp: transfer.block_timestamp.getTime(),

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
