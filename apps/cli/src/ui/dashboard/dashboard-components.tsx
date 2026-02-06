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
      {/* Provider readiness */}
      {state.providerReadiness && (
        <Text>
          ✓ {state.providerReadiness.count} providers ready ({formatDuration(state.providerReadiness.durationMs)})
        </Text>
      )}

      {/* Account info */}
      {state.account && (
        <AccountLine
          accountId={state.account.id}
          isResuming={state.account.isResuming}
        />
      )}

      {/* Import operation */}
      {state.import && <ImportSection import={state.import} />}

      {/* Processing operation */}
      {state.processing && <ProcessingSection processing={state.processing} />}

      {/* API calls footer */}
      <ApiFooter state={state} />

      {/* Warnings */}
      {state.warnings.length > 0 && <WarningsSection state={state} />}
    </Box>
  );
};

/**
 * Account line
 */
const AccountLine: React.FC<{ accountId: number; isResuming: boolean }> = ({ accountId, isResuming }) => {
  if (isResuming) {
    return <Text>✓ Account #{accountId} (resuming from previous import)</Text>;
  }
  return <Text>✓ Account #{accountId}</Text>;
};

function statusIcon(status: OperationStatus): React.ReactNode {
  if (status === 'active') {
    return <Spinner type="dots" />;
  }
  if (status === 'failed' || status === 'warning') {
    return '⚠';
  }
  return '✓';
}

/**
 * Import section
 */
const ImportSection: React.FC<{ import: ImportOperation }> = ({ import: importOp }) => {
  const elapsed = importOp.completedAt
    ? importOp.completedAt - importOp.startedAt
    : performance.now() - importOp.startedAt;
  const duration = formatDuration(elapsed);
  const durationText = importOp.completedAt ? `(${duration})` : `· ${duration}`;

  return (
    <Box flexDirection="column">
      <Text>
        {statusIcon(importOp.status)} Import {durationText}
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

function getStreamStatusText(stream: StreamState): string {
  if (stream.status === 'active' && stream.currentBatch !== undefined) {
    const duration = formatDuration(performance.now() - stream.startedAt);
    return `batch ${stream.currentBatch} · ${duration}`;
  }

  if (stream.status === 'completed') {
    const duration = formatDuration((stream.completedAt || performance.now()) - stream.startedAt);
    return `${stream.imported} new (${duration})`;
  }

  if (stream.status === 'warning' || stream.status === 'failed') {
    const duration = formatDuration((stream.completedAt || performance.now()) - stream.startedAt);
    return `⚠ Failed (${duration})`;
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
        {branch} {stream.name}: {statusText}
      </Text>
      {/* Sub-line for active streams */}
      {stream.status === 'active' && <StreamSubLine stream={stream} />}
      {/* Error message for failed streams */}
      {(stream.status === 'warning' || stream.status === 'failed') && stream.errorMessage && (
        <Text>
          {'     '}└─ {stream.errorMessage}
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
        {'     '}└─ {stream.imported} imported · {msgText}
      </Text>
    );
  }

  // Normal provider info
  if (stream.activeProvider && stream.currentRate !== undefined && stream.maxRate !== undefined) {
    const rate = `${stream.currentRate.toFixed(1)}/${stream.maxRate} req/s`;
    return (
      <Text>
        {'     '}└─ {stream.imported} imported · {stream.activeProvider} {rate}
      </Text>
    );
  }

  // Just show imported count if no provider info (CSV imports)
  if (stream.imported > 0) {
    return (
      <Text>
        {'     '}└─ {stream.imported} imported
      </Text>
    );
  }

  return null;
};

function getTransientMessageText(transientMessage: TransientMessage): string {
  if (transientMessage.type === 'backoff') {
    const waitTime = Math.max(0, transientMessage.expiresAt - performance.now());
    return `⏸ waiting ${formatWaitTime(waitTime)} (rate limit)`;
  }
  return transientMessage.text;
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
          {statusIcon(processing.status)} Processing {durationText}
        </Text>
        <Text>{'  '}└─ No transactions to process</Text>
      </Box>
    );
  }

  // CSV / simple: no metadata events fired, show single summary on completion
  if (!processing.metadata && isComplete) {
    return (
      <Box flexDirection="column">
        <Text>
          {statusIcon(processing.status)} Processing {durationText}
        </Text>
        <Text>
          {'  '}└─ {processing.totalProcessed ?? processing.processed} transactions enriched
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
        {statusIcon(processing.status)} Processing {durationText}
      </Text>

      {/* Progress line: live counter while active, raw→transactions on completion */}
      <Text>
        {'  '}
        {progressIsLast ? '└─' : '├─'}{' '}
        {isComplete
          ? `${processing.totalRaw} raw → ${processing.totalProcessed ?? processing.processed} transactions`
          : `${processing.processed} / ${processing.totalRaw} raw transactions`}
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
          {'  '}└─ ⚠ {processing.scams!.total} scam tokens ({processing.scams!.exampleSymbols.join(', ')})
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
  const countsText =
    metadata.fetched > 0 ? `${metadata.cached} cached, ${metadata.fetched} fetched` : `${metadata.cached} cached`;

  const suffixText = calculateMetadataSuffix(metadata, isComplete);

  return (
    <Text>
      {'  '}
      {branch} Token metadata: {countsText}
      {suffixText}
    </Text>
  );
};

function calculateMetadataSuffix(metadata: ProcessingMetadata, isComplete: boolean): string {
  if (isComplete && metadata.fetched > 0) {
    const total = metadata.cached + metadata.fetched;
    const hitRate = Math.round((metadata.cached / total) * 100);
    return ` (${hitRate}% cached)`;
  }

  if (!isComplete && metadata.fetched > 0) {
    if (metadata.transientMessage && performance.now() < metadata.transientMessage.expiresAt) {
      if (metadata.transientMessage.type === 'backoff') {
        const waitTime = Math.max(0, metadata.transientMessage.expiresAt - performance.now());
        return ` · ⏸ waiting ${formatWaitTime(waitTime)} (rate limit)`;
      }
      return ` · ${metadata.transientMessage.text}`;
    }

    if (metadata.activeProvider && metadata.currentRate !== undefined && metadata.maxRate !== undefined) {
      return ` · ${metadata.activeProvider} ${metadata.currentRate.toFixed(1)}/${metadata.maxRate} req/s`;
    }
  }

  return '';
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
        />
      )}
    </Box>
  );
};

