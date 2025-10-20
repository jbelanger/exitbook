import { parseDecimal, type RawTransactionMetadata } from '@exitbook/core';
import type { ImportSessionMetadata } from '@exitbook/data';
import { type Result, err, ok } from 'neverthrow';

import { BaseRawDataMapper } from '../../../../core/blockchain/base/mapper.ts';
import type { NormalizationError } from '../../../../core/blockchain/index.ts';
import { SUBSTRATE_CHAINS } from '../../chain-registry.js';
import { SubstrateTransactionSchema } from '../../schemas.js';
import type { SubstrateTransaction } from '../../types.js';

import { TaostatsTransactionRawSchema } from './taostats.schemas.js';
import type { TaostatsTransactionAugmented } from './taostats.types.js';

export class TaostatsTransactionMapper extends BaseRawDataMapper<TaostatsTransactionAugmented, SubstrateTransaction> {
  protected readonly inputSchema = TaostatsTransactionRawSchema;
  protected readonly outputSchema = SubstrateTransactionSchema;

  protected mapInternal(
    rawData: TaostatsTransactionAugmented,
    _metadata: RawTransactionMetadata,
    sessionContext: ImportSessionMetadata
  ): Result<SubstrateTransaction, NormalizationError> {
    // Extract SS58 addresses from address objects
    const fromAddress = rawData.from.ss58;
    const toAddress = rawData.to.ss58;

    // Extract addresses from session context
    const addresses = sessionContext.derivedAddresses || (sessionContext.address ? [sessionContext.address] : []);
    const relevantAddresses = new Set(addresses);

    // Check if transaction involves any of our addresses
    const isFromUser = relevantAddresses.has(fromAddress);
    const isToUser = relevantAddresses.has(toAddress);

    if (!isFromUser && !isToUser) {
      return err({
        message: `Transaction not relevant to user addresses: ${Array.from(relevantAddresses).join(', ')}`,
        type: 'error',
      });
    }

    // Get chain-specific info from augmented fields
    const nativeCurrency = rawData._nativeCurrency;
    const nativeDecimals = rawData._nativeDecimals;

    // Get Bittensor chain config for ss58Format
    const chainConfig = SUBSTRATE_CHAINS.bittensor;
    if (!chainConfig) {
      return err({
        message: 'Bittensor chain configuration not found',
        type: 'error',
      });
    }

    // Parse amount (in rao, smallest unit) - Zod already validated it's numeric
    const amountRao = parseDecimal(rawData.amount);
    const divisor = parseDecimal('10').pow(nativeDecimals);
    const amountTao = amountRao.dividedBy(divisor);

    // Parse fee if available - Zod already validated it's numeric
    const feeRao = parseDecimal(rawData.fee || '0');
    const feeTao = feeRao.dividedBy(divisor);

    // Parse timestamp (ISO string to milliseconds) - Zod already validated format
    const timestamp = new Date(rawData.timestamp).getTime();

    // Build the normalized SubstrateTransaction
    // Note: Taostats only provides basic transfer data, no module/call/events information
    // The processor will handle classification based on available fields
    const transaction: SubstrateTransaction = {
      amount: amountTao.toFixed(),
      blockHeight: rawData.block_number,
      chainName: chainConfig.chainName, // Use chain config for consistency
      currency: nativeCurrency,
      extrinsicIndex: rawData.extrinsic_id,
      feeAmount: feeTao.toFixed(),
      feeCurrency: nativeCurrency,
      from: fromAddress,
      id: rawData.transaction_hash,
      module: 'balances', // Taostats doesn't provide this, assume balances module for transfers
      providerId: 'taostats',
      ss58Format: chainConfig.ss58Format,
      status: 'success', // Taostats only returns successful transactions
      timestamp,
      to: toAddress,
    };

    return ok(transaction);
  }
}
