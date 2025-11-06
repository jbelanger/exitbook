import { CorrelatingExchangeProcessor } from './correlating-exchange-processor.js';
import { byCorrelationId, standardAmounts } from './strategies/index.js';

/**
 * Default exchange processor using standard correlation and amount semantics.
 * Use this for exchanges like Kraken, KuCoin (non-CSV), etc.
 *
 * - Groups entries by correlationId (from normalized data)
 * - Uses standard amount interpretation (amount is net, fee is separate)
 */
export class DefaultExchangeProcessor extends CorrelatingExchangeProcessor {
  constructor(sourceId: string) {
    super(sourceId, byCorrelationId, standardAmounts);
  }
}
