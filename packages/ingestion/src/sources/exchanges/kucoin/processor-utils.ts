import { buildExchangeAssetId, parseDecimal } from '@exitbook/core';
import type { Logger } from '@exitbook/logger';
import { err, ok, type Result } from 'neverthrow';

import type { ProcessedTransaction } from '../../../shared/types/processors.js';

const EXCHANGE_NAME = 'kucoin';

import type {
  CsvAccountHistoryRow,
  CsvDepositWithdrawalRow,
  CsvOrderSplittingRow,
  CsvSpotOrderRow,
  CsvTradingBotRow,
} from './types.js';

/**
 * Pure business logic functions for processing KuCoin CSV data.
 * These functions extract and transform KuCoin transaction data into ProcessedTransaction format.
 * All functions return Result types to prevent silent failures and enable proper error handling.
 */
function parseKucoinUtcTimestamp(timeStr: string | undefined): Result<{ datetime: string; timestamp: number }, Error> {
  if (!timeStr || timeStr.trim() === '') {
    return err(new Error('Missing KuCoin timestamp'));
  }

  const isoBase = timeStr.includes('T') ? timeStr : timeStr.replace(' ', 'T');
  const isoString = isoBase.endsWith('Z') ? isoBase : `${isoBase}Z`;
  const parsed = new Date(isoString);

  if (isNaN(parsed.getTime())) {
    return err(new Error(`Invalid KuCoin timestamp: ${timeStr}`));
  }

  return ok({ timestamp: parsed.getTime(), datetime: parsed.toISOString() });
}

/**
 * Convert KuCoin account history convert market entries (deposit + withdrawal pair) into a swap transaction
 */
export function convertKucoinAccountHistoryConvertToTransaction(
  deposit: CsvAccountHistoryRow,
  withdrawal: CsvAccountHistoryRow,
  timestamp: string
): Result<ProcessedTransaction, Error> {
  const parsedTimestamp = parseKucoinUtcTimestamp(timestamp);
  if (parsedTimestamp.isErr()) {
    return err(parsedTimestamp.error);
  }
  const timestampMs = parsedTimestamp.value.timestamp;
  const datetime = parsedTimestamp.value.datetime;

  const sellCurrency = withdrawal.Currency;
  const sellAmount = parseDecimal(withdrawal.Amount).abs();
  const buyCurrency = deposit.Currency;
  const buyAmount = parseDecimal(deposit.Amount);

  // Build assetIds
  const sellAssetIdResult = buildExchangeAssetId(EXCHANGE_NAME, sellCurrency);
  if (sellAssetIdResult.isErr()) {
    return err(
      new Error(`Failed to build assetId for ${sellCurrency} on ${EXCHANGE_NAME}: ${sellAssetIdResult.error.message}`)
    );
  }

  const buyAssetIdResult = buildExchangeAssetId(EXCHANGE_NAME, buyCurrency);
  if (buyAssetIdResult.isErr()) {
    return err(
      new Error(`Failed to build assetId for ${buyCurrency} on ${EXCHANGE_NAME}: ${buyAssetIdResult.error.message}`)
    );
  }

  // Calculate total fees (both deposit and withdrawal fees)
  const withdrawalFee = withdrawal.Fee ? parseDecimal(withdrawal.Fee) : parseDecimal('0');
  const depositFee = deposit.Fee ? parseDecimal(deposit.Fee) : parseDecimal('0');
  const totalFee = withdrawalFee.plus(depositFee);

  return ok({
    externalId: `${withdrawal.UID}-${timestampMs}-convert-market-${sellCurrency}-${buyCurrency}`,
    datetime,
    timestamp: timestampMs,
    source: 'kucoin',
    status: mapKucoinStatus('success', 'deposit_withdrawal'),

    // Structured movements - convert market is a swap (sold X, bought Y)
    movements: {
      outflows: [
        {
          assetId: sellAssetIdResult.value,
          assetSymbol: sellCurrency,
          grossAmount: sellAmount,
          netAmount: sellAmount,
        },
      ],
      inflows: [
        {
          assetId: buyAssetIdResult.value,
          assetSymbol: buyCurrency,
          grossAmount: buyAmount,
          netAmount: buyAmount,
        },
      ],
    },

    // Structured fees - convert market has platform fees (always included, even if zero)
    fees: [
      {
        assetId: sellAssetIdResult.value,
        assetSymbol: sellCurrency,
        amount: totalFee,
        scope: 'platform' as const,
        settlement: 'balance' as const,
      },
    ],

    // Operation classification - 10/10 confidence: convert market is a swap
    operation: {
      category: 'trade',
      type: 'swap',
    },
  });
}

