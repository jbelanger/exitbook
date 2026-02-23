import type { XrpBalanceChange, XrpTransaction } from '@exitbook/blockchain-providers';
import { parseDecimal } from '@exitbook/core';
import { type Result, err, ok } from 'neverthrow';

import type { AddressContext } from '../../../shared/types/processors.js';

import type { XrpFundFlow } from './types.js';

/**
 * Analyze fund flow from normalized XRP transaction.
 * Uses balance changes from transaction metadata to determine net effect.
 */
export function analyzeXrpFundFlow(normalizedTx: XrpTransaction, context: AddressContext): Result<XrpFundFlow, string> {
  const walletAddress = context.primaryAddress;

  // Only consider XRP native currency balance changes for the wallet
  const walletBalanceChange = normalizedTx.balanceChanges?.find(
    (change: XrpBalanceChange) => change.account === walletAddress && change.currency === 'XRP'
  );

  if (!walletBalanceChange) {
    // The sender always has a balance change because XRP fees are always charged.
    // A missing balance change for the sender indicates a data extraction bug in the mapper.
    const feeAmount = parseDecimal(normalizedTx.feeAmount);
    if (normalizedTx.account === walletAddress && !feeAmount.isZero()) {
      return err(
        `Missing balance change for sender address ${walletAddress} despite nonzero fee (${normalizedTx.feeAmount} XRP). ` +
          `This indicates a data extraction bug in the mapper.`
      );
    }

    return ok({
      fromAddress: normalizedTx.account,
      toAddress: normalizedTx.destination,
      isIncoming: false,
      isOutgoing: false,
      netAmount: '0',
      feeAmount: normalizedTx.feeAmount,
    });
  }

  const currentBalance = parseDecimal(walletBalanceChange.balance);
  const previousBalance = parseDecimal(walletBalanceChange.previousBalance ?? '0');
  const balanceChange = currentBalance.minus(previousBalance);

  const isIncoming = balanceChange.greaterThan('0');
  const isOutgoing = balanceChange.lessThan('0');
  const netAmount = balanceChange.abs().toFixed();

  let fromAddress: string | undefined;
  let toAddress: string | undefined;

  if (isOutgoing) {
    fromAddress = walletAddress;
    toAddress = normalizedTx.destination;
  } else if (isIncoming) {
    fromAddress = normalizedTx.account;
    toAddress = walletAddress;
  } else {
    // No net change (rare case)
    fromAddress = normalizedTx.account;
    toAddress = normalizedTx.destination;
  }

  return ok({
    fromAddress,
    toAddress,
    isIncoming,
    isOutgoing,
    netAmount,
    feeAmount: normalizedTx.feeAmount,
  });
}

/**
 * Classify XRP transaction type for display metadata.
 * All XRP transactions are currently treated as transfers.
 * Future: differentiate based on normalizedTx.transactionType (Payment, OfferCreate, TrustSet, etc.)
 */
export function determineXrpTransactionType(_normalizedTx: XrpTransaction): 'transfer' {
  return 'transfer';
}
