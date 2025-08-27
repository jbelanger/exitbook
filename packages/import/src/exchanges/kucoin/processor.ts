import type { UniversalTransaction } from '@crypto/core';
import { createMoney, parseDecimal } from '@crypto/shared-utils';

import { BaseProcessor } from '../../shared/processors/base-processor.ts';
import type { StoredRawData } from '../../shared/processors/interfaces.ts';
import type { CsvAccountHistoryRow, CsvDepositWithdrawalRow, CsvKuCoinRawData, CsvSpotOrderRow } from './types.ts';

/**
 * Processor for KuCoin CSV data.
 * Handles processing logic for KuCoin transactions including:
 * - Spot order processing
 * - Deposit and withdrawal handling
 * - Convert market transaction processing from account history
 */
export class KucoinProcessor extends BaseProcessor<CsvKuCoinRawData> {
  constructor() {
    super('kucoin');
  }

  private convertAccountHistoryConvertToTransaction(
    deposit: CsvAccountHistoryRow,
    withdrawal: CsvAccountHistoryRow,
    timestamp: string
  ): UniversalTransaction {
    const timestampMs = new Date(timestamp).getTime();

    const sellCurrency = withdrawal.Currency;
    const sellAmount = parseDecimal(withdrawal.Amount).abs().toNumber();
    const buyCurrency = deposit.Currency;
    const buyAmount = parseDecimal(deposit.Amount).toNumber();

    // Calculate total fees (both deposit and withdrawal fees)
    const withdrawalFee = withdrawal.Fee ? parseDecimal(withdrawal.Fee).toNumber() : 0;
    const depositFee = deposit.Fee ? parseDecimal(deposit.Fee).toNumber() : 0;
    const totalFee = withdrawalFee + depositFee;

    return {
      amount: createMoney(buyAmount, buyCurrency),
      datetime: timestamp,
      fee: totalFee > 0 ? createMoney(totalFee, sellCurrency) : createMoney(0, sellCurrency),
      id: `${withdrawal.UID}-${timestampMs}-convert-market-${sellCurrency}-${buyCurrency}`,
      metadata: {
        buyAmount,
        buyCurrency,
        depositFee,
        depositRow: deposit,
        sellAmount,
        sellCurrency,
        side: 'buy',
        type: 'convert_market',
        withdrawalFee,
        withdrawalRow: withdrawal,
      },
      network: 'exchange',
      price: createMoney(sellAmount, sellCurrency),
      source: 'kucoin',
      status: this.mapStatus('success', 'deposit_withdrawal'),
      symbol: `${buyCurrency}/${sellCurrency}`,
      timestamp: timestampMs,
      type: 'trade' as const,
    };
  }

  private convertDepositToTransaction(row: CsvDepositWithdrawalRow): UniversalTransaction {
    const timestamp = new Date(row['Time(UTC)']).getTime();
    const amount = parseDecimal(row.Amount).toNumber();
    const fee = row.Fee ? parseDecimal(row.Fee).toNumber() : 0;

    return {
      amount: createMoney(amount, row.Coin),
      datetime: row['Time(UTC)'],
      fee: fee > 0 ? createMoney(fee, row.Coin) : createMoney(0, row.Coin),
      id: row.Hash || `${row.UID}-${timestamp}-${row.Coin}-deposit-${row.Amount}`,
      metadata: {
        address: row['Deposit Address'],
        hash: row.Hash,
        originalRow: row,
        remarks: row.Remarks,
        transferNetwork: row['Transfer Network'],
      },
      network: 'exchange',
      source: 'kucoin',
      status: this.mapStatus(row.Status, 'deposit_withdrawal'),
      timestamp,
      type: 'deposit' as const,
    };
  }

  private convertSpotOrderToTransaction(row: CsvSpotOrderRow): UniversalTransaction {
    const timestamp = new Date(row['Filled Time(UTC)']).getTime();
    const [baseCurrency, quoteCurrency] = row.Symbol.split('-');
    const filledAmount = parseDecimal(row['Filled Amount']).toNumber();
    const filledVolume = parseDecimal(row['Filled Volume']).toNumber();
    const fee = parseDecimal(row.Fee).toNumber();

    return {
      amount: createMoney(filledAmount, baseCurrency || 'unknown'),
      datetime: row['Filled Time(UTC)'],
      fee: createMoney(fee, row['Fee Currency']),
      id: row['Order ID'],
      metadata: {
        filledVolume,
        filledVolumeUSDT: parseDecimal(row['Filled Volume (USDT)']).toNumber(),
        orderAmount: parseDecimal(row['Order Amount']).toNumber(),
        orderPrice: parseDecimal(row['Order Price']).toNumber(),
        orderTime: row['Order Time(UTC)'],
        orderType: row['Order Type'],
        originalRow: row,
        side: row.Side.toLowerCase() as 'buy' | 'sell',
      },
      network: 'exchange',
      price: createMoney(filledVolume, quoteCurrency || 'unknown'),
      source: 'kucoin',
      status: this.mapStatus(row.Status, 'spot'),
      symbol: `${baseCurrency}/${quoteCurrency}`,
      timestamp,
      type: 'trade' as const,
    };
  }

