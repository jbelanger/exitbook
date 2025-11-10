import { parseDecimal } from '@exitbook/core';
import type { SourceMetadata } from '@exitbook/core';
import type { Decimal } from 'decimal.js';
import { type Result, ok } from 'neverthrow';

import type { NormalizationError } from '../../../../shared/blockchain/index.js';
import { withValidation } from '../../../../shared/blockchain/index.js';
import { EvmTransactionSchema } from '../../schemas.js';
import type { EvmTransaction } from '../../types.js';
import { normalizeEvmAddress } from '../../utils.js';

import { ThetaScanTransactionSchema, type ThetaScanTransaction } from './thetascan.schemas.js';

/**
 * Pure functions for ThetaScan transaction mapping
 * Following the Functional Core / Imperative Shell pattern
 */

/**
 * Parses a comma-formatted number string to Decimal.
 * Used for ThetaScan amounts like "1,000,000.000000".
 *
 * @param value - Number string with commas
 * @returns Parsed Decimal value
 */
export function parseCommaFormattedNumber(value: string): Decimal {
  return parseDecimal(value.replace(/,/g, ''));
}

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
 * Maps ThetaScan transaction to normalized EvmTransaction (internal)
 */
function mapThetaScanTransactionInternal(
  rawData: ThetaScanTransaction,
  _sourceContext: SourceMetadata
): Result<EvmTransaction, NormalizationError> {
  // Remove commas from amounts (ThetaScan uses "1,000,000.000000" format)
  const thetaAmount = parseCommaFormattedNumber(rawData.theta);
  const tfuelAmount = parseCommaFormattedNumber(rawData.tfuel);

  // Determine which currency was transferred and the amount
  const { currency, amount } = selectThetaCurrency(thetaAmount, tfuelAmount);

  // Theta blockchain has TWO native currencies: THETA and TFUEL
  // The processor expects nativeCurrency to be TFUEL (for fees), so we map THETA
  // transfers as token_transfer to preserve the correct symbol
  const isTheta = isThetaTokenTransfer(currency);

  // Convert timestamp to milliseconds
  const timestamp = rawData.timestamp.getTime();

  // Calculate fee in wei
  const THETA_DECIMALS = 18;
  const feeInWei = parseDecimal(rawData.fee_tfuel.toString()).mul(parseDecimal('10').pow(THETA_DECIMALS));

  // Amount handling:
  // - THETA transfers are mapped as token_transfer, so amounts should be normalized (not wei)
  // - TFUEL transfers are mapped as native transfer, so amounts should be in wei
  const amountFormatted = isTheta ? amount.toFixed() : amount.mul(parseDecimal('10').pow(THETA_DECIMALS)).toFixed(0);

  const transaction: EvmTransaction = {
    amount: amountFormatted,
    blockHeight: parseInt(rawData.block),
    currency,
    feeAmount: feeInWei.toFixed(0),
    feeCurrency: 'TFUEL', // Fees are always paid in TFUEL on Theta
    from: normalizeEvmAddress(rawData.sending_address) ?? '',
    id: rawData.hash,
    providerName: 'thetascan',
    status: 'success', // ThetaScan only returns successful transactions
    timestamp,
    to: normalizeEvmAddress(rawData.recieving_address),
    tokenSymbol: isTheta ? 'THETA' : 'TFUEL',
    tokenType: 'native',
    type: isTheta ? 'token_transfer' : 'transfer',
  };

  return ok(transaction);
}

/**
 * Maps ThetaScan transaction to normalized EvmTransaction with validation
 */
export const mapThetaScanTransaction = withValidation(
  ThetaScanTransactionSchema,
  EvmTransactionSchema,
  'ThetaScanTransaction'
)(mapThetaScanTransactionInternal);
