import type { BitcoinTransaction } from '@exitbook/blockchain-providers';
import { satoshisToBtcString } from '@exitbook/blockchain-providers';
import { Decimal } from 'decimal.js';
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

  let totalInput = new Decimal(0);
  let totalOutput = new Decimal(0);
  let walletInput = new Decimal(0);
  let walletOutput = new Decimal(0);

  for (const input of normalizedTx.inputs) {
    const value = new Decimal(input.value);
    totalInput = totalInput.plus(value);
    if (input.address === walletAddress) {
      walletInput = walletInput.plus(value);
    }
  }

  for (const output of normalizedTx.outputs) {
    const value = new Decimal(output.value);
    totalOutput = totalOutput.plus(value);
    if (output.address === walletAddress) {
      walletOutput = walletOutput.plus(value);
    }
  }

  const netAmount = satoshisToBtcString(walletOutput.minus(walletInput).abs().toNumber());
  const isIncoming = walletOutput.greaterThan(walletInput);
  const isOutgoing = walletInput.greaterThan(walletOutput);

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
    totalInput: satoshisToBtcString(totalInput.toNumber()),
    totalOutput: satoshisToBtcString(totalOutput.toNumber()),
    walletInput: satoshisToBtcString(walletInput.toNumber()),
    walletOutput: satoshisToBtcString(walletOutput.toNumber()),
  });
}
