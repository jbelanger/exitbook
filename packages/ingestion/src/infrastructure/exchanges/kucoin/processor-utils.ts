import { Currency, parseDecimal } from '@exitbook/core';
import type { UniversalTransaction } from '@exitbook/core';
import type { Logger } from '@exitbook/logger';

import type {
  CsvAccountHistoryRow,
  CsvDepositWithdrawalRow,
  CsvOrderSplittingRow,
  CsvSpotOrderRow,
  CsvTradingBotRow,
} from './types.js';

/**
 * Pure business logic functions for processing KuCoin CSV data.
 * These functions extract and transform KuCoin transaction data into UniversalTransaction format.
 */

/**
 * Convert KuCoin account history convert market entries (deposit + withdrawal pair) into a swap transaction
 */
export function convertKucoinAccountHistoryConvertToTransaction(
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
  const platformFee = { amount: totalFee, asset: Currency.create(sellCurrency) };

  return {
    id: 0, // Will be assigned by database
    externalId: `${withdrawal.UID}-${timestampMs}-convert-market-${sellCurrency}-${buyCurrency}`,
    datetime: timestamp,
    timestamp: timestampMs,
    source: 'kucoin',
    status: mapKucoinStatus('success', 'deposit_withdrawal'),

    // Structured movements - convert market is a swap (sold X, bought Y)
    movements: {
      outflows: [
        {
          asset: Currency.create(sellCurrency),
          grossAmount: sellAmount,
          netAmount: sellAmount,
        },
      ],
      inflows: [
        {
          asset: Currency.create(buyCurrency),
          grossAmount: buyAmount,
          netAmount: buyAmount,
        },
      ],
    },

    // Structured fees - convert market has platform fees
    fees: platformFee ? [{ ...platformFee, scope: 'platform' as const, settlement: 'balance' as const }] : [],

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

/**
 * Convert KuCoin deposit row into UniversalTransaction
 */
export function convertKucoinDepositToTransaction(row: CsvDepositWithdrawalRow): UniversalTransaction {
  const timestamp = new Date(row['Time(UTC)']).getTime();
  const grossAmount = parseDecimal(row.Amount);
  const fee = row.Fee ? parseDecimal(row.Fee) : parseDecimal('0');

  // For KuCoin deposits: Amount field is what arrived on-chain
  // netAmount must equal grossAmount for transfer matching to work
  // (needs to match the on-chain amount from the source withdrawal)
  // Fee is charged separately from user's credited balance
  const netAmount = grossAmount;
  const platformFee = { amount: fee, asset: Currency.create(row.Coin) };

  return {
    id: 0, // Will be assigned by database
    externalId: row.Hash || `${row.UID}-${timestamp}-${row.Coin}-deposit-${row.Amount}`,
    datetime: row['Time(UTC)'],
    timestamp,
    source: 'kucoin',
    status: mapKucoinStatus(row.Status, 'deposit_withdrawal'),

    // Structured movements - deposit means we gained assets
    movements: {
      inflows: [
        {
          asset: Currency.create(row.Coin),
          grossAmount: grossAmount,
          netAmount: netAmount,
        },
      ],
      outflows: [], // No outflows for deposit
    },

    // Structured fees - deposit fees charged separately from credited balance
    fees: platformFee.amount.greaterThan(0)
      ? [{ ...platformFee, scope: 'platform' as const, settlement: 'balance' as const }]
      : [],

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

/**
 * Convert KuCoin order-splitting row (individual fill) into UniversalTransaction
 */
export function convertKucoinOrderSplittingToTransaction(row: CsvOrderSplittingRow): UniversalTransaction {
  const timestamp = new Date(row['Filled Time(UTC)']).getTime();
  const [baseCurrency, quoteCurrency] = row.Symbol.split('-');
  const filledAmount = row['Filled Amount'];
  const filledVolume = row['Filled Volume'];
  const fee = parseDecimal(row.Fee).toNumber();
  const platformFee = { amount: parseDecimal(fee.toString()), asset: Currency.create(row['Fee Currency']) };
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
          asset: Currency.create(isBuy ? quoteCurrency || 'unknown' : baseCurrency || 'unknown'),
          grossAmount: parseDecimal(isBuy ? filledVolume : filledAmount),
          netAmount: parseDecimal(isBuy ? filledVolume : filledAmount),
        },
      ],
      inflows: [
        {
          asset: Currency.create(isBuy ? baseCurrency || 'unknown' : quoteCurrency || 'unknown'),
          grossAmount: parseDecimal(isBuy ? filledAmount : filledVolume),
          netAmount: parseDecimal(isBuy ? filledAmount : filledVolume),
        },
      ],
    },

    // Structured fees - exchange trades have platform fees
    fees: platformFee ? [{ ...platformFee, scope: 'platform' as const, settlement: 'balance' as const }] : [],

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

/**
 * Convert KuCoin trading bot row into UniversalTransaction
 */
export function convertKucoinTradingBotToTransaction(row: CsvTradingBotRow): UniversalTransaction {
  const timestamp = new Date(row['Time Filled(UTC)']).getTime();
  const [baseCurrency, quoteCurrency] = row.Symbol.split('-');
  const filledAmount = row['Filled Amount'];
  const filledVolume = row['Filled Volume'];
  const fee = parseDecimal(row.Fee).toNumber();
  const platformFee = { amount: parseDecimal(fee.toString()), asset: Currency.create(row['Fee Currency']) };
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
          asset: Currency.create(isBuy ? quoteCurrency || 'unknown' : baseCurrency || 'unknown'),
          grossAmount: parseDecimal(isBuy ? filledVolume : filledAmount),
          netAmount: parseDecimal(isBuy ? filledVolume : filledAmount),
        },
      ],
      inflows: [
        {
          asset: Currency.create(isBuy ? baseCurrency || 'unknown' : quoteCurrency || 'unknown'),
          grossAmount: parseDecimal(isBuy ? filledAmount : filledVolume),
          netAmount: parseDecimal(isBuy ? filledAmount : filledVolume),
        },
      ],
    },

    // Structured fees - exchange trades have platform fees
    fees: platformFee ? [{ ...platformFee, scope: 'platform' as const, settlement: 'balance' as const }] : [],

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

