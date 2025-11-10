import type { SourceMetadata } from '@exitbook/core';
import { parseDecimal } from '@exitbook/core';
import { err, ok, type Result } from 'neverthrow';

import type { NormalizationError } from '../../../../shared/blockchain/index.js';
import { withValidation } from '../../../../shared/blockchain/index.js';
import type { SUBSTRATE_CHAINS } from '../../chain-registry.js';
import { SubstrateTransactionSchema } from '../../schemas.js';
import type { SubstrateTransaction } from '../../types.js';

import { SubscanTransferBaseSchema, type SubscanTransfer } from './subscan.schemas.js';

/**
 * Converts a Subscan transfer to a SubstrateTransaction (internal, no validation).
 * Handles address relevance checking, amount/fee conversion, and status mapping.
 */
function convertSubscanTransactionInternal(
  transfer: SubscanTransfer,
  _sourceContext: SourceMetadata,
  relevantAddresses: Set<string>,
  chainConfig: (typeof SUBSTRATE_CHAINS)[keyof typeof SUBSTRATE_CHAINS],
  nativeCurrency: string,
  nativeDecimals: number
): Result<SubstrateTransaction, NormalizationError> {
  const isFromUser = relevantAddresses.has(transfer.from);
  const isToUser = relevantAddresses.has(transfer.to);

  if (!isFromUser && !isToUser) {
    return err({ reason: 'Transaction not relevant to wallet addresses', type: 'skip' });
  }

  // Subscan returns amount in human-readable format while fee is already in raw units.
  const decimalsMultiplier = parseDecimal('10').pow(nativeDecimals);
  const amountHuman = parseDecimal(transfer.amount || '0');

  // Subscan `amount` field is already in main units. Convert back to smallest units
  const amountPlanck = amountHuman.times(decimalsMultiplier);

  const feePlanck = parseDecimal(transfer.fee || '0');

  const transaction: SubstrateTransaction = {
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

  return ok(transaction);
}

/**
 * Converts a Subscan transfer to a SubstrateTransaction with validation
 */
export const convertSubscanTransaction = withValidation(
  SubscanTransferBaseSchema,
  SubstrateTransactionSchema,
  'SubscanTransfer'
)(convertSubscanTransactionInternal);
