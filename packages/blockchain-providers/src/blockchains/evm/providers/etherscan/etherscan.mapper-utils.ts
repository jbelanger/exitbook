import { getErrorMessage } from '@exitbook/core';
import { Decimal } from 'decimal.js';
import { err, ok, type Result } from 'neverthrow';

import type { NormalizationError } from '../../../../core/index.js';
import { validateOutput } from '../../../../core/index.js';
import { EvmTransactionSchema } from '../../schemas.js';
import type { EvmTransaction } from '../../types.js';
import { generateBeaconWithdrawalEventId, normalizeEvmAddress } from '../../utils.js';

import {
  BEACON_CHAIN_ADDRESS,
  EtherscanBeaconWithdrawalResponseSchema,
  type EtherscanBeaconWithdrawal,
  type EtherscanNormalTransaction,
  type EtherscanInternalTransaction,
  type EtherscanTokenTransaction,
  EtherscanNormalTransactionResponseSchema,
  EtherscanInternalTransactionResponseSchema,
  EtherscanTokenTransactionResponseSchema,
} from './etherscan.schemas.js';

/**
 * Pure functions for Etherscan transaction mapping.
 * Following the Functional Core / Imperative Shell pattern.
 */

/**
 * Converts Gwei (10^9 wei) to Wei (smallest ETH unit).
 *
 * @param gweiAmount - Amount in Gwei as string
 * @returns Amount in Wei as string
 */
function convertGweiToWei(gweiAmount: string): string {
  const gwei = new Decimal(gweiAmount);
  const wei = gwei.mul(1_000_000_000); // 10^9
  return wei.toFixed(0);
}

/**
 * Maps Etherscan beacon withdrawal to normalized EvmTransaction.
 *
 * Key transformations:
 * - Converts amount from Gwei to Wei
 * - Creates synthetic transaction ID using withdrawal index
 * - Sets BEACON_CHAIN_ADDRESS as 'from' (consensus layer has no sender address)
 *
 * Note: Tax classification and metadata notes are added by the processor,
 * not at the mapper level. The mapper only produces normalized EvmTransaction.
 *
 * @param rawData - Raw Etherscan withdrawal data (pre-validated)
 * @param nativeCurrency - Chain native currency symbol (e.g., 'ETH')
 * @returns Normalized EvmTransaction or error
 */
export function mapEtherscanWithdrawalToEvmTransaction(
  rawData: EtherscanBeaconWithdrawal,
  nativeCurrency = 'ETH'
): Result<EvmTransaction, NormalizationError> {
  try {
    // Convert Gwei to Wei (Etherscan returns amounts in Gwei)
    const amountWei = convertGweiToWei(rawData.amount);

    // Create synthetic transaction ID for withdrawals
    // Format: beacon-withdrawal-{index}
    // Processor will extract the index from this ID for metadata
    const syntheticTxId = `beacon-withdrawal-${rawData.withdrawalIndex}`;

    // Parse timestamp
    const timestamp = parseInt(rawData.timestamp) * 1000; // Convert seconds to milliseconds

    // Normalize recipient address
    const to = normalizeEvmAddress(rawData.address);
    if (!to) {
      return err({
        type: 'error',
        message: `Invalid recipient address: ${rawData.address}`,
      });
    }

    const transaction: EvmTransaction = {
      amount: amountWei,
      blockHeight: parseInt(rawData.blockNumber),
      blockId: undefined, // Withdrawals don't have block hash in Etherscan API
      currency: nativeCurrency,
      eventId: generateBeaconWithdrawalEventId({
        withdrawalIndex: rawData.withdrawalIndex,
        validatorIndex: rawData.validatorIndex,
        address: rawData.address,
        amountWei,
        blockNumber: rawData.blockNumber,
        timestamp: rawData.timestamp,
        nativeCurrency,
      }),
      feeAmount: '0', // Withdrawals have no gas fees
      feeCurrency: nativeCurrency,
      from: BEACON_CHAIN_ADDRESS,
      gasPrice: '0',
      gasUsed: '0',
      id: syntheticTxId,
      providerName: 'etherscan',
      status: 'success', // All withdrawals are successful
      timestamp,
      to,
      tokenType: 'native',
      type: 'beacon_withdrawal',
      // Preserve withdrawal metadata for processor notes
      withdrawalIndex: rawData.withdrawalIndex,
      validatorIndex: rawData.validatorIndex,
    };

    return validateOutput(transaction, EvmTransactionSchema, 'EtherscanBeaconWithdrawal');
  } catch (error) {
    return err({
      type: 'error',
      message: `Failed to map withdrawal: ${getErrorMessage(error)}`,
    });
  }
}

