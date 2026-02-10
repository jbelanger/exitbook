/**
 * Dashboard Components - Tree-based operation display
 */

import { performance } from 'node:perf_hooks';

import type { BlockchainProviderManager } from '@exitbook/blockchain-providers';
import type { InstrumentationCollector } from '@exitbook/http';
import { Box, Text } from 'ink';
import { type FC, type ReactNode, useEffect, useLayoutEffect, useReducer } from 'react';

import {
  ApiFooter,
  type EventRelay,
  formatDuration,
  formatWaitTime,
  type LifecycleBridge,
  type OperationStatus,
  statusIcon,
} from '../../../ui/shared/index.js';

import {
  createIngestionMonitorState,
  type DerivationOperation,
  type ImportOperation,
  type IngestionMonitorState,
  type ProcessingMetadata,
  type ProcessingOperation,
  type StreamState,
  type TransientMessage,
  type XpubImportWrapper,
} from './ingestion-monitor-state.js';
import { type CliEvent, ingestionMonitorReducer } from './ingestion-monitor-updater.js';

const REFRESH_INTERVAL_MS = 250;

// --- Hook ---

function useIngestionMonitorState(
  relay: EventRelay<CliEvent>,
  instrumentation: InstrumentationCollector,
  providerManager: BlockchainProviderManager,
  lifecycle: LifecycleBridge
): IngestionMonitorState {
  const [state, dispatch] = useReducer(ingestionMonitorReducer, undefined, createIngestionMonitorState);

  // Connect to the event relay (replays any buffered events, then forwards new ones).
  // Also register lifecycle callbacks for synchronous abort/fail dispatch.
  useLayoutEffect(() => {
    lifecycle.onAbort = () => dispatch({ type: 'abort' });
    lifecycle.onFail = (errorMessage: string) => dispatch({ type: 'fail', errorMessage });

    const disconnect = relay.connect((event: CliEvent) => {
      dispatch({ type: 'event', event, instrumentation, providerManager });
    });

    return () => {
      lifecycle.onAbort = undefined;
      lifecycle.onFail = undefined;
      disconnect();
    };
  }, [relay, lifecycle, instrumentation, providerManager]);

  // Periodic refresh for elapsed times and transient messages
  useEffect(() => {
    const timer = setInterval(() => {
      dispatch({ type: 'tick' });
    }, REFRESH_INTERVAL_MS);
    return () => clearInterval(timer);
  }, []);

  return state;
}

// --- Components ---

interface IngestionMonitorProps {
  instrumentation: InstrumentationCollector;
  lifecycle: LifecycleBridge;
  providerManager: BlockchainProviderManager;
  relay: EventRelay<CliEvent>;
}

/**
 * Main ingestion monitor component
 */
export const IngestionMonitor: FC<IngestionMonitorProps> = ({ relay, instrumentation, providerManager, lifecycle }) => {
  const state = useIngestionMonitorState(relay, instrumentation, providerManager, lifecycle);

  return (
    <Box flexDirection="column">
      {/* Blank line before first operation */}
      <Text> </Text>

      {/* Account info */}
      {state.account && (
        <AccountLine
          accountId={state.account.id}
          isNewAccount={state.account.isNewAccount}
          isXpubParent={state.account.isXpubParent}
          childAccountCount={state.account.childAccountCount}
          transactionCounts={state.account.transactionCounts}
        />
      )}

      {/* Provider readiness */}
      {state.providerReadiness && (
        <Text>
          <Text color="green">✓</Text> {state.providerReadiness.count} providers ready
        </Text>
      )}

      {/* Derivation operation (xpub only) */}
      {state.derivation && <DerivationSection derivation={state.derivation} />}

      {/* Import operation */}
      {state.import && (
        <ImportSection
          import={state.import}
          xpubImport={state.xpubImport}
        />
      )}

      {/* Processing operation */}
      {state.processing && <ProcessingSection processing={state.processing} />}

      {/* Completion status */}
      {state.isComplete && <CompletionSection state={state} />}

      {/* API calls footer */}
      <ApiFooter
        total={state.apiCalls.total}
        byProvider={state.apiCalls.byProvider}
        isComplete={state.isComplete}
        overallDurationMs={state.totalDurationMs}
      />
    </Box>
  );
};

