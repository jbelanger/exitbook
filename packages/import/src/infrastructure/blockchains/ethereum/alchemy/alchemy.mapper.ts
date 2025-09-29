import type { Balance } from '@crypto/core';
import { parseDecimal } from '@crypto/shared-utils';
import { Decimal } from 'decimal.js';
import { type Result, ok } from 'neverthrow';

import type { ImportSessionMetadata } from '../../../../app/ports/processors.ts';
import type { UniversalBlockchainTransaction } from '../../../../app/ports/raw-data-mappers.ts';
import { RegisterTransactionMapper } from '../../../shared/processors/processor-registry.ts';
import { BaseRawDataMapper } from '../../shared/base-raw-data-mapper.ts';

import { AlchemyAssetTransferSchema } from './alchemy.schemas.ts';
import type { AlchemyAssetTransfer } from './alchemy.types.ts';

@RegisterTransactionMapper('alchemy')
export class AlchemyTransactionMapper extends BaseRawDataMapper<AlchemyAssetTransfer, UniversalBlockchainTransaction> {
  protected readonly schema = AlchemyAssetTransferSchema;

  protected mapInternal(
    rawData: AlchemyAssetTransfer,
    _sessionContext: ImportSessionMetadata
  ): Result<UniversalBlockchainTransaction, string> {
    // Determine transaction type based on Alchemy categories
    let type: UniversalBlockchainTransaction['type'];
    const isTokenTransfer =
      rawData.category === 'token' ||
      rawData.category === 'erc20' ||
      rawData.category === 'erc721' ||
      rawData.category === 'erc1155';

    if (isTokenTransfer) {
      type = 'token_transfer';
    } else {
      type = 'transfer';
    }

    // Handle different asset types
    let currency = 'ETH';
    let amount = parseDecimal(String(rawData.value || 0));

    if (isTokenTransfer) {
      currency = rawData.asset || 'UNKNOWN';

      // Alchemy returns human-readable amounts, not raw wei values
      // So we don't need to divide by decimals
      // The rawData.value is already in the correct token units

      // For NFTs, amount is typically 1 or the specified quantity
      if (rawData.category === 'erc721') {
        amount = new Decimal(1);
      } else if (
        rawData.category === 'erc1155' &&
        Array.isArray(rawData.erc1155Metadata) &&
        rawData.erc1155Metadata.length > 0 &&
        rawData.erc1155Metadata[0] !== undefined
      ) {
        // Use the first token's value for ERC-1155
        amount = parseDecimal(rawData.erc1155Metadata[0]?.value || '1');
      }
      // For ERC-20 tokens, use the amount as-is since Alchemy provides human-readable values
    }

    const timestamp = rawData.metadata?.blockTimestamp
      ? new Date(rawData.metadata.blockTimestamp).getTime()
      : Date.now();

    const transaction: UniversalBlockchainTransaction = {
      amount: amount.toString(),
      blockHeight: parseInt(rawData.blockNum, 16),
      currency,
      from: rawData.from,
      id: rawData.hash,
      providerId: 'alchemy',
      status: 'success',
      timestamp,
      to: rawData.to,
      type,
    };

    // Add token-specific fields if it's a token transfer
    if (isTokenTransfer && rawData.rawContract?.address) {
      transaction.tokenAddress = rawData.rawContract.address;
      transaction.tokenSymbol = currency;
      if (rawData.rawContract.decimal) {
        const decimals =
          typeof rawData.rawContract.decimal === 'number'
            ? rawData.rawContract.decimal
            : parseInt(String(rawData.rawContract.decimal));
        transaction.tokenDecimals = decimals;
      }
    }

    return ok(transaction);
  }
}
