export {
  getCircuitStatistics,
  getCircuitStatus,
  isCircuitClosed,
  isCircuitHalfOpen,
  isCircuitOpen,
  recordFailure,
  recordSuccess,
  resetCircuit,
  shouldCircuitBlock,
} from './circuit-breaker.js';
export { CircuitBreakerRegistry } from './registry.js';
export { createInitialCircuitState } from './types.js';
export type { CircuitState, CircuitStatus } from './types.js';
