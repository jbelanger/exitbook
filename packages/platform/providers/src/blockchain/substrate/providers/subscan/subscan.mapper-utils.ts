import { parseDecimal } from '@exitbook/core';

import type { SUBSTRATE_CHAINS } from '../../chain-registry.js';
import type { SubstrateTransaction } from '../../types.js';

import type { SubscanTransferAugmented } from './subscan.schemas.js';

/**
 * Converts a Subscan transfer to a SubstrateTransaction.
 * Handles address relevance checking, amount/fee conversion, and status mapping.
 *
 * @param transfer - Augmented Subscan transfer object
 * @param relevantAddresses - Set of addresses to check relevance
 * @param chainConfig - Chain configuration
 * @param nativeCurrency - Native currency symbol (DOT, KSM, etc.)
 * @param nativeDecimals - Number of decimals for the currency
 * @returns SubstrateTransaction or undefined if not relevant
 */
export function convertSubscanTransaction(
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

      providerName: 'subscan',
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