/**
 * Live API footer (during import)
 */
const ApiFooterLive: React.FC<{ byProvider: Map<string, ProviderApiStats>; total: number }> = ({
  total,
  byProvider,
}) => {
  const providers = Array.from(byProvider.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([name, stats]) => {
      const details: string[] = [];
      if (stats.retries > 0) details.push(`${stats.retries} retries`);
      if (stats.rateLimited > 0) details.push(`${stats.rateLimited} rate-limited`);
      if (stats.failed > 0) details.push(`${stats.failed} failed`);

      return details.length > 0 ? `${name}: ${stats.total} (${details.join(', ')})` : `${name}: ${stats.total}`;
    })
    .join(', ');

  return (
    <Text>
      API Calls: {total} · {providers}
    </Text>
  );
};

/**
 * Final API footer (after completion)
 */
const ApiFooterFinal: React.FC<{ byProvider: Map<string, ProviderApiStats>; total: number }> = ({
  total,
  byProvider,
}) => {
  const providerArray = Array.from(byProvider.entries()).sort(([a], [b]) => a.localeCompare(b));

  return (
    <Box flexDirection="column">
      <Text>API Calls: {total} total</Text>
      {providerArray.map(([name, stats], index) => {
        const isLast = index === providerArray.length - 1;
        const branch = isLast ? '└─' : '├─';

        // Get response breakdown
        const responses = Array.from(stats.responsesByStatus.entries()).sort(([a], [b]) => {
          // Sort by priority: 200, 429, 500+, others
          const priority = (code: number) => {
            if (code === 200) return 0;
            if (code === 429) return 1;
            if (code >= 500) return 2;
            return 3;
          };
          return priority(a) - priority(b) || a - b;
        });

        const hasDetails = stats.retries > 0 || responses.length > 1;

        return (
          <Box
            key={name}
            flexDirection="column"
          >
            <Text>
              {'  '}
              {branch} {name}: {stats.total} calls
            </Text>
            {hasDetails && (
              <Box flexDirection="column">
                {/* Response breakdown */}
                {responses.map(([status, count], idx) => {
                  const isLastResponse = idx === responses.length - 1 && stats.retries === 0;
                  const subBranch = isLastResponse ? '└─' : '├─';
                  const label = statusLabel(status);

                  return (
                    <Text key={status}>
                      {'  │  '}
                      {subBranch} {label}: {count} ({status})
                    </Text>
                  );
                })}
                {/* Retries */}
                {stats.retries > 0 && (
                  <Text>
                    {'  │  '}└─ Retries: {stats.retries}
                  </Text>
                )}
              </Box>
            )}
          </Box>
        );
      })}
    </Box>
  );
};

/**
 * Warnings section
 */
const WarningsSection: React.FC<{ state: DashboardState }> = ({ state }) => {
  if (state.warnings.length === 0) return null;

  const count = state.warnings.length;
  const plural = count === 1 ? 'warning' : 'warnings';
  const duration = state.totalDurationMs ? formatDuration(state.totalDurationMs) : '';

  return (
    <Box flexDirection="column">
      <Text>
        ⚠ Completed with {count} {plural} {duration && `(${duration} total)`}
      </Text>
      {state.warnings.map((warning, index) => (
        <Text key={index}> {warning.message}</Text>
      ))}
    </Box>
  );
};

function statusLabel(code: number): string {
  if (code === 200) return 'OK';
  if (code === 429) return 'Rate Limited';
  return 'Error';
}

function formatWaitTime(ms: number): string {
  if (ms < 1000) {
    return `${ms.toFixed(0)}ms`;
  }
  return `${(ms / 1000).toFixed(1)}s`;
}

function formatDuration(ms: number): string {
  if (ms < 1000) {
    return `${ms.toFixed(0)}ms`;
  } else if (ms < 60000) {
    const seconds = ms / 1000;
    return `${seconds.toFixed(1)}s`;
  } else {
    const minutes = Math.floor(ms / 60000);
    const seconds = Math.floor((ms % 60000) / 1000);
    return `${minutes}m ${seconds}s`;
  }
}
