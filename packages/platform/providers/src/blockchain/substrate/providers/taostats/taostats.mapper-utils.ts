import { parseDecimal } from '@exitbook/core';

import { SUBSTRATE_CHAINS } from '../../chain-registry.js';
import type { SubstrateTransaction } from '../../types.js';

import type { TaostatsTransactionAugmented } from './taostats.schemas.js';

/**
 * Converts a Taostats transaction to a SubstrateTransaction.
 * Handles amount/fee parsing, timestamp conversion, and sets defaults for Bittensor.
 *
 * @param rawData - Augmented Taostats transaction object
 * @param nativeCurrency - Native currency symbol (TAO)
 * @returns SubstrateTransaction
 */
export function convertTaostatsTransaction(
  rawData: TaostatsTransactionAugmented,
  nativeCurrency: string
): SubstrateTransaction {
  // Extract SS58 addresses from address objects
  const fromAddress = rawData.from.ss58;
  const toAddress = rawData.to.ss58;

  // Get Bittensor chain config for ss58Format
  const chainConfig = SUBSTRATE_CHAINS.bittensor;
  if (!chainConfig) {
    throw new Error('Bittensor chain configuration not found');
  }

  // Parse amount (rao = smallest unit). Provider already returns planck values so keep raw units.
  const amountPlanck = parseDecimal(rawData.amount);

  // Parse fee if available - remains in planck units for processor normalization.
  const feePlanck = parseDecimal(rawData.fee || '0');

  // Parse timestamp (ISO string to milliseconds)
  const timestamp = new Date(rawData.timestamp).getTime();

  // Build the normalized SubstrateTransaction
  // Note: Taostats only provides basic transfer data, no module/call/events information
  // The processor will handle classification based on available fields
  return {
    amount: amountPlanck.toFixed(),
    blockHeight: rawData.block_number,
    chainName: chainConfig.chainName,
    currency: nativeCurrency,
    extrinsicIndex: rawData.extrinsic_id,
    feeAmount: feePlanck.toFixed(),
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
}

/**
 * Checks if a transaction is relevant to the given addresses.
 *
 * @param rawData - Taostats transaction with address objects
 * @param relevantAddresses - Set of addresses to check against
 * @returns True if transaction involves any of the relevant addresses
 */
export function isTransactionRelevant(rawData: TaostatsTransactionAugmented, relevantAddresses: Set<string>): boolean {
  const fromAddress = rawData.from.ss58;
  const toAddress = rawData.to.ss58;

  return relevantAddresses.has(fromAddress) || relevantAddresses.has(toAddress);
}
