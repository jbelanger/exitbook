import { normalizeKrakenAsset, type KrakenLedgerEntry } from '@exitbook/exchange-providers/kraken';
import { parseCurrency } from '@exitbook/foundation';
import { err, ok, type Result } from '@exitbook/foundation';

import { getDirectionHint } from '../shared/exchange-utils.js';
import type { ExchangeProviderEvent } from '../shared/index.js';

function getKrakenCorrelationKeys(raw: KrakenLedgerEntry, eventId: string): string[] {
  const normalizedSubtype = raw.subtype?.trim().toLowerCase();
  const trimmedRefId = raw.refid?.trim() ?? '';

  if (normalizedSubtype === 'spotfromfutures') {
    return trimmedRefId.length > 0 ? [eventId, trimmedRefId] : [eventId];
  }

  return trimmedRefId.length > 0 ? [trimmedRefId] : [eventId];
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
      correlationKeys: getKrakenCorrelationKeys(raw, eventId),
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