/**
 * Convert KuCoin deposit row into ProcessedTransaction
 */
export function convertKucoinDepositToTransaction(row: CsvDepositWithdrawalRow): Result<ProcessedTransaction, Error> {
  const parsedTimestamp = parseKucoinUtcTimestamp(row['Time(UTC)']);
  if (parsedTimestamp.isErr()) {
    return err(parsedTimestamp.error);
  }
  const { timestamp, datetime } = parsedTimestamp.value;
  const grossAmount = parseDecimal(row.Amount);
  const fee = row.Fee ? parseDecimal(row.Fee) : parseDecimal('0');

  // Build assetId
  const assetIdResult = buildExchangeAssetId(EXCHANGE_NAME, row.Coin);
  if (assetIdResult.isErr()) {
    return err(
      new Error(`Failed to build assetId for ${row.Coin} on ${EXCHANGE_NAME}: ${assetIdResult.error.message}`)
    );
  }

  // For KuCoin deposits: Amount field is what arrived on-chain
  // netAmount must equal grossAmount for transfer matching to work
  // (needs to match the on-chain amount from the source withdrawal)
  // Fee is charged separately from user's credited balance
  const netAmount = grossAmount;

  return ok({
    externalId: row.Hash || `${row.UID}-${timestamp}-${row.Coin}-deposit-${row.Amount}`,
    datetime,
    timestamp,
    source: 'kucoin',
    status: mapKucoinStatus(row.Status, 'deposit_withdrawal'),

    // Structured movements - deposit means we gained assets
    movements: {
      inflows: [
        {
          assetId: assetIdResult.value,
          assetSymbol: row.Coin,
          grossAmount: grossAmount,
          netAmount: netAmount,
        },
      ],
      outflows: [], // No outflows for deposit
    },

    // Structured fees - deposit fees charged separately from credited balance
    fees: fee.greaterThan(0)
      ? [
          {
            assetId: assetIdResult.value,
            assetSymbol: row.Coin,
            amount: fee,
            scope: 'platform' as const,
            settlement: 'balance' as const,
          },
        ]
      : [],

    // Operation classification - 10/10 confidence: deposit is transfer/deposit
    operation: {
      category: 'transfer',
      type: 'deposit',
    },
  });
}

/**
 * Convert KuCoin order-splitting row (individual fill) into ProcessedTransaction
 */
