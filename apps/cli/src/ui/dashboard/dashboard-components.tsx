/**
 * Dashboard Components - Tree-based operation display
 */

import { performance } from 'node:perf_hooks';

import { Box, Text } from 'ink';
import Spinner from 'ink-spinner';
import React from 'react';

import type {
  DashboardState,
  ImportOperation,
  OperationStatus,
  ProcessingMetadata,
  ProcessingOperation,
  ProviderApiStats,
  StreamState,
  TransientMessage,
} from './dashboard-state.js';

interface DashboardProps {
  state: DashboardState;
}

/**
 * Main Dashboard component
 */
export const Dashboard: React.FC<DashboardProps> = ({ state }) => {
  return (
    <Box flexDirection="column">
      {/* Blank line before first operation */}
      <Text> </Text>

      {/* Account info */}
      {state.account && (
        <AccountLine
          accountId={state.account.id}
          isNewAccount={state.account.isNewAccount}
          transactionCounts={state.account.transactionCounts}
        />
      )}

      {/* Provider readiness */}
      {state.providerReadiness && (
        <Text>
          <Text color="green">✓</Text> {state.providerReadiness.count} providers ready
        </Text>
      )}

      {/* Import operation */}
      {state.import && <ImportSection import={state.import} />}

      {/* Processing operation */}
      {state.processing && <ProcessingSection processing={state.processing} />}

      {/* Completion status */}
      {state.isComplete && <CompletionSection state={state} />}

      {/* API calls footer */}
      <ApiFooter state={state} />
    </Box>
  );
};

/**
 * Account line
 */
const AccountLine: React.FC<{
  accountId: number;
  isNewAccount: boolean;
  transactionCounts?: Map<string, number> | undefined;
}> = ({ accountId, isNewAccount, transactionCounts }) => {
  if (!isNewAccount) {
    // Calculate total transactions
    const totalTransactions = transactionCounts
      ? Array.from(transactionCounts.values()).reduce((sum, count) => sum + count, 0)
      : 0;

    // Format transaction breakdown
    const hasBreakdown = transactionCounts && transactionCounts.size > 0;
    const breakdownParts: React.ReactNode[] = [];

    if (hasBreakdown) {
      // Sort by count descending for consistent display
      const sortedCounts = Array.from(transactionCounts.entries()).sort(([, a], [, b]) => b - a);

      for (const [streamType, count] of sortedCounts) {
        if (breakdownParts.length > 0) {
          breakdownParts.push(<Text key={`sep-${streamType}`}> · </Text>);
        }
        breakdownParts.push(
          <Text key={streamType}>
            {streamType}: {count.toLocaleString()}
          </Text>
        );
      }
    }

    return (
      <Box flexDirection="column">
        <Text>
          <Text color="green">✓</Text> Account #{accountId}{' '}
          <Text dimColor>
            (resuming
            {totalTransactions > 0 && ` · ${totalTransactions.toLocaleString()} transactions`})
          </Text>
        </Text>
        {hasBreakdown && (
          <Text>
            {'  '}
            {breakdownParts}
          </Text>
        )}
      </Box>
    );
  }
  return (
    <Text>
      <Text color="green">✓</Text> Created account #{accountId}
    </Text>
  );
};

function statusIcon(status: OperationStatus): React.ReactNode {
  if (status === 'active') {
    return (
      <Text color="cyan">
        <Spinner type="dots" />
      </Text>
    );
  }
  if (status === 'failed' || status === 'warning') {
    return <Text color="yellow">⚠</Text>;
  }
  return <Text color="green">✓</Text>;
}

/**
 * Import section
 */
