import { type IBlockchainProviderRuntime } from '@exitbook/blockchain-providers';
import type { InstrumentationCollector } from '@exitbook/observability';
import { Box, Text } from 'ink';
import { type FC, useEffect, useLayoutEffect, useReducer } from 'react';

import { type EventRelay, formatDuration, type LifecycleBridge, statusIcon } from '../../../ui/shared/index.js';

import { batchImportMonitorReducer } from './batch-import-monitor-controller.js';
import type { BatchImportMonitorEvent, BatchImportMonitorState, BatchImportRow } from './batch-import-monitor-state.js';
import { createBatchImportMonitorState } from './batch-import-monitor-state.js';
import { IngestionMonitorSections } from './ingestion-monitor-view-components.jsx';

const REFRESH_INTERVAL_MS = 250;

function useBatchImportMonitorState(
  relay: EventRelay<BatchImportMonitorEvent>,
  lifecycle: LifecycleBridge,
  instrumentation: InstrumentationCollector,
  providerRuntime: IBlockchainProviderRuntime
): BatchImportMonitorState {
  const [state, dispatch] = useReducer(batchImportMonitorReducer, undefined, createBatchImportMonitorState);

  useLayoutEffect(() => {
    lifecycle.onAbort = () => dispatch({ type: 'abort' });
    lifecycle.onFail = (errorMessage: string) => dispatch({ type: 'fail', errorMessage });

    const disconnect = relay.connect((event: BatchImportMonitorEvent) => {
      dispatch({ type: 'event', event, instrumentation, providerRuntime });
    });

    return () => {
      lifecycle.onAbort = undefined;
      lifecycle.onFail = undefined;
      disconnect();
    };
  }, [relay, lifecycle, instrumentation, providerRuntime]);

  useEffect(() => {
    const timer = setInterval(() => {
      dispatch({ type: 'tick' });
    }, REFRESH_INTERVAL_MS);
    return () => clearInterval(timer);
  }, []);

  return state;
}

interface BatchImportMonitorProps {
  instrumentation: InstrumentationCollector;
  lifecycle: LifecycleBridge;
  providerRuntime: IBlockchainProviderRuntime;
  relay: EventRelay<BatchImportMonitorEvent>;
}

export const BatchImportMonitor: FC<BatchImportMonitorProps> = ({
  relay,
  lifecycle,
  instrumentation,
  providerRuntime,
}) => {
  const state = useBatchImportMonitorState(relay, lifecycle, instrumentation, providerRuntime);

  return (
    <Box flexDirection="column">
      <Text> </Text>
      <BatchHeader state={state} />
      {state.rows.map((row) => (
        <BatchRowLine
          key={row.accountId}
          row={row}
          isActive={row.accountId === state.activeAccountId && row.status === 'active'}
        />
      ))}
      {state.activeDetail && (
        <Box flexDirection="column">
          <Text> </Text>
          <ActiveDetailHeader state={state} />
          <IngestionMonitorSections state={state.activeDetail} />
        </Box>
      )}
      {state.isComplete && <BatchCompletionSection state={state} />}
    </Box>
  );
};

const BatchHeader: FC<{ state: BatchImportMonitorState }> = ({ state }) => {
  const activeCount =
    !state.isComplete && state.rows.some((row) => row.accountId === state.activeAccountId && row.status === 'active')
      ? 1
      : 0;
  const pendingCount = Math.max(0, state.totalCount - state.completedCount - state.failedCount - activeCount);

  return (
    <Text>
      <Text bold>Importing profile {state.profileDisplayName ?? '...'}</Text>
      <Text dimColor>
        {' '}
        · {state.totalCount} accounts · {activeCount} active · {state.completedCount} completed · {state.failedCount}{' '}
        failed · {pendingCount} pending
      </Text>
    </Text>
  );
};

const BatchRowLine: FC<{ isActive: boolean; row: BatchImportRow }> = ({ row, isActive }) => {
  const icon = renderBatchRowIcon(row.status);
  const label = `${row.name} · ${row.platformKey} · ${formatSyncMode(row.syncMode)}`;
  const counts =
    row.imported > 0 || row.skipped > 0
      ? ` (${row.imported.toLocaleString()} imported, ${row.skipped.toLocaleString()} skipped)`
      : '';

  return (
    <Text dimColor={!isActive && row.status === 'pending'}>
      {icon} <Text bold={isActive}>{label}</Text>
      {counts && <Text dimColor>{counts}</Text>}
      {row.status === 'failed' && row.errorMessage && <Text color="yellow">{`: ${row.errorMessage}`}</Text>}
    </Text>
  );
};

const ActiveDetailHeader: FC<{ state: BatchImportMonitorState }> = ({ state }) => {
  const total = state.totalCount || state.rows.length;
  const activeNumber = (state.activeIndex ?? 0) + 1;

  return (
    <Text>
      <Text bold>
        Active account {activeNumber}/{total}: {state.activeName ?? `#${state.activeAccountId ?? '?'}`}
      </Text>
      {state.activePlatformKey && <Text dimColor>{` · ${state.activePlatformKey}`}</Text>}
      {state.activeSyncMode && <Text dimColor>{` · ${formatSyncMode(state.activeSyncMode)}`}</Text>}
    </Text>
  );
};

const BatchCompletionSection: FC<{ state: BatchImportMonitorState }> = ({ state }) => {
  const duration = state.totalDurationMs ? formatDuration(state.totalDurationMs) : '';

  if (state.errorMessage) {
    return (
      <Box flexDirection="column">
        <Text> </Text>
        <Text>
          <Text color="yellow">⚠</Text> Failed {duration && <Text dimColor>({duration})</Text>}
        </Text>
        <Text dimColor>{state.errorMessage}</Text>
      </Box>
    );
  }

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

  if (state.failedCount > 0) {
    const failedRows = state.rows.filter((row) => row.status === 'failed');
    return (
      <Box flexDirection="column">
        <Text> </Text>
        <Text>
          <Text color="yellow">⚠</Text> Completed with failures {duration && <Text dimColor>({duration})</Text>}
        </Text>
        {failedRows.map((row) => (
          <Text key={row.accountId}>
            {'  '}
            {row.name}: {row.errorMessage ?? 'Import failed'}
          </Text>
        ))}
      </Box>
    );
  }

  return (
    <Box flexDirection="column">
      <Text> </Text>
      <Text>
        <Text color="green">✓</Text> Done {duration && <Text dimColor>({duration})</Text>}
      </Text>
    </Box>
  );
};

function renderBatchRowIcon(status: BatchImportRow['status']) {
  if (status === 'pending') {
    return <Text dimColor>·</Text>;
  }

  return statusIcon(status === 'failed' ? 'failed' : status === 'active' ? 'active' : 'completed');
}

function formatSyncMode(syncMode: BatchImportRow['syncMode']): string {
  switch (syncMode) {
    case 'first-sync':
      return 'first sync';
    case 'resuming':
      return 'resuming';
    case 'incremental':
      return 'incremental';
  }
}