export function convertKucoinOrderSplittingToTransaction(
  row: CsvOrderSplittingRow
): Result<ProcessedTransaction, Error> {
  const parsedTimestamp = parseKucoinUtcTimestamp(row['Filled Time(UTC)']);
  if (parsedTimestamp.isErr()) {
    return err(parsedTimestamp.error);
  }
  const { timestamp, datetime } = parsedTimestamp.value;

  // Guard against missing Symbol field
  if (!row.Symbol) {
    return err(new Error(`Missing Symbol field in order-splitting row (Order ID: ${row['Order ID'] || 'unknown'})`));
  }

  // Guard against missing Side field
  if (!row.Side) {
    return err(new Error(`Missing Side field in order-splitting row (Order ID: ${row['Order ID'] || 'unknown'})`));
  }

  // Validate Side field
  const side = row.Side.trim().toLowerCase();
  if (side !== 'buy' && side !== 'sell') {
    return err(
      new Error(
        `Invalid Side value '${row.Side}' in order-splitting row (Order ID: ${row['Order ID'] || 'unknown'}). Expected 'buy' or 'sell'.`
      )
    );
  }

  // Parse symbol - CRITICAL: fail-fast if malformed (prevents exchange:kucoin:unknown collisions)
  const symbolParts = row.Symbol.split('-');
  if (symbolParts.length !== 2) {
    return err(
      new Error(
        `Invalid symbol format '${row.Symbol}' in order-splitting row (Order ID: ${row['Order ID']}). Expected format: BASE-QUOTE`
      )
    );
  }

  const [baseCurrency, quoteCurrency] = symbolParts;
  if (!baseCurrency || !quoteCurrency || baseCurrency.trim() === '' || quoteCurrency.trim() === '') {
    return err(
      new Error(
        `Empty base or quote currency in symbol '${row.Symbol}' (Order ID: ${row['Order ID']}). Cannot create assetId.`
      )
    );
  }

  const filledAmount = row['Filled Amount'];
  const filledVolume = row['Filled Volume'];
  const fee = parseDecimal(row.Fee);

  // For order-splitting (individual fills):
  // - Buy: spent quoteCurrency (filledVolume), received baseCurrency (filledAmount)
  // - Sell: spent baseCurrency (filledAmount), received quoteCurrency (filledVolume)
  const isBuy = side === 'buy';

  // Build assetIds - currencies are validated, no 'unknown' defaults
  const baseAssetIdResult = buildExchangeAssetId(EXCHANGE_NAME, baseCurrency);
  if (baseAssetIdResult.isErr()) {
    return err(
      new Error(
        `Failed to build assetId for base currency ${baseCurrency} on ${EXCHANGE_NAME}: ${baseAssetIdResult.error.message}`
      )
    );
  }

  const quoteAssetIdResult = buildExchangeAssetId(EXCHANGE_NAME, quoteCurrency);
  if (quoteAssetIdResult.isErr()) {
    return err(
      new Error(
        `Failed to build assetId for quote currency ${quoteCurrency} on ${EXCHANGE_NAME}: ${quoteAssetIdResult.error.message}`
      )
    );
  }

  // Build fee assetId - CRITICAL: never silently drop fees
  let feeAssetId: string | undefined;
  if (fee.greaterThan(0)) {
    // Fee exists - Fee Currency must be present
    if (!row['Fee Currency'] || row['Fee Currency'].trim() === '') {
      return err(
        new Error(
          `Fee amount ${fee.toFixed()} exists but Fee Currency is missing in order-splitting row (Order ID: ${row['Order ID']}). Cannot determine fee asset.`
        )
      );
    }

    const feeAssetIdResult = buildExchangeAssetId(EXCHANGE_NAME, row['Fee Currency']);
    if (feeAssetIdResult.isErr()) {
      return err(
        new Error(
          `Failed to build fee assetId for ${row['Fee Currency']} on ${EXCHANGE_NAME}: ${feeAssetIdResult.error.message}`
        )
      );
    }
    feeAssetId = feeAssetIdResult.value;
  }

  // Generate unique ID using order ID + timestamp + filled amount to handle multiple fills
  const uniqueId = `${row['Order ID']}-${timestamp}-${filledAmount}`;

  return ok({
    externalId: uniqueId,
    datetime,
    timestamp,
    source: 'kucoin',
    status: 'closed', // Order-splitting data only shows completed fills

    // Structured movements - trade has both outflow and inflow
    // Buy: spent quoteCurrency (filledVolume), received baseCurrency (filledAmount)
    // Sell: spent baseCurrency (filledAmount), received quoteCurrency (filledVolume)
    movements: {
      outflows: [
        {
          assetId: isBuy ? quoteAssetIdResult.value : baseAssetIdResult.value,
          assetSymbol: isBuy ? quoteCurrency : baseCurrency,
          grossAmount: parseDecimal(isBuy ? filledVolume : filledAmount),
          netAmount: parseDecimal(isBuy ? filledVolume : filledAmount),
        },
      ],
      inflows: [
        {
          assetId: isBuy ? baseAssetIdResult.value : quoteAssetIdResult.value,
          assetSymbol: isBuy ? baseCurrency : quoteCurrency,
          grossAmount: parseDecimal(isBuy ? filledAmount : filledVolume),
          netAmount: parseDecimal(isBuy ? filledAmount : filledVolume),
        },
      ],
    },

    // Structured fees - exchange trades have platform fees
    fees: feeAssetId
      ? [
          {
            assetId: feeAssetId,
            assetSymbol: row['Fee Currency'],
            amount: fee,
            scope: 'platform' as const,
            settlement: 'balance' as const,
          },
        ]
      : [],

    // Operation classification - 10/10 confidence: order-splitting is trade/buy or trade/sell
    operation: {
      category: 'trade',
      type: side, // 'buy' or 'sell'
    },
  });
}

