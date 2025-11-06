import { parseDecimal } from '@exitbook/core';
import type { Decimal } from 'decimal.js';

import type { AlchemyAssetTransfer } from './providers/alchemy/alchemy.schemas.ts';
import type { EvmTransaction } from './types.ts';

const TOKEN_CATEGORIES = new Set<string>(['token', 'erc20', 'erc721', 'erc1155']);

/**
 * Result of extracting amount and currency from a transaction.
 */
export interface AmountResult {
  amount: Decimal;
  currency: string;
  tokenType: EvmTransaction['tokenType'];
}

/**
 * Determines if a category represents a token transfer.
 *
 * @param category - Transaction category (e.g., 'erc20', 'external')
 * @returns True if this is a token transfer
 */
export function isTokenTransfer(category: string): boolean {
  return TOKEN_CATEGORIES.has(category);
}

/**
 * Extracts amount and currency from an Alchemy asset transfer.
 * Routes to either token transfer or native transfer logic.
 *
 * @param rawData - Alchemy asset transfer data
 * @returns Amount, currency, and token type
 */
export function extractAmountAndCurrency(rawData: AlchemyAssetTransfer): AmountResult {
  return isTokenTransfer(rawData.category) ? extractTokenTransferData(rawData) : extractNativeTransferData(rawData);
}

/**
 * Extracts amount and currency for token transfers (ERC-20, ERC-721, ERC-1155).
 *
 * @param rawData - Alchemy asset transfer data
 * @returns Amount, currency (contract address), and token type
 */
export function extractTokenTransferData(rawData: AlchemyAssetTransfer): AmountResult {
  const rawValue = rawData.rawContract?.value || rawData.value;
  const baseAmount = parseDecimal(String(rawValue || 0));

  const amount = adjustNftAmount(rawData, baseAmount);
  const currency = rawData.rawContract?.address || 'UNKNOWN';
  const tokenType = rawData.category as EvmTransaction['tokenType'];

  return { amount, currency, tokenType };
}

/**
 * Adjusts amount for NFT transfers (ERC-721, ERC-1155).
 * ERC-721: Always 1
 * ERC-1155: Extract from metadata or default to 1
 * Others: Use base amount
 *
 * @param rawData - Alchemy asset transfer data
 * @param baseAmount - Base amount before NFT adjustment
 * @returns Adjusted amount
 */
export function adjustNftAmount(rawData: AlchemyAssetTransfer, baseAmount: Decimal): Decimal {
  const nftAmountHandlers: Record<string, () => Decimal> = {
    erc721: () => parseDecimal('1'),
    erc1155: () => extractErc1155Amount(rawData),
  };

  const handler = nftAmountHandlers[rawData.category];
  return handler ? handler() : baseAmount;
}

/**
 * Extracts the amount for ERC-1155 token transfers from metadata.
 *
 * @param rawData - Alchemy asset transfer data
 * @returns Amount from first metadata entry or 1 if not found
 */
export function extractErc1155Amount(rawData: AlchemyAssetTransfer): Decimal {
  const firstMetadata = rawData.erc1155Metadata?.[0];
  return firstMetadata?.value ? parseDecimal(firstMetadata.value) : parseDecimal('1');
}

/**
 * Extracts amount and currency for native transfers (ETH, MATIC, etc.).
 *
 * @param rawData - Alchemy asset transfer data
 * @returns Amount in wei, currency symbol, and 'native' token type
 */
export function extractNativeTransferData(rawData: AlchemyAssetTransfer): AmountResult {
  const amount = rawData.rawContract?.value
    ? parseDecimal(String(rawData.rawContract.value))
    : convertToSmallestUnit(rawData);

  const currency = rawData.asset ?? (rawData.rawContract?.address || 'UNKNOWN');

  return { amount, currency, tokenType: 'native' };
}

/**
 * Converts a decimal amount to smallest unit (wei) using contract decimals.
 *
 * @param rawData - Alchemy asset transfer with value and decimal info
 * @returns Amount in smallest units
 */
export function convertToSmallestUnit(rawData: AlchemyAssetTransfer): Decimal {
  const decimalAmount = parseDecimal(String(rawData.value || 0));
  const decimals = rawData.rawContract?.decimal ? parseInt(String(rawData.rawContract.decimal)) : 18;
  return decimalAmount.mul(parseDecimal('10').pow(decimals));
}

/**
 * Extracts timestamp from Alchemy metadata and converts to milliseconds.
 *
 * @param blockTimestamp - ISO timestamp string from Alchemy
 * @returns Unix timestamp in milliseconds
 */
export function extractTimestamp(blockTimestamp: string): number {
  return new Date(blockTimestamp).getTime();
}

/**
 * Determines transaction type based on category.
 *
 * @param category - Alchemy category (e.g., 'erc20', 'internal', 'external')
 * @returns Transaction type
 */
export function determineTransactionType(category: string): EvmTransaction['type'] {
  if (isTokenTransfer(category)) return 'token_transfer';
  if (category === 'internal') return 'internal';
  return 'transfer';
}

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
export function selectThetaCurrency(thetaAmount: Decimal, tfuelAmount: Decimal): { amount: Decimal; currency: string; } {
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
 * Extracts the method ID from transaction input data.
 * Method ID is the first 4 bytes (10 characters including '0x') of input data.
 *
 * @param inputData - Transaction input data
 * @returns Method ID or undefined if input is too short
 */
export function extractMethodId(inputData: string | null | undefined): string | undefined {
  if (!inputData || inputData.length < 10) {
    return undefined;
  }
  return inputData.slice(0, 10);
}

/**
 * Determines transaction type based on function name presence.
 * Transactions with function names are contract calls, others are transfers.
 *
 * @param functionName - Function name from transaction data
 * @returns Transaction type
 */
export function getTransactionTypeFromFunctionName(
  functionName: string | null | undefined
): 'contract_call' | 'transfer' {
  return functionName ? 'contract_call' : 'transfer';
}

/**
 * Extracts network name from Alchemy base URL.
 * Example: https://eth-mainnet.g.alchemy.com/v2 -> eth-mainnet
 *
 * @param baseUrl - Alchemy base URL
 * @param blockchain - Fallback blockchain name
 * @returns Network name for Alchemy API
 */
export function extractAlchemyNetworkName(baseUrl: string, blockchain: string): string {
  const match = baseUrl.match(/https:\/\/([^.]+)\.g\.alchemy\.com/);
  return match?.[1] || `${blockchain}-mainnet`;
}
