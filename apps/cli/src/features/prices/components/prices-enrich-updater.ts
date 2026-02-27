import { performance } from 'node:perf_hooks';

import type { PriceEvent } from '@exitbook/accounting';
import type { RequestMetric } from '@exitbook/http';

import { createProviderStats } from '../../../ui/shared/index.js';
import type { ApiCallStats } from '../../../ui/shared/index.js';

import type { PricesEnrichState } from './prices-enrich-state.js';

const RATE_WINDOW_MS = 5000;

/**
 * Actions that drive state transitions in the prices enrich UI.
 */
export type PricesEnrichAction =
  | { apiCalls: ApiCallStats; type: 'refresh' }
  | { errorMessage: string; type: 'fail' }
  | { event: PriceEvent; type: 'event' }
  | { type: 'abort' }
  | { type: 'complete' };

/**
 * Immutable reducer for prices enrich dashboard state.
 * Returns a new state object on every meaningful action, enabling React's change detection.
 */
export function pricesEnrichReducer(state: PricesEnrichState, action: PricesEnrichAction): PricesEnrichState {
  switch (action.type) {
    case 'event':
      return applyEvent(state, action.event);
    case 'refresh':
      return { ...state, apiCalls: action.apiCalls };
    default:
      break;
  }

  if (state.isComplete) {
    return state;
  }

  const totalDurationMs = performance.now() - state.startedAt;

  switch (action.type) {
    case 'complete':
      return { ...state, isComplete: true, totalDurationMs };
    case 'abort':
      return { ...state, isComplete: true, aborted: true, totalDurationMs };
    case 'fail':
      return {
        ...state,
        isComplete: true,
        errorMessage: action.errorMessage.split('\n')[0],
        suggestedAction: 'exitbook prices view --missing-only',
        totalDurationMs,
      };
  }
}

function applyEvent(state: PricesEnrichState, event: PriceEvent): PricesEnrichState {
  switch (event.type) {
    case 'providers.initializing':
      return { ...state, providerInit: { status: 'active', startedAt: performance.now() } };
    case 'providers.ready':
      if (!state.providerInit) return state;
      return {
        ...state,
        providerInit: { ...state.providerInit, status: 'completed', completedAt: performance.now() },
      };
    case 'stage.started':
      return applyStageStarted(state, event.stage);
    case 'stage.completed':
      return applyStageCompleted(state, event.result);
    case 'stage.failed':
      return applyStageFailed(state, event);
    case 'stage.progress':
      return applyStageProgress(state, event);
  }
}

function applyStageStarted(
  state: PricesEnrichState,
  stage: (PriceEvent & { type: 'stage.started' })['stage']
): PricesEnrichState {
  const now = performance.now();

  switch (stage) {
    case 'tradePrices':
      return { ...state, tradePrices: { status: 'active', startedAt: now, transactionsUpdated: 0 } };
    case 'fxRates':
      return {
        ...state,
        fxRates: {
          status: 'active',
          startedAt: now,
          movementsNormalized: 0,
          movementsSkipped: 0,
          failures: 0,
          errors: [],
        },
      };
    case 'marketPrices':
      return {
        ...state,
        marketPrices: {
          status: 'active',
          startedAt: now,
          processed: 0,
          total: 0,
          pricesFetched: 0,
          movementsUpdated: 0,
          skipped: 0,
          failures: 0,
          errors: [],
        },
      };
    case 'rederive':
      return { ...state, rederive: { status: 'active', startedAt: now, transactionsUpdated: 0 } };
    default:
      return state;
  }
}