/**
 * Convert KuCoin trading bot row into ProcessedTransaction
 */
export function convertKucoinTradingBotToTransaction(row: CsvTradingBotRow): Result<ProcessedTransaction, Error> {
  const parsedTimestamp = parseKucoinUtcTimestamp(row['Time Filled(UTC)']);
  if (parsedTimestamp.isErr()) {
    return err(parsedTimestamp.error);
  }
  const { timestamp, datetime } = parsedTimestamp.value;

  // Guard against missing Symbol field
  if (!row.Symbol) {
    return err(new Error(`Missing Symbol field in trading bot row (Order ID: ${row['Order ID'] || 'unknown'})`));
  }

  // Validate required field: Side
  if (!row.Side || row.Side.trim() === '') {
    return err(
      new Error(
        `Missing required field 'Side' in trading bot row (Order ID: ${row['Order ID']}). Cannot determine buy/sell direction.`
      )
    );
  }

  // Validate Side value
  const side = row.Side.trim().toLowerCase();
  if (side !== 'buy' && side !== 'sell') {
    return err(
      new Error(
        `Invalid Side value '${row.Side}' in trading bot row (Order ID: ${row['Order ID'] || 'unknown'}). Expected 'buy' or 'sell'.`
      )
    );
  }

  // Parse symbol - CRITICAL: fail-fast if malformed (prevents exchange:kucoin:unknown collisions)
  const symbolParts = row.Symbol.split('-');
  if (symbolParts.length !== 2) {
    return err(
      new Error(
        `Invalid symbol format '${row.Symbol}' in trading bot row (Order ID: ${row['Order ID']}). Expected format: BASE-QUOTE`
      )
    );
  }

  const [baseCurrency, quoteCurrency] = symbolParts;
  if (!baseCurrency || !quoteCurrency || baseCurrency.trim() === '' || quoteCurrency.trim() === '') {
    return err(
      new Error(
        `Empty base or quote currency in symbol '${row.Symbol}' (Order ID: ${row['Order ID']}). Cannot create assetId.`
      )
    );
  }

  const filledAmount = row['Filled Amount'];
  const filledVolume = row['Filled Volume'];
  const fee = parseDecimal(row.Fee);

  // For trading bot fills (similar to order-splitting):
  // - Buy: spent quoteCurrency (filledVolume), received baseCurrency (filledAmount)
  // - Sell: spent baseCurrency (filledAmount), received quoteCurrency (filledVolume)
  const isBuy = side === 'buy';

  // Build assetIds - currencies are validated, no 'unknown' defaults
  const baseAssetIdResult = buildExchangeAssetId(EXCHANGE_NAME, baseCurrency);
  if (baseAssetIdResult.isErr()) {
    return err(
      new Error(
        `Failed to build assetId for base currency ${baseCurrency} on ${EXCHANGE_NAME}: ${baseAssetIdResult.error.message}`
      )
    );
  }

  const quoteAssetIdResult = buildExchangeAssetId(EXCHANGE_NAME, quoteCurrency);
  if (quoteAssetIdResult.isErr()) {
    return err(
      new Error(
        `Failed to build assetId for quote currency ${quoteCurrency} on ${EXCHANGE_NAME}: ${quoteAssetIdResult.error.message}`
      )
    );
  }

  // Build fee assetId - CRITICAL: never silently drop fees
  let feeAssetId: string | undefined;
  if (fee.greaterThan(0)) {
    // Fee exists - Fee Currency must be present
    if (!row['Fee Currency'] || row['Fee Currency'].trim() === '') {
      return err(
        new Error(
          `Fee amount ${fee.toFixed()} exists but Fee Currency is missing in trading bot row (Order ID: ${row['Order ID']}). Cannot determine fee asset.`
        )
      );
    }

    const feeAssetIdResult = buildExchangeAssetId(EXCHANGE_NAME, row['Fee Currency']);
    if (feeAssetIdResult.isErr()) {
      return err(
        new Error(
          `Failed to build fee assetId for ${row['Fee Currency']} on ${EXCHANGE_NAME}: ${feeAssetIdResult.error.message}`
        )
      );
    }
    feeAssetId = feeAssetIdResult.value;
  }

  // Generate unique ID using order ID + timestamp + filled amount to handle multiple fills
  const uniqueId = `${row['Order ID']}-${timestamp}-${filledAmount}`;

  return ok({
    externalId: uniqueId,
    datetime,
    timestamp,
    source: 'kucoin',
    status: 'closed', // Trading bot data only shows completed fills

    // Structured movements - trade has both outflow and inflow
    // Buy: spent quoteCurrency (filledVolume), received baseCurrency (filledAmount)
    // Sell: spent baseCurrency (filledAmount), received quoteCurrency (filledVolume)
    movements: {
      outflows: [
        {
          assetId: isBuy ? quoteAssetIdResult.value : baseAssetIdResult.value,
          assetSymbol: isBuy ? quoteCurrency : baseCurrency,
          grossAmount: parseDecimal(isBuy ? filledVolume : filledAmount),
          netAmount: parseDecimal(isBuy ? filledVolume : filledAmount),
        },
      ],
      inflows: [
        {
          assetId: isBuy ? baseAssetIdResult.value : quoteAssetIdResult.value,
          assetSymbol: isBuy ? baseCurrency : quoteCurrency,
          grossAmount: parseDecimal(isBuy ? filledAmount : filledVolume),
          netAmount: parseDecimal(isBuy ? filledAmount : filledVolume),
        },
      ],
    },

    // Structured fees - exchange trades have platform fees
    fees: feeAssetId
      ? [
          {
            assetId: feeAssetId,
            assetSymbol: row['Fee Currency'],
            amount: fee,
            scope: 'platform' as const,
            settlement: 'balance' as const,
          },
        ]
      : [],

    // Operation classification - 10/10 confidence: trading bot is trade/buy or trade/sell
    operation: {
      category: 'trade',
      type: side, // 'buy' or 'sell'
    },
  });
}

