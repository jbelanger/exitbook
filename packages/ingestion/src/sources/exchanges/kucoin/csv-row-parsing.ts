import type { TransactionStatus } from '@exitbook/core';
import { parseCurrency, type Currency } from '@exitbook/foundation';
import { err, ok, type Result } from '@exitbook/foundation';

import type { KucoinCsvRow } from './types.js';

interface ParsedKucoinTimestamp {
  datetime: string;
  timestamp: number;
}

interface ParsedKucoinTradePair {
  baseCurrency: Currency;
  quoteCurrency: Currency;
}

function parseKucoinUtcTimestamp(timeStr: string | undefined): Result<ParsedKucoinTimestamp, Error> {
  if (!timeStr || timeStr.trim() === '') {
    return err(new Error('Missing KuCoin timestamp'));
  }

  const isoBase = timeStr.includes('T') ? timeStr : timeStr.replace(' ', 'T');
  const isoString = isoBase.endsWith('Z') ? isoBase : `${isoBase}Z`;
  const parsed = new Date(isoString);

  if (Number.isNaN(parsed.getTime())) {
    return err(new Error(`Invalid KuCoin timestamp: ${timeStr}`));
  }

  return ok({ timestamp: parsed.getTime(), datetime: parsed.toISOString() });
}

export function mapKucoinStatus(
  status: string | undefined,
  type: 'spot' | 'deposit_withdrawal' | 'account_history'
): TransactionStatus {
  if (!status || status.trim() === '') {
    return type === 'account_history' ? 'success' : 'pending';
  }

  const normalizedStatus = status.trim().toLowerCase();

  if (type === 'spot') {
    switch (normalizedStatus) {
      case 'deal':
      case 'done':
      case 'filled':
        return 'closed';
      case 'part_deal':
      case 'partial':
        return 'open';
      case 'cancel':
      case 'cancelled':
        return 'canceled';
      default:
        return 'pending';
    }
  }

  if (type === 'account_history') {
    return 'success';
  }

  switch (normalizedStatus) {
    case 'success':
      return 'success';
    case 'processing':
    case 'wallet processing':
      return 'pending';
    case 'failure':
    case 'wallet processing fail':
      return 'failed';
    default:
      return 'pending';
  }
}

export function parseKucoinCurrency(rawCurrency: string, context: string): Result<Currency, Error> {
  const currencyResult = parseCurrency(rawCurrency);
  if (currencyResult.isErr()) {
    return err(new Error(`Invalid KuCoin currency "${rawCurrency}" in ${context}: ${currencyResult.error.message}`));
  }

  return ok(currencyResult.value);
}

export function parseKucoinTradePair(symbol: string, context: string): Result<ParsedKucoinTradePair, Error> {
  if (!symbol || symbol.trim() === '') {
    return err(new Error(`Missing KuCoin symbol in ${context}`));
  }

  const [rawBaseCurrency, rawQuoteCurrency, extraSegment] = symbol.split('-');
  if (!rawBaseCurrency || !rawQuoteCurrency || extraSegment) {
    return err(new Error(`Invalid KuCoin symbol "${symbol}" in ${context}. Expected BASE-QUOTE format.`));
  }

  const baseCurrencyResult = parseKucoinCurrency(rawBaseCurrency, context);
  if (baseCurrencyResult.isErr()) {
    return err(baseCurrencyResult.error);
  }

  const quoteCurrencyResult = parseKucoinCurrency(rawQuoteCurrency, context);
  if (quoteCurrencyResult.isErr()) {
    return err(quoteCurrencyResult.error);
  }

  return ok({
    baseCurrency: baseCurrencyResult.value,
    quoteCurrency: quoteCurrencyResult.value,
  });
}

export function trimToUndefined(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

export function getKucoinRowOccurredAt(raw: KucoinCsvRow): Result<number, Error> {
  switch (raw._rowType) {
    case 'spot_order':
    case 'order_splitting': {
      const timestampResult = parseKucoinUtcTimestamp(raw['Filled Time(UTC)']);
      return timestampResult.isOk() ? ok(timestampResult.value.timestamp) : err(timestampResult.error);
    }
    case 'deposit':
    case 'withdrawal':
    case 'account_history': {
      const timestampResult = parseKucoinUtcTimestamp(raw['Time(UTC)']);
      return timestampResult.isOk() ? ok(timestampResult.value.timestamp) : err(timestampResult.error);
    }
    case 'trading_bot': {
      const timestampResult = parseKucoinUtcTimestamp(raw['Time Filled(UTC)']);
      return timestampResult.isOk() ? ok(timestampResult.value.timestamp) : err(timestampResult.error);
    }
    default:
      return err(new Error(`Unknown KuCoin row type "${(raw as { _rowType?: string })._rowType}"`));
  }
}
