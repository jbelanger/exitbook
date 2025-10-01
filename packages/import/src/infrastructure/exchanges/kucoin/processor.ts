import type { RawData } from '@exitbook/data';
import type { UniversalTransaction } from '@exitbook/import/domain/universal-transaction.ts';
import { createMoney, parseDecimal } from '@exitbook/shared-utils';
import { type Result, err, ok } from 'neverthrow';

import { BaseTransactionProcessor } from '../../shared/processors/base-transaction-processor.ts';

import type { CsvAccountHistoryRow, CsvDepositWithdrawalRow, CsvKuCoinRawData, CsvSpotOrderRow } from './types.js';

/**
 * Processor for KuCoin CSV data.
 * Handles processing logic for KuCoin transactions including:
 * - Spot order processing
 * - Deposit and withdrawal handling
 * - Convert market transaction processing from account history
 */
export class KucoinProcessor extends BaseTransactionProcessor {
  constructor() {
    super('kucoin');
  }

  protected async processInternal(rawDataItems: RawData[]): Promise<Result<UniversalTransaction[], string>> {
    const allTransactions: UniversalTransaction[] = [];

    for (const rawDataItem of rawDataItems) {
      const result = this.processSingle(rawDataItem);
      if (result.isErr()) {
        this.logger.warn(`Failed to process KuCoin batch: ${result.error}`);
        continue;
      }

      const transactions = result.value;
      if (transactions) {
        allTransactions.push(...transactions);
      }
    }

    return Promise.resolve(ok(allTransactions));
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
      amount: createMoney(buyAmount.toString(), buyCurrency),
      datetime: timestamp,
      fee: totalFee > 0 ? createMoney(totalFee.toString(), sellCurrency) : createMoney('0', sellCurrency),
      id: `${withdrawal.UID}-${timestampMs}-convert-market-${sellCurrency}-${buyCurrency}`,
      metadata: {
        buyAmount,
        buyCurrency,
        depositFee,
        depositRow: deposit,
        sellAmount,
        sellCurrency,
        type: 'convert_market',
        withdrawalFee,
        withdrawalRow: withdrawal,
      },
      price: createMoney(sellAmount.toString(), sellCurrency),
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
      amount: createMoney(amount.toString(), row.Coin),
      datetime: row['Time(UTC)'],
      fee: fee > 0 ? createMoney(fee.toString(), row.Coin) : createMoney('0', row.Coin),
      id: row.Hash || `${row.UID}-${timestamp}-${row.Coin}-deposit-${row.Amount}`,
      metadata: {
        address: row['Deposit Address'],
        hash: row.Hash,
        originalRow: row,
        remarks: row.Remarks,
        transferNetwork: row['Transfer Network'],
      },
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
      amount: createMoney(filledAmount.toString(), baseCurrency || 'unknown'),
      datetime: row['Filled Time(UTC)'],
      fee: createMoney(fee.toString(), row['Fee Currency']),
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
      price: createMoney(filledVolume.toString(), quoteCurrency || 'unknown'),
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
      amount: createMoney(amount.toString(), row.Coin),
      datetime: row['Time(UTC)'],
      fee: fee > 0 ? createMoney(fee.toString(), row.Coin) : createMoney('0', row.Coin),
      id: row.Hash || `${row.UID}-${timestamp}-${row.Coin}-withdrawal-${row.Amount}`,
      metadata: {
        address: row['Withdrawal Address/Account'],
        hash: row.Hash,
        originalRow: row,
        remarks: row.Remarks,
        transferNetwork: row['Transfer Network'],
      },
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
    const convertMarketRows = filteredRows.filter((row) => row.Type === 'Convert Market');

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
        const deposit = group.find((row) => row.Side === 'Deposit');
        const withdrawal = group.find((row) => row.Side === 'Withdrawal');

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

  private processSingle(rawDataItem: RawData): Result<UniversalTransaction[], string> {
    try {
      const rawData = rawDataItem.raw_data;
      const transactions: UniversalTransaction[] = [];

      // Process spot orders
      for (const row of (rawData as CsvKuCoinRawData).spotOrders) {
        const transaction = this.convertSpotOrderToTransaction(row);
        transactions.push(transaction);
      }

      // Process deposits
      for (const row of (rawData as CsvKuCoinRawData).deposits) {
        const transaction = this.convertDepositToTransaction(row);
        transactions.push(transaction);
      }

      // Process withdrawals
      for (const row of (rawData as CsvKuCoinRawData).withdrawals) {
        const transaction = this.convertWithdrawalToTransaction(row);
        transactions.push(transaction);
      }

      // Process account history (convert market transactions)
      const convertTransactions = this.processAccountHistory((rawData as CsvKuCoinRawData).accountHistory);
      transactions.push(...convertTransactions);

      return ok(transactions);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return err(`Failed to process KuCoin batch: ${errorMessage}`);
    }
  }
}
