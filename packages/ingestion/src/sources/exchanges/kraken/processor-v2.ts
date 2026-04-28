import { KrakenLedgerEntrySchema, type KrakenLedgerEntry } from '@exitbook/exchange-providers/kraken';

import { ExchangeLedgerProcessor, createRawExchangeProcessorInputSchema } from '../shared/index.js';

import { buildKrakenCorrelationGroups } from './build-correlation-groups.js';
import { interpretKrakenGroup } from './interpret-group.js';
import { normalizeKrakenProviderEvent, type KrakenProviderMetadata } from './normalize-provider-event.js';

const KrakenLedgerProcessorInputSchema = createRawExchangeProcessorInputSchema(KrakenLedgerEntrySchema);

/**
 * Kraken ledger-v2 processor. It reuses the legacy provider-event
 * interpretation path, then materializes accounting-owned ledger artifacts.
 */
export class KrakenProcessorV2 extends ExchangeLedgerProcessor<KrakenLedgerEntry, KrakenProviderMetadata> {
  constructor() {
    super({
      buildGroups: buildKrakenCorrelationGroups,
      displayName: 'Kraken ledger-v2',
      inputSchema: KrakenLedgerProcessorInputSchema,
      interpretGroup: interpretKrakenGroup,
      loggerName: 'KrakenProcessorV2',
      normalizeEvent: (input) => normalizeKrakenProviderEvent(input.raw, input.eventId),
    });
  }
}