function applyStageCompleted(
  state: PricesEnrichState,
  result: (PriceEvent & { type: 'stage.completed' })['result']
): PricesEnrichState {
  const now = performance.now();

  switch (result.stage) {
    case 'tradePrices':
      if (!state.tradePrices) return state;
      return {
        ...state,
        tradePrices: {
          ...state.tradePrices,
          status: 'completed',
          completedAt: now,
          transactionsUpdated: result.transactionsUpdated,
        },
      };
    case 'fxRates':
      if (!state.fxRates) return state;
      return {
        ...state,
        fxRates: {
          ...state.fxRates,
          status: result.failures > 0 ? 'warning' : 'completed',
          completedAt: now,
          movementsNormalized: result.movementsNormalized,
          movementsSkipped: result.movementsSkipped,
          failures: result.failures,
          errors: result.errors,
        },
      };
    case 'marketPrices':
      if (!state.marketPrices) return state;
      return {
        ...state,
        marketPrices: {
          ...state.marketPrices,
          status: result.failures > 0 ? 'warning' : 'completed',
          completedAt: now,
          pricesFetched: result.pricesFetched,
          movementsUpdated: result.movementsUpdated,
          skipped: result.skipped,
          failures: result.failures,
          errors: result.errors,
        },
      };
    case 'rederive':
      if (!state.rederive) return state;
      return {
        ...state,
        rederive: {
          ...state.rederive,
          status: 'completed',
          completedAt: now,
          transactionsUpdated: result.transactionsUpdated,
        },
      };
    default:
      return state;
  }
}

function applyStageFailed(state: PricesEnrichState, event: PriceEvent & { type: 'stage.failed' }): PricesEnrichState {
  const now = performance.now();
  const base: PricesEnrichState = {
    ...state,
    errorMessage: event.error.split('\n')[0],
    suggestedAction: 'exitbook prices view --missing-only',
    isComplete: true,
    totalDurationMs: now - state.startedAt,
  };

  switch (event.stage) {
    case 'tradePrices':
      return state.tradePrices
        ? { ...base, tradePrices: { ...state.tradePrices, status: 'failed', completedAt: now } }
        : base;
    case 'fxRates':
      return state.fxRates ? { ...base, fxRates: { ...state.fxRates, status: 'failed', completedAt: now } } : base;
    case 'marketPrices':
      return state.marketPrices
        ? { ...base, marketPrices: { ...state.marketPrices, status: 'failed', completedAt: now } }
        : base;
    case 'rederive':
      return state.rederive ? { ...base, rederive: { ...state.rederive, status: 'failed', completedAt: now } } : base;
    default:
      return base;
  }
}

function applyStageProgress(
  state: PricesEnrichState,
  event: PriceEvent & { type: 'stage.progress' }
): PricesEnrichState {
  if (!state.marketPrices) return state;
  return {
    ...state,
    marketPrices: { ...state.marketPrices, processed: event.processed, total: event.total },
  };
}

/**
 * Build ApiCallStats from raw instrumentation metrics.
 * Called on each refresh tick for up-to-date API stats.
 */
export function computeApiCallStats(metrics: RequestMetric[]): ApiCallStats {
  const byProvider = new Map<string, ReturnType<typeof createProviderStats>>();
  const now = Date.now();
  const windowStart = now - RATE_WINDOW_MS;

  // Track recent counts per provider during the first pass
  const recentCounts = new Map<string, number>();

  for (const m of metrics) {
    let stats = byProvider.get(m.provider);
    if (!stats) {
      stats = createProviderStats();
      byProvider.set(m.provider, stats);
    }

    stats.total++;
    stats.latencies.push(m.durationMs);
    if (stats.startTime === 0) stats.startTime = m.timestamp;
    if (m.timestamp > stats.lastCallTime) stats.lastCallTime = m.timestamp;

    const count = stats.responsesByStatus.get(m.status) ?? 0;
    stats.responsesByStatus.set(m.status, count + 1);

    if (m.status >= 200 && m.status < 300 && m.status !== 429) {
      stats.okCount++;
    } else if (m.status === 429) {
      stats.throttledCount++;
    } else if (m.status >= 400) {
      stats.failed++;
    }

    // Track recent calls for rate calculation
    if (m.timestamp >= windowStart) {
      recentCounts.set(m.provider, (recentCounts.get(m.provider) ?? 0) + 1);
    }
  }

  // Compute current rate per provider from pre-computed counts
  for (const [provider, stats] of byProvider) {
    const recentCount = recentCounts.get(provider) ?? 0;
    stats.currentRate = recentCount / (RATE_WINDOW_MS / 1000);
  }

  return { total: metrics.length, byProvider };
}
