import { parseDecimal } from '@exitbook/core';
import type { Decimal } from 'decimal.js';
import { type Result, ok, err } from 'neverthrow';

import type { NormalizationError } from '../../../../core/index.js';
import { withValidation } from '../../../../core/index.js';
import { EvmTransactionSchema } from '../../schemas.js';
import type { EvmTransaction } from '../../types.js';
import { normalizeEvmAddress } from '../../utils.js';

import {
  ThetaTransactionSchema,
  type ThetaTransaction,
  type ThetaSendTransactionData,
  type ThetaSmartContractData,
} from './theta-explorer.schemas.js';

/**
 * Pure functions for Theta Explorer transaction mapping
 * Following the Functional Core / Imperative Shell pattern
 */

/**
 * Determines which currency was transferred when multiple currencies are available.
 * Prioritizes THETA over TFUEL for Theta blockchain transactions.
 *
 * @param thetaAmount - THETA amount
 * @param tfuelAmount - TFUEL amount
 * @returns Currency symbol and amount
 */
export function selectThetaCurrency(thetaAmount: Decimal, tfuelAmount: Decimal): { amount: Decimal; currency: string } {
  if (thetaAmount.gt(0)) {
    return { currency: 'THETA', amount: thetaAmount };
  } else if (tfuelAmount.gt(0)) {
    return { currency: 'TFUEL', amount: tfuelAmount };
  } else {
    return { currency: 'TFUEL', amount: parseDecimal('0') };
  }
}

/**
 * Determines if a THETA transfer should be mapped as token_transfer.
 * THETA is mapped as token_transfer to preserve symbol, while TFUEL is native.
 *
 * @param currency - Currency symbol ('THETA' or 'TFUEL')
 * @returns True if this should be a token transfer
 */
export function isThetaTokenTransfer(currency: string): boolean {
  return currency === 'THETA';
}

/**
 * Formats amount for Theta transactions based on whether it's THETA or TFUEL.
 * THETA: Convert from wei to decimal
 * TFUEL: Keep in wei
 *
 * @param amount - Amount in wei
 * @param isThetaTransfer - True if this is a THETA transfer
 * @param decimals - Number of decimals (typically 18)
 * @returns Formatted amount string
 */
export function formatThetaAmount(amount: Decimal, isThetaTransfer: boolean, decimals: number): string {
  return isThetaTransfer ? amount.dividedBy(parseDecimal('10').pow(decimals)).toFixed() : amount.toFixed(0); // Use toFixed(0) to avoid scientific notation
}

/**
 * Extracts transaction details from Type 2 (Send) transaction
 */
function extractSendTransactionDetails(data: ThetaSendTransactionData): {
  amount: Decimal;
  currency: string;
  from: string;
  to: string;
} {
  // Get from/to addresses and normalize
  const from = normalizeEvmAddress(data.source?.address || data.inputs?.[0]?.address) || '0x0';
  const to = normalizeEvmAddress(data.target?.address || data.outputs?.[0]?.address) || '0x0';

  // Determine currency and amount
  // The API can use either source/target OR inputs/outputs pattern
  // Check both TFUEL and THETA, prioritize THETA over TFUEL (for consistency with ThetaScan)

  // Try target first, then outputs[0]
  const tfuelWei = parseDecimal(data.target?.coins?.tfuelwei || data.outputs?.[0]?.coins?.tfuelwei || '0');
  const thetaWei = parseDecimal(data.target?.coins?.thetawei || data.outputs?.[0]?.coins?.thetawei || '0');

  const targetResult = selectThetaCurrency(thetaWei, tfuelWei);

  if (targetResult.amount.gt(0)) {
    return { from, to, currency: targetResult.currency, amount: targetResult.amount };
  }

  // If both are zero, check source/inputs for outgoing amounts
  const sourceTfuel = parseDecimal(data.source?.coins?.tfuelwei || data.inputs?.[0]?.coins?.tfuelwei || '0');
  const sourceTheta = parseDecimal(data.source?.coins?.thetawei || data.inputs?.[0]?.coins?.thetawei || '0');

  const sourceResult = selectThetaCurrency(sourceTheta, sourceTfuel);
  return { from, to, currency: sourceResult.currency, amount: sourceResult.amount };
}

/**
 * Extracts transaction details from Type 7 (Smart Contract) transaction
 */
function extractSmartContractTransactionDetails(data: ThetaSmartContractData): {
  amount: Decimal;
  currency: string;
  from: string;
  to: string;
} {
  const from = normalizeEvmAddress(data.from?.address) || '0x0';
  const to = normalizeEvmAddress(data.to?.address) || '0x0';

  // For smart contract transactions, check both coins, prioritize THETA over TFUEL
  const tfuelWei = parseDecimal(data.to?.coins?.tfuelwei || '0');
  const thetaWei = parseDecimal(data.to?.coins?.thetawei || '0');

  const result = selectThetaCurrency(thetaWei, tfuelWei);
  return { from, to, currency: result.currency, amount: result.amount };
}

/**
 * Maps Theta Explorer transaction to normalized EvmTransaction (internal)
 */
function mapThetaExplorerTransactionInternal(rawData: ThetaTransaction): Result<EvmTransaction, NormalizationError> {
  // Extract transaction details based on type
  let from: string;
  let to: string;
  let amount: Decimal;
  let currency: string;

  // Type 2: Send transaction
  if (rawData.type === 2) {
    const data = rawData.data as ThetaSendTransactionData;
    const details = extractSendTransactionDetails(data);
    from = details.from;
    to = details.to;
    currency = details.currency;
    amount = details.amount;
  }
  // Type 7: Smart contract transaction
  else if (rawData.type === 7) {
    const data = rawData.data as ThetaSmartContractData;
    const details = extractSmartContractTransactionDetails(data);
    from = details.from;
    to = details.to;
    currency = details.currency;
    amount = details.amount;
  }
  // Other transaction types - skip for now
  else {
    return err({ message: `Unsupported transaction type: ${rawData.type}`, type: 'error' });
  }

  // Convert timestamp to milliseconds
  const timestamp = rawData.timestamp.getTime();

  // Convert block height to number
  const blockHeight = parseInt(rawData.block_height);

  // Theta blockchain has TWO native currencies: THETA and TFUEL
  // The processor expects nativeCurrency to be TFUEL (for fees), so we map THETA
  // transfers as token_transfer to preserve the correct symbol
  const isTheta = isThetaTokenTransfer(currency);
  const THETA_DECIMALS = 18;

  // Amount handling:
  // - Amounts from API are already in wei (thetawei/tfuelwei)
  // - THETA transfers are mapped as token_transfer, so amounts should be normalized (not wei)
  // - TFUEL transfers are mapped as native transfer, so amounts should stay in wei
  const amountFormatted = formatThetaAmount(amount, isTheta, THETA_DECIMALS);

  const transaction: EvmTransaction = {
    amount: amountFormatted,
    blockHeight,
    currency,
    from,
    id: rawData.hash,
    providerName: 'theta-explorer',
    status: 'success',
    timestamp,
    to,
    tokenSymbol: isTheta ? 'THETA' : 'TFUEL',
    tokenType: 'native',
    type: isTheta ? 'token_transfer' : 'transfer',
  };

  return ok(transaction);
}

/**
 * Maps Theta Explorer transaction to normalized EvmTransaction with validation
 */
export const mapThetaExplorerTransaction = withValidation(
  ThetaTransactionSchema,
  EvmTransactionSchema,
  'ThetaExplorerTransaction'
)(mapThetaExplorerTransactionInternal);