const ImportSection: React.FC<{ import: ImportOperation }> = ({ import: importOp }) => {
  const elapsed = importOp.completedAt
    ? importOp.completedAt - importOp.startedAt
    : performance.now() - importOp.startedAt;
  const duration = formatDuration(elapsed);

  let durationText: string;
  if (importOp.completedAt) {
    durationText = `(${duration})`;
  } else {
    durationText = `· ${duration}`;
  }

  return (
    <Box flexDirection="column">
      <Text>
        {statusIcon(importOp.status)} <Text bold>Importing</Text> <Text dimColor>{durationText}</Text>
      </Text>
      {/* Streams */}
      <StreamList streams={importOp.streams} />
    </Box>
  );
};

/**
 * Stream list with tree structure
 */
const StreamList: React.FC<{ streams: Map<string, StreamState> }> = ({ streams }) => {
  const streamArray = Array.from(streams.values());

  return (
    <Box flexDirection="column">
      {streamArray.map((stream, index) => {
        const isLast = index === streamArray.length - 1;
        return (
          <StreamLine
            key={stream.name}
            stream={stream}
            isLast={isLast}
          />
        );
      })}
    </Box>
  );
};

function getStreamStatusText(stream: StreamState): React.ReactNode {
  if (stream.status === 'active' && stream.currentBatch !== undefined) {
    const duration = formatDuration(performance.now() - stream.startedAt);
    return (
      <>
        batch {stream.currentBatch} <Text dimColor>· {duration}</Text>
      </>
    );
  }

  if (stream.status === 'completed') {
    const endTime = stream.completedAt || performance.now();
    const duration = formatDuration(endTime - stream.startedAt);
    return (
      <>
        <Text color="green">{stream.imported} new</Text> <Text dimColor>({duration})</Text>
      </>
    );
  }

  if (stream.status === 'warning' || stream.status === 'failed') {
    const endTime = stream.completedAt || performance.now();
    const duration = formatDuration(endTime - stream.startedAt);
    return (
      <>
        <Text color="yellow">⚠ Failed</Text> <Text dimColor>({duration})</Text>
      </>
    );
  }

  return '';
}

/**
 * Individual stream line
 */
const StreamLine: React.FC<{ isLast: boolean; stream: StreamState }> = ({ stream, isLast }) => {
  const branch = isLast ? '└─' : '├─';
  const statusText = getStreamStatusText(stream);

  return (
    <Box flexDirection="column">
      <Text>
        {'  '}
        <Text dimColor>{branch}</Text> {stream.name}: {statusText}
      </Text>
      {/* Sub-line for active streams */}
      {stream.status === 'active' && <StreamSubLine stream={stream} />}
      {/* Error message for failed streams */}
      {(stream.status === 'warning' || stream.status === 'failed') && stream.errorMessage && (
        <Text>
          {'     '}
          <Text dimColor>└─</Text> {stream.errorMessage}
        </Text>
      )}
    </Box>
  );
};

/**
 * Stream sub-line (provider info)
 */
const StreamSubLine: React.FC<{ stream: StreamState }> = ({ stream }) => {
  // Check for transient message
  if (stream.transientMessage && performance.now() < stream.transientMessage.expiresAt) {
    const msgText = getTransientMessageText(stream.transientMessage);
    return (
      <Text>
        {'     '}
        <Text dimColor>└─</Text> <Text color="green">{stream.imported} imported</Text> · {msgText}
      </Text>
    );
  }

  // Normal provider info
  if (stream.activeProvider && stream.currentRate !== undefined && stream.maxRate !== undefined) {
    const rate = `${stream.currentRate.toFixed(1)}/${stream.maxRate} req/s`;
    return (
      <Text>
        {'     '}
        <Text dimColor>└─</Text> <Text color="green">{stream.imported} imported</Text> ·{' '}
        <Text color="cyan">{stream.activeProvider}</Text> <Text color="cyan">{rate}</Text>
      </Text>
    );
  }

  // Just show imported count if no provider info (CSV imports)
  if (stream.imported > 0) {
    return (
      <Text>
        {'     '}
        <Text dimColor>└─</Text> <Text color="green">{stream.imported} imported</Text>
      </Text>
    );
  }

  return null;
};

