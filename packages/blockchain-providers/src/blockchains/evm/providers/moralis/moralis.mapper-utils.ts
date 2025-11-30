import type { ImportSessionMetadata } from '@exitbook/core';
import { type Result } from 'neverthrow';

import type { NormalizationError } from '../../../../core/index.js';
import { validateOutput } from '../../../../core/index.js';
import { calculateGasFee } from '../../receipt-utils.js';
import { EvmTransactionSchema } from '../../schemas.js';
import type { EvmTransaction } from '../../types.js';
import { extractMethodId, normalizeEvmAddress } from '../../utils.js';

import type { MoralisTransaction, MoralisTokenTransfer } from './moralis.schemas.js';

/**
 * Pure functions for Moralis transaction mapping
 * Following the Functional Core / Imperative Shell pattern
 */

/**
 * Maps Moralis native currency transaction to normalized EvmTransaction
 * Input data is pre-validated by HTTP client schema validation
 */
export function mapMoralisTransaction(
  rawData: MoralisTransaction,
  _sourceContext: ImportSessionMetadata,
  nativeCurrency?: string
): Result<EvmTransaction, NormalizationError> {
  const currency = nativeCurrency || 'UNKNOWN';

  // Moralis returns values in smallest units (wei for ETH)
  // Keep them in wei - the processor will convert to decimal when needed
  const valueWei = rawData.value;
  const timestamp = new Date(rawData.block_timestamp).getTime();

  // Calculate gas fee in wei - Zod already validated they're numeric
  const feeWei = calculateGasFee(rawData.receipt_gas_used || '0', rawData.gas_price || '0').toString();

  const transaction: EvmTransaction = {
    amount: valueWei,
    blockHeight: parseInt(rawData.block_number),
    blockId: rawData.block_hash,
    currency,
    feeAmount: feeWei,
    feeCurrency: currency,
    from: normalizeEvmAddress(rawData.from_address) ?? '',
    gasPrice: rawData.gas_price && rawData.gas_price !== '' ? rawData.gas_price : undefined,
    gasUsed: rawData.receipt_gas_used && rawData.receipt_gas_used !== '' ? rawData.receipt_gas_used : undefined,
    id: rawData.hash,
    inputData: rawData.input && rawData.input !== '' ? rawData.input : undefined,
    methodId: extractMethodId(rawData.input),
    providerName: 'moralis',
    status: rawData.receipt_status === '1' ? 'success' : 'failed',
    timestamp,
    to: normalizeEvmAddress(rawData.to_address),
    tokenType: 'native',
    type: 'transfer',
  };

  return validateOutput(transaction, EvmTransactionSchema, 'MoralisTransaction');
}

/**
 * Maps Moralis token transfer event to normalized EvmTransaction
 * Input data is pre-validated by HTTP client schema validation
 */
export function mapMoralisTokenTransfer(
  rawData: MoralisTokenTransfer,
  _sourceContext: ImportSessionMetadata
): Result<EvmTransaction, NormalizationError> {
  const timestamp = new Date(rawData.block_timestamp).getTime();

  // Parse token decimals
  const tokenDecimals = parseInt(rawData.token_decimals);

  // Moralis returns token values in smallest units
  // Keep them in smallest units - the processor will convert to decimal when needed
  const valueRaw = rawData.value;

  // Map Moralis contract_type to EvmTransaction tokenType
  // Moralis returns "ERC20", "ERC721", "ERC1155" - convert to lowercase
  // Default to 'erc20' if contract_type is undefined or unrecognized
  let tokenType: EvmTransaction['tokenType'] = 'erc20';
  if (rawData.contract_type) {
    const contractTypeLower = rawData.contract_type.toLowerCase();
    if (contractTypeLower === 'erc20' || contractTypeLower === 'erc721' || contractTypeLower === 'erc1155') {
      tokenType = contractTypeLower;
    }
  }

  // Use token_symbol if Moralis provides it, otherwise fall back to contract address for currency
  // The processor will enrich contract addresses with metadata from the token repository
  const currency = rawData.token_symbol || rawData.address;
  const tokenSymbol = rawData.token_symbol || undefined;

  // Parse log_index for unique ID generation
  const logIndex = parseInt(rawData.log_index);

  const transaction: EvmTransaction = {
    amount: valueRaw,
    blockHeight: parseInt(rawData.block_number),
    blockId: rawData.block_hash,
    currency,
    from: normalizeEvmAddress(rawData.from_address) ?? '',
    id: `${rawData.transaction_hash}-${rawData.log_index}`,
    logIndex,
    providerName: 'moralis',
    status: 'success', // Token transfers are always successful if they appear in the results
    timestamp,
    to: normalizeEvmAddress(rawData.to_address),
    tokenAddress: normalizeEvmAddress(rawData.address),
    tokenDecimals,
    tokenSymbol,
    tokenType,
    type: 'token_transfer',
  };

  return validateOutput(transaction, EvmTransactionSchema, 'MoralisTokenTransfer');
}
