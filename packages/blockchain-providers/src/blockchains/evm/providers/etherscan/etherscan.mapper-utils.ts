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
    // "No transactions found" is not an error, just return empty array
    if (
      (typeof data.message === 'string' && data.message.toLowerCase().includes('no transactions found')) ||
      (typeof data.result === 'string' && data.result.toLowerCase().includes('no transactions found'))
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