/**
 * Parses and validates Etherscan beacon withdrawal API response.
 *
 * Handles:
 * - Empty results (no withdrawals found)
 * - API errors (status '0')
 * - Invalid response structure
 *
 * @param response - Raw API response
 * @returns Array of validated withdrawals or error
 */
export function parseEtherscanWithdrawalResponse(response: unknown): Result<EtherscanBeaconWithdrawal[], Error> {
  const parseResult = EtherscanBeaconWithdrawalResponseSchema.safeParse(response);

  if (!parseResult.success) {
    return err(new Error(`Invalid Etherscan response structure: ${parseResult.error.message}`));
  }

  const data = parseResult.data;

  // Handle API errors
  if (data.status === '0') {
    // "No transactions found" / "No token transfers found" is not an error, just return empty array
    const message = typeof data.message === 'string' ? data.message.toLowerCase() : '';
    const result = typeof data.result === 'string' ? data.result.toLowerCase() : '';
    if (
      message.includes('no transactions found') ||
      message.includes('no token transfers found') ||
      result.includes('no transactions found') ||
      result.includes('no token transfers found')
    ) {
      return ok([]);
    }
    const resultStr = typeof data.result === 'string' ? data.result : JSON.stringify(data.result);
    return err(new Error(`Etherscan API error: ${data.message} - Result: ${resultStr}`));
  }

  // Validate result is array
  if (!Array.isArray(data.result)) {
    return err(new Error('Expected array of withdrawals in result'));
  }

  return ok(data.result);
}

/**
 * Maps Etherscan normal transaction to normalized EvmTransaction.
 *
 * Key transformations:
 * - Converts gas fields from Wei to appropriate units
 * - Handles contract deployments (null 'to' address)
 * - Maps transaction status from isError and txreceipt_status
 *
 * @param rawData - Raw Etherscan normal transaction data (pre-validated)
 * @param nativeCurrency - Chain native currency symbol (e.g., 'ETH')
 * @returns Normalized EvmTransaction or error
 */
export function mapEtherscanNormalTransactionToEvmTransaction(
  rawData: EtherscanNormalTransaction,
  nativeCurrency = 'ETH'
): Result<EvmTransaction, NormalizationError> {
  try {
    // Parse timestamp
    const timestamp = parseInt(rawData.timeStamp) * 1000; // Convert seconds to milliseconds

    // Normalize addresses
    const from = normalizeEvmAddress(rawData.from);
    if (!from) {
      return err({
        type: 'error',
        message: `Invalid from address: ${rawData.from}`,
      });
    }

    // 'to' can be null for contract deployments
    const to = rawData.to ? normalizeEvmAddress(rawData.to) : undefined;

    // Determine transaction status
    // isError: '0' = success, '1' = error
    // txreceipt_status: '1' = success, '0' = failed, '' or null = pre-Byzantium
    let status: 'success' | 'failed' | 'pending' = 'success';
    if (rawData.isError === '1') {
      status = 'failed';
    } else if (rawData.txreceipt_status === '0') {
      status = 'failed';
    }

    // Calculate fee amount
    const gasUsed = new Decimal(rawData.gasUsed);
    const gasPrice = new Decimal(rawData.gasPrice);
    const feeAmount = gasUsed.mul(gasPrice).toFixed(0);

    const transaction: EvmTransaction = {
      amount: rawData.value,
      blockHeight: parseInt(rawData.blockNumber),
      blockId: rawData.blockHash,
      currency: nativeCurrency,
      eventId: `${rawData.hash}-0`, // Main transaction uses index 0
      feeAmount,
      feeCurrency: nativeCurrency,
      from,
      gasPrice: rawData.gasPrice,
      gasUsed: rawData.gasUsed,
      id: rawData.hash,
      providerName: 'etherscan',
      status,
      timestamp,
      to,
      tokenType: 'native',
      type: 'transfer',
    };

    return validateOutput(transaction, EvmTransactionSchema, 'EtherscanNormalTransaction');
  } catch (error) {
    return err({
      type: 'error',
      message: `Failed to map normal transaction: ${getErrorMessage(error)}`,
    });
  }
}

/**
 * Maps Etherscan internal transaction to normalized EvmTransaction.
 *
 * Key transformations:
 * - Internal transactions don't pay their own gas (parent transaction does)
 * - Uses traceId for ordering within parent transaction
 * - Handles contract creation (CREATE/CREATE2)
 *
 * @param rawData - Raw Etherscan internal transaction data (pre-validated)
 * @param nativeCurrency - Chain native currency symbol (e.g., 'ETH')
 * @returns Normalized EvmTransaction or error
 */