/**
 * Convert KuCoin spot order row into ProcessedTransaction
 */
export function convertKucoinSpotOrderToTransaction(row: CsvSpotOrderRow): Result<ProcessedTransaction, Error> {
  const parsedTimestamp = parseKucoinUtcTimestamp(row['Filled Time(UTC)']);
  if (parsedTimestamp.isErr()) {
    return err(parsedTimestamp.error);
  }
  const { timestamp, datetime } = parsedTimestamp.value;

  // Guard against missing Symbol field
  if (!row.Symbol) {
    return err(new Error(`Missing Symbol field in spot order row (Order ID: ${row['Order ID'] || 'unknown'})`));
  }

  // Validate required field: Side
  if (!row.Side || row.Side.trim() === '') {
    return err(
      new Error(
        `Missing required field 'Side' in spot order row (Order ID: ${row['Order ID']}). Cannot determine buy/sell direction.`
      )
    );
  }

  // Validate Side value
  const side = row.Side.trim().toLowerCase();
  if (side !== 'buy' && side !== 'sell') {
    return err(
      new Error(
        `Invalid Side value '${row.Side}' in spot order row (Order ID: ${row['Order ID'] || 'unknown'}). Expected 'buy' or 'sell'.`
      )
    );
  }

  // Parse symbol - CRITICAL: fail-fast if malformed (prevents exchange:kucoin:unknown collisions)
  const symbolParts = row.Symbol.split('-');
  if (symbolParts.length !== 2) {
    return err(
      new Error(
        `Invalid symbol format '${row.Symbol}' in spot order row (Order ID: ${row['Order ID']}). Expected format: BASE-QUOTE`
      )
    );
  }

  const [baseCurrency, quoteCurrency] = symbolParts;
  if (!baseCurrency || !quoteCurrency || baseCurrency.trim() === '' || quoteCurrency.trim() === '') {
    return err(
      new Error(
        `Empty base or quote currency in symbol '${row.Symbol}' (Order ID: ${row['Order ID']}). Cannot create assetId.`
      )
    );
  }

  const filledAmount = row['Filled Amount'];
  const filledVolume = row['Filled Volume'];
  const fee = parseDecimal(row.Fee);

  // For spot orders:
  // - Buy: spent quoteCurrency (filledVolume), received baseCurrency (filledAmount)
  // - Sell: spent baseCurrency (filledAmount), received quoteCurrency (filledVolume)
  const isBuy = side === 'buy';

  // Build assetIds - currencies are validated, no 'unknown' defaults
  const baseAssetIdResult = buildExchangeAssetId(EXCHANGE_NAME, baseCurrency);
  if (baseAssetIdResult.isErr()) {
    return err(
      new Error(
        `Failed to build assetId for base currency ${baseCurrency} on ${EXCHANGE_NAME}: ${baseAssetIdResult.error.message}`
      )
    );
  }

  const quoteAssetIdResult = buildExchangeAssetId(EXCHANGE_NAME, quoteCurrency);
  if (quoteAssetIdResult.isErr()) {
    return err(
      new Error(
        `Failed to build assetId for quote currency ${quoteCurrency} on ${EXCHANGE_NAME}: ${quoteAssetIdResult.error.message}`
      )
    );
  }

  // Build fee assetId - CRITICAL: never silently drop fees
  let feeAssetId: string | undefined;
  if (fee.greaterThan(0)) {
    // Fee exists - Fee Currency must be present
    if (!row['Fee Currency'] || row['Fee Currency'].trim() === '') {
      return err(
        new Error(
          `Fee amount ${fee.toFixed()} exists but Fee Currency is missing in spot order row (Order ID: ${row['Order ID']}). Cannot determine fee asset.`
        )
      );
    }

    const feeAssetIdResult = buildExchangeAssetId(EXCHANGE_NAME, row['Fee Currency']);
    if (feeAssetIdResult.isErr()) {
      return err(
        new Error(
          `Failed to build fee assetId for ${row['Fee Currency']} on ${EXCHANGE_NAME}: ${feeAssetIdResult.error.message}`
        )
      );
    }
    feeAssetId = feeAssetIdResult.value;
  }

  return ok({
    externalId: row['Order ID'],
    datetime,
    timestamp,
    source: 'kucoin',
    status: mapKucoinStatus(row.Status, 'spot'),

    // Structured movements - trade has both outflow and inflow
    // Buy: spent quoteCurrency (filledVolume), received baseCurrency (filledAmount)
    // Sell: spent baseCurrency (filledAmount), received quoteCurrency (filledVolume)
    movements: {
      outflows: [
        {
          assetId: isBuy ? quoteAssetIdResult.value : baseAssetIdResult.value,
          assetSymbol: isBuy ? quoteCurrency : baseCurrency,
          grossAmount: parseDecimal(isBuy ? filledVolume : filledAmount),
          netAmount: parseDecimal(isBuy ? filledVolume : filledAmount),
        },
      ],
      inflows: [
        {
          assetId: isBuy ? baseAssetIdResult.value : quoteAssetIdResult.value,
          assetSymbol: isBuy ? baseCurrency : quoteCurrency,
          grossAmount: parseDecimal(isBuy ? filledAmount : filledVolume),
          netAmount: parseDecimal(isBuy ? filledAmount : filledVolume),
        },
      ],
    },

    // Structured fees - exchange trades have platform fees
    fees: feeAssetId
      ? [
          {
            assetId: feeAssetId,
            assetSymbol: row['Fee Currency'],
            amount: fee,
            scope: 'platform' as const,
            settlement: 'balance' as const,
          },
        ]
      : [],

    // Operation classification - 10/10 confidence: spot order is trade/buy or trade/sell
    operation: {
      category: 'trade',
      type: side, // 'buy' or 'sell'
    },
  });
}

