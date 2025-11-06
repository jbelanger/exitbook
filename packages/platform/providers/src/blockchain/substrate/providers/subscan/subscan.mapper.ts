import type { SourceMetadata } from '@exitbook/core';
import { type Result, err, ok } from 'neverthrow';

import { BaseRawDataMapper } from '../../../../shared/blockchain/base/mapper.ts';
import type { NormalizationError } from '../../../../shared/blockchain/index.ts';
import { SUBSTRATE_CHAINS } from '../../chain-registry.js';
import { SubstrateTransactionSchema } from '../../schemas.js';
import type { SubstrateTransaction } from '../../types.js';

import { convertSubscanTransaction } from './subscan.mapper-utils.ts';
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
    const transaction = convertSubscanTransaction(
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
}
