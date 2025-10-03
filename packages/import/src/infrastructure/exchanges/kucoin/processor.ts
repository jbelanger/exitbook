import { parseDecimal, createMoney } from '@exitbook/core';
import type { RawData } from '@exitbook/data';
import type { UniversalTransaction } from '@exitbook/import/domain/universal-transaction.ts';
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
    const platformFee = createMoney(totalFee.toString(), sellCurrency);

    return {
      // Core fields
      id: `${withdrawal.UID}-${timestampMs}-convert-market-${sellCurrency}-${buyCurrency}`,
      datetime: timestamp,
      timestamp: timestampMs,
      source: 'kucoin',
      status: this.mapStatus('success', 'deposit_withdrawal'),

      // Structured movements - convert market is a swap (sold X, bought Y)
      movements: {
        outflows: [
          {
            asset: sellCurrency,
            amount: createMoney(sellAmount.toString(), sellCurrency),
          },
        ],
        inflows: [
          {
            asset: buyCurrency,
            amount: createMoney(buyAmount.toString(), buyCurrency),
          },
        ],
        primary: {
          asset: buyCurrency, // What we bought is primary
          amount: createMoney(buyAmount.toString(), buyCurrency),
          direction: 'in' as const,
        },
      },

      // Structured fees - convert market has platform fees
      fees: {
        network: undefined, // No network fee for exchange conversions
        platform: platformFee,
        total: platformFee,
      },

      // Operation classification - 10/10 confidence: convert market is a swap
      operation: {
        category: 'trade',
        type: 'swap',
      },

      // Price information
      price: createMoney(sellAmount.toString(), sellCurrency),

      // Minimal metadata
      metadata: {
        type: 'convert_market',
        depositFee,
        withdrawalFee,
        depositRow: deposit,
        withdrawalRow: withdrawal,
      },
    };
  }

  private convertDepositToTransaction(row: CsvDepositWithdrawalRow): UniversalTransaction {
    const timestamp = new Date(row['Time(UTC)']).getTime();
    const grossAmount = parseDecimal(row.Amount).toNumber();
    const fee = row.Fee ? parseDecimal(row.Fee).toNumber() : 0;

    // For KuCoin deposits: amount is gross, user actually receives amount - fee
    const netAmount = grossAmount - fee;
    const platformFee = createMoney(fee.toString(), row.Coin);

    return {
      // Core fields
      id: row.Hash || `${row.UID}-${timestamp}-${row.Coin}-deposit-${row.Amount}`,
      datetime: row['Time(UTC)'],
      timestamp,
      source: 'kucoin',
      status: this.mapStatus(row.Status, 'deposit_withdrawal'),

      // Structured movements - deposit means we gained assets
      movements: {
        inflows: [
          {
            asset: row.Coin,
            amount: createMoney(netAmount.toString(), row.Coin),
          },
        ],
        outflows: [], // No outflows for deposit
        primary: {
          asset: row.Coin,
          amount: createMoney(netAmount.toString(), row.Coin),
          direction: 'in' as const,
        },
      },

      // Structured fees - exchange deposits have platform fees
      fees: {
        network: undefined, // No network fee for exchange deposits
        platform: platformFee,
        total: platformFee,
      },

      // Operation classification - 10/10 confidence: deposit is transfer/deposit
      operation: {
        category: 'transfer',
        type: 'deposit',
      },

      // Minimal metadata
      metadata: {
        address: row['Deposit Address'],
        hash: row.Hash,
        remarks: row.Remarks,
        transferNetwork: row['Transfer Network'],
        originalRow: row,
      },
    };
  }

  private convertSpotOrderToTransaction(row: CsvSpotOrderRow): UniversalTransaction {
    const timestamp = new Date(row['Filled Time(UTC)']).getTime();
    const [baseCurrency, quoteCurrency] = row.Symbol.split('-');
    const filledAmount = parseDecimal(row['Filled Amount']).toNumber();
    const filledVolume = parseDecimal(row['Filled Volume']).toNumber();
    const fee = parseDecimal(row.Fee).toNumber();
    const platformFee = createMoney(fee.toString(), row['Fee Currency']);
    const side = row.Side.toLowerCase() as 'buy' | 'sell';

    // For spot orders:
    // - Buy: spent quoteCurrency (filledVolume), received baseCurrency (filledAmount)
    // - Sell: spent baseCurrency (filledAmount), received quoteCurrency (filledVolume)
    const isBuy = side === 'buy';

    return {
      // Core fields
      id: row['Order ID'],
      datetime: row['Filled Time(UTC)'],
      timestamp,
      source: 'kucoin',
      status: this.mapStatus(row.Status, 'spot'),

      // Structured movements - trade has both outflow and inflow
      movements: {
        outflows: [
          {
            asset: isBuy ? quoteCurrency || 'unknown' : baseCurrency || 'unknown',
            amount: createMoney(
              isBuy ? filledVolume.toString() : filledAmount.toString(),
              isBuy ? quoteCurrency || 'unknown' : baseCurrency || 'unknown'
            ),
          },
        ],
        inflows: [
          {
            asset: isBuy ? baseCurrency || 'unknown' : quoteCurrency || 'unknown',
            amount: createMoney(
              isBuy ? filledAmount.toString() : filledVolume.toString(),
              isBuy ? baseCurrency || 'unknown' : quoteCurrency || 'unknown'
            ),
          },
        ],
        primary: {
          asset: baseCurrency || 'unknown', // Base currency is always primary
          amount: createMoney(isBuy ? filledAmount.toString() : (-filledAmount).toString(), baseCurrency || 'unknown'),
          direction: isBuy ? ('in' as const) : ('out' as const),
        },
      },

      // Structured fees - exchange trades have platform fees
      fees: {
        network: undefined, // No network fee for exchange trades
        platform: platformFee,
        total: platformFee,
      },

      // Operation classification - 10/10 confidence: spot order is trade/buy or trade/sell
      operation: {
        category: 'trade',
        type: side, // 'buy' or 'sell'
      },

      // Price information
      price: createMoney(filledVolume.toString(), quoteCurrency || 'unknown'),

      // Minimal metadata
      metadata: {
        side,
        orderType: row['Order Type'],
        orderTime: row['Order Time(UTC)'],
        orderAmount: parseDecimal(row['Order Amount']).toNumber(),
        orderPrice: parseDecimal(row['Order Price']).toNumber(),
        filledVolumeUSDT: parseDecimal(row['Filled Volume (USDT)']).toNumber(),
        originalRow: row,
      },
    };
  }

  private convertWithdrawalToTransaction(row: CsvDepositWithdrawalRow): UniversalTransaction {
    const timestamp = new Date(row['Time(UTC)']).getTime();
    const absAmount = Math.abs(parseDecimal(row.Amount).toNumber());
    const fee = row.Fee ? parseDecimal(row.Fee).toNumber() : 0;
    const platformFee = createMoney(fee.toString(), row.Coin);

    return {
      // Core fields
      id: row.Hash || `${row.UID}-${timestamp}-${row.Coin}-withdrawal-${row.Amount}`,
      datetime: row['Time(UTC)'],
      timestamp,
      source: 'kucoin',
      status: this.mapStatus(row.Status, 'deposit_withdrawal'),

      // Structured movements - withdrawal means we lost assets
      movements: {
        inflows: [],
        outflows: [
          {
            asset: row.Coin,
            amount: createMoney(absAmount.toString(), row.Coin),
          },
        ],
        primary: {
          asset: row.Coin,
          amount: createMoney((-absAmount).toString(), row.Coin), // Negative for outflow
          direction: 'out' as const,
        },
      },

      // Structured fees - exchange withdrawals have platform fees
      fees: {
        network: undefined, // No network fee for exchange withdrawals
        platform: platformFee,
        total: platformFee,
      },

      // Operation classification - 10/10 confidence: withdrawal is transfer/withdrawal
      operation: {
        category: 'transfer',
        type: 'withdrawal',
      },

      // Minimal metadata
      metadata: {
        address: row['Withdrawal Address/Account'],
        hash: row.Hash,
        remarks: row.Remarks,
        transferNetwork: row['Transfer Network'],
        originalRow: row,
      },
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