/**
 * Convert KuCoin spot order row into UniversalTransaction
 */
export function convertKucoinSpotOrderToTransaction(row: CsvSpotOrderRow): UniversalTransaction {
  const timestamp = new Date(row['Filled Time(UTC)']).getTime();
  const [baseCurrency, quoteCurrency] = row.Symbol.split('-');
  const filledAmount = row['Filled Amount'];
  const filledVolume = row['Filled Volume'];
  const fee = parseDecimal(row.Fee).toNumber();
  const platformFee = { amount: parseDecimal(fee.toString()), asset: Currency.create(row['Fee Currency']) };
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
    status: mapKucoinStatus(row.Status, 'spot'),

    // Structured movements - trade has both outflow and inflow
    movements: {
      outflows: [
        {
          asset: Currency.create(isBuy ? quoteCurrency || 'unknown' : baseCurrency || 'unknown'),
          grossAmount: parseDecimal(isBuy ? filledVolume : filledAmount),
          netAmount: parseDecimal(isBuy ? filledVolume : filledAmount),
        },
      ],
      inflows: [
        {
          asset: Currency.create(isBuy ? baseCurrency || 'unknown' : quoteCurrency || 'unknown'),
          grossAmount: parseDecimal(isBuy ? filledAmount : filledVolume),
          netAmount: parseDecimal(isBuy ? filledAmount : filledVolume),
        },
      ],
    },

    // Structured fees - exchange trades have platform fees
    fees: platformFee ? [{ ...platformFee, scope: 'platform' as const, settlement: 'balance' as const }] : [],

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

/**
 * Convert KuCoin withdrawal row into UniversalTransaction
 */
export function convertKucoinWithdrawalToTransaction(row: CsvDepositWithdrawalRow): UniversalTransaction {
  const timestamp = new Date(row['Time(UTC)']).getTime();
  const absAmount = Math.abs(parseDecimal(row.Amount).toNumber());
  const fee = parseDecimal(row.Fee ?? '0');
  const platformFee = { amount: fee, asset: Currency.create(row.Coin) };

  return {
    id: 0, // Will be assigned by database
    externalId: row.Hash || `${row.UID}-${timestamp}-${row.Coin}-withdrawal-${row.Amount}`,
    datetime: row['Time(UTC)'],
    timestamp,
    source: 'kucoin',
    status: mapKucoinStatus(row.Status, 'deposit_withdrawal'),

    // Structured movements - withdrawal means we lost assets
    movements: {
      inflows: [],
      outflows: [
        {
          asset: Currency.create(row.Coin),
          grossAmount: parseDecimal(absAmount.toFixed()),
          netAmount: parseDecimal(absAmount.toFixed()),
        },
      ],
    },

    // Structured fees - exchange withdrawals have platform fees
    fees: platformFee.amount.greaterThan(0)
      ? [{ ...platformFee, scope: 'platform' as const, settlement: 'balance' as const }]
      : [],

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

/**
 * Map KuCoin status values to UniversalTransaction status
 */
export function mapKucoinStatus(
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
 * Process account history to extract convert market transactions.
 * Groups convert market entries by timestamp and pairs deposits with withdrawals.
 */
export function processKucoinAccountHistory(
  filteredRows: CsvAccountHistoryRow[],
  logger: Logger
): UniversalTransaction[] {
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
        const convertTx = convertKucoinAccountHistoryConvertToTransaction(deposit, withdrawal, timestamp);
        convertTransactions.push(convertTx);
      } else {
        logger.warn(
          `Convert Market group missing deposit/withdrawal pair - Timestamp: ${timestamp}, Group: ${JSON.stringify(group)}`
        );
      }
    } else {
      logger.warn(
        `Convert Market group has unexpected number of entries - Timestamp: ${timestamp}, Count: ${group.length}, Group: ${JSON.stringify(group)}`
      );
    }
  }

  return convertTransactions;
}
