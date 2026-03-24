// Backwards-compatible barrel while callers migrate to the focused modules.
export {
  ensureConsumerInputsReady,
  type ConsumerTarget,
  type EnsureConsumerInputsReadyOptions,
} from './consumer-input-readiness.js';
export {
  ensureAssetReviewReady,
  ensureLinksReady,
  ensureProcessedTransactionsReady,
  type PrereqExecutionOptions,
} from './projection-readiness.js';
export { countProjectionResetImpact, resetProjections, type ProjectionResetImpact } from './projection-reset.js';
export { ensureTransactionPricesReady, type PricePrereqConfig, type PriceReadinessTarget } from './price-readiness.js';
