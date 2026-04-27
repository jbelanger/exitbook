import { RawCoinbaseLedgerEntrySchema, type RawCoinbaseLedgerEntry } from '@exitbook/exchange-providers/coinbase';
import { z } from 'zod';

import {
  ExchangeLedgerProcessor,
  RawExchangeProcessorInputSchema,
  type RawExchangeProcessorInput,
} from '../shared/index.js';

import { buildCoinbaseCorrelationGroups } from './build-correlation-groups.js';
import { interpretCoinbaseGroup } from './interpret-group.js';
import { normalizeCoinbaseProviderEvent, type CoinbaseProviderMetadata } from './normalize-provider-event.js';

const CoinbaseLedgerProcessorInputSchema = RawExchangeProcessorInputSchema.extend({
  raw: RawCoinbaseLedgerEntrySchema,
}) as z.ZodType<RawExchangeProcessorInput<RawCoinbaseLedgerEntry>>;

/**
 * Coinbase ledger-v2 processor. It reuses the provider-event interpretation
 * path, then materializes accounting-owned ledger artifacts.
 */
export class CoinbaseProcessorV2 extends ExchangeLedgerProcessor<RawCoinbaseLedgerEntry, CoinbaseProviderMetadata> {
  constructor() {
    super({
      buildGroups: buildCoinbaseCorrelationGroups,
      displayName: 'Coinbase ledger-v2',
      inputSchema: CoinbaseLedgerProcessorInputSchema,
      interpretGroup: interpretCoinbaseGroup,
      loggerName: 'CoinbaseProcessorV2',
      normalizeEvent: (input) => normalizeCoinbaseProviderEvent(input.raw, input.eventId),
    });
  }
}
