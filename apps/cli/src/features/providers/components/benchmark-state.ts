/**
 * State management for benchmark TUI
 */

import type { BenchmarkProgressEvent } from '../../providers-benchmark/benchmark-tool.js';
import type { BenchmarkParams } from '../../providers-benchmark/providers-benchmark-utils.js';
import { buildConfigOverride } from '../../providers-benchmark/providers-benchmark-utils.js';

export interface SustainedTest {
  rate: number;
  status: 'pending' | 'running' | 'success' | 'failed';
  responseTimeMs?: number | undefined;
}

export interface BurstTest {
  limit: number;
  status: 'pending' | 'running' | 'success' | 'failed';
}

export interface BenchmarkState {
  // Provider info
  providerName: string;
  blockchain: string;
  currentRateLimit: unknown;
  numRequests: number;
  skipBurst: boolean;

  // Test state
  phase: 'testing' | 'complete' | 'error';
  sustainedTests: SustainedTest[];
  burstTests: BurstTest[];

  // Results (when phase = complete)
  configOverride?: Record<string, unknown> | undefined;
  maxSafeRate?: number | undefined;
  recommended?:
    | {
        burstLimit?: number | undefined;
        requestsPerSecond: number;
      }
    | undefined;

  // Error (when phase = error)
  errorMessage?: string | undefined;
}

export type BenchmarkAction =
  | { event: BenchmarkProgressEvent; type: 'PROGRESS' }
  | {
      result: {
        burstLimits?: { limit: number; success: boolean }[] | undefined;
        maxSafeRate: number;
        recommended: {
          burstLimit?: number | undefined;
          requestsPerSecond: number;
        };
        testResults: { rate: number; responseTimeMs?: number | undefined; success: boolean }[];
      };
      type: 'COMPLETE';
    }
  | { message: string; type: 'ERROR' };

/**
 * Create initial benchmark state from params and provider info
 */
export function createBenchmarkState(
  params: BenchmarkParams,
  providerInfo: {
    blockchain: string;
    name: string;
    rateLimit: unknown;
  }
): BenchmarkState {
  // Build sustained test list
  const customRates = params.customRates;
  const ratesToTest = customRates
    ? customRates.sort((a, b) => a - b)
    : [...new Set([0.25, 0.5, 1.0, 2.5, 5.0, params.maxRate])].filter((r) => r <= params.maxRate).sort((a, b) => a - b);

  const sustainedTests: SustainedTest[] = ratesToTest.map((rate) => ({
    rate,
    status: 'pending',
  }));

  // Build burst test list
  const burstTests: BurstTest[] = params.skipBurst
    ? []
    : [10, 15, 20, 30, 60].map((limit) => ({
        limit,
        status: 'pending',
      }));

  return {
    providerName: providerInfo.name,
    blockchain: providerInfo.blockchain,
    currentRateLimit: providerInfo.rateLimit,
    numRequests: params.numRequests,
    skipBurst: params.skipBurst,
    phase: 'testing',
    sustainedTests,
    burstTests,
  };
}

/**
 * Reducer for benchmark state updates
 */
export function benchmarkReducer(state: BenchmarkState, action: BenchmarkAction): BenchmarkState {
  switch (action.type) {
    case 'PROGRESS': {
      const event = action.event;

      if (event.type === 'sustained-start') {
        // Mark test as running
        return {
          ...state,
          sustainedTests: state.sustainedTests.map((test) =>
            test.rate === event.rate ? { ...test, status: 'running' } : test
          ),
        };
      }

      if (event.type === 'sustained-complete') {
        // Mark test as complete
        return {
          ...state,
          sustainedTests: state.sustainedTests.map((test) =>
            test.rate === event.rate
              ? {
                  ...test,
                  status: event.success ? 'success' : 'failed',
                  responseTimeMs: event.responseTimeMs,
                }
              : test
          ),
        };
      }

      if (event.type === 'burst-start') {
        // Mark burst test as running
        return {
          ...state,
          burstTests: state.burstTests.map((test) =>
            test.limit === event.limit ? { ...test, status: 'running' } : test
          ),
        };
      }

      if (event.type === 'burst-complete') {
        // Mark burst test as complete
        return {
          ...state,
          burstTests: state.burstTests.map((test) =>
            test.limit === event.limit ? { ...test, status: event.success ? 'success' : 'failed' } : test
          ),
        };
      }

      return state;
    }

    case 'COMPLETE': {
      return {
        ...state,
        configOverride: buildConfigOverride(state.blockchain, state.providerName, action.result.recommended),
        maxSafeRate: action.result.maxSafeRate,
        phase: 'complete',
        recommended: action.result.recommended,
      };
    }

    case 'ERROR': {
      return {
        ...state,
        phase: 'error',
        errorMessage: action.message,
      };
    }

    default:
      return state;
  }
}
