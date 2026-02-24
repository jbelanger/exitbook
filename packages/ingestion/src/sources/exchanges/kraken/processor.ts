import { parseCurrency } from '@exitbook/core';
import type { KrakenLedgerEntry } from '@exitbook/exchange-providers';
import { normalizeKrakenAsset } from '@exitbook/exchange-providers';
import { err, type Result } from 'neverthrow';

import { CorrelatingExchangeProcessor } from '../shared/correlating-exchange-processor.js';
import type { ExchangeLedgerEntry } from '../shared/schemas.js';
import { byCorrelationId, standardAmounts } from '../shared/strategies/index.js';

/**
 * Kraken processor: normalizes raw Kraken ledger entries and uses
 * standard correlation + amount semantics (amount is net, fee is separate).
 */
export class KrakenProcessor extends CorrelatingExchangeProcessor<KrakenLedgerEntry> {
  constructor() {
    super('kraken', byCorrelationId, standardAmounts);
  }

  protected normalizeEntry(raw: KrakenLedgerEntry, _eventId: string): Result<ExchangeLedgerEntry, Error> {
    const normalizedAsset = normalizeKrakenAsset(raw.asset);

    const currencyResult = parseCurrency(normalizedAsset);
    if (currencyResult.isErr()) {
      return err(
        new Error(
          `Invalid Kraken asset "${raw.asset}" (normalized: "${normalizedAsset}"): ${currencyResult.error.message}`
        )
      );
    }

    const timestamp = Math.floor(raw.time * 1000);
    const assetSymbol = currencyResult.value;

    return this.validateNormalized({
      id: raw.id,
      correlationId: raw.refid,
      timestamp,
      type: raw.type,
      assetSymbol,
      amount: raw.amount,
      fee: raw.fee,
      feeCurrency: assetSymbol,
      status: 'success',
    });
  }
}
