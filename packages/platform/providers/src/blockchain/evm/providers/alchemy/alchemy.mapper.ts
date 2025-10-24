import { parseDecimal } from '@exitbook/core';
import type { ImportSessionMetadata } from '@exitbook/core';
import type { Decimal } from 'decimal.js';
import { type Result, ok } from 'neverthrow';

import { BaseRawDataMapper } from '../../../../shared/blockchain/base/mapper.ts';
import type { NormalizationError } from '../../../../shared/blockchain/index.ts';
import { EvmTransactionSchema } from '../../schemas.js';
import type { EvmTransaction } from '../../types.js';

import { AlchemyAssetTransferSchema, type AlchemyAssetTransfer } from './alchemy.schemas.js';

const TOKEN_CATEGORIES = new Set<string>(['token', 'erc20', 'erc721', 'erc1155']);

interface AmountResult {
  amount: Decimal;
  currency: string;
  tokenType: EvmTransaction['tokenType'];
}

export class AlchemyTransactionMapper extends BaseRawDataMapper<AlchemyAssetTransfer, EvmTransaction> {
  protected readonly inputSchema = AlchemyAssetTransferSchema;
  protected readonly outputSchema = EvmTransactionSchema;

  protected mapInternal(
    rawData: AlchemyAssetTransfer,
    _sessionContext: ImportSessionMetadata
  ): Result<EvmTransaction, NormalizationError> {
    const { amount, currency, tokenType } = this.extractAmountAndCurrency(rawData);
    const timestamp = this.extractTimestamp(rawData);
    const transactionType = this.determineTransactionType(rawData.category);

    const transaction: EvmTransaction = {
      amount: amount.toString(),
      blockHeight: parseInt(rawData.blockNum, 16),
      currency,
      from: rawData.from,
      id: rawData.hash,
      providerId: 'alchemy',
      status: 'success',
      timestamp,
      to: rawData.to ?? undefined,
      tokenType,
      type: transactionType,
    };

    this.enrichWithTokenFields(transaction, rawData, currency);
    this.enrichWithGasFees(transaction, rawData);

    return ok(transaction);
  }

  private extractAmountAndCurrency(rawData: AlchemyAssetTransfer): AmountResult {
    const isTokenTransfer = TOKEN_CATEGORIES.has(rawData.category);

    return isTokenTransfer ? this.extractTokenTransferData(rawData) : this.extractNativeTransferData(rawData);
  }

  private extractTokenTransferData(rawData: AlchemyAssetTransfer): AmountResult {
    const rawValue = rawData.rawContract?.value || rawData.value;
    const baseAmount = parseDecimal(String(rawValue || 0));

    const amount = this.adjustNftAmount(rawData, baseAmount);
    const currency = rawData.asset ?? (rawData.rawContract?.address || 'UNKNOWN');
    const tokenType = rawData.category as EvmTransaction['tokenType'];

    return { amount, currency, tokenType };
  }

  private adjustNftAmount(rawData: AlchemyAssetTransfer, baseAmount: Decimal): Decimal {
    const nftAmountHandlers: Record<string, () => Decimal> = {
      erc721: () => parseDecimal('1'),
      erc1155: () => this.extractErc1155Amount(rawData),
    };

    const handler = nftAmountHandlers[rawData.category];
    return handler ? handler() : baseAmount;
  }

  private extractErc1155Amount(rawData: AlchemyAssetTransfer): Decimal {
    const firstMetadata = rawData.erc1155Metadata?.[0];
    return firstMetadata?.value ? parseDecimal(firstMetadata.value) : parseDecimal('1');
  }

  private extractNativeTransferData(rawData: AlchemyAssetTransfer): AmountResult {
    const amount = rawData.rawContract?.value
      ? parseDecimal(String(rawData.rawContract.value))
      : this.convertToSmallestUnit(rawData);

    const currency = rawData.asset ?? (rawData.rawContract?.address || 'UNKNOWN');

    return { amount, currency, tokenType: 'native' };
  }

  private convertToSmallestUnit(rawData: AlchemyAssetTransfer): Decimal {
    const decimalAmount = parseDecimal(String(rawData.value || 0));
    const decimals = rawData.rawContract?.decimal ? parseInt(String(rawData.rawContract.decimal)) : 18;
    return decimalAmount.mul(parseDecimal('10').pow(decimals));
  }

  private extractTimestamp(rawData: AlchemyAssetTransfer): number {
    return new Date(rawData.metadata.blockTimestamp).getTime();
  }

  private determineTransactionType(category: string): EvmTransaction['type'] {
    if (TOKEN_CATEGORIES.has(category)) return 'token_transfer';
    if (category === 'internal') return 'internal';
    return 'transfer';
  }

  private enrichWithTokenFields(transaction: EvmTransaction, rawData: AlchemyAssetTransfer, currency: string): void {
    const isTokenTransfer = TOKEN_CATEGORIES.has(rawData.category);
    const contractAddress = rawData.rawContract?.address;

    if (!isTokenTransfer || !contractAddress) return;

    transaction.tokenAddress = contractAddress;
    transaction.tokenSymbol = currency;

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

    // Calculate total fee: gasUsed * effectiveGasPrice (both in wei)
    const gasUsedDecimal = parseDecimal(gasUsed);
    const gasPriceDecimal = parseDecimal(effectiveGasPrice);
    const feeWei = gasUsedDecimal.mul(gasPriceDecimal);

    transaction.gasUsed = gasUsed;
    transaction.gasPrice = effectiveGasPrice;
    transaction.feeAmount = feeWei.toString();

    // Gas fees are always paid in the native currency (ETH, MATIC, AVAX, etc.)
    // Use the chain-specific native currency from chain registry
    transaction.feeCurrency = nativeCurrency || 'ETH'; // Fallback to ETH if not provided
  }
}