export function mapEtherscanInternalTransactionToEvmTransaction(
  rawData: EtherscanInternalTransaction,
  nativeCurrency = 'ETH'
): Result<EvmTransaction, NormalizationError> {
  try {
    // Parse timestamp
    const timestamp = parseInt(rawData.timeStamp) * 1000; // Convert seconds to milliseconds

    // Normalize addresses
    const from = normalizeEvmAddress(rawData.from);
    if (!from) {
      return err({
        type: 'error',
        message: `Invalid from address: ${rawData.from}`,
      });
    }

    // 'to' can be null for contract creation
    const to = rawData.to ? normalizeEvmAddress(rawData.to) : undefined;

    // Determine transaction status
    const status: 'success' | 'failed' = rawData.isError === '1' ? 'failed' : 'success';

    // Internal transactions don't pay gas themselves
    // The parent transaction pays the gas
    const feeAmount = '0';

    // Use traceId for eventId to maintain ordering within parent transaction
    // If traceId is missing, create a unique discriminator using from-to-value-type
    // to prevent collisions when multiple internal transactions exist in one parent transaction
    const eventIdSuffix = rawData.traceId ?? `${from}-${to ?? 'null'}-${rawData.value}-${rawData.type}`;
    const eventId = `${rawData.hash}-internal-${eventIdSuffix}`;

    const transaction: EvmTransaction = {
      amount: rawData.value,
      blockHeight: parseInt(rawData.blockNumber),
      blockId: undefined, // Internal transactions don't have block hash in Etherscan API
      currency: nativeCurrency,
      eventId,
      feeAmount,
      feeCurrency: nativeCurrency,
      from,
      gasPrice: '0',
      gasUsed: rawData.gasUsed,
      id: rawData.hash,
      providerName: 'etherscan',
      status,
      timestamp,
      to,
      tokenType: 'native',
      type: 'internal',
    };

    return validateOutput(transaction, EvmTransactionSchema, 'EtherscanInternalTransaction');
  } catch (error) {
    return err({
      type: 'error',
      message: `Failed to map internal transaction: ${getErrorMessage(error)}`,
    });
  }
}

/**
 * Maps Etherscan token transaction to normalized EvmTransaction.
 *
 * Key transformations:
 * - Token transfers don't pay gas themselves (parent transaction does)
 * - Uses contract address and token metadata
 * - Value is in smallest token unit (respects tokenDecimal)
 *
 * @param rawData - Raw Etherscan token transaction data (pre-validated)
 * @param nativeCurrency - Chain native currency symbol (e.g., 'ETH')
 * @returns Normalized EvmTransaction or error
 */
export function mapEtherscanTokenTransactionToEvmTransaction(
  rawData: EtherscanTokenTransaction,
  nativeCurrency = 'ETH'
): Result<EvmTransaction, NormalizationError> {
  try {
    // Parse timestamp
    const timestamp = parseInt(rawData.timeStamp) * 1000; // Convert seconds to milliseconds

    // Normalize addresses
    const from = normalizeEvmAddress(rawData.from);
    if (!from) {
      return err({
        type: 'error',
        message: `Invalid from address: ${rawData.from}`,
      });
    }

    const to = normalizeEvmAddress(rawData.to);
    if (!to) {
      return err({
        type: 'error',
        message: `Invalid to address: ${rawData.to}`,
      });
    }

    const contractAddress = normalizeEvmAddress(rawData.contractAddress);
    if (!contractAddress) {
      return err({
        type: 'error',
        message: `Invalid contract address: ${rawData.contractAddress}`,
      });
    }

    // Token symbol - use tokenSymbol if available, otherwise use contract address
    const currency = rawData.tokenSymbol || contractAddress;

    // Token transfers don't pay gas themselves
    const feeAmount = '0';

    // Create unique event ID using contract address and transactionIndex to prevent collisions
    // when multiple transfers of the same token occur in one transaction
    // V2 API: logIndex no longer available, using transactionIndex instead
    const eventId = `${rawData.hash}-token-${contractAddress}-${rawData.transactionIndex}`;

    const transaction: EvmTransaction = {
      amount: rawData.value,
      blockHeight: parseInt(rawData.blockNumber),
      blockId: rawData.blockHash,
      currency,
      eventId,
      feeAmount,
      feeCurrency: nativeCurrency,
      from,
      gasPrice: '0',
      gasUsed: '0',
      id: rawData.hash,
      providerName: 'etherscan',
      status: 'success', // Token transfers that appear in the API were successful
      timestamp,
      to,
      tokenType: 'erc20', // Default to erc20, can be refined based on contract
      type: 'token_transfer',
      tokenAddress: contractAddress,
      tokenSymbol: rawData.tokenSymbol ?? undefined,
      tokenDecimals: rawData.tokenDecimal !== undefined ? parseInt(rawData.tokenDecimal) : undefined,
    };

    return validateOutput(transaction, EvmTransactionSchema, 'EtherscanTokenTransaction');
  } catch (error) {
    return err({
      type: 'error',
      message: `Failed to map token transaction: ${getErrorMessage(error)}`,
    });
  }
}

