import { parseDecimal } from '@exitbook/core';
import type { SourceMetadata } from '@exitbook/core';
import { type Result, ok } from 'neverthrow';

import { BaseRawDataMapper } from '../../../../shared/blockchain/base/mapper.ts';
import type { NormalizationError } from '../../../../shared/blockchain/index.ts';
import { EvmTransactionSchema } from '../../schemas.ts';
import type { EvmTransaction } from '../../types.ts';
import { normalizeEvmAddress } from '../../utils.js';

import {
  MoralisTransactionSchema,
  MoralisTokenTransferSchema,
  type MoralisTransaction,
  type MoralisTokenTransfer,
} from './moralis.schemas.ts';

export class MoralisTransactionMapper extends BaseRawDataMapper<MoralisTransaction, EvmTransaction> {
  protected readonly inputSchema = MoralisTransactionSchema;
  protected readonly outputSchema = EvmTransactionSchema;

  protected mapInternal(
    rawData: MoralisTransaction,
    _sourceContext: SourceMetadata
  ): Result<EvmTransaction, NormalizationError> {
    const nativeCurrency = rawData._nativeCurrency || 'UNKNOWN';

    // Moralis returns values in smallest units (wei for ETH)
    // Keep them in wei - the processor will convert to decimal when needed
    const valueWei = rawData.value;
    const timestamp = new Date(rawData.block_timestamp).getTime();

    // Calculate gas fee in wei - Zod already validated they're numeric
    const gasUsed = parseDecimal(rawData.receipt_gas_used || '0');
    const gasPrice = parseDecimal(rawData.gas_price || '0');
    const feeWei = gasUsed.mul(gasPrice).toString();

    const transaction: EvmTransaction = {
      amount: valueWei,
      blockHeight: parseInt(rawData.block_number),
      blockId: rawData.block_hash,
      currency: nativeCurrency,
      feeAmount: feeWei,
      feeCurrency: nativeCurrency,
      from: normalizeEvmAddress(rawData.from_address) ?? '',
      gasPrice: rawData.gas_price && rawData.gas_price !== '' ? rawData.gas_price : undefined,
      gasUsed: rawData.receipt_gas_used && rawData.receipt_gas_used !== '' ? rawData.receipt_gas_used : undefined,
      id: rawData.hash,
      inputData: rawData.input && rawData.input !== '' ? rawData.input : undefined,
      methodId: rawData.input && rawData.input.length >= 10 ? rawData.input.slice(0, 10) : undefined,
      providerId: 'moralis',
      status: rawData.receipt_status === '1' ? 'success' : 'failed',
      timestamp,
      to: normalizeEvmAddress(rawData.to_address),
      tokenType: 'native',
      type: 'transfer',
    };

    return ok(transaction);
  }
}

/**
 * Maps Moralis token transfer events to the normalized EvmTransaction format.
 * Unlike {@link MoralisTransactionMapper}, which handles native currency transactions,
 * this mapper processes token transfers (ERC-20, ERC-721, etc.) and extracts relevant
 * token-specific fields such as token address, symbol, decimals, and contract type.
 * Use this mapper for transactions involving tokens rather than native currency.
 */
export class MoralisTokenTransferMapper extends BaseRawDataMapper<MoralisTokenTransfer, EvmTransaction> {
  protected readonly inputSchema = MoralisTokenTransferSchema;
  protected readonly outputSchema = EvmTransactionSchema;

  protected mapInternal(
    rawData: MoralisTokenTransfer,
    _sourceContext: SourceMetadata
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

    const transaction: EvmTransaction = {
      amount: valueRaw,
      blockHeight: parseInt(rawData.block_number),
      blockId: rawData.block_hash,
      currency,
      from: normalizeEvmAddress(rawData.from_address) ?? '',
      id: rawData.transaction_hash,
      providerId: 'moralis',
      status: 'success', // Token transfers are always successful if they appear in the results
      timestamp,
      to: normalizeEvmAddress(rawData.to_address),
      tokenAddress: normalizeEvmAddress(rawData.address),
      tokenDecimals,
      tokenSymbol,
      tokenType,
      type: 'token_transfer',
    };

    return ok(transaction);
  }
}
