export { TtlCache } from './cache/index.js';
export {
  CircuitBreakerRegistry,
  createInitialCircuitState,
  getCircuitStatistics,
  getCircuitStatus,
  isCircuitClosed,
  isCircuitHalfOpen,
  isCircuitOpen,
  recordFailure,
  recordSuccess,
  resetCircuit,
  shouldCircuitBlock,
} from './circuit-breaker/index.js';
export type { CircuitState, CircuitStatus } from './circuit-breaker/index.js';
export { executeWithFailover } from './failover/index.js';
export type { FailoverAttempt, FailoverOptions, FailoverResult } from './failover/index.js';
export {
  createInitialHealth,
  getProviderHealthWithCircuit,
  hasAvailableProviders,
  shouldBlockDueToCircuit,
  updateHealthMetrics,
} from './provider-health/index.js';
export type { IProvider, ProviderHealth, ProviderHealthWithCircuit } from './provider-health/index.js';
export { scoreProviderHealth } from './provider-scoring/index.js';
export { buildProviderSelectionDebugInfo, selectProviders } from './provider-selection/index.js';
export type { ScoredProvider, SelectProvidersOptions } from './provider-selection/index.js';
export { ProviderHealthStore } from './provider-stats/index.js';
export type { ProviderHealthSnapshot } from './provider-stats/index.js';
