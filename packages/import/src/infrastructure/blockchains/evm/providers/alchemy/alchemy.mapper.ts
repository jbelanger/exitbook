import type { RawTransactionMetadata } from '@exitbook/import/app/ports/importers.ts';
import type { ImportSessionMetadata } from '@exitbook/import/app/ports/transaction-processor.interface.ts';
import { parseDecimal } from '@exitbook/shared-utils';
import { Decimal } from 'decimal.js';
import { type Result, ok } from 'neverthrow';

import { RegisterTransactionMapper } from '../../../../shared/processors/processor-registry.ts';
import { BaseRawDataMapper } from '../../../shared/base-raw-data-mapper.ts';
import { EvmTransactionSchema } from '../../schemas.js';
import type { EvmTransaction } from '../../types.js';

import { AlchemyAssetTransferSchema } from './alchemy.schemas.js';
import type { AlchemyAssetTransfer } from './alchemy.types.js';

@RegisterTransactionMapper('alchemy')
export class AlchemyTransactionMapper extends BaseRawDataMapper<AlchemyAssetTransfer, EvmTransaction> {
  protected readonly inputSchema = AlchemyAssetTransferSchema;
  protected readonly outputSchema = EvmTransactionSchema;

  protected mapInternal(
    rawData: AlchemyAssetTransfer,
    _metadata: RawTransactionMetadata,
    _sessionContext: ImportSessionMetadata
  ): Result<EvmTransaction, string> {
    // Determine if this is a token transfer
    const isTokenTransfer =
      rawData.category === 'token' ||
      rawData.category === 'erc20' ||
      rawData.category === 'erc721' ||
      rawData.category === 'erc1155';

    // Determine if this is an internal transaction
    const isInternal = rawData.category === 'internal';

    // Extract basic transaction data - currency will be determined later
    let currency: string;
    let amount: Decimal;
    let tokenType: EvmTransaction['tokenType'] = 'native';

    if (isTokenTransfer) {
      // For token transfers, use rawContract.value if available
      const rawValue = rawData.rawContract?.value || rawData.value;

      // Handle hex string values (common for ERC20 transfers)
      if (typeof rawValue === 'string' && rawValue.startsWith('0x')) {
        amount = new Decimal(BigInt(rawValue).toString());
      } else {
        amount = parseDecimal(String(rawValue || 0));
      }

      currency = rawData.asset || 'UNKNOWN';
      tokenType = rawData.category as EvmTransaction['tokenType'];

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
    } else {
      // For native transfers (ETH, AVAX, MATIC, etc.) - use asset from rawData
      amount = parseDecimal(String(rawData.value || 0));
      currency = rawData.asset || 'UNKNOWN'; // Alchemy provides asset for all transfer types
    }

    const timestamp = rawData.metadata?.blockTimestamp
      ? new Date(rawData.metadata.blockTimestamp).getTime()
      : Date.now();

    // Determine transaction type
    let transactionType: EvmTransaction['type'];
    if (isTokenTransfer) {
      transactionType = 'token_transfer';
    } else if (isInternal) {
      transactionType = 'internal';
    } else {
      transactionType = 'transfer';
    }

    const transaction: EvmTransaction = {
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
      type: transactionType,
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