/**
 * Convert KuCoin withdrawal row into ProcessedTransaction
 */
export function convertKucoinWithdrawalToTransaction(
  row: CsvDepositWithdrawalRow
): Result<ProcessedTransaction, Error> {
  const parsedTimestamp = parseKucoinUtcTimestamp(row['Time(UTC)']);
  if (parsedTimestamp.isErr()) {
    return err(parsedTimestamp.error);
  }
  const { timestamp, datetime } = parsedTimestamp.value;
  const grossAmount = parseDecimal(row.Amount).abs();
  const fee = parseDecimal(row.Fee ?? '0');

  // Build assetId
  const assetIdResult = buildExchangeAssetId(EXCHANGE_NAME, row.Coin);
  if (assetIdResult.isErr()) {
    return err(
      new Error(`Failed to build assetId for ${row.Coin} on ${EXCHANGE_NAME}: ${assetIdResult.error.message}`)
    );
  }

  return ok({
    externalId: row.Hash || `${row.UID}-${timestamp}-${row.Coin}-withdrawal-${row.Amount}`,
    datetime,
    timestamp,
    source: 'kucoin',
    status: mapKucoinStatus(row.Status, 'deposit_withdrawal'),

    // Structured movements - withdrawal means we lost assets
    movements: {
      inflows: [],
      outflows: [
        {
          assetId: assetIdResult.value,
          assetSymbol: row.Coin,
          grossAmount: grossAmount,
          netAmount: grossAmount,
        },
      ],
    },

    // Structured fees - exchange withdrawals have platform fees
    fees: fee.greaterThan(0)
      ? [
          {
            assetId: assetIdResult.value,
            assetSymbol: row.Coin,
            amount: fee,
            scope: 'platform' as const,
            settlement: 'balance' as const,
          },
        ]
      : [],

    // Operation classification - 10/10 confidence: withdrawal is transfer/withdrawal
    operation: {
      category: 'transfer',
      type: 'withdrawal',
    },
  });
}

/**
 * Map KuCoin status values to ProcessedTransaction status
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
): Result<ProcessedTransaction[], Error> {
  const convertTransactions: ProcessedTransaction[] = [];
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
        const convertTxResult = convertKucoinAccountHistoryConvertToTransaction(deposit, withdrawal, timestamp);
        if (convertTxResult.isErr()) {
          logger.error(
            { error: convertTxResult.error },
            `Failed to convert account history convert transaction - Timestamp: ${timestamp}`
          );
          return err(convertTxResult.error);
        }
        convertTransactions.push(convertTxResult.value);
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

  return ok(convertTransactions);
}
