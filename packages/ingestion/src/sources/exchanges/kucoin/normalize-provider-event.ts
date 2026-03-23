import type { Currency } from '@exitbook/foundation';
import { err, ok, type Result } from '@exitbook/foundation';

import type { ExchangeProviderEvent } from '../shared/index.js';

import {
  getKucoinRowOccurredAt,
  mapKucoinStatus,
  parseKucoinCurrency,
  parseKucoinTradePair,
  trimToUndefined,
} from './csv-row-parsing.js';
import type { KucoinCsvRow, KucoinCsvRowType } from './types.js';

interface KucoinProviderMetadataBase extends Record<string, unknown> {
  correlationKey: string;
  rowKind: KucoinCsvRowType;
}

export interface KucoinTradeProviderMetadata extends KucoinProviderMetadataBase {
  baseCurrency: Currency;
  feeCurrency?: Currency | undefined;
  filledAmount: string;
  filledVolume: string;
  orderId: string;
  quoteCurrency: Currency;
  rowKind: 'spot_order' | 'order_splitting' | 'trading_bot';
  side: 'buy' | 'sell';
}

export interface KucoinTransferProviderMetadata extends KucoinProviderMetadataBase {
  address?: string | undefined;
  hash?: string | undefined;
  rowKind: 'deposit' | 'withdrawal';
  remarks?: string | undefined;
  transferNetwork?: string | undefined;
}

export interface KucoinAccountHistoryProviderMetadata extends KucoinProviderMetadataBase {
  remark?: string | undefined;
  rowKind: 'account_history';
  side: 'credit' | 'debit';
  type: string;
}

export type KucoinProviderMetadata =
  | KucoinTradeProviderMetadata
  | KucoinTransferProviderMetadata
  | KucoinAccountHistoryProviderMetadata;

function getAccountHistoryDirectionHint(rawSide: string): 'credit' | 'debit' | 'unknown' {
  const normalizedSide = rawSide.trim().toLowerCase();
  if (normalizedSide === 'deposit' || normalizedSide === 'in') {
    return 'credit';
  }

  if (normalizedSide === 'withdrawal' || normalizedSide === 'out') {
    return 'debit';
  }

  return 'unknown';
}

function buildCorrelationKey(raw: KucoinCsvRow, eventId: string): string {
  switch (raw._rowType) {
    case 'spot_order':
    case 'order_splitting':
    case 'trading_bot':
      return eventId;
    case 'deposit':
    case 'withdrawal':
      return trimToUndefined(raw.Hash) ?? eventId;
    case 'account_history': {
      const normalizedType = raw.Type.trim().toLowerCase();
      if (normalizedType === 'convert market') {
        return `convert-market:${raw.UID}:${raw['Time(UTC)']}`;
      }

      return eventId;
    }
  }
}

