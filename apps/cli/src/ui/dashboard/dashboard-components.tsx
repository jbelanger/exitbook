import type { InstrumentationCollector } from '@exitbook/http';
import { Box, Text } from 'ink';
import Spinner from 'ink-spinner';
import React from 'react';

import { CLI_VERSION } from '../../index.js';
import type { ProviderMetrics } from '../provider-metrics.js';
import { formatRequestBreakdown } from '../provider-metrics.js';

import type { DashboardState } from './dashboard-state.js';
import { calculateHitRate, formatAddress, formatElapsedTime, formatNumber, formatTimestamp } from './formatters.js';

/**
 * Ink component props.
 */
interface DashboardProps {
  state: DashboardState;
  metrics: ProviderMetrics;
  instrumentation: InstrumentationCollector;
}

/**
 * Main dashboard component.
 * Uses Ink for flexible, dynamic layouts without line counting.
 */
export const Dashboard: React.FC<DashboardProps> = ({ state, metrics, instrumentation }) => {
  return (
    <Box flexDirection="column">
      <Text dimColor>{'─'.repeat(80)}</Text>
      <Header state={state} />

      {/* Event log */}
      {state.events.map((event, index) => (
        <Text
          key={index}
          dimColor
        >
          {'  '}
          {formatTimestamp(event.timestamp)} {event.icon} {event.message}
        </Text>
      ))}

      {/* Contextual spinner (only during run) */}
      {!state.isComplete && state.currentActivity && (
        <SpinnerLine
          activity={state.currentActivity}
          instrumentation={instrumentation}
          state={state}
        />
      )}

      {/* Completion sections */}
      {state.isComplete && (
        <>
          <Text> </Text>
          {metrics.providers.length > 0 && <CompletionProviderTable metrics={metrics} />}
          <Text> </Text>
          <FinalStats state={state} />
        </>
      )}

      {/* Separator and stats always at bottom */}
      <Text dimColor>{'─'.repeat(80)}</Text>
      <StatsLine
        state={state}
        instrumentation={instrumentation}
      />
    </Box>
  );
};

/**
 * Header line component.
 * Example: EXITBOOK CLI  v2.1.0  •  Importing from Ethereum  •  Account #42  •  0xd8da...9d7e
 */
const Header: React.FC<{ state: DashboardState }> = ({ state }) => {
  const parts = [`EXITBOOK CLI  v${CLI_VERSION}`];

  if (state.sourceName) {
    parts.push(`Importing from ${state.sourceName}`);
  }

  if (state.accountId !== undefined) {
    parts.push(`Account #${state.accountId}`);
  }

  if (state.address) {
    parts.push(formatAddress(state.address));
  }

  return <Text>{parts.join('  •  ')}</Text>;
};

/**
 * Contextual spinner line with live metrics.
 */
const SpinnerLine: React.FC<{
  activity: NonNullable<DashboardState['currentActivity']>;
  instrumentation: InstrumentationCollector;
  state: DashboardState;
}> = ({ activity, instrumentation, state }) => {
  let message: string;

  // Processing phase (local, no API metrics)
  if (activity.provider === '__processing__') {
    message = `${activity.operation} (${formatNumber(state.processed)})`;
  }
  // Import phase (API providers with metrics)
  else {
    const { avgLatencyMs, reqPerSec } = getSpinnerMetrics(activity.provider, instrumentation);
    const _streamType = activity.streamType || 'data';
    message = `${activity.operation} from ${activity.provider} (avg ${avgLatencyMs}ms, ${reqPerSec.toFixed(0)} req/s)`;
  }

  return (
    <Box>
      <Text
        bold
        color="cyan"
      >
        <Spinner type="dots" /> {message}
      </Text>
    </Box>
  );
};

