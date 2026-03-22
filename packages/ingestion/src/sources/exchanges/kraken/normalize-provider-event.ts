import { parseCurrency } from '@exitbook/core';
import { err, ok, type Result } from '@exitbook/core';
import { normalizeKrakenAsset, type KrakenLedgerEntry } from '@exitbook/exchange-providers/kraken';

import { getDirectionHint } from '../shared/exchange-utils.js';
import type { ExchangeProviderEvent } from '../shared/index.js';

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
