import type { SourceMetadata } from '@exitbook/core';
import type { Result } from 'neverthrow';

import { BaseRawDataMapper } from '../../../../shared/blockchain/base/mapper.js';
import type { NormalizationError } from '../../../../shared/blockchain/index.js';
import { EvmTransactionSchema } from '../../schemas.js';
import type { EvmTransaction } from '../../types.js';

import { mapMoralisTransaction, mapMoralisTokenTransfer } from './moralis.mapper-utils.js';
import {
  MoralisTransactionSchema,
  MoralisTokenTransferSchema,
  type MoralisTransaction,
  type MoralisTokenTransfer,
} from './moralis.schemas.js';

export class MoralisTransactionMapper extends BaseRawDataMapper<MoralisTransaction, EvmTransaction> {
  protected readonly inputSchema = MoralisTransactionSchema;
  protected readonly outputSchema = EvmTransactionSchema;

  protected mapInternal(
    rawData: MoralisTransaction,
    sourceContext: SourceMetadata
  ): Result<EvmTransaction, NormalizationError> {
    return mapMoralisTransaction(rawData, sourceContext);
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
    sourceContext: SourceMetadata
  ): Result<EvmTransaction, NormalizationError> {
    return mapMoralisTokenTransfer(rawData, sourceContext);
  }
}