function getTransientMessageText(transientMessage: TransientMessage): React.ReactNode {
  if (transientMessage.type === 'backoff') {
    const waitTime = Math.max(0, transientMessage.expiresAt - performance.now());
    return (
      <>
        <Text color="cyan">⏸</Text> waiting {formatWaitTime(waitTime)} (rate limit)
      </>
    );
  }

  return <Text color="cyan">{transientMessage.text}</Text>;
}

/**
 * Processing section — progress, token metadata with live provider/rate, scam summary.
 * Three distinct views: empty (totalRaw=0), CSV (no metadata events), full blockchain.
 */
const ProcessingSection: React.FC<{ processing: ProcessingOperation }> = ({ processing }) => {
  const duration = processing.completedAt
    ? formatDuration(processing.completedAt - processing.startedAt)
    : formatDuration(performance.now() - processing.startedAt);
  const durationText = processing.completedAt ? `(${duration})` : `· ${duration}`;
  const isComplete = processing.status !== 'active';

  // Empty: nothing to process
  if (processing.totalRaw === 0) {
    return (
      <Box flexDirection="column">
        <Text>
          {statusIcon(processing.status)} <Text bold>Processing</Text> <Text dimColor>{durationText}</Text>
        </Text>
        <Text>
          {'  '}
          <Text dimColor>└─</Text> No transactions to process
        </Text>
      </Box>
    );
  }

  // CSV / simple: no metadata events fired, show single summary on completion
  if (!processing.metadata && isComplete) {
    return (
      <Box flexDirection="column">
        <Text>
          {statusIcon(processing.status)} <Text bold>Processing</Text> <Text dimColor>{durationText}</Text>
        </Text>
        <Text>
          {'  '}
          <Text dimColor>└─</Text> {processing.totalProcessed ?? processing.processed}{' '}
          <Text dimColor>transactions enriched</Text>
        </Text>
      </Box>
    );
  }

  // Full view: progress + optional metadata + optional scams
  const hasMetadata = processing.metadata !== undefined;
  const hasScams = processing.scams !== undefined && processing.scams.total > 0;
  const progressIsLast = !hasMetadata && !hasScams;
  const metadataIsLast = hasMetadata && !hasScams;

  return (
    <Box flexDirection="column">
      <Text>
        {statusIcon(processing.status)} <Text bold>Processing</Text> <Text dimColor>{durationText}</Text>
      </Text>

      {/* Progress line: live counter while active, raw→transactions on completion */}
      <Text>
        {'  '}
        <Text dimColor>{progressIsLast ? '└─' : '├─'}</Text>{' '}
        {isComplete ? (
          <>
            <Text color="green">{processing.totalRaw}</Text> <Text dimColor>raw →</Text>{' '}
            <Text color="green">{processing.totalProcessed ?? processing.processed}</Text>{' '}
            <Text dimColor>transactions</Text>
          </>
        ) : (
          <>
            <Text color="green">{processing.processed}</Text> / <Text color="green">{processing.totalRaw}</Text>{' '}
            <Text dimColor>raw transactions</Text>
          </>
        )}
      </Text>

      {/* Token metadata: live provider/rate while fetching, hit rate on completion */}
      {hasMetadata && (
        <ProcessingMetadataLine
          metadata={processing.metadata!}
          isLast={metadataIsLast}
          isComplete={isComplete}
        />
      )}

      {/* Scam tokens summary */}
      {hasScams && (
        <Text>
          {'  '}
          <Text dimColor>└─</Text> <Text color="yellow">⚠</Text>{' '}
          <Text color="yellow">{processing.scams!.total} scam tokens</Text>{' '}
          <Text dimColor>({processing.scams!.exampleSymbols.join(', ')})</Text>
        </Text>
      )}
    </Box>
  );
};

