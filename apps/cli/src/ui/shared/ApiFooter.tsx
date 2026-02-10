/**
 * API Footer Component - Shared tabular display of API call metrics
 *
 * Displays per-provider API call statistics with two views:
 * - Live view: Active/idle status, current rate, live counts
 * - Final view: Average rate, total calls, response breakdown with status codes
 *
 * Used by both ingestion dashboard and prices enrich command.
 */

import { Box, Text } from 'ink';
import { Fragment, type FC, type ReactNode } from 'react';

import type { ProviderApiStats } from './api-stats-types.js';

interface ApiFooterProps {
  /** Total API calls across all providers */
  total: number;
  /** Per-provider statistics */
  byProvider: Map<string, ProviderApiStats>;
  /** Whether operation is complete (switches to final view) */
  isComplete: boolean;
  /** Overall operation duration (for final view rate calculations) */
  overallDurationMs?: number | undefined;
}

/**
 * Check if provider is active (has in-flight requests or called within last 2 seconds)
 */
function isProviderActive(stats: ProviderApiStats): boolean {
  // Active if there are in-flight requests (even during long-running calls)
  if (stats.inFlightCount > 0) return true;
  // Or if recently completed a call
  if (stats.lastCallTime === 0) return false;
  return Date.now() - stats.lastCallTime < 2000;
}

/**
 * Calculate average latency
 */
function avgLatency(stats: ProviderApiStats): number {
  if (stats.latencies.length === 0) return 0;
  return stats.latencies.reduce((sum, lat) => sum + lat, 0) / stats.latencies.length;
}

/**
 * Format latency for display
 */
function formatLatency(stats: ProviderApiStats): string {
  if (stats.latencies.length === 0) return '—';
  return `${Math.round(avgLatency(stats))}ms`;
}

/**
 * Format status and rate for live view
 */
function formatLiveStatusRate(stats: ProviderApiStats, isActive: boolean): string {
  if (!isActive) {
    return '○ idle';
  }

  if (stats.currentRate !== undefined) {
    return `${stats.currentRate.toFixed(1)} req/s`;
  }

  return '— req/s';
}

/**
 * Render counts for live view with colors
 */
function renderLiveCounts(stats: ProviderApiStats): ReactNode {
  const parts: ReactNode[] = [];

  if (stats.okCount > 0) {
    parts.push(
      <Text
        key="ok"
        color="green"
      >
        {stats.okCount} ok
      </Text>
    );
  }

  if (stats.throttledCount > 0) {
    if (parts.length > 0) parts.push(<Text key="sep1"> · </Text>);
    parts.push(
      <Text
        key="throttled"
        color="yellow"
      >
        {stats.throttledCount} throttled
      </Text>
    );
  }

  if (stats.failed > 0) {
    if (parts.length > 0) parts.push(<Text key="sep2"> · </Text>);
    parts.push(
      <Text
        key="err"
        color="red"
      >
        {stats.failed} err
      </Text>
    );
  }

  return <>{parts}</>;
}

/**
 * Format average rate for final view
 */
function formatAvgRate(stats: ProviderApiStats, overallDurationMs?: number): string {
  if (stats.total === 0 || stats.startTime === 0) {
    return '—';
  }

  let durationSeconds = (stats.lastCallTime - stats.startTime) / 1000;

  if (durationSeconds === 0 && overallDurationMs && overallDurationMs > 0) {
    durationSeconds = overallDurationMs / 1000;
  }

  if (durationSeconds === 0) {
    return '—';
  }

  const avgRate = stats.total / durationSeconds;
  return `${avgRate.toFixed(1)} req/s`;
}

/**
 * Render breakdown for final view with colors
 */
function renderFinalBreakdown(stats: ProviderApiStats): ReactNode {
  const parts: ReactNode[] = [];

  if (stats.okCount > 0) {
    parts.push(
      <Fragment key="ok">
        <Text color="green">{stats.okCount} ok</Text>
        <Text dimColor> (200)</Text>
      </Fragment>
    );
  }

  if (stats.throttledCount > 0) {
    if (parts.length > 0) parts.push(<Text key="sep1"> · </Text>);
    parts.push(
      <Fragment key="throttled">
        <Text color="yellow">{stats.throttledCount} throttled</Text>
        <Text dimColor> (429)</Text>
      </Fragment>
    );
  }

  if (stats.retries > 0) {
    if (parts.length > 0) parts.push(<Text key="sep2"> · </Text>);
    parts.push(
      <Text
        key="retries"
        color="yellow"
      >
        {stats.retries} retries
      </Text>
    );
  }

  if (stats.failed > 0) {
    if (parts.length > 0) parts.push(<Text key="sep3"> · </Text>);
    const errorCode = getErrorStatusCode(stats);
    parts.push(
      <Fragment key="err">
        <Text color="red">{stats.failed} err</Text>
        {errorCode && <Text dimColor> ({errorCode})</Text>}
      </Fragment>
    );
  }

  return parts.length > 0 ? <>{parts}</> : null;
}

