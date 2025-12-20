import { parseDecimal } from '@exitbook/core';
import { getLogger } from '@exitbook/logger';
import { err, type Result } from 'neverthrow';

import { generateUniqueTransactionEventId, type NormalizationError } from '../../../../core/index.js';
import { validateOutput } from '../../../../core/index.js';
import type { SUBSTRATE_CHAINS } from '../../chain-registry.js';
import { SubstrateTransactionSchema } from '../../schemas.js';
import type { SubstrateTransaction } from '../../types.js';
import { trySubstrateAddressToAccountIdHex } from '../../utils.js';

import type { SubscanTransfer } from './subscan.schemas.js';

const logger = getLogger('SubscanMapper');

/**
 * Converts a Subscan transfer to a SubstrateTransaction
 * Input is already validated by HTTP client, output validated here
 * Handles address relevance checking, amount/fee conversion, and status mapping.
 */
export function convertSubscanTransaction(
  transfer: SubscanTransfer,
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
  const amount = amountPlanck.toFixed(0);
  const timestamp = transfer.block_timestamp.getTime();
  const eventIdx = transfer.event_idx ?? undefined;
  const transferId = transfer.transfer_id ?? undefined;

  const eventDiscriminator =
    eventIdx !== undefined
      ? `event_idx:${eventIdx}`
      : transferId !== undefined
        ? `transfer_id:${transferId}`
        : undefined;
  if (!eventDiscriminator) {
    logger.warn(
      { hash: transfer.hash, extrinsicIndex: transfer.extrinsic_index },
      'Subscan transfer missing event discriminator (event_idx/transfer_id); eventId may collide for batch extrinsics'
    );
  }

  const fromIdentity = trySubstrateAddressToAccountIdHex(transfer.from) ?? transfer.from;
  const toIdentity = trySubstrateAddressToAccountIdHex(transfer.to) ?? transfer.to;

  const transaction: SubstrateTransaction = {
    // Value information
    amount,
    // Block context
    blockHeight: transfer.block_num,
    blockId: transfer.hash, // Use transaction hash as block identifier

    // Chain identification
    chainName: chainConfig.chainName,
    currency: nativeCurrency,

    eventId: generateUniqueTransactionEventId({
      amount,
      currency: nativeCurrency,
      from: fromIdentity,
      id: transfer.hash,
      timestamp,
      to: toIdentity,
      traceId: eventDiscriminator ? `${transfer.extrinsic_index}|${eventDiscriminator}` : transfer.extrinsic_index,
      type: 'transfer',
    }),
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

    timestamp,

    to: transfer.to,
  };

  return validateOutput(transaction, SubstrateTransactionSchema, 'SubscanTransfer');
}
