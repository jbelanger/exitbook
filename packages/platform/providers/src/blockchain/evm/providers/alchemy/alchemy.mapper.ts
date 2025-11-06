import type { SourceMetadata } from '@exitbook/core';
import { type Result, ok } from 'neverthrow';

import { BaseRawDataMapper } from '../../../../shared/blockchain/base/mapper.js';
import type { NormalizationError } from '../../../../shared/blockchain/index.js';
import { determineTransactionType, extractAmountAndCurrency, isTokenTransfer } from '../../mapper-utils.js';
import { calculateGasFee } from '../../receipt-utils.js';
import { EvmTransactionSchema } from '../../schemas.js';
import type { EvmTransaction } from '../../types.js';
import { normalizeEvmAddress } from '../../utils.js';

import { AlchemyAssetTransferSchema, type AlchemyAssetTransfer } from './alchemy.schemas.js';

export class AlchemyTransactionMapper extends BaseRawDataMapper<AlchemyAssetTransfer, EvmTransaction> {
  protected readonly inputSchema = AlchemyAssetTransferSchema;
  protected readonly outputSchema = EvmTransactionSchema;

  protected mapInternal(
    rawData: AlchemyAssetTransfer,
    _sourceContext: SourceMetadata
  ): Result<EvmTransaction, NormalizationError> {
    const { amount, currency, tokenType } = extractAmountAndCurrency(rawData);
    const timestamp = rawData.metadata.blockTimestamp.getTime();
    const transactionType = determineTransactionType(rawData.category);

    const transaction: EvmTransaction = {
      amount: amount.toFixed(),
      blockHeight: parseInt(rawData.blockNum, 16),
      currency,
      from: normalizeEvmAddress(rawData.from) ?? '',
      id: rawData.hash,
      providerId: 'alchemy',
      status: 'success',
      timestamp,
      to: normalizeEvmAddress(rawData.to),
      tokenType,
      type: transactionType,
    };

    this.enrichWithTokenFields(transaction, rawData, currency);
    this.enrichWithGasFees(transaction, rawData);

    return ok(transaction);
  }

  private enrichWithTokenFields(transaction: EvmTransaction, rawData: AlchemyAssetTransfer, _currency: string): void {
    if (!isTokenTransfer(rawData.category)) return;

    const contractAddress = rawData.rawContract?.address;
    if (!contractAddress) return;

    transaction.tokenAddress = normalizeEvmAddress(contractAddress);
    // Use contract address - processor will enrich with symbol from token repository
    transaction.tokenSymbol = contractAddress;

    const rawDecimals = rawData.rawContract?.decimal;
    if (rawDecimals !== undefined) {
      transaction.tokenDecimals = typeof rawDecimals === 'number' ? rawDecimals : parseInt(String(rawDecimals));
    }
  }

  private enrichWithGasFees(transaction: EvmTransaction, rawData: AlchemyAssetTransfer): void {
    // Extract gas data from receipt (added by API client)
    const gasUsed = rawData._gasUsed;
    const effectiveGasPrice = rawData._effectiveGasPrice;
    const nativeCurrency = rawData._nativeCurrency;

    if (!gasUsed || !effectiveGasPrice) {
      return;
    }

    const feeWei = calculateGasFee(gasUsed, effectiveGasPrice);

    transaction.gasUsed = gasUsed;
    transaction.gasPrice = effectiveGasPrice;
    transaction.feeAmount = feeWei.toString();

    // Gas fees are always paid in the native currency (ETH, MATIC, AVAX, etc.)
    // Use the chain-specific native currency from chain registry
    transaction.feeCurrency = nativeCurrency || 'ETH'; // Fallback to ETH if not provided
  }
}
