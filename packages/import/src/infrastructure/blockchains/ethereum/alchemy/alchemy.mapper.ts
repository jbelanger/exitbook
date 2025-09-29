import type { ImportSessionMetadata } from '@exitbook/import/app/ports/processors.js';
import { parseDecimal } from '@exitbook/shared-utils';
import { Decimal } from 'decimal.js';
import { type Result, ok } from 'neverthrow';

import { RegisterTransactionMapper } from '../../../shared/processors/processor-registry.js';
import { BaseRawDataMapper } from '../../shared/base-raw-data-mapper.js';
import type { EthereumTransaction } from '../types.js';

import { AlchemyAssetTransferSchema } from './alchemy.schemas.js';
import type { AlchemyAssetTransfer } from './alchemy.types.js';

@RegisterTransactionMapper('alchemy')
export class AlchemyTransactionMapper extends BaseRawDataMapper<AlchemyAssetTransfer, EthereumTransaction> {
  protected readonly schema = AlchemyAssetTransferSchema;

  protected mapInternal(
    rawData: AlchemyAssetTransfer,
    _sessionContext: ImportSessionMetadata
  ): Result<EthereumTransaction, string> {
    // Determine if this is a token transfer
    const isTokenTransfer =
      rawData.category === 'token' ||
      rawData.category === 'erc20' ||
      rawData.category === 'erc721' ||
      rawData.category === 'erc1155';

    // Extract basic transaction data
    let currency = 'ETH';
    let amount = parseDecimal(String(rawData.value || 0));
    let tokenType: EthereumTransaction['tokenType'] = 'native';

    if (isTokenTransfer) {
      currency = rawData.asset || 'UNKNOWN';
      tokenType = rawData.category as EthereumTransaction['tokenType'];

      // For NFTs, amount is typically 1 or the specified quantity
      if (rawData.category === 'erc721') {
        amount = new Decimal(1);
      } else if (
        rawData.category === 'erc1155' &&
        Array.isArray(rawData.erc1155Metadata) &&
        rawData.erc1155Metadata.length > 0 &&
        rawData.erc1155Metadata[0] !== undefined
      ) {
        amount = parseDecimal(rawData.erc1155Metadata[0]?.value || '1');
      }
    }

    const timestamp = rawData.metadata?.blockTimestamp
      ? new Date(rawData.metadata.blockTimestamp).getTime()
      : Date.now();

    const transaction: EthereumTransaction = {
      amount: amount.toString(),
      blockHeight: parseInt(rawData.blockNum, 16),
      currency,
      from: rawData.from,
      id: rawData.hash,
      providerId: 'alchemy',
      status: 'success',
      timestamp,
      to: rawData.to,
      tokenType,
      type: isTokenTransfer ? 'token_transfer' : 'transfer',
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
