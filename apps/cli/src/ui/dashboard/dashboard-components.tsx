import type { InstrumentationCollector } from '@exitbook/http';
import { Box, Text } from 'ink';
import pc from 'picocolors';
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
    <Box
      flexDirection="column"
      gap={1}
    >
      <Header state={state} />
      <StatusLine
        state={state}
        instrumentation={instrumentation}
      />
      {metrics.providers.length > 0 && <ProviderTable metrics={metrics} />}
      {state.events.length > 0 && <RecentActivity events={state.events} />}
      {state.isComplete ? <FinalStats state={state} /> : <Controls />}
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
 * Status line with counters.
 * Example: 1,234 imported  •  1,234 processed  •  1,340 API calls  •  00:08 elapsed
 */
const StatusLine: React.FC<{ instrumentation: InstrumentationCollector; state: DashboardState }> = ({
  state,
  instrumentation,
}) => {
  const parts: string[] = [];

  parts.push(`${formatNumber(state.imported)} imported`);
  parts.push(`${formatNumber(state.processed)} processed`);

  const apiCalls = instrumentation.getMetrics().length;
  parts.push(`${formatNumber(apiCalls)} API calls`);

  if (state.startedAt) {
    const elapsed =
      state.isComplete && state.completedAt ? state.completedAt - state.startedAt : Date.now() - state.startedAt;
    parts.push(`${formatElapsedTime(elapsed)} elapsed`);
  }

  if (state.isComplete) {
    parts.push('✓');
  }

  return <Text>{parts.join('  •  ')}</Text>;
};

/**
 * Provider table component.
 */
const ProviderTable: React.FC<{ metrics: ProviderMetrics }> = ({ metrics }) => {
  return (
    <Box flexDirection="column">
      <Text>ACTIVE PROVIDERS LATENCY RATE THROTTLES REQUESTS</Text>
      {metrics.providers.map((provider) => (
        <ProviderRow
          key={provider.name}
          provider={provider}
        />
      ))}
    </Box>
  );
};

/**
 * Single provider row.
 */
const ProviderRow: React.FC<{ provider: ProviderMetrics['providers'][0] }> = ({ provider }) => {
  const name = provider.name.padEnd(12);
  const statusText = provider.status.padEnd(6);
  const latency = provider.latencyMs !== null ? `${provider.latencyMs}ms` : '—';
  const rate = provider.requestsPerSecond > 0 ? `${provider.requestsPerSecond.toFixed(0)} req/s` : '0 req/s';
  const throttles = String(provider.throttles);
  const requests = formatRequestBreakdown(provider.requestsByStatus);

  const visualWidth = 21;
  const paddingNeeded = 52 - visualWidth;

  const statusIndicator = provider.status === 'ACTIVE' ? pc.green('●') : pc.dim('●');
  const providerCol = `${name} ${statusIndicator} ${statusText}${' '.repeat(paddingNeeded)}`;

  const latencyCol = latency.padEnd(9);
  const rateCol = rate.padEnd(9);
  const throttleCol = throttles.padEnd(11);

  const line = `  ${providerCol} ${latencyCol} ${rateCol} ${throttleCol} ${requests}`;

  return <Text dimColor={provider.status === 'IDLE'}>{line}</Text>;
};

/**
 * Recent activity section.
 */
const RecentActivity: React.FC<{ events: DashboardState['events'] }> = ({ events }) => {
  const MAX_EVENTS = 10;
  const displayEvents = events.slice(-MAX_EVENTS);
  const overflow = events.length - displayEvents.length;

  const header = overflow > 0 ? `RECENT ACTIVITY (${overflow} earlier events)` : 'RECENT ACTIVITY';

  return (
    <Box flexDirection="column">
      <Text>{header}</Text>
      {displayEvents.map((event, idx) => (
        <Text key={idx}>
          {'  '}
          {formatTimestamp(event.timestamp)} {event.icon} {event.message}
        </Text>
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

/**
 * Controls footer.
 */
const Controls: React.FC = () => {
  return <Text>[CTRL+C] Abort</Text>;
};