/**
 * Derivation operation section (xpub only)
 */
const DerivationSection: FC<{ derivation: DerivationOperation }> = ({ derivation }) => {
  const elapsed = derivation.completedAt
    ? derivation.completedAt - derivation.startedAt
    : performance.now() - derivation.startedAt;
  const duration = formatDuration(elapsed);

  const actionText = derivation.isRederivation ? 'Re-deriving addresses' : 'Deriving addresses';
  let gapText = '';
  if (derivation.isRederivation) {
    gapText = ` (gap increased: ${derivation.previousGap ?? '—'} → ${derivation.gapLimit})`;
  }

  if (derivation.status === 'active') {
    return (
      <Text>
        {statusIcon('active')} <Text bold>{actionText}</Text>
        {gapText} <Text dimColor>· {duration}</Text>
      </Text>
    );
  }

  if (derivation.status === 'completed') {
    let countText = `${derivation.derivedCount} addresses`;
    if (derivation.newCount !== undefined) {
      countText = `${derivation.derivedCount} addresses (${derivation.newCount} new)`;
    }

    return (
      <Text>
        {statusIcon('completed')} Derived {countText} <Text dimColor>({duration})</Text>
      </Text>
    );
  }

  return null;
};

/**
 * Account line
 */
const AccountLine: FC<{
  accountId: number;
  childAccountCount?: number | undefined;
  isNewAccount: boolean;
  isXpubParent?: boolean | undefined;
  transactionCounts?: Map<string, number> | undefined;
}> = ({ accountId, isNewAccount, isXpubParent, childAccountCount, transactionCounts }) => {
  // Xpub parent account
  if (isXpubParent) {
    if (isNewAccount) {
      return (
        <Text>
          <Text color="green">✓</Text> Created parent account #{accountId} <Text dimColor>(xpub)</Text>
        </Text>
      );
    }

    // Resuming xpub
    const totalTransactions = transactionCounts
      ? Array.from(transactionCounts.values()).reduce((sum, count) => sum + count, 0)
      : 0;

    return (
      <Box flexDirection="column">
        <Text>
          <Text color="green">✓</Text> Account #{accountId} <Text dimColor>(xpub · resuming)</Text>
        </Text>
        {childAccountCount && (
          <Text>
            {'  '}
            Reusing {childAccountCount} existing child accounts
          </Text>
        )}
        {totalTransactions > 0 && (
          <Text>
            {'  '}
            {totalTransactions.toLocaleString()} transactions
          </Text>
        )}
        {transactionCounts && transactionCounts.size > 0 && (
          <Text>
            {'    '}
            {Array.from(transactionCounts.entries())
              .sort(([, a], [, b]) => b - a)
              .map(([streamType, count]) => `${streamType}: ${count.toLocaleString()}`)
              .join(' · ')}
          </Text>
        )}
      </Box>
    );
  }

  // Normal account (non-xpub)
  if (!isNewAccount) {
    // Calculate total transactions
    const totalTransactions = transactionCounts
      ? Array.from(transactionCounts.values()).reduce((sum, count) => sum + count, 0)
      : 0;

    // Format transaction breakdown
    const hasBreakdown = transactionCounts && transactionCounts.size > 0;
    const breakdownParts: ReactNode[] = [];

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

/**
 * Import section
 */
const ImportSection: FC<{ import: ImportOperation; xpubImport?: XpubImportWrapper | undefined }> = ({
  import: importOp,
  xpubImport,
}) => {
  const elapsed = importOp.completedAt
    ? importOp.completedAt - importOp.startedAt
    : performance.now() - importOp.startedAt;
  const duration = formatDuration(elapsed);

  const durationText = importOp.completedAt ? `(${duration})` : `· ${duration}`;

  // Xpub aggregated view
  if (xpubImport) {
    const label = `Importing ${xpubImport.childAccountCount} addresses`;

    return (
      <Box flexDirection="column">
        <Text>
          {statusIcon(importOp.status)} <Text bold>{label}</Text> <Text dimColor>{durationText}</Text>
        </Text>
        <StreamList
          importStatus={importOp.status}
          streams={xpubImport.aggregatedStreams}
        />
      </Box>
    );
  }

  // Normal import view
  return (
    <Box flexDirection="column">
      <Text>
        {statusIcon(importOp.status)} <Text bold>Importing</Text> <Text dimColor>{durationText}</Text>
      </Text>
      {/* Streams */}
      <StreamList
        importStatus={importOp.status}
        streams={importOp.streams}
      />
    </Box>
  );
};

/**
 * Stream list with tree structure
 */
const StreamList: FC<{ importStatus: OperationStatus; streams: Map<string, StreamState> }> = ({
  importStatus,
  streams,
}) => {
  const streamArray = Array.from(streams.values());
  const allCompleted = streamArray.length > 0 && streamArray.every((s) => s.status === 'completed');
  const showFetchingNext = importStatus === 'active' && allCompleted;

  return (
    <Box flexDirection="column">
      {streamArray.map((stream, index) => {
        const isLast = !showFetchingNext && index === streamArray.length - 1;
        return (
          <StreamLine
            key={stream.name}
            stream={stream}
            isLast={isLast}
          />
        );
      })}
      {showFetchingNext && (
        <Text>
          {'  '}
          <Text dimColor>└─</Text> <Text dimColor>Fetching next stream...</Text>
        </Text>
      )}
    </Box>
  );
};

function getStreamStatusText(stream: StreamState): ReactNode {
  if (stream.status === 'active' && stream.currentBatch !== undefined) {
    const duration = formatDuration(performance.now() - stream.startedAt);
    return (
      <>
        batch {stream.currentBatch} <Text dimColor>· {duration}</Text>
      </>
    );
  }

  if (stream.status === 'completed') {
    const endTime = stream.completedAt ?? performance.now();
    const duration = formatDuration(endTime - stream.startedAt);
    return (
      <>
        <Text color="green">{stream.imported} new</Text> <Text dimColor>({duration})</Text>
      </>
    );
  }

  if (stream.status === 'warning' || stream.status === 'failed') {
    const endTime = stream.completedAt ?? performance.now();
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
const StreamLine: FC<{ isLast: boolean; stream: StreamState }> = ({ stream, isLast }) => {
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
const StreamSubLine: FC<{ stream: StreamState }> = ({ stream }) => {
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
  const hasProviderInfo =
    stream.activeProvider !== undefined && stream.currentRate !== undefined && stream.maxRate !== undefined;

  if (hasProviderInfo) {
    const rate = `${stream.currentRate!.toFixed(1)}/${stream.maxRate} req/s`;
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

function getTransientMessageText(transientMessage: TransientMessage): ReactNode {
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
const ProcessingSection: FC<{ processing: ProcessingOperation }> = ({ processing }) => {
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
          <Text dimColor>transactions processed</Text>
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
const ProcessingMetadataLine: FC<{
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

function calculateMetadataSuffix(metadata: ProcessingMetadata, isComplete: boolean): ReactNode {
  if (isComplete && metadata.fetched > 0) {
    const total = metadata.cached + metadata.fetched;
    const hitRate = Math.round((metadata.cached / total) * 100);
    return <Text dimColor> ({hitRate}% cached)</Text>;
  }

  if (!isComplete && metadata.fetched > 0) {
    const hasTransientMessage =
      metadata.transientMessage !== undefined && performance.now() < metadata.transientMessage.expiresAt;

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
      metadata.activeProvider !== undefined && metadata.currentRate !== undefined && metadata.maxRate !== undefined;

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
 * Completion section - shows final status (Done/Warnings/Aborted)
 */
const CompletionSection: FC<{ state: IngestionMonitorState }> = ({ state }) => {
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
