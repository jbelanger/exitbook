import { performance } from 'node:perf_hooks';

import type { ApiCallStats, OperationStatus } from '../shared/index.js';

export type { ApiCallStats, OperationStatus };

export interface PricesEnrichState {
  providerInit?:
    | {
        completedAt?: number | undefined;
        startedAt: number;
        status: OperationStatus;
      }
    | undefined;

  tradePrices?:
    | {
        completedAt?: number | undefined;
        startedAt: number;
        status: OperationStatus;
        transactionsUpdated: number;
      }
    | undefined;

  fxRates?:
    | {
        completedAt?: number | undefined;
        errors: string[];
        failures: number;
        movementsNormalized: number;
        movementsSkipped: number;
        startedAt: number;
        status: OperationStatus;
      }
    | undefined;

  marketPrices?:
    | {
        completedAt?: number | undefined;
        errors: string[];
        failures: number;
        movementsUpdated: number;
        pricesFetched: number;
        processed: number;
        skipped: number;
        startedAt: number;
        status: OperationStatus;
        total: number;
      }
    | undefined;

  propagation?:
    | {
        completedAt?: number | undefined;
        startedAt: number;
        status: OperationStatus;
        transactionsUpdated: number;
      }
    | undefined;

  apiCalls: ApiCallStats;
  isComplete: boolean;
  aborted?: boolean | undefined;
  errorMessage?: string | undefined;
  suggestedAction?: string | undefined;
  totalDurationMs?: number | undefined;
  startedAt: number;
}

/**
 * Callback bridge for lifecycle signals from controller to React component.
 * Controller calls these synchronously; component registers them via useLayoutEffect.
 * Required for abort/fail where process.exit() follows immediately.
 */
export interface LifecycleBridge {
  onAbort?: (() => void) | undefined;
  onComplete?: (() => void) | undefined;
  onFail?: ((errorMessage: string) => void) | undefined;
}

export function createPricesEnrichState(): PricesEnrichState {
  return {
    apiCalls: { total: 0, byProvider: new Map() },
    isComplete: false,
    startedAt: performance.now(),
  };
}