  private convertWithdrawalToTransaction(row: CsvDepositWithdrawalRow): UniversalTransaction {
    const timestamp = new Date(row['Time(UTC)']).getTime();
    const amount = parseDecimal(row.Amount).toNumber();
    const fee = row.Fee ? parseDecimal(row.Fee).toNumber() : 0;

    return {
      amount: createMoney(amount, row.Coin),
      datetime: row['Time(UTC)'],
      fee: fee > 0 ? createMoney(fee, row.Coin) : createMoney(0, row.Coin),
      id: row.Hash || `${row.UID}-${timestamp}-${row.Coin}-withdrawal-${row.Amount}`,
      metadata: {
        address: row['Withdrawal Address/Account'],
        hash: row.Hash,
        originalRow: row,
        remarks: row.Remarks,
        transferNetwork: row['Transfer Network'],
      },
      network: 'exchange',
      source: 'kucoin',
      status: this.mapStatus(row.Status, 'deposit_withdrawal'),
      timestamp,
      type: 'withdrawal' as const,
    };
  }

  private mapStatus(
    status: string,
    type: 'spot' | 'deposit_withdrawal'
  ): 'closed' | 'open' | 'canceled' | 'pending' | 'ok' | 'failed' {
    if (!status) return 'pending';

    const statusLower = status.toLowerCase();

    if (type === 'spot') {
      switch (statusLower) {
        case 'deal':
          return 'closed';
        case 'part_deal':
          return 'open';
        case 'cancel':
          return 'canceled';
        default:
          return 'pending';
      }
    } else {
      // deposit_withdrawal
      switch (statusLower) {
        case 'success':
          return 'ok';
        case 'pending':
          return 'pending';
        case 'failed':
          return 'failed';
        case 'canceled':
          return 'canceled';
        default:
          return 'pending';
      }
    }
  }

  /**
   * Process account history to extract convert market transactions
   */
  private processAccountHistory(filteredRows: CsvAccountHistoryRow[]): UniversalTransaction[] {
    const convertTransactions: UniversalTransaction[] = [];
    const convertMarketRows = filteredRows.filter(row => row.Type === 'Convert Market');

    // Group convert market entries by timestamp
    const convertGroups = new Map<string, CsvAccountHistoryRow[]>();

    for (const row of convertMarketRows) {
      const timestamp = row['Time(UTC)'];
      if (!convertGroups.has(timestamp)) {
        convertGroups.set(timestamp, []);
      }
      convertGroups.get(timestamp)!.push(row);
    }

    // Process each group of convert transactions
    for (const [timestamp, group] of convertGroups) {
      if (group.length === 2) {
        // Should be one deposit and one withdrawal
        const deposit = group.find(row => row.Side === 'Deposit');
        const withdrawal = group.find(row => row.Side === 'Withdrawal');

        if (deposit && withdrawal) {
          const convertTx = this.convertAccountHistoryConvertToTransaction(deposit, withdrawal, timestamp);
          convertTransactions.push(convertTx);
        } else {
          this.logger.warn(
            `Convert Market group missing deposit/withdrawal pair - Timestamp: ${timestamp}, Group: ${JSON.stringify(group)}`
          );
        }
      } else {
        this.logger.warn(
          `Convert Market group has unexpected number of entries - Timestamp: ${timestamp}, Count: ${group.length}, Group: ${JSON.stringify(group)}`
        );
      }
    }

    return convertTransactions;
  }

  protected canProcessSpecific(sourceType: string): boolean {
    return sourceType === 'exchange';
  }

  async process(rawDataItems: StoredRawData<CsvKuCoinRawData>[]): Promise<UniversalTransaction[]> {
    this.logger.info(`Processing ${rawDataItems.length} KuCoin raw data batches`);

    const allTransactions: UniversalTransaction[] = [];

    try {
      for (const rawDataItem of rawDataItems) {
        const rawData = rawDataItem.rawData;

        // Process spot orders
        for (const row of rawData.spotOrders) {
          const transaction = this.convertSpotOrderToTransaction(row);
          allTransactions.push(transaction);
        }

        // Process deposits
        for (const row of rawData.deposits) {
          const transaction = this.convertDepositToTransaction(row);
          allTransactions.push(transaction);
        }

        // Process withdrawals
        for (const row of rawData.withdrawals) {
          const transaction = this.convertWithdrawalToTransaction(row);
          allTransactions.push(transaction);
        }

        // Process account history (convert market transactions)
        const convertTransactions = this.processAccountHistory(rawData.accountHistory);
        allTransactions.push(...convertTransactions);
      }

      this.logger.info(`Successfully processed ${allTransactions.length} KuCoin transactions`);
      return allTransactions;
    } catch (error) {
      this.logger.error(`Failed to process KuCoin data: ${error}`);
      throw error;
    }
  }

  async processSingle(_rawData: StoredRawData<CsvKuCoinRawData>): Promise<UniversalTransaction | null> {
    // For KuCoin, we don't process single items as the data comes in structured batches
    // This method is mainly for compatibility - the real logic is in the batch process
    this.logger.warn('Single processing not supported for KuCoin - use batch processing instead');
    return null;
  }
}
