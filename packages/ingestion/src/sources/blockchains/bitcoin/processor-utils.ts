import type { BitcoinTransaction } from '@exitbook/blockchain-providers';
import { satoshisToBtcString } from '@exitbook/blockchain-providers';
import { type Result, ok } from 'neverthrow';

import type { AddressContext } from '../../../shared/types/processors.js';

import type { BitcoinFundFlow } from './types.js';

/**
 * Analyze fund flow from normalized Bitcoin transaction with structured input/output data.
 * Per-address UTXO model: only considers the single address being processed.
 */
export function analyzeBitcoinFundFlow(
  normalizedTx: BitcoinTransaction,
  context: AddressContext
): Result<BitcoinFundFlow, string> {
  const walletAddress = context.primaryAddress;

  let totalInput = 0;
  let totalOutput = 0;
  let walletInput = 0;
  let walletOutput = 0;

  for (const input of normalizedTx.inputs) {
    const value = parseFloat(input.value);
    totalInput += value;
    if (input.address === walletAddress) {
      walletInput += value;
    }
  }

  for (const output of normalizedTx.outputs) {
    const value = parseFloat(output.value);
    totalOutput += value;
    if (output.address === walletAddress) {
      walletOutput += value;
    }
  }

  const netAmount = satoshisToBtcString(Math.abs(walletOutput - walletInput));
  const isIncoming = walletOutput > walletInput;
  const isOutgoing = walletInput > walletOutput;

  // Use wallet's own input/output address for from/to when we are the initiator/recipient
  const fromAddress = isOutgoing
    ? normalizedTx.inputs.find((input) => input.address === walletAddress)?.address
    : normalizedTx.inputs[0]?.address;

  const toAddress = isIncoming
    ? normalizedTx.outputs.find((output) => output.address === walletAddress)?.address
    : normalizedTx.outputs[0]?.address;

  return ok({
    fromAddress,
    isIncoming,
    isOutgoing,
    netAmount,
    toAddress,
    totalInput: satoshisToBtcString(totalInput),
    totalOutput: satoshisToBtcString(totalOutput),
    walletInput: satoshisToBtcString(walletInput),
    walletOutput: satoshisToBtcString(walletOutput),
  });
}
