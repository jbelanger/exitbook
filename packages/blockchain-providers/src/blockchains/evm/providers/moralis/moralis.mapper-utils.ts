import { type Result } from 'neverthrow';

import type { NormalizationError } from '../../../../core/index.js';
import { generateUniqueTransactionEventId, validateOutput } from '../../../../core/index.js';
import { calculateGasFee } from '../../receipt-utils.js';
import { EvmTransactionSchema } from '../../schemas.js';
import type { EvmTransaction } from '../../types.js';
import { extractMethodId, normalizeEvmAddress } from '../../utils.js';

import type { MoralisTransaction, MoralisTokenTransfer, MoralisInternalTransaction } from './moralis.schemas.js';

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
  nativeCurrency?: string
): Result<EvmTransaction, NormalizationError> {
  const currency = nativeCurrency || 'UNKNOWN';

  // Moralis returns values in smallest units (wei for ETH)
  // Keep them in wei - the processor will convert to decimal when needed
  const valueWei = rawData.value;
  const timestamp = new Date(rawData.block_timestamp).getTime();

  // Calculate gas fee in wei - Zod already validated they're numeric
  const feeWei = calculateGasFee(rawData.receipt_gas_used || '0', rawData.gas_price || '0').toString();

  const from = normalizeEvmAddress(rawData.from_address) ?? '';
  const to = normalizeEvmAddress(rawData.to_address);

  const transaction: EvmTransaction = {
    amount: valueWei,
    blockHeight: parseInt(rawData.block_number),
    blockId: rawData.block_hash,
    currency,
    eventId: generateUniqueTransactionEventId({
      amount: valueWei,
      currency,
      from,
      id: rawData.hash,
      timestamp,
      to,
      type: 'transfer',
    }),
    feeAmount: feeWei,
    feeCurrency: currency,
    from,
    gasPrice: rawData.gas_price && rawData.gas_price !== '' ? rawData.gas_price : undefined,
    gasUsed: rawData.receipt_gas_used && rawData.receipt_gas_used !== '' ? rawData.receipt_gas_used : undefined,
    id: rawData.hash,
    inputData: rawData.input && rawData.input !== '' ? rawData.input : undefined,
    methodId: extractMethodId(rawData.input),
    providerName: 'moralis',
    status: rawData.receipt_status === '1' ? 'success' : 'failed',
    timestamp,
    to,
    tokenType: 'native',
    type: 'transfer',
  };

  return validateOutput(transaction, EvmTransactionSchema, 'MoralisTransaction');
}

/**
 * Maps Moralis token transfer event to normalized EvmTransaction
 * Input data is pre-validated by HTTP client schema validation
 */
export function mapMoralisTokenTransfer(rawData: MoralisTokenTransfer): Result<EvmTransaction, NormalizationError> {
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

  const tokenAddress = normalizeEvmAddress(rawData.address);
  // Use contract address for currency to keep eventId stable across providers.
  // The processor will enrich contract addresses with metadata from the token repository.
  const currency = tokenAddress ?? rawData.address;
  const tokenSymbol = rawData.token_symbol || undefined;

  // Parse log_index for unique ID generation
  const logIndex = parseInt(rawData.log_index);
  const from = normalizeEvmAddress(rawData.from_address) ?? '';
  const to = normalizeEvmAddress(rawData.to_address);

  const transaction: EvmTransaction = {
    amount: valueRaw,
    blockHeight: parseInt(rawData.block_number),
    blockId: rawData.block_hash,
    currency,
    eventId: generateUniqueTransactionEventId({
      amount: valueRaw,
      currency,
      from,
      id: rawData.transaction_hash,
      //logIndex, -- activate only when all providers provides it
      timestamp,
      to,
      tokenAddress,
      type: 'token_transfer',
    }),
    from,
    id: rawData.transaction_hash,
    logIndex,
    providerName: 'moralis',
    status: 'success', // Token transfers are always successful if they appear in the results
    timestamp,
    to,
    tokenAddress,
    tokenDecimals,
    tokenSymbol,
    tokenType,
    type: 'token_transfer',
  };

  return validateOutput(transaction, EvmTransactionSchema, 'MoralisTokenTransfer');
}

/**
 * Maps Moralis internal transaction to normalized EvmTransaction
 * Input data is pre-validated by Zod schema validation
 *
 * Internal transactions are contract-to-contract or contract-to-EOA value transfers
 * that occur during contract execution. They are extracted from the parent transaction's
 * internal_transactions array and processed as separate EvmTransaction objects.
 *
 * @param rawData - Moralis internal transaction data
 * @param parentTimestamp - Timestamp from parent transaction (internal txs don't have their own)
 * @param nativeCurrency - Native currency symbol for the chain
 * @param traceIndex - Array index of this internal transaction (for uniqueness)
 */
export function mapMoralisInternalTransaction(
  rawData: MoralisInternalTransaction,
  parentTimestamp: number,
  nativeCurrency: string,
  traceIndex: number
): Result<EvmTransaction, NormalizationError> {
  // Internal transactions don't have their own timestamp - use parent transaction's timestamp
  const timestamp = parentTimestamp;

  // Moralis returns values in smallest units (wei for ETH)
  const valueWei = rawData.value;

  // Internal transactions that failed have an error field
  // If error is null or undefined, the internal transaction was successful
  const status = rawData.error ? 'failed' : 'success';
  const from = normalizeEvmAddress(rawData.from) ?? '';
  const to = normalizeEvmAddress(rawData.to);
  const traceId = `moralis-internal-${traceIndex}`; // Unique identifier for this internal transaction

  const transaction: EvmTransaction = {
    amount: valueWei,
    blockHeight: rawData.block_number,
    blockId: rawData.block_hash,
    currency: nativeCurrency,
    eventId: generateUniqueTransactionEventId({
      amount: valueWei,
      currency: nativeCurrency,
      from,
      id: rawData.transaction_hash,
      timestamp,
      to,
      traceId,
      type: 'internal',
    }),
    feeAmount: '0', // Internal transactions don't pay gas fees (parent transaction pays)
    feeCurrency: nativeCurrency,
    from,
    id: rawData.transaction_hash, // Use parent transaction hash for grouping
    inputData: rawData.input && rawData.input !== '' ? rawData.input : undefined,
    methodId: extractMethodId(rawData.input),
    providerName: 'moralis',
    status,
    timestamp,
    to,
    tokenType: 'native',
    traceId,
    type: 'internal',
  };

  return validateOutput(transaction, EvmTransactionSchema, 'MoralisInternalTransaction');
}