/**
 * Parses and validates Etherscan normal transaction API response.
 *
 * @param response - Raw API response
 * @returns Array of validated transactions or error
 */
export function parseEtherscanNormalTransactionResponse(
  response: unknown
): Result<EtherscanNormalTransaction[], Error> {
  const parseResult = EtherscanNormalTransactionResponseSchema.safeParse(response);

  if (!parseResult.success) {
    return err(new Error(`Invalid Etherscan response structure: ${parseResult.error.message}`));
  }

  const data = parseResult.data;

  // Handle API errors
  if (data.status === '0') {
    // "No transactions found" / "No token transfers found" is not an error, just return empty array
    const message = typeof data.message === 'string' ? data.message.toLowerCase() : '';
    const result = typeof data.result === 'string' ? data.result.toLowerCase() : '';
    if (
      message.includes('no transactions found') ||
      message.includes('no token transfers found') ||
      result.includes('no transactions found') ||
      result.includes('no token transfers found')
    ) {
      return ok([]);
    }
    const resultStr = typeof data.result === 'string' ? data.result : JSON.stringify(data.result);
    return err(new Error(`Etherscan API error: ${data.message} - Result: ${resultStr}`));
  }

  // Validate result is array
  if (!Array.isArray(data.result)) {
    return err(new Error('Expected array of transactions in result'));
  }

  return ok(data.result);
}

/**
 * Parses and validates Etherscan internal transaction API response.
 *
 * @param response - Raw API response
 * @returns Array of validated transactions or error
 */
export function parseEtherscanInternalTransactionResponse(
  response: unknown
): Result<EtherscanInternalTransaction[], Error> {
  const parseResult = EtherscanInternalTransactionResponseSchema.safeParse(response);

  if (!parseResult.success) {
    return err(new Error(`Invalid Etherscan response structure: ${parseResult.error.message}`));
  }

  const data = parseResult.data;

  // Handle API errors
  if (data.status === '0') {
    // "No transactions found" / "No token transfers found" is not an error, just return empty array
    const message = typeof data.message === 'string' ? data.message.toLowerCase() : '';
    const result = typeof data.result === 'string' ? data.result.toLowerCase() : '';
    if (
      message.includes('no transactions found') ||
      message.includes('no token transfers found') ||
      result.includes('no transactions found') ||
      result.includes('no token transfers found')
    ) {
      return ok([]);
    }
    const resultStr = typeof data.result === 'string' ? data.result : JSON.stringify(data.result);
    return err(new Error(`Etherscan API error: ${data.message} - Result: ${resultStr}`));
  }

  // Validate result is array
  if (!Array.isArray(data.result)) {
    return err(new Error('Expected array of transactions in result'));
  }

  return ok(data.result);
}

/**
 * Parses and validates Etherscan token transaction API response.
 *
 * @param response - Raw API response
 * @returns Array of validated transactions or error
 */
export function parseEtherscanTokenTransactionResponse(response: unknown): Result<EtherscanTokenTransaction[], Error> {
  const parseResult = EtherscanTokenTransactionResponseSchema.safeParse(response);

  if (!parseResult.success) {
    return err(new Error(`Invalid Etherscan response structure: ${parseResult.error.message}`));
  }

  const data = parseResult.data;

  // Handle API errors
  if (data.status === '0') {
    // "No transactions found" / "No token transfers found" is not an error, just return empty array
    const message = typeof data.message === 'string' ? data.message.toLowerCase() : '';
    const result = typeof data.result === 'string' ? data.result.toLowerCase() : '';
    if (
      message.includes('no transactions found') ||
      message.includes('no token transfers found') ||
      result.includes('no transactions found') ||
      result.includes('no token transfers found')
    ) {
      return ok([]);
    }
    const resultStr = typeof data.result === 'string' ? data.result : JSON.stringify(data.result);
    return err(new Error(`Etherscan API error: ${data.message} - Result: ${resultStr}`));
  }

  // Validate result is array
  if (!Array.isArray(data.result)) {
    return err(new Error('Expected array of transactions in result'));
  }

  return ok(data.result);
}
