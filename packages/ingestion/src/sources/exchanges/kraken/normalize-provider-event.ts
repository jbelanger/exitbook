import { parseCurrency, parseDecimal } from '@exitbook/core';
import { err, ok, type Result } from '@exitbook/core';
import type { KrakenLedgerEntry } from '@exitbook/exchange-providers';
import { normalizeKrakenAsset } from '@exitbook/exchange-providers';

import type { ExchangeProviderEvent } from '../shared-v2/index.js';

function getDirectionHint(amount: string): 'credit' | 'debit' | 'unknown' {
  const value = parseDecimal(amount);

  if (value.isNegative()) {
    return 'debit';
  }

  if (value.isPositive()) {
    return 'credit';
  }

  return 'unknown';
}

export function normalizeKrakenProviderEvent(
  raw: KrakenLedgerEntry,
  eventId: string
): Result<ExchangeProviderEvent, Error> {
  const normalizedAsset = normalizeKrakenAsset(raw.asset);
  const currencyResult = parseCurrency(normalizedAsset);

  if (currencyResult.isErr()) {
    return err(
      new Error(
        `Invalid Kraken asset "${raw.asset}" (normalized: "${normalizedAsset}") for event ${eventId}: ${currencyResult.error.message}`
      )
    );
  }

  const occurredAt = Math.floor(raw.time * 1000);
  const correlationKey = raw.refid.trim() || eventId;

  return ok({
    providerEventId: eventId,
    providerName: 'kraken',
    providerType: raw.type,
    occurredAt,
    status: 'success',
    assetSymbol: currencyResult.value,
    rawAmount: raw.amount,
    rawFee: raw.fee,
    rawFeeCurrency: currencyResult.value,
    providerHints: {
      correlationKeys: [correlationKey],
      directionHint: getDirectionHint(raw.amount),
    },
    providerMetadata: {
      aclass: raw.aclass,
      asset: raw.asset,
      balance: raw.balance,
      refid: raw.refid,
      subtype: raw.subtype,
      type: raw.type,
    },
  });
}