/**
 * Token metadata sub-line: cached/fetched counts with live provider/rate or hit rate on completion.
 * Mirrors the transient message pattern used by import stream sub-lines.
 * Provider/rate omitted entirely when fetched === 0 (all cached).
 */
const ProcessingMetadataLine: React.FC<{
  isComplete: boolean;
  isLast: boolean;
  metadata: ProcessingMetadata;
}> = ({ metadata, isLast, isComplete }) => {
  const branch = isLast ? '└─' : '├─';
  const suffixText = calculateMetadataSuffix(metadata, isComplete);

  return (
    <Text>
      {'  '}
      <Text dimColor>{branch}</Text> <Text dimColor>Token metadata:</Text>{' '}
      <Text color="green">{metadata.cached} cached</Text>
      {metadata.fetched > 0 && (
        <>
          <Text dimColor>, </Text>
          <Text color="cyan">{metadata.fetched} fetched</Text>
        </>
      )}
      {suffixText}
    </Text>
  );
};

function calculateMetadataSuffix(metadata: ProcessingMetadata, isComplete: boolean): React.ReactNode {
  if (isComplete && metadata.fetched > 0) {
    const total = metadata.cached + metadata.fetched;
    const hitRate = Math.round((metadata.cached / total) * 100);
    return <Text dimColor> ({hitRate}% cached)</Text>;
  }

  if (!isComplete && metadata.fetched > 0) {
    const hasTransientMessage = metadata.transientMessage && performance.now() < metadata.transientMessage.expiresAt;

    if (hasTransientMessage) {
      if (metadata.transientMessage!.type === 'backoff') {
        const waitTime = Math.max(0, metadata.transientMessage!.expiresAt - performance.now());
        return (
          <>
            {' · '}
            <Text color="cyan">⏸</Text> waiting {formatWaitTime(waitTime)} (rate limit)
          </>
        );
      }

      return (
        <>
          {' · '}
          <Text color="cyan">{metadata.transientMessage!.text}</Text>
        </>
      );
    }

    const hasProviderInfo =
      metadata.activeProvider && metadata.currentRate !== undefined && metadata.maxRate !== undefined;

    if (hasProviderInfo) {
      return (
        <>
          {' · '}
          <Text color="cyan">{metadata.activeProvider}</Text>{' '}
          <Text color="cyan">
            {metadata.currentRate!.toFixed(1)}/{metadata.maxRate} req/s
          </Text>
        </>
      );
    }
  }

  return null;
}

/**
 * Check if provider is active (called within last 2 seconds)
 */
