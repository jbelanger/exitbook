import { parseDecimal } from '@exitbook/core';
import type { Decimal } from 'decimal.js';
import { type Result } from 'neverthrow';

import type { NormalizationError } from '../../../../core/index.js';
import { validateOutput } from '../../../../core/index.js';
import { calculateGasFee } from '../../receipt-utils.js';
import { EvmTransactionSchema } from '../../schemas.js';
import type { EvmTransaction } from '../../types.js';
import { normalizeEvmAddress } from '../../utils.js';

import type { AlchemyAssetTransfer } from './alchemy.schemas.js';

/**
 * Pure functions for Alchemy transaction mapping
 * Following the Functional Core / Imperative Shell pattern
 */

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

/**
 * Enriches transaction with token fields if applicable
 */
function enrichWithTokenFields(transaction: EvmTransaction, rawData: AlchemyAssetTransfer, _currency: string): void {
  if (!isTokenTransfer(rawData.category)) return;

  const contractAddress = rawData.rawContract?.address;
  if (!contractAddress) return;

  transaction.tokenAddress = normalizeEvmAddress(contractAddress);
  // Use contract address - processor will enrich with symbol from token repository
  transaction.tokenSymbol = contractAddress;

  const rawDecimals = rawData.rawContract?.decimal;
  if (rawDecimals !== undefined) {
    transaction.tokenDecimals = typeof rawDecimals === 'number' ? rawDecimals : parseInt(String(rawDecimals));
  }
}

/**
 * Enriches transaction with gas fee information
 */
function enrichWithGasFees(transaction: EvmTransaction, rawData: AlchemyAssetTransfer): void {
  // Extract gas data from receipt (added by API client)
  const gasUsed = rawData._gasUsed;
  const effectiveGasPrice = rawData._effectiveGasPrice;
  const nativeCurrency = rawData._nativeCurrency;

  if (!gasUsed || !effectiveGasPrice) {
    return;
  }

  const feeWei = calculateGasFee(gasUsed, effectiveGasPrice);

  transaction.gasUsed = gasUsed;
  transaction.gasPrice = effectiveGasPrice;
  transaction.feeAmount = feeWei.toString();

  // Gas fees are always paid in the native currency (ETH, MATIC, AVAX, etc.)
  // Use the chain-specific native currency from chain registry
  transaction.feeCurrency = nativeCurrency || 'ETH'; // Fallback to ETH if not provided
}

/**
 * Maps Alchemy asset transfer to normalized EvmTransaction
 * Input data is pre-validated by HTTP client schema validation
 */
export function mapAlchemyTransaction(rawData: AlchemyAssetTransfer): Result<EvmTransaction, NormalizationError> {
  const { amount, currency, tokenType } = extractAmountAndCurrency(rawData);
  const timestamp = rawData.metadata.blockTimestamp.getTime();
  const transactionType = determineTransactionType(rawData.category);

  const transaction: EvmTransaction = {
    amount: amount.toFixed(),
    blockHeight: parseInt(rawData.blockNum, 16),
    currency,
    from: normalizeEvmAddress(rawData.from) ?? '',
    id: rawData.hash,
    providerName: 'alchemy',
    status: 'success',
    timestamp,
    to: normalizeEvmAddress(rawData.to),
    tokenType,
    type: transactionType,
  };

  enrichWithTokenFields(transaction, rawData, currency);
  enrichWithGasFees(transaction, rawData);

  return validateOutput(transaction, EvmTransactionSchema, 'AlchemyTransaction');
}
