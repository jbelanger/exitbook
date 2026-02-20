/**
 * Background health check timer for blockchain providers
 *
 * Opt-in lifecycle: timer is NOT started in the constructor.
 * Call start() explicitly to begin periodic health checks.
 * This prevents timer leaks in tests and short-lived CLI invocations.
 */

import { getErrorMessage } from '@exitbook/core';
import { getLogger } from '@exitbook/logger';

import type { IBlockchainProvider } from '../types/index.js';

const logger = getLogger('ProviderHealthMonitor');

// Provider health check interval: Balance between timely failure detection and overhead
// 1 minute provides reasonable responsiveness while minimizing background health check traffic
const DEFAULT_HEALTH_CHECK_INTERVAL_MS = 60_000;

export class ProviderHealthMonitor {
  private timer?: NodeJS.Timeout | undefined;

  constructor(
    private readonly getProviders: () => Map<string, IBlockchainProvider[]>,
    private readonly onResult: (
      blockchain: string,
      providerName: string,
      success: boolean,
      responseTime: number,
      error?: string
    ) => void,
    private readonly intervalMs = DEFAULT_HEALTH_CHECK_INTERVAL_MS
  ) {}

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      void this.performHealthChecks().catch((error) => {
        logger.error(`Health check failed: ${getErrorMessage(error)}`);
      });
    }, this.intervalMs);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
  }

  isRunning(): boolean {
    return this.timer !== undefined;
  }

  private async performHealthChecks(): Promise<void> {
    for (const [blockchain, providers] of this.getProviders().entries()) {
      for (const provider of providers) {
        try {
          const startTime = Date.now();
          const result = await provider.isHealthy();
          const responseTime = Date.now() - startTime;

          if (result.isErr()) {
            this.onResult(blockchain, provider.name, false, responseTime, result.error.message);
          } else {
            this.onResult(blockchain, provider.name, result.value, responseTime);
          }
        } catch (error) {
          this.onResult(blockchain, provider.name, false, 0, getErrorMessage(error, 'Health check failed'));
        }
      }
    }
  }
}
