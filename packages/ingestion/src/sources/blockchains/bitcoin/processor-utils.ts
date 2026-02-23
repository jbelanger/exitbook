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
  // Per-address mode: only check this single address
  const walletAddress = context.primaryAddress;

  const addressSet = new Set([walletAddress]);

  let totalInput = 0;
  let totalOutput = 0;
  let walletInput = 0;
  let walletOutput = 0;

  // Analyze inputs
  for (const input of normalizedTx.inputs) {
    const value = parseFloat(input.value);
    totalInput += value;

    // Address already normalized by BitcoinAddressSchema
    if (input.address && addressSet.has(input.address)) {
      walletInput += value;
    }
  }

  // Analyze outputs
  for (const output of normalizedTx.outputs) {
    const value = parseFloat(output.value);
    totalOutput += value;

    // Address already normalized by BitcoinAddressSchema
    if (output.address && addressSet.has(output.address)) {
      walletOutput += value;
    }
  }

  const netAmount = satoshisToBtcString(Math.abs(walletOutput - walletInput));
  const isIncoming = walletOutput > walletInput;
  const isOutgoing = walletInput > walletOutput;

  // Determine primary addresses for from/to fields
  // Addresses already normalized by BitcoinAddressSchema
  const fromAddress = isOutgoing
    ? normalizedTx.inputs.find((input) => input.address && addressSet.has(input.address))?.address
    : normalizedTx.inputs[0]?.address;

  const toAddress = isIncoming
    ? normalizedTx.outputs.find((output) => output.address && addressSet.has(output.address))?.address
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

/**
 * Determine transaction type from fund flow analysis.
 * Per-address UTXO model: returns generic 'transfer' type.
 *
 * Without derivedAddresses, we can't reliably distinguish:
 * - External deposit vs internal change receipt
 * - External withdrawal vs internal send to sibling address
 *
 * Solution: Use generic 'transfer' type for all UTXO movements.
 * Transaction linking can later provide semantic classification if needed.
 *
 * Note: operation_type is display metadata only - doesn't affect balance/cost basis calculations.
 */
export function determineBitcoinTransactionType(_fundFlow: BitcoinFundFlow, _context: AddressContext): 'transfer' {
  return 'transfer';
}