export function normalizeKucoinProviderEvent(raw: KucoinCsvRow, eventId: string): Result<ExchangeProviderEvent, Error> {
  const occurredAtResult = getKucoinRowOccurredAt(raw);
  if (occurredAtResult.isErr()) {
    return err(occurredAtResult.error);
  }

  const correlationKey = buildCorrelationKey(raw, eventId);

  switch (raw._rowType) {
    case 'spot_order':
    case 'order_splitting':
    case 'trading_bot': {
      const pairResult = parseKucoinTradePair(raw.Symbol, `${raw._rowType} event ${eventId}`);
      if (pairResult.isErr()) {
        return err(pairResult.error);
      }

      const feeCurrency = trimToUndefined(raw['Fee Currency']);
      const feeCurrencyResult = feeCurrency
        ? parseKucoinCurrency(feeCurrency, `${raw._rowType} fee currency for ${eventId}`)
        : ok(undefined);
      if (feeCurrencyResult.isErr()) {
        return err(feeCurrencyResult.error);
      }

      const side = raw.Side.trim().toLowerCase();
      if (side !== 'buy' && side !== 'sell') {
        return err(new Error(`Invalid KuCoin side "${raw.Side}" in ${raw._rowType} event ${eventId}`));
      }

      const providerMetadata: KucoinTradeProviderMetadata = {
        correlationKey,
        rowKind: raw._rowType,
        orderId: raw['Order ID'],
        side,
        baseCurrency: pairResult.value.baseCurrency,
        quoteCurrency: pairResult.value.quoteCurrency,
        filledAmount: raw['Filled Amount'],
        filledVolume: raw['Filled Volume'],
        ...(feeCurrencyResult.value ? { feeCurrency: feeCurrencyResult.value } : {}),
      };

      return ok({
        providerEventId: eventId,
        providerName: 'kucoin',
        providerType: raw._rowType,
        occurredAt: occurredAtResult.value,
        status: raw._rowType === 'spot_order' ? mapKucoinStatus(raw.Status, 'spot') : 'closed',
        assetSymbol: pairResult.value.baseCurrency,
        rawAmount: raw['Filled Amount'],
        ...(trimToUndefined(raw.Fee) ? { rawFee: raw.Fee } : {}),
        ...(feeCurrencyResult.value ? { rawFeeCurrency: feeCurrencyResult.value } : {}),
        providerHints: {
          correlationKeys: [correlationKey],
          directionHint: side === 'buy' ? 'credit' : 'debit',
        },
        providerMetadata,
      });
    }
    case 'deposit':
    case 'withdrawal': {
      const currencyResult = parseKucoinCurrency(raw.Coin, `${raw._rowType} asset for ${eventId}`);
      if (currencyResult.isErr()) {
        return err(currencyResult.error);
      }

      const providerMetadata: KucoinTransferProviderMetadata = {
        correlationKey,
        rowKind: raw._rowType,
        ...(trimToUndefined(raw['Transfer Network'])
          ? { transferNetwork: trimToUndefined(raw['Transfer Network']) }
          : {}),
        ...(trimToUndefined(raw.Hash) ? { hash: trimToUndefined(raw.Hash) } : {}),
        ...(trimToUndefined(raw.Remarks) ? { remarks: trimToUndefined(raw.Remarks) } : {}),
        ...(raw._rowType === 'deposit'
          ? { address: trimToUndefined(raw['Deposit Address']) }
          : { address: trimToUndefined(raw['Withdrawal Address/Account']) }),
      };

      return ok({
        providerEventId: eventId,
        providerName: 'kucoin',
        providerType: raw._rowType,
        occurredAt: occurredAtResult.value,
        status: mapKucoinStatus(raw.Status, 'deposit_withdrawal'),
        assetSymbol: currencyResult.value,
        rawAmount: raw.Amount,
        ...(trimToUndefined(raw.Fee) ? { rawFee: raw.Fee, rawFeeCurrency: currencyResult.value } : {}),
        providerHints: {
          correlationKeys: [correlationKey],
          directionHint: raw._rowType === 'deposit' ? 'credit' : 'debit',
          ...(providerMetadata.transferNetwork ? { networkHint: providerMetadata.transferNetwork } : {}),
          ...(providerMetadata.address ? { addressHint: providerMetadata.address } : {}),
          ...(providerMetadata.hash ? { hashHint: providerMetadata.hash } : {}),
        },
        providerMetadata,
      });
    }
    case 'account_history': {
      const currencyResult = parseKucoinCurrency(raw.Currency, `account history asset for ${eventId}`);
      if (currencyResult.isErr()) {
        return err(currencyResult.error);
      }

      const directionHint = getAccountHistoryDirectionHint(raw.Side);
      if (directionHint === 'unknown') {
        return err(new Error(`Missing KuCoin account history direction evidence in event ${eventId}`));
      }

      const providerMetadata: KucoinAccountHistoryProviderMetadata = {
        correlationKey,
        rowKind: 'account_history',
        side: directionHint,
        type: raw.Type.trim().toLowerCase(),
        ...(trimToUndefined(raw.Remark) ? { remark: trimToUndefined(raw.Remark) } : {}),
      };

      return ok({
        providerEventId: eventId,
        providerName: 'kucoin',
        providerType: raw.Type,
        occurredAt: occurredAtResult.value,
        status: mapKucoinStatus(raw.Type, 'account_history'),
        assetSymbol: currencyResult.value,
        rawAmount: raw.Amount,
        ...(trimToUndefined(raw.Fee) ? { rawFee: raw.Fee, rawFeeCurrency: currencyResult.value } : {}),
        providerHints: {
          correlationKeys: [correlationKey],
          directionHint,
        },
        providerMetadata,
      });
    }
    default:
      return err(new Error(`Unknown KuCoin row type "${(raw as { _rowType?: string })._rowType}" in event ${eventId}`));
  }
}
