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
 *
 * **Why this exists:**
 * When the user presses Ctrl-C (SIGINT), the controller must:
 * 1. Dispatch abort state to React
 * 2. Force synchronous render (flushRender)
 * 3. Call process.exit(130)
 *
 * Normal event emission via EventBus uses queueMicrotask, which won't flush
 * before process.exit terminates the process. This would leave the UI showing
 * stale state instead of the abort message.
 *
 * **How it works:**
 * - Controller calls `lifecycle.onAbort?.()` synchronously
 * - Component's useLayoutEffect sets `onAbort = () => dispatch({ type: 'abort' })`
 * - Controller calls `flushRender()` to force synchronous React commit
 * - UI paints abort state
 * - process.exit(130) terminates cleanly
 *
 * **Pattern:**
 * ```tsx
 * // In component:
 * useLayoutEffect(() => {
 *   lifecycle.onAbort = () => dispatch({ type: 'abort' })
 *   lifecycle.onFail = (msg) => dispatch({ type: 'fail', errorMessage: msg })
 *   lifecycle.onComplete = () => dispatch({ type: 'complete' })
 *   return () => {
 *     lifecycle.onAbort = undefined
 *     lifecycle.onFail = undefined
 *     lifecycle.onComplete = undefined
 *   }
 * }, [lifecycle])
 *
 * // In controller:
 * abort(): void {
 *   this.lifecycle.onAbort?.()
 *   this.flushRender()  // Force synchronous render
 *   // process.exit(130) happens next in signal handler
 * }
 * ```
 *
 * @see {@link https://react.dev/reference/react-dom/flushSync} - React's flushSync (Ink's flushRender is similar)
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