function isProviderActive(stats: ProviderApiStats): boolean {
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
function renderLiveCounts(stats: ProviderApiStats): React.ReactNode {
  const parts: React.ReactNode[] = [];

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
function renderFinalBreakdown(stats: ProviderApiStats): React.ReactNode {
  const parts: React.ReactNode[] = [];

  if (stats.okCount > 0) {
    parts.push(
      <React.Fragment key="ok">
        <Text color="green">{stats.okCount} ok</Text>
        <Text dimColor> (200)</Text>
      </React.Fragment>
    );
  }

  if (stats.throttledCount > 0) {
    if (parts.length > 0) parts.push(<Text key="sep1"> · </Text>);
    parts.push(
      <React.Fragment key="throttled">
        <Text color="yellow">{stats.throttledCount} throttled</Text>
        <Text dimColor> (429)</Text>
      </React.Fragment>
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
      <React.Fragment key="err">
        <Text color="red">{stats.failed} err</Text>
        {errorCode && <Text dimColor> ({errorCode})</Text>}
      </React.Fragment>
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
 * API calls footer
 */
const ApiFooter: React.FC<{ state: DashboardState }> = ({ state }) => {
  const { total, byProvider } = state.apiCalls;

  // Don't show if no API calls (CSV imports)
  if (total === 0) {
    return null;
  }

  const terminalWidth = process.stdout.columns || 120;

  return (
    <Box flexDirection="column">
      <Text> </Text>
      <Text dimColor>{'─'.repeat(terminalWidth)}</Text>

      {/* Live view (during import) */}
      {!state.isComplete && (
        <ApiFooterLive
          total={total}
          byProvider={byProvider}
        />
      )}

      {/* Final view (after completion) */}
      {state.isComplete && (
        <ApiFooterFinal
          total={total}
          byProvider={byProvider}
          overallDurationMs={state.totalDurationMs}
        />
      )}
      <Text> </Text>
    </Box>
  );
};

/**
 * Live API footer (during import) - Tabular format with active/idle status
 */
const ApiFooterLive: React.FC<{ byProvider: Map<string, ProviderApiStats>; total: number }> = ({
  total,
  byProvider,
}) => {
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
            <Text>{truncateProvider(name, 12).padEnd(12)}</Text>
            <Text>{'  '}</Text>
            {isActive ? (
              <>
                <Text color="green">●</Text>
                <Text> </Text>
                <Text color="cyan">{statusRate.padEnd(17)}</Text>
              </>
            ) : (
              <Text dimColor>{statusRate.padEnd(18)}</Text>
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
const ApiFooterFinal: React.FC<{
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
        const callsText = stats.total > 0 ? `${stats.total} call${stats.total !== 1 ? 's' : ''}` : '0 calls';
        const breakdown = renderFinalBreakdown(stats);

        return (
          <Box key={name}>
            {!singleProvider && <Text>{'  '}</Text>}
            <Text>{truncateProvider(name, 12).padEnd(12)}</Text>
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

/**
 * Completion section - shows final status (Done/Warnings/Aborted)
 */
const CompletionSection: React.FC<{ state: DashboardState }> = ({ state }) => {
  const duration = state.totalDurationMs ? formatDuration(state.totalDurationMs) : '';
  const hasWarnings = state.warnings.length > 0;
  const errorMessage = state.errorMessage;

  if (errorMessage) {
    return (
      <Box flexDirection="column">
        <Text> </Text>
        <Text>
          <Text color="yellow">⚠</Text> Failed {duration && <Text dimColor>({duration})</Text>}
        </Text>
        <Text dimColor>{errorMessage}</Text>
      </Box>
    );
  }

  // Aborted (Ctrl-C or error)
  if (state.aborted) {
    return (
      <Box flexDirection="column">
        <Text> </Text>
        <Text>
          <Text color="yellow">⚠</Text> Aborted {duration && <Text dimColor>({duration})</Text>}
        </Text>
      </Box>
    );
  }

  // Completed with warnings
  if (hasWarnings) {
    const count = state.warnings.length;
    const plural = count === 1 ? 'warning' : 'warnings';

    return (
      <Box flexDirection="column">
        <Text> </Text>
        <Text>
          <Text color="yellow">⚠</Text> Completed with <Text color="yellow">{count}</Text> {plural}{' '}
          {duration && <Text dimColor>({duration})</Text>}
        </Text>
        {state.warnings.map((warning, index) => (
          <Text key={index}> {warning.message}</Text>
        ))}
      </Box>
    );
  }

  // Success
  return (
    <Box flexDirection="column">
      <Text> </Text>
      <Text>
        <Text color="green">✓</Text> Done {duration && <Text dimColor>({duration})</Text>}
      </Text>
    </Box>
  );
};

function formatWaitTime(ms: number): string {
  if (ms < 1000) {
    return `${ms.toFixed(0)}ms`;
  }
  return `${(ms / 1000).toFixed(1)}s`;
}

function formatDuration(ms: number): string {
  if (ms < 1000) {
    return `${ms.toFixed(0)}ms`;
  }

  if (ms < 60000) {
    const seconds = ms / 1000;
    return `${seconds.toFixed(1)}s`;
  }

  const minutes = Math.floor(ms / 60000);
  const seconds = Math.floor((ms % 60000) / 1000);
  return `${minutes}m ${seconds}s`;
}
