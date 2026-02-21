import type { CircuitStatus } from '../circuit-breaker/types.js';

/**
 * Minimal provider contract shared across blockchain and price providers
 *
 * Both IBlockchainProvider and IPriceProvider extend this interface,
 * enabling shared utilities (e.g., hasAvailableProviders) to accept
 * provider arrays directly without mapping to names.
 */
export interface IProvider {
  readonly name: string;
  destroy(): Promise<void>;
}

/**
 * Provider health tracking metrics
 *
 * Shared across blockchain and price provider managers for consistent
 * health monitoring, scoring, and failover decisions.
 */
export interface ProviderHealth {
  averageResponseTime: number;
  consecutiveFailures: number;
  errorRate: number;
  isHealthy: boolean;
  lastChecked: number;
  lastError?: string | undefined;
}

/**
 * Provider health combined with circuit breaker status (for monitoring endpoints)
 */
export type ProviderHealthWithCircuit = ProviderHealth & { circuitState: CircuitStatus };