/**
 * Get representative error status code
 */
function getErrorStatusCode(stats: ProviderApiStats): number | null {
  // Find first error status code (>= 400, not 429)
  for (const [code, _count] of stats.responsesByStatus.entries()) {
    if (code >= 400 && code !== 429) {
      return code;
    }
  }
  return null;
}

/**
 * Truncate provider name to max length
 */
function truncateProvider(name: string, maxLen: number): string {
  if (name.length <= maxLen) return name;
  return name.slice(0, maxLen - 1) + '…';
}

/**
 * API calls footer - switches between live and final views
 */
export const ApiFooter: FC<ApiFooterProps> = ({ total, byProvider, isComplete, overallDurationMs }) => {
  // Don't show if no API calls (CSV imports)
  if (total === 0) {
    return null;
  }

  const terminalWidth = process.stdout.columns || 120;

  return (
    <Box flexDirection="column">
      <Text> </Text>
      <Text dimColor>{'─'.repeat(terminalWidth)}</Text>

      {/* Live view (during operation) */}
      {!isComplete && (
        <ApiFooterLive
          total={total}
          byProvider={byProvider}
        />
      )}

      {/* Final view (after completion) */}
      {isComplete && (
        <ApiFooterFinal
          total={total}
          byProvider={byProvider}
          overallDurationMs={overallDurationMs}
        />
      )}
      <Text> </Text>
    </Box>
  );
};

/**
 * Live API footer (during operation) - Tabular format with active/idle status
 */
const ApiFooterLive: FC<{ byProvider: Map<string, ProviderApiStats>; total: number }> = ({ total, byProvider }) => {
  const providers = Array.from(byProvider.entries()).sort(([a], [b]) => a.localeCompare(b));
  const singleProvider = providers.length === 1;

  return (
    <Box flexDirection="column">
      {!singleProvider && (
        <Text>
          {total} API call{total !== 1 ? 's' : ''}
        </Text>
      )}
      {providers.map(([name, stats]) => {
        const isActive = isProviderActive(stats);
        const statusRate = formatLiveStatusRate(stats, isActive);
        const latency = formatLatency(stats);

        return (
          <Box key={name}>
            {!singleProvider && <Text>{'  '}</Text>}
            <Text>{truncateProvider(name, 14).padEnd(14)}</Text>
            <Text>{'  '}</Text>
            {isActive ? (
              <>
                <Text color="green">●</Text>
                <Text> </Text>
                <Text color="cyan">{statusRate.padEnd(17)}</Text>
              </>
            ) : (
              <Text dimColor>{statusRate.padEnd(19)}</Text>
            )}
            <Text>{'  '}</Text>
            <Text dimColor>{latency.padStart(6)}</Text>
            <Text>{'   '}</Text>
            {stats.total === 0 ? <Text dimColor>0</Text> : renderLiveCounts(stats)}
          </Box>
        );
      })}
    </Box>
  );
};

/**
 * Final API footer (after completion) - Tabular format with avg stats
 */
const ApiFooterFinal: FC<{
  byProvider: Map<string, ProviderApiStats>;
  overallDurationMs?: number | undefined;
  total: number;
}> = ({ total, byProvider, overallDurationMs }) => {
  const providers = Array.from(byProvider.entries()).sort(([a], [b]) => a.localeCompare(b));
  const singleProvider = providers.length === 1;

  return (
    <Box flexDirection="column">
      {!singleProvider && (
        <Text>
          {total} API call{total !== 1 ? 's' : ''}
        </Text>
      )}
      {providers.map(([name, stats]) => {
        const avgRate = formatAvgRate(stats, overallDurationMs);
        const latency = formatLatency(stats);
        const callsText = (stats.total > 0 ? `${stats.total} call${stats.total !== 1 ? 's' : ''}` : '0 calls').padEnd(
          8
        );
        const breakdown = renderFinalBreakdown(stats);

        return (
          <Box key={name}>
            {!singleProvider && <Text>{'  '}</Text>}
            <Text>{truncateProvider(name, 14).padEnd(14)}</Text>
            <Text>{'  '}</Text>
            {stats.total === 0 ? (
              <Text dimColor>{'—'.padEnd(18)}</Text>
            ) : (
              <Text color="cyan">{avgRate.padEnd(18)}</Text>
            )}
            <Text>{'  '}</Text>
            <Text dimColor>{latency.padStart(6)}</Text>
            <Text>{'   '}</Text>
            {stats.total === 0 ? (
              <Text dimColor>{callsText}</Text>
            ) : (
              <>
                <Text>{callsText}</Text>
                {breakdown && (
                  <>
                    <Text>{'   '}</Text>
                    {breakdown}
                  </>
                )}
              </>
            )}
          </Box>
        );
      })}
    </Box>
  );
};
