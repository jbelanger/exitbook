import type { SourceMetadata } from '@exitbook/core';
import { parseDecimal } from '@exitbook/core';
import { ok, type Result } from 'neverthrow';

import type { NormalizationError } from '../../../../shared/blockchain/index.js';
import { withValidation } from '../../../../shared/blockchain/index.js';
import { SUBSTRATE_CHAINS } from '../../chain-registry.js';
import { SubstrateTransactionSchema } from '../../schemas.js';
import type { SubstrateTransaction } from '../../types.js';

import { TaostatsTransactionSchema, type TaostatsTransaction } from './taostats.schemas.js';

/**
 * Converts a Taostats transaction to a SubstrateTransaction (internal, no validation).
 * Handles amount/fee parsing, timestamp conversion, and sets defaults for Bittensor.
 */
function convertTaostatsTransactionInternal(
  rawData: TaostatsTransaction,
  _sourceContext: SourceMetadata,
  nativeCurrency: string
): Result<SubstrateTransaction, NormalizationError> {
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
  const transaction: SubstrateTransaction = {
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
    providerName: 'taostats',
    ss58Format: chainConfig.ss58Format,
    status: 'success', // Taostats only returns successful transactions
    timestamp,
    to: toAddress,
  };

  return ok(transaction);
}

/**
 * Converts a Taostats transaction to a SubstrateTransaction with validation
 */
export const convertTaostatsTransaction = withValidation(
  TaostatsTransactionSchema,
  SubstrateTransactionSchema,
  'TaostatsTransaction'
)(convertTaostatsTransactionInternal);

/**
 * Checks if a transaction is relevant to the given addresses.
 *
 * @param rawData - Taostats transaction with address objects
 * @param relevantAddresses - Set of addresses to check against
 * @returns True if transaction involves any of the relevant addresses
 */
export function isTransactionRelevant(rawData: TaostatsTransaction, relevantAddresses: Set<string>): boolean {
  const fromAddress = rawData.from.ss58;
  const toAddress = rawData.to.ss58;

  return relevantAddresses.has(fromAddress) || relevantAddresses.has(toAddress);
}
