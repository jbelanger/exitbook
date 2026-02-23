import type { XrpBalanceChange, XrpTransaction } from '@exitbook/blockchain-providers';
import { parseDecimal } from '@exitbook/core';
import { type Result, err, ok } from 'neverthrow';

import type { FundFlowContext } from '../../../shared/types/processors.js';

import type { XrpFundFlow } from './types.js';

/**
 * Analyze fund flow from normalized XRP transaction.
 * Uses balance changes from transaction metadata to determine net effect.
 */
export function analyzeXrpFundFlow(
  normalizedTx: XrpTransaction,
  context: FundFlowContext
): Result<XrpFundFlow, string> {
  const walletAddress = context.primaryAddress;

  // Find balance change for the wallet address (XRP native currency only)
  const walletBalanceChange = normalizedTx.balanceChanges?.find(
    (change: XrpBalanceChange) => change.account === walletAddress && change.currency === 'XRP'
  );

  if (!walletBalanceChange) {
    // If the wallet initiated the transaction (is the sender), there MUST be a balance change
    // because XRP fees are always charged. Missing balance change indicates data extraction failure.
    const feeAmount = parseDecimal(normalizedTx.feeAmount);
    if (normalizedTx.account === walletAddress && !feeAmount.isZero()) {
      return err(
        `Missing balance change for sender address ${walletAddress} despite nonzero fee (${normalizedTx.feeAmount} XRP). ` +
          `This indicates a data extraction bug in the mapper.`
      );
    }

    // No balance change for this address - transaction doesn't affect this wallet
    // This could happen if tracking an address that appears in the transaction but has no balance impact
    return ok({
      fromAddress: normalizedTx.account,
      toAddress: normalizedTx.destination,
      isIncoming: false,
      isOutgoing: false,
      netAmount: '0',
      feeAmount: normalizedTx.feeAmount,
    });
  }

  // Calculate net balance change
  const currentBalance = parseDecimal(walletBalanceChange.balance);
  const previousBalance = parseDecimal(walletBalanceChange.previousBalance || '0');
  const balanceChange = currentBalance.minus(previousBalance);

  // Determine direction
  const isIncoming = balanceChange.greaterThan('0');
  const isOutgoing = balanceChange.lessThan('0');

  // Net amount is the absolute value of the balance change
  const netAmount = balanceChange.abs().toFixed();

  // Determine from/to addresses
  let fromAddress: string | undefined;
  let toAddress: string | undefined;

  if (isOutgoing) {
    // For outgoing: from = wallet, to = destination
    fromAddress = walletAddress;
    toAddress = normalizedTx.destination;
  } else if (isIncoming) {
    // For incoming: from = account (sender), to = wallet
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
 * Determine transaction type from XRP transaction.
 * XRP Ledger has various transaction types, but for simplicity we classify most as transfers.
 *
 * Note: operation_type is display metadata only - doesn't affect balance/cost basis calculations.
 */
export function determineXrpTransactionType(_normalizedTx: XrpTransaction, _context: FundFlowContext): 'transfer' {
  // For now, treat all XRP transactions as transfers
  // In the future, we could add more sophisticated type detection based on normalizedTx.transactionType
  // (Payment, OfferCreate, TrustSet, etc.)
  return 'transfer';
}
