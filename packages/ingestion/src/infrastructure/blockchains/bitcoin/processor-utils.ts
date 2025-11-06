import type { BitcoinTransaction } from '@exitbook/providers';
import { type Result, ok } from 'neverthrow';

import type { BitcoinFundFlow } from './types.ts';

/**
 * Analyze fund flow from normalized Bitcoin transaction with structured input/output data.
 */
export function analyzeBitcoinFundFlow(
  normalizedTx: BitcoinTransaction,
  sessionMetadata: Record<string, unknown>
): Result<BitcoinFundFlow, string> {
  // Convert all wallet addresses to lowercase for case-insensitive comparison
  const allWalletAddresses = new Set(
    [
      typeof sessionMetadata.address === 'string' ? sessionMetadata.address.toLowerCase() : undefined,
      ...(Array.isArray(sessionMetadata.derivedAddresses)
        ? sessionMetadata.derivedAddresses.filter((addr): addr is string => typeof addr === 'string')
        : []
      ).map((addr) => addr.toLowerCase()),
    ].filter(Boolean)
  );

  let totalInput = 0;
  let totalOutput = 0;
  let walletInput = 0;
  let walletOutput = 0;

  // Analyze inputs
  for (const input of normalizedTx.inputs) {
    const value = parseFloat(input.value);
    totalInput += value;

    // Address already normalized by BitcoinAddressSchema
    if (input.address && allWalletAddresses.has(input.address)) {
      walletInput += value;
    }
  }

  // Analyze outputs
  for (const output of normalizedTx.outputs) {
    const value = parseFloat(output.value);
    totalOutput += value;

    // Address already normalized by BitcoinAddressSchema
    if (output.address && allWalletAddresses.has(output.address)) {
      walletOutput += value;
    }
  }

  const netAmount = (walletOutput - walletInput) / 100000000;
  const isIncoming = walletOutput > walletInput;
  const isOutgoing = walletInput > walletOutput;

  // Determine primary addresses for from/to fields
  // Addresses already normalized by BitcoinAddressSchema
  const fromAddress = isOutgoing
    ? normalizedTx.inputs.find((input) => input.address && allWalletAddresses.has(input.address))?.address
    : normalizedTx.inputs[0]?.address;

  const toAddress = isIncoming
    ? normalizedTx.outputs.find((output) => output.address && allWalletAddresses.has(output.address))?.address
    : normalizedTx.outputs[0]?.address;

  return ok({
    fromAddress,
    isIncoming,
    isOutgoing,
    netAmount: Math.abs(netAmount).toString(),
    toAddress,
    totalInput: (totalInput / 100000000).toString(),
    totalOutput: (totalOutput / 100000000).toString(),
    walletInput: (walletInput / 100000000).toString(),
    walletOutput: (walletOutput / 100000000).toString(),
  });
}

/**
 * Determine transaction type from fund flow analysis.
 */
export function determineBitcoinTransactionType(
  fundFlow: BitcoinFundFlow,
  _sessionMetadata: Record<string, unknown>
): 'deposit' | 'withdrawal' | 'transfer' | 'fee' {
  const { isIncoming, isOutgoing, walletInput, walletOutput } = fundFlow;

  // Check if this is a fee-only transaction
  const walletInputNum = parseFloat(walletInput);
  const walletOutputNum = parseFloat(walletOutput);
  const netAmount = Math.abs(walletOutputNum - walletInputNum);

  if (netAmount < 0.00001 && walletInputNum > 0) {
    // Very small net change with wallet involvement
    return 'fee';
  }

  // Determine transaction type based on fund flow direction
  if (isIncoming && isOutgoing) {
    // Both incoming and outgoing - internal transfer or self-send with change
    return 'transfer';
  } else if (isIncoming && !isOutgoing) {
    // Only incoming - deposit
    return 'deposit';
  } else if (!isIncoming && isOutgoing) {
    // Only outgoing - withdrawal
    return 'withdrawal';
  } else {
    // Neither incoming nor outgoing - shouldn't happen but default to transfer
    return 'transfer';
  }
}
