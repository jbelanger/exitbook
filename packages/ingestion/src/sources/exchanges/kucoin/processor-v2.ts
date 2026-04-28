import { ExchangeLedgerProcessor, createRawExchangeProcessorInputSchema } from '../shared/index.js';

import { buildKuCoinCorrelationGroups } from './build-correlation-groups.js';
import { interpretKuCoinGroup } from './interpret-group.js';
import { normalizeKuCoinProviderEvent, type KuCoinProviderMetadata } from './normalize-provider-event.js';
import { KuCoinCsvRowSchema } from './schemas.js';
import type { KuCoinCsvRow } from './types.js';

const KuCoinLedgerProcessorInputSchema = createRawExchangeProcessorInputSchema(KuCoinCsvRowSchema);

/**
 * KuCoin ledger-v2 processor. It keeps CSV provider-event interpretation
 * shared with legacy processing, then materializes accounting-owned ledger
 * artifacts through the generic exchange ledger processor.
 */
export class KuCoinProcessorV2 extends ExchangeLedgerProcessor<KuCoinCsvRow, KuCoinProviderMetadata> {
  constructor() {
    super({
      buildGroups: buildKuCoinCorrelationGroups,
      displayName: 'KuCoin ledger-v2',
      inputSchema: KuCoinLedgerProcessorInputSchema,
      interpretGroup: interpretKuCoinGroup,
      loggerName: 'KuCoinProcessorV2',
      normalizeEvent: (input) => normalizeKuCoinProviderEvent(input.raw, input.eventId),
    });
  }
}
