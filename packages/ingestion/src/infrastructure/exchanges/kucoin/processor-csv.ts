import { parseDecimal, getErrorMessage } from '@exitbook/core';
import type { UniversalTransaction } from '@exitbook/core';
import { type Result, okAsync } from 'neverthrow';

import { BaseTransactionProcessor } from '../../shared/processors/base-transaction-processor.ts';

import type {
  CsvAccountHistoryRow,
  CsvDepositWithdrawalRow,
  CsvOrderSplittingRow,
  CsvSpotOrderRow,
  CsvTradingBotRow,
} from './types.js';

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

  protected async processInternal(rawDataItems: unknown[]): Promise<Result<UniversalTransaction[], string>> {
    const allTransactions: UniversalTransaction[] = [];
    const accountHistoryRows: CsvAccountHistoryRow[] = [];

    for (const rawDataItem of rawDataItems) {
      // For exchanges, rawDataItem is wrapped in a dataPackage with {raw, normalized, externalId, cursor}
      // Extract the normalized data which contains the _rowType field
      const dataPackage = rawDataItem as { normalized?: unknown };
      const row = (dataPackage.normalized || rawDataItem) as { _rowType?: string };

      try {
        switch (row._rowType) {
          case 'spot_order': {
            const transaction = this.convertSpotOrderToTransaction(row as CsvSpotOrderRow);
            allTransactions.push(transaction);
            break;
          }
          case 'order_splitting': {
            const transaction = this.convertOrderSplittingToTransaction(row as CsvOrderSplittingRow);
            allTransactions.push(transaction);
            break;
          }
          case 'deposit': {
            const transaction = this.convertDepositToTransaction(row as CsvDepositWithdrawalRow);
            allTransactions.push(transaction);
            break;
          }
          case 'withdrawal': {
            const transaction = this.convertWithdrawalToTransaction(row as CsvDepositWithdrawalRow);
            allTransactions.push(transaction);
            break;
          }
          case 'account_history': {
            // Collect account history rows for batch processing (convert market grouping)
            accountHistoryRows.push(row as CsvAccountHistoryRow);
            break;
          }
          case 'trading_bot': {
            const transaction = this.convertTradingBotToTransaction(row as CsvTradingBotRow);
            allTransactions.push(transaction);
            break;
          }
          default:
            this.logger.warn(`Unknown row type: ${row._rowType}`);
        }
      } catch (error) {
        const errorMessage = getErrorMessage(error);
        this.logger.warn(`Failed to process KuCoin row: ${errorMessage}`);
        continue;
      }
    }

    // Process account history rows (handles convert market grouping)
    if (accountHistoryRows.length > 0) {
      const convertTransactions = this.processAccountHistory(accountHistoryRows);
      allTransactions.push(...convertTransactions);
    }

    return okAsync(allTransactions);
  }

  private convertAccountHistoryConvertToTransaction(
    deposit: CsvAccountHistoryRow,
    withdrawal: CsvAccountHistoryRow,
    timestamp: string
  ): UniversalTransaction {
    const timestampMs = new Date(timestamp).getTime();

    const sellCurrency = withdrawal.Currency;
    const sellAmount = parseDecimal(withdrawal.Amount).abs();
    const buyCurrency = deposit.Currency;
    const buyAmount = parseDecimal(deposit.Amount);

    // Calculate total fees (both deposit and withdrawal fees)
    const withdrawalFee = withdrawal.Fee ? parseDecimal(withdrawal.Fee) : parseDecimal('0');
    const depositFee = deposit.Fee ? parseDecimal(deposit.Fee) : parseDecimal('0');
    const totalFee = withdrawalFee.plus(depositFee);
    const platformFee = { amount: totalFee, asset: sellCurrency };

    return {
      id: 0, // Will be assigned by database
      externalId: `${withdrawal.UID}-${timestampMs}-convert-market-${sellCurrency}-${buyCurrency}`,
      datetime: timestamp,
      timestamp: timestampMs,
      source: 'kucoin',
      status: this.mapStatus('success', 'deposit_withdrawal'),

      // Structured movements - convert market is a swap (sold X, bought Y)
      movements: {
        outflows: [
          {
            asset: sellCurrency,
            amount: sellAmount,
          },
        ],
        inflows: [
          {
            asset: buyCurrency,
            amount: buyAmount,
          },
        ],
      },

      // Structured fees - convert market has platform fees
      fees: {
        network: undefined, // No network fee for exchange conversions
        platform: platformFee,
      },

      // Operation classification - 10/10 confidence: convert market is a swap
      operation: {
        category: 'trade',
        type: 'swap',
      },

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
    const grossAmount = parseDecimal(row.Amount);
    const fee = row.Fee ? parseDecimal(row.Fee) : parseDecimal('0');

    // For KuCoin deposits: amount is gross, user actually receives amount - fee
    const netAmount = grossAmount.minus(fee);
    const platformFee = { amount: fee, asset: row.Coin };

    return {
      id: 0, // Will be assigned by database
      externalId: row.Hash || `${row.UID}-${timestamp}-${row.Coin}-deposit-${row.Amount}`,
      datetime: row['Time(UTC)'],
      timestamp,
      source: 'kucoin',
      status: this.mapStatus(row.Status, 'deposit_withdrawal'),

      // Structured movements - deposit means we gained assets
      movements: {
        inflows: [
          {
            asset: row.Coin,
            amount: netAmount,
          },
        ],
        outflows: [], // No outflows for deposit
      },

      // Structured fees - exchange deposits have platform fees
      fees: {
        network: undefined, // No network fee for exchange deposits
        platform: platformFee,
      },

      // Operation classification - 10/10 confidence: deposit is transfer/deposit
      operation: {
        category: 'transfer',
        type: 'deposit',
      },

      metadata: {
        address: row['Deposit Address'],
        hash: row.Hash,
        remarks: row.Remarks,
        transferNetwork: row['Transfer Network'],
        originalRow: row,
      },
    };
  }

  private convertOrderSplittingToTransaction(row: CsvOrderSplittingRow): UniversalTransaction {
    const timestamp = new Date(row['Filled Time(UTC)']).getTime();
    const [baseCurrency, quoteCurrency] = row.Symbol.split('-');
    const filledAmount = row['Filled Amount'];
    const filledVolume = row['Filled Volume'];
    const fee = parseDecimal(row.Fee).toNumber();
    const platformFee = { amount: parseDecimal(fee.toString()), asset: row['Fee Currency'] };
    const side = row.Side.toLowerCase() as 'buy' | 'sell';

    // For order-splitting (individual fills):
    // - Buy: spent quoteCurrency (filledVolume), received baseCurrency (filledAmount)
    // - Sell: spent baseCurrency (filledAmount), received quoteCurrency (filledVolume)
    const isBuy = side === 'buy';

    // Generate unique ID using order ID + timestamp + filled amount to handle multiple fills
    const uniqueId = `${row['Order ID']}-${timestamp}-${filledAmount}`;

    return {
      id: 0, // Will be assigned by database
      externalId: uniqueId,
      datetime: row['Filled Time(UTC)'],
      timestamp,
      source: 'kucoin',
      status: 'closed', // Order-splitting data only shows completed fills

      // Structured movements - trade has both outflow and inflow
      movements: {
        outflows: [
          {
            asset: isBuy ? quoteCurrency || 'unknown' : baseCurrency || 'unknown',
            amount: parseDecimal(isBuy ? filledVolume : filledAmount),
          },
        ],
        inflows: [
          {
            asset: isBuy ? baseCurrency || 'unknown' : quoteCurrency || 'unknown',
            amount: parseDecimal(isBuy ? filledAmount : filledVolume),
          },
        ],
      },

      // Structured fees - exchange trades have platform fees
      fees: {
        network: undefined, // No network fee for exchange trades
        platform: platformFee,
      },

      // Operation classification - 10/10 confidence: order-splitting is trade/buy or trade/sell
      operation: {
        category: 'trade',
        type: side, // 'buy' or 'sell'
      },

      metadata: {
        side,
        orderType: row['Order Type'],
        makerTaker: row['Maker/Taker'],
        filledVolumeUSDT: parseDecimal(row['Filled Volume (USDT)']).toNumber(),
        orderId: row['Order ID'],
        fillType: 'order-splitting',
        originalRow: row,
      },
    };
  }

  private convertTradingBotToTransaction(row: CsvTradingBotRow): UniversalTransaction {
    const timestamp = new Date(row['Time Filled(UTC)']).getTime();
    const [baseCurrency, quoteCurrency] = row.Symbol.split('-');
    const filledAmount = row['Filled Amount'];
    const filledVolume = row['Filled Volume'];
    const fee = parseDecimal(row.Fee).toNumber();
    const platformFee = { amount: parseDecimal(fee.toString()), asset: row['Fee Currency'] };
    const side = row.Side.toLowerCase() as 'buy' | 'sell';

    // For trading bot fills (similar to order-splitting):
    // - Buy: spent quoteCurrency (filledVolume), received baseCurrency (filledAmount)
    // - Sell: spent baseCurrency (filledAmount), received quoteCurrency (filledVolume)
    const isBuy = side === 'buy';

    // Generate unique ID using order ID + timestamp + filled amount to handle multiple fills
    const uniqueId = `${row['Order ID']}-${timestamp}-${filledAmount}`;

    return {
      id: 0, // Will be assigned by database
      externalId: uniqueId,
      datetime: row['Time Filled(UTC)'],
      timestamp,
      source: 'kucoin',
      status: 'closed', // Trading bot data only shows completed fills

      // Structured movements - trade has both outflow and inflow
      movements: {
        outflows: [
          {
            asset: isBuy ? quoteCurrency || 'unknown' : baseCurrency || 'unknown',
            amount: parseDecimal(isBuy ? filledVolume : filledAmount),
          },
        ],
        inflows: [
          {
            asset: isBuy ? baseCurrency || 'unknown' : quoteCurrency || 'unknown',
            amount: parseDecimal(isBuy ? filledAmount : filledVolume),
          },
        ],
      },

      // Structured fees - exchange trades have platform fees
      fees: {
        network: undefined, // No network fee for exchange trades
        platform: platformFee,
      },

      // Operation classification - 10/10 confidence: trading bot is trade/buy or trade/sell
      operation: {
        category: 'trade',
        type: side, // 'buy' or 'sell'
      },

      metadata: {
        side,
        orderType: row['Order Type'],
        filledVolumeUSDT: parseDecimal(row['Filled Volume (USDT)']).toNumber(),
        orderId: row['Order ID'],
        fillType: 'trading-bot',
        originalRow: row,
      },
    };
  }

  private convertSpotOrderToTransaction(row: CsvSpotOrderRow): UniversalTransaction {
    const timestamp = new Date(row['Filled Time(UTC)']).getTime();
    const [baseCurrency, quoteCurrency] = row.Symbol.split('-');
    const filledAmount = row['Filled Amount'];
    const filledVolume = row['Filled Volume'];
    const fee = parseDecimal(row.Fee).toNumber();
    const platformFee = { amount: parseDecimal(fee.toString()), asset: row['Fee Currency'] };
    const side = row.Side.toLowerCase() as 'buy' | 'sell';

    // For spot orders:
    // - Buy: spent quoteCurrency (filledVolume), received baseCurrency (filledAmount)
    // - Sell: spent baseCurrency (filledAmount), received quoteCurrency (filledVolume)
    const isBuy = side === 'buy';

    return {
      id: 0, // Will be assigned by database
      externalId: row['Order ID'],
      datetime: row['Filled Time(UTC)'],
      timestamp,
      source: 'kucoin',
      status: this.mapStatus(row.Status, 'spot'),

      // Structured movements - trade has both outflow and inflow
      movements: {
        outflows: [
          {
            asset: isBuy ? quoteCurrency || 'unknown' : baseCurrency || 'unknown',
            amount: parseDecimal(isBuy ? filledVolume : filledAmount),
          },
        ],
        inflows: [
          {
            asset: isBuy ? baseCurrency || 'unknown' : quoteCurrency || 'unknown',
            amount: parseDecimal(isBuy ? filledAmount : filledVolume),
          },
        ],
      },

      // Structured fees - exchange trades have platform fees
      fees: {
        network: undefined, // No network fee for exchange trades
        platform: platformFee,
      },

      // Operation classification - 10/10 confidence: spot order is trade/buy or trade/sell
      operation: {
        category: 'trade',
        type: side, // 'buy' or 'sell'
      },

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
    const fee = parseDecimal(row.Fee ?? '0');
    const platformFee = { amount: fee, asset: row.Coin };

    return {
      id: 0, // Will be assigned by database
      externalId: row.Hash || `${row.UID}-${timestamp}-${row.Coin}-withdrawal-${row.Amount}`,
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
            amount: parseDecimal(absAmount.toFixed()),
          },
        ],
      },

      // Structured fees - exchange withdrawals have platform fees
      fees: {
        network: undefined, // No network fee for exchange withdrawals
        platform: platformFee,
      },

      // Operation classification - 10/10 confidence: withdrawal is transfer/withdrawal
      operation: {
        category: 'transfer',
        type: 'withdrawal',
      },

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
  ): 'closed' | 'open' | 'canceled' | 'pending' | 'success' | 'failed' {
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
          return 'success';
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
}
