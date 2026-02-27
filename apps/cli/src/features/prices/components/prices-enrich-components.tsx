import { performance } from 'node:perf_hooks';

import type { PriceEvent } from '@exitbook/accounting';
import type { InstrumentationCollector } from '@exitbook/http';
import { Box, Text } from 'ink';
import { type FC, type ReactNode, useEffect, useLayoutEffect, useReducer } from 'react';

import {
  ApiFooter,
  type EventRelay,
  formatDuration,
  type LifecycleBridge,
  statusIcon,
  TreeChars,
} from '../../../ui/shared/index.js';

import { createPricesEnrichState, type PricesEnrichState } from './prices-enrich-state.js';
import { computeApiCallStats, pricesEnrichReducer } from './prices-enrich-updater.js';

const REFRESH_INTERVAL_MS = 250;

// --- Hook ---

function usePricesEnrichState(
  relay: EventRelay<PriceEvent>,
  lifecycle: LifecycleBridge,
  instrumentation: InstrumentationCollector
): PricesEnrichState {
  const [state, dispatch] = useReducer(pricesEnrichReducer, undefined, createPricesEnrichState);

  // Connect to the event relay (replays any buffered events, then forwards new ones).
  // Also register lifecycle callbacks for synchronous abort/fail/complete dispatch.
  useLayoutEffect(() => {
    lifecycle.onAbort = () => dispatch({ type: 'abort' });
    lifecycle.onFail = (errorMessage: string) => dispatch({ type: 'fail', errorMessage });
    lifecycle.onComplete = () => dispatch({ type: 'complete' });

    const disconnect = relay.connect((event: PriceEvent) => {
      dispatch({ type: 'event', event });
    });

    return () => {
      lifecycle.onAbort = undefined;
      lifecycle.onFail = undefined;
      lifecycle.onComplete = undefined;
      disconnect();
    };
  }, [relay, lifecycle]);

  // Periodic refresh for API call stats
  useEffect(() => {
    const timer = setInterval(() => {
      dispatch({
        type: 'refresh',
        apiCalls: computeApiCallStats(instrumentation.getMetrics()),
      });
    }, REFRESH_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [instrumentation]);

  return state;
}

// --- Components ---

interface PricesEnrichMonitorProps {
  instrumentation: InstrumentationCollector;
  lifecycle: LifecycleBridge;
  relay: EventRelay<PriceEvent>;
}

export const PricesEnrichMonitor: FC<PricesEnrichMonitorProps> = ({ relay, lifecycle, instrumentation }) => {
  const state = usePricesEnrichState(relay, lifecycle, instrumentation);

  const hasFailures =
    (state.fxRates?.failures ?? 0) > 0 ||
    (state.marketPrices?.failures ?? 0) > 0 ||
    state.fxRates?.status === 'warning' ||
    state.marketPrices?.status === 'warning';

  return (
    <Box flexDirection="column">
      <Text> </Text>
      {state.tradePrices && <TradePricesStage stage={state.tradePrices} />}
      {state.providerInit && <ProviderInitStage stage={state.providerInit} />}
      {state.fxRates && <FxRatesStage stage={state.fxRates} />}
      {state.marketPrices && <MarketPricesStage stage={state.marketPrices} />}
      {state.rederive && <RederiveStage stage={state.rederive} />}
      {state.isComplete && (
        <CompletionSection
          state={state}
          showNextHint={hasFailures}
        />
      )}
      <ApiFooter
        total={state.apiCalls.total}
        byProvider={state.apiCalls.byProvider}
        isComplete={state.isComplete}
        overallDurationMs={state.totalDurationMs}
      />
    </Box>
  );
};

const TradePricesStage: FC<{ stage: NonNullable<PricesEnrichState['tradePrices']> }> = ({ stage }) => {
  const elapsed = stage.completedAt ? stage.completedAt - stage.startedAt : performance.now() - stage.startedAt;
  const duration = formatDuration(elapsed);

  if (stage.status === 'active') {
    return (
      <Text>
        {statusIcon('active')} <Text bold>Extracting trade prices</Text>
        <Text dimColor> · {duration}</Text>
      </Text>
    );
  }

  return (
    <Box flexDirection="column">
      <Text>
        {statusIcon(stage.status)} <Text bold>Trade prices</Text>
        <Text dimColor> ({duration})</Text>
      </Text>
      <Box>
        <Text dimColor>
          {'  '}
          {TreeChars.LAST_BRANCH}{' '}
        </Text>
        {stage.transactionsUpdated > 0 ? (
          <>
            <Text color="green">{stage.transactionsUpdated}</Text>
            <Text dimColor> transactions updated</Text>
          </>
        ) : (
          <Text dimColor>0 transactions updated</Text>
        )}
      </Box>
    </Box>
  );
};

const ProviderInitStage: FC<{ stage: NonNullable<PricesEnrichState['providerInit']> }> = ({ stage }) => {
  const elapsed = stage.completedAt ? stage.completedAt - stage.startedAt : performance.now() - stage.startedAt;
  const duration = formatDuration(elapsed);

  if (stage.status === 'active') {
    return (
      <Text>
        {statusIcon('active')} <Text bold>Initializing price providers</Text>
        <Text dimColor> · {duration}</Text>
      </Text>
    );
  }

  return (
    <Text>
      {statusIcon(stage.status)} <Text bold>Price providers</Text>
      <Text dimColor> ({duration})</Text>
    </Text>
  );
};

const FxRatesStage: FC<{ stage: NonNullable<PricesEnrichState['fxRates']> }> = ({ stage }) => {
  const elapsed = stage.completedAt ? stage.completedAt - stage.startedAt : performance.now() - stage.startedAt;
  const duration = formatDuration(elapsed);

  if (stage.status === 'active') {
    return (
      <Text>
        {statusIcon('active')} <Text bold>Normalizing FX rates</Text>
        <Text dimColor> · {duration}</Text>
      </Text>
    );
  }

  const nothingToDo = stage.movementsNormalized === 0 && stage.movementsSkipped === 0 && stage.failures === 0;
  const errorLines = stage.failures > 0 ? stage.errors.slice(0, 5) : [];

  const mainLines: ReactNode[] = [];
  if (nothingToDo) {
    mainLines.push(
      <Text
        dimColor
        key="zero"
      >
        0 movements to convert
      </Text>
    );
  } else {
    mainLines.push(
      <>
        {stage.movementsNormalized > 0 ? (
          <Text color="green">{stage.movementsNormalized}</Text>
        ) : (
          <Text dimColor>0</Text>
        )}
        <Text dimColor> movements converted to USD</Text>
      </>
    );
    if (stage.movementsSkipped > 0) {
      mainLines.push(
        <Text
          dimColor
          key="skip"
        >
          {stage.movementsSkipped} skipped
        </Text>
      );
    }
    if (stage.failures > 0) {
      mainLines.push(
        <Text
          color="yellow"
          key="fail"
        >
          {stage.failures} failures
        </Text>
      );
    }
  }

  return (
    <Box flexDirection="column">
      <Text>
        {statusIcon(stage.status)} <Text bold>FX rates</Text>
        <Text dimColor> ({duration})</Text>
      </Text>
      {mainLines.map((content, i) => (
        <Box key={i}>
          <Text dimColor>
            {'  '}
            {i === mainLines.length - 1 ? TreeChars.LAST_BRANCH : TreeChars.BRANCH}{' '}
          </Text>
          {content}
        </Box>
      ))}
      {errorLines.map((err, i) => (
        <Box key={`err-${i}`}>
          <Text dimColor>
            {'    '}
            {i === errorLines.length - 1 ? TreeChars.LAST_BRANCH : TreeChars.BRANCH}{' '}
          </Text>
          <Text color="yellow">{err}</Text>
        </Box>
      ))}
    </Box>
  );
};

const MarketPricesStage: FC<{ stage: NonNullable<PricesEnrichState['marketPrices']> }> = ({ stage }) => {
  const elapsed = stage.completedAt ? stage.completedAt - stage.startedAt : performance.now() - stage.startedAt;
  const duration = formatDuration(elapsed);

  if (stage.status === 'active') {
    const progress = stage.total > 0 ? ` · ${stage.processed}/${stage.total}` : '';
    return (
      <Text>
        {statusIcon('active')} <Text bold>Fetching market prices</Text>
        <Text dimColor>
          {progress} · {duration}
        </Text>
      </Text>
    );
  }

  const nothingToDo =
    stage.pricesFetched === 0 && stage.movementsUpdated === 0 && stage.skipped === 0 && stage.failures === 0;
  const errorLines = stage.failures > 0 ? stage.errors.slice(0, 5) : [];

  const mainLines: ReactNode[] = [];
  if (nothingToDo) {
    mainLines.push(
      <Text
        dimColor
        key="zero"
      >
        0 transactions need prices
      </Text>
    );
  } else {
    mainLines.push(
      <>
        {stage.pricesFetched > 0 ? <Text color="green">{stage.pricesFetched}</Text> : <Text dimColor>0</Text>}
        <Text dimColor> fetched from providers</Text>
      </>
    );
    mainLines.push(
      <>
        {stage.movementsUpdated > 0 ? <Text color="green">{stage.movementsUpdated}</Text> : <Text dimColor>0</Text>}
        <Text dimColor> movements updated</Text>
      </>
    );
    if (stage.skipped > 0) {
      mainLines.push(
        <Text
          dimColor
          key="skip"
        >
          {stage.skipped} skipped
        </Text>
      );
    }
    if (stage.failures > 0) {
      mainLines.push(
        <Text
          color="yellow"
          key="fail"
        >
          {stage.failures} failures
        </Text>
      );
    }
  }

  return (
    <Box flexDirection="column">
      <Text>
        {statusIcon(stage.status)} <Text bold>Market prices</Text>
        <Text dimColor> ({duration})</Text>
      </Text>
      {mainLines.map((content, i) => (
        <Box key={i}>
          <Text dimColor>
            {'  '}
            {i === mainLines.length - 1 ? TreeChars.LAST_BRANCH : TreeChars.BRANCH}{' '}
          </Text>
          {content}
        </Box>
      ))}
      {errorLines.map((err, i) => (
        <Box key={`err-${i}`}>
          <Text dimColor>
            {'    '}
            {i === errorLines.length - 1 ? TreeChars.LAST_BRANCH : TreeChars.BRANCH}{' '}
          </Text>
          <Text color="yellow">{err}</Text>
        </Box>
      ))}
    </Box>
  );
};

const RederiveStage: FC<{ stage: NonNullable<PricesEnrichState['rederive']> }> = ({ stage }) => {
  const elapsed = stage.completedAt ? stage.completedAt - stage.startedAt : performance.now() - stage.startedAt;
  const duration = formatDuration(elapsed);

  if (stage.status === 'active') {
    return (
      <Text>
        {statusIcon('active')} <Text bold>Re-deriving prices</Text>
        <Text dimColor> · {duration}</Text>
      </Text>
    );
  }

  return (
    <Box flexDirection="column">
      <Text>
        {statusIcon(stage.status)} <Text bold>Price re-derivation</Text>
        <Text dimColor> ({duration})</Text>
      </Text>
      <Box>
        <Text dimColor>
          {'  '}
          {TreeChars.LAST_BRANCH}{' '}
        </Text>
        {stage.transactionsUpdated > 0 ? (
          <>
            <Text color="green">{stage.transactionsUpdated}</Text>
            <Text dimColor> transactions updated</Text>
          </>
        ) : (
          <Text dimColor>0 transactions updated</Text>
        )}
      </Box>
    </Box>
  );
};

const CompletionSection: FC<{ showNextHint: boolean; state: PricesEnrichState }> = ({ state, showNextHint }) => {
  const duration = state.totalDurationMs ? formatDuration(state.totalDurationMs) : '—';

  if (state.aborted) {
    return (
      <Text>
        <Text color="yellow">⚠</Text> <Text bold>Aborted</Text>
        <Text dimColor> ({duration})</Text>
      </Text>
    );
  }

  if (state.errorMessage) {
    return (
      <Box flexDirection="column">
        <Text>
          <Text color="yellow">⚠</Text> <Text bold>Failed</Text>
          <Text dimColor> ({duration})</Text>
        </Text>
        <Text>
          {'  '}
          {state.errorMessage}
        </Text>
        {state.suggestedAction && (
          <Text dimColor>
            {'  '}Run: {state.suggestedAction}
          </Text>
        )}
      </Box>
    );
  }

  return (
    <Box flexDirection="column">
      <Text> </Text>
      <Text>
        <Text color="green">✓</Text> <Text bold>Done</Text>
        <Text dimColor> ({duration})</Text>
      </Text>
      {showNextHint && <Text dimColor>{'  '}Next: exitbook prices view --missing-only</Text>}
    </Box>
  );
};
