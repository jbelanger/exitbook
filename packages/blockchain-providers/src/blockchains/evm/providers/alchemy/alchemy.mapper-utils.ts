import { parseDecimal } from '@exitbook/core';
import type { Decimal } from 'decimal.js';
import { err, ok, type Result } from 'neverthrow';

import { generateUniqueTransactionEventId, type NormalizationError } from '../../../../core/index.js';
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
 * @returns Result containing amount, currency, and token type
 */
export function extractAmountAndCurrency(rawData: AlchemyAssetTransfer): Result<AmountResult, NormalizationError> {
  if (isTokenTransfer(rawData.category)) {
    return extractTokenTransferData(rawData);
  }
  return extractNativeTransferData(rawData);
}

/**
 * Extracts amount and currency for token transfers (ERC-20, ERC-721, ERC-1155).
 *
 * @param rawData - Alchemy asset transfer data
 * @returns Result containing amount, currency (contract address), and token type
 * @returns Error result if contract address is missing (data quality issue)
 */
export function extractTokenTransferData(rawData: AlchemyAssetTransfer): Result<AmountResult, NormalizationError> {
  const rawValue = rawData.rawContract?.value || rawData.value;
  const baseAmount = parseDecimal(String(rawValue || 0));

  const amount = adjustNftAmount(rawData, baseAmount);

  if (!rawData.rawContract?.address) {
    return err({
      type: 'error' as const,
      message: `Missing contract address for token transfer. Hash: ${rawData.hash}`,
    });
  }

  const currency = rawData.rawContract.address;
  const tokenType = rawData.category as EvmTransaction['tokenType'];

  return ok({ amount, currency, tokenType });
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
 * @returns Error result if asset field is missing (data quality issue)
 */
export function extractNativeTransferData(rawData: AlchemyAssetTransfer): Result<AmountResult, NormalizationError> {
  const amount = rawData.rawContract?.value
    ? parseDecimal(String(rawData.rawContract.value))
    : convertToSmallestUnit(rawData);

  if (!rawData.asset) {
    return err({
      type: 'error' as const,
      message: `Missing asset field for native transfer. Hash: ${rawData.hash}`,
    });
  }

  return ok({ amount, currency: rawData.asset, tokenType: 'native' });
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
  transaction.tokenSymbol = contractAddress;

  const rawDecimals = rawData.rawContract?.decimal;
  if (rawDecimals !== undefined) {
    transaction.tokenDecimals = typeof rawDecimals === 'number' ? rawDecimals : parseInt(String(rawDecimals));
  }
}

/**
 * Enriches transaction with gas fee information from receipt data.
 * Gas fees are added by the API client after fetching eth_getTransactionReceipt.
 *
 * Note: Internal transactions don't have their own gas fees (they're part of parent tx),
 * so missing gas data for internal transactions is expected and not an error.
 *
 * @returns Error result if gas data is incomplete (has some but not all required fields)
 */
function enrichWithGasFees(
  transaction: EvmTransaction,
  rawData: AlchemyAssetTransfer
): Result<void, NormalizationError> {
  const gasUsed = rawData._gasUsed;
  const effectiveGasPrice = rawData._effectiveGasPrice;
  const nativeCurrency = rawData._nativeCurrency;

  // If no gas data present, this is likely an internal transaction or gas fetch failed
  if (!gasUsed || !effectiveGasPrice) {
    return ok(undefined);
  }

  // If we have gas data, we must have native currency
  if (!nativeCurrency) {
    return err({
      type: 'error' as const,
      message: `Missing native currency for gas fee calculation. Hash: ${rawData.hash}`,
    });
  }

  const feeWei = calculateGasFee(gasUsed, effectiveGasPrice);

  transaction.gasUsed = gasUsed;
  transaction.gasPrice = effectiveGasPrice;
  transaction.feeAmount = feeWei.toString();
  transaction.feeCurrency = nativeCurrency;

  return ok(undefined);
}

/**
 * Maps Alchemy asset transfer to normalized EvmTransaction
 * Input data is pre-validated by HTTP client schema validation
 * Fails loudly on missing required fields - no silent defaults
 */
export function mapAlchemyTransaction(rawData: AlchemyAssetTransfer): Result<EvmTransaction, NormalizationError> {
  // Validate required fields first - fail fast with clear errors
  if (!rawData.metadata?.blockTimestamp) {
    return err({
      type: 'error' as const,
      message: `Missing blockTimestamp for transaction ${rawData.hash}`,
    });
  }

  // Extract amount and currency (may fail for missing asset field)
  const amountResult = extractAmountAndCurrency(rawData);
  if (amountResult.isErr()) {
    return err(amountResult.error);
  }
  const { amount, currency, tokenType } = amountResult.value;

  const timestamp = rawData.metadata.blockTimestamp.getTime();
  const transactionType = determineTransactionType(rawData.category);

  // Handle null from address (minting operations) with zero address sentinel
  const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';
  const from = rawData.from ? (normalizeEvmAddress(rawData.from) ?? '') : ZERO_ADDRESS;
  const to = normalizeEvmAddress(rawData.to);
  const tokenAddress = rawData.rawContract?.address ? normalizeEvmAddress(rawData.rawContract.address) : undefined;

  const transaction: EvmTransaction = {
    amount: amount.toFixed(),
    blockHeight: parseInt(rawData.blockNum, 16),
    currency,
    eventId: generateUniqueTransactionEventId({
      amount: amount.toFixed(),
      currency,
      from,
      id: rawData.hash,
      timestamp,
      to,
      tokenAddress,
      type: transactionType,
    }),
    from,
    id: rawData.hash,
    providerName: 'alchemy',
    status: 'success',
    timestamp,
    to,
    tokenType,
    type: transactionType,
  };

  enrichWithTokenFields(transaction, rawData, currency);

  // Enrich with gas fees (may fail if gas data incomplete)
  const gasResult = enrichWithGasFees(transaction, rawData);
  if (gasResult.isErr()) {
    return err(gasResult.error);
  }

  return validateOutput(transaction, EvmTransactionSchema, 'AlchemyTransaction');
}