function getSpinnerMetrics(
  provider: string,
  instrumentation: InstrumentationCollector
): { avgLatencyMs: number; reqPerSec: number } {
  const now = Date.now();
  const windowStart = now - 5000; // 5-second window

  const recentMetrics = instrumentation
    .getMetrics()
    .filter((m) => m.provider === provider && m.timestamp >= windowStart && m.status >= 200 && m.status < 300);

  const avgLatencyMs =
    recentMetrics.length > 0
      ? Math.round(recentMetrics.reduce((sum, m) => sum + m.durationMs, 0) / recentMetrics.length)
      : 0;

  const reqPerSec = recentMetrics.length / 5;

  return { avgLatencyMs, reqPerSec };
}

/**
 * Progressive stats line (updates during run).
 */
const StatsLine: React.FC<{
  instrumentation: InstrumentationCollector;
  state: DashboardState;
}> = ({ state, instrumentation }) => {
  const parts: string[] = [];

  // Elapsed time
  if (state.startedAt) {
    const elapsed =
      state.isComplete && state.completedAt ? state.completedAt - state.startedAt : Date.now() - state.startedAt;
    parts.push(formatElapsedTime(elapsed));
  }

  // Core counters
  parts.push(`${formatNumber(state.imported)} imported`);
  parts.push(`${formatNumber(state.processed)} processed`);

  const apiCalls = instrumentation.getMetrics().length;
  parts.push(`${formatNumber(apiCalls)} API calls`);

  // Progressive fields (only if > 0)
  if (state.duplicates > 0) {
    parts.push(`${formatNumber(state.duplicates)} duplicates`);
  }
  if (state.skipped > 0) {
    parts.push(`${formatNumber(state.skipped)} skipped`);
  }

  return <Text>{parts.join('  •  ')}</Text>;
};

/**
 * Completion provider table (only shown after completion).
 */
const CompletionProviderTable: React.FC<{ metrics: ProviderMetrics }> = ({ metrics }) => {
  return (
    <Box flexDirection="column">
      {/* Header */}
      <Box>
        <Box width={20}>
          <Text>PROVIDERS</Text>
        </Box>
        <Box width={10}>
          <Text>LATENCY</Text>
        </Box>
        <Box width={12}>
          <Text>THROTTLES</Text>
        </Box>
        <Box>
          <Text>REQUESTS</Text>
        </Box>
      </Box>

      {/* Rows */}
      {metrics.providers.map((provider) => (
        <Box key={provider.name}>
          <Box width={20}>
            <Text>
              {'  '}
              {provider.name}
            </Text>
          </Box>
          <Box width={10}>
            <Text>{provider.latencyMs ? `${provider.latencyMs}ms` : '—'}</Text>
          </Box>
          <Box width={12}>
            <Text>{provider.throttles}</Text>
          </Box>
          <Box>
            <Text>{formatRequestBreakdown(provider.requestsByStatus)}</Text>
          </Box>
        </Box>
      ))}
    </Box>
  );
};

/**
 * Final stats (only shown on completion).
 */
const FinalStats: React.FC<{ state: DashboardState }> = ({ state }) => {
  const lines: string[] = [];

  const { cacheHits, cacheMisses } = state.metadataStats;
  const totalMetadata = cacheHits + cacheMisses;
  if (totalMetadata > 0) {
    const hitRate = calculateHitRate(cacheHits, cacheMisses);
    lines.push(
      `Token Metadata:  ${hitRate}% cache hit rate (${formatNumber(cacheHits)} cached / ${formatNumber(cacheMisses)} fetched)`
    );
  }

  if (state.scamStats.totalFound > 0) {
    const examples = state.scamStats.examples.join(', ');
    lines.push(`Scams Filtered:  ${formatNumber(state.scamStats.totalFound)} rejected (${examples})`);
  }

  if (lines.length === 0) {
    return;
  }

  return (
    <Box flexDirection="column">
      {lines.map((line, idx) => (
        <Text key={idx}>{line}</Text>
      ))}
    </Box>
  );
};
