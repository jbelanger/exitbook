/**
 * Providers view TUI components
 */

import { Box, Text, useInput, useStdout } from 'ink';
import { useReducer, type FC, type ReactElement } from 'react';

import {
  calculateChromeLines,
  calculateVisibleRows,
  type Columns,
  createColumns,
  Divider,
  FixedHeightDetail,
  SelectableRow,
} from '../../../ui/shared/index.js';
import type { HealthStatus, ProviderBlockchainItem, ProviderViewItem } from '../providers-view-model.js';

import { handleProvidersKeyboardInput, providersViewReducer } from './providers-view-controller.js';
import { formatTimeAgo } from './providers-view-formatting.js';
import type { ProvidersViewState } from './providers-view-state.js';

const PROVIDER_DETAIL_LINES = 9;

export const CHROME_LINES = calculateChromeLines({
  beforeHeader: 1, // blank line
  header: 1, // "Blockchain Providers · N providers"
  afterHeader: 1, // blank line
  listScrollIndicators: 2, // "▲/▼ N more above/below"
  divider: 1, // separator line
  detail: PROVIDER_DETAIL_LINES, // provider detail panel (chains list)
  beforeControls: 1, // blank line
  controls: 1, // control hints
  buffer: 1, // bottom margin
});

// --- Color Helpers ---

function getHealthIcon(status: HealthStatus): { char: string; color: string } {
  switch (status) {
    case 'healthy':
      return { char: '✓', color: 'green' };
    case 'degraded':
      return { char: '⚠', color: 'yellow' };
    case 'unhealthy':
      return { char: '✗', color: 'red' };
    case 'no-stats':
      return { char: '·', color: 'dim' };
  }
}

function getHealthLabel(status: HealthStatus): { color: string; text: string } {
  switch (status) {
    case 'healthy':
      return { text: '✓ healthy', color: 'green' };
    case 'degraded':
      return { text: '⚠ degraded', color: 'yellow' };
    case 'unhealthy':
      return { text: '✗ unhealthy', color: 'red' };
    case 'no-stats':
      return { text: 'no stats', color: 'dim' };
  }
}

function getResponseTimeColor(ms: number): string {
  if (ms < 200) return 'green';
  if (ms <= 500) return 'yellow';
  return 'red';
}

function getErrorRateColor(rate: number): string {
  if (rate < 2) return 'green';
  if (rate < 10) return 'yellow';
  return 'red';
}

// --- Main App ---

export const ProvidersViewApp: FC<{
  initialState: ProvidersViewState;
  onQuit: () => void;
}> = ({ initialState, onQuit }) => {
  const [state, dispatch] = useReducer(providersViewReducer, initialState);

  const { stdout } = useStdout();
  const terminalHeight = stdout?.rows || 24;
  const terminalWidth = stdout?.columns || 80;

  useInput((input, key) => {
    handleProvidersKeyboardInput(input, key, dispatch, onQuit, terminalHeight);
  });

  if (state.providers.length === 0) {
    return <ProvidersEmptyState state={state} />;
  }

  return (
    <Box flexDirection="column">
      <Text> </Text>
      <ProvidersHeader state={state} />
      <Text> </Text>
      <ProviderList
        state={state}
        terminalHeight={terminalHeight}
      />
      <Divider width={terminalWidth} />
      <ProviderDetailPanel state={state} />
      <Text> </Text>
      <ControlsBar />
    </Box>
  );
};

// --- Header ---

const ProvidersHeader: FC<{ state: ProvidersViewState }> = ({ state }) => {
  const { healthCounts, totalCount, apiKeyRequiredCount, blockchainFilter, healthFilter, missingApiKeyFilter } = state;

  let filterLabel = '';
  if (blockchainFilter) filterLabel = ` (${blockchainFilter})`;
  else if (healthFilter) filterLabel = ` (${healthFilter})`;
  else if (missingApiKeyFilter) filterLabel = ' (missing API key)';

  // Build health count parts (only show categories with count > 0)
  const healthParts: { color: string; count: number; label: string }[] = [];
  if (healthCounts.healthy > 0) healthParts.push({ count: healthCounts.healthy, label: 'healthy', color: 'green' });
  if (healthCounts.degraded > 0) healthParts.push({ count: healthCounts.degraded, label: 'degraded', color: 'yellow' });
  if (healthCounts.unhealthy > 0) healthParts.push({ count: healthCounts.unhealthy, label: 'unhealthy', color: 'red' });
  if (healthCounts.noStats > 0) healthParts.push({ count: healthCounts.noStats, label: 'no stats', color: 'dim' });

  return (
    <Box>
      <Text bold>Providers{filterLabel}</Text>
      <Text dimColor> </Text>
      <Text dimColor>{totalCount} total</Text>
      {healthParts.length > 0 && (
        <>
          {healthParts.map((part) => (
            <Text key={part.label}>
              <Text dimColor> · </Text>
              {part.color === 'dim' ? (
                <Text dimColor>
                  {part.count} {part.label}
                </Text>
              ) : (
                <Text color={part.color}>
                  {part.count} {part.label}
                </Text>
              )}
            </Text>
          ))}
        </>
      )}
      {apiKeyRequiredCount > 0 && (
        <>
          <Text dimColor> · </Text>
          <Text dimColor>{apiKeyRequiredCount} require API key</Text>
        </>
      )}
    </Box>
  );
};

// --- List ---

const ProviderList: FC<{ state: ProvidersViewState; terminalHeight: number }> = ({ state, terminalHeight }) => {
  const { providers, selectedIndex, scrollOffset } = state;
  const visibleRows = calculateVisibleRows(terminalHeight, CHROME_LINES);
  const columns = createColumns(providers, {
    displayName: { format: (item) => item.name, minWidth: 16 },
    chains: { format: (item) => `${item.chainCount} ${item.chainCount === 1 ? 'chain ' : 'chains'}`, minWidth: 10 },
    avgResponse: {
      format: (item) => (item.stats !== undefined ? `${item.stats.avgResponseTime}ms` : '—'),
      align: 'right',
      minWidth: 7,
    },
    errorRate: {
      format: (item) => (item.stats !== undefined ? `${item.stats.errorRate}%` : '—'),
      align: 'right',
      minWidth: 7,
    },
    totalReqs: {
      format: (item) => (item.stats !== undefined ? `${item.stats.totalRequests.toLocaleString()} req` : '0 req'),
      align: 'right',
      minWidth: 12,
    },
  });

  const startIndex = scrollOffset;
  const endIndex = Math.min(startIndex + visibleRows, providers.length);
  const visible = providers.slice(startIndex, endIndex);

  const hasMoreAbove = startIndex > 0;
  const hasMoreBelow = endIndex < providers.length;

  return (
    <Box flexDirection="column">
      {hasMoreAbove && (
        <Text dimColor>
          {'  '}▲ {startIndex} more above
        </Text>
      )}
      {visible.map((item, windowIndex) => {
        const actualIndex = startIndex + windowIndex;
        return (
          <ProviderRow
            key={item.name}
            item={item}
            isSelected={actualIndex === selectedIndex}
            columns={columns}
          />
        );
      })}
      {hasMoreBelow && (
        <Text dimColor>
          {'  '}▼ {providers.length - endIndex} more below
        </Text>
      )}
    </Box>
  );
};

// --- Row ---

const ProviderRow: FC<{
  columns: Columns<ProviderViewItem, 'displayName' | 'chains' | 'avgResponse' | 'errorRate' | 'totalReqs'>;
  isSelected: boolean;
  item: ProviderViewItem;
}> = ({ item, isSelected, columns }) => {
  const icon = getHealthIcon(item.healthStatus);
  const { displayName, chains, avgResponse, errorRate, totalReqs } = columns.format(item);

  const hasStats = item.stats !== undefined;
  const environmentConfigurationStatus =
    item.requiresApiKey && item.apiKeyEnvName ? getEnvironmentConfigurationStatus(item.apiKeyConfigured) : undefined;

  // No-stats rows are entirely dim
  if (item.healthStatus === 'no-stats') {
    return (
      <SelectableRow
        dimWhenUnselected
        isSelected={isSelected}
      >
        {icon.char} {displayName} {chains} {avgResponse} {errorRate} {totalReqs}
        {environmentConfigurationStatus ? `   ${environmentConfigurationStatus.text}` : ''}
      </SelectableRow>
    );
  }

  // Normal row: use pre-formatted strings for alignment, apply colors to content
  return (
    <SelectableRow isSelected={isSelected}>
      <Text color={icon.color}>{icon.char}</Text> {displayName} {chains}{' '}
      {hasStats ? (
        <Text color={getResponseTimeColor(item.stats!.avgResponseTime)}>{avgResponse}</Text>
      ) : (
        <Text dimColor>{avgResponse}</Text>
      )}{' '}
      {hasStats ? (
        <Text color={getErrorRateColor(item.stats!.errorRate)}>{errorRate}</Text>
      ) : (
        <Text dimColor>{errorRate}</Text>
      )}{' '}
      {totalReqs}
      {environmentConfigurationStatus && (
        <>
          {'   '}
          <Text color={environmentConfigurationStatus.color}>{environmentConfigurationStatus.text}</Text>
        </>
      )}
    </SelectableRow>
  );
};

function getEnvironmentConfigurationStatus(apiKeyConfigured: boolean | undefined): {
  color: 'green' | 'yellow';
  text: string;
} {
  if (apiKeyConfigured) {
    return { color: 'green', text: 'env configured ✓' };
  }

  return { color: 'yellow', text: 'env missing ✗' };
}

// --- Detail Panel ---

const ProviderDetailPanel: FC<{ state: ProvidersViewState }> = ({ state }) => {
  const selected = state.providers[state.selectedIndex];
  if (!selected) return null;

  return (
    <FixedHeightDetail
      height={PROVIDER_DETAIL_LINES}
      rows={buildProviderDetailRows(selected)}
    />
  );
};

function buildProviderDetailRows(selected: ProviderViewItem): ReactElement[] {
  const hasStats = selected.stats !== undefined;
  const healthLabel = getHealthLabel(selected.healthStatus);
  const chainLabel = selected.chainCount === 1 ? 'chain' : 'chains';

  // Limit blockchains shown to prevent layout overflow
  const MAX_BLOCKCHAINS_SHOWN = 10;
  const visibleBlockchains = selected.blockchains.slice(0, MAX_BLOCKCHAINS_SHOWN);
  const hiddenCount = selected.blockchains.length - visibleBlockchains.length;
  const rows: ReactElement[] = [
    <Text key="title">
      <Text bold>▸ {selected.displayName}</Text>
      {'  '}
      <Text>{selected.chainCount}</Text>
      <Text dimColor> {chainLabel}</Text>
      {hasStats ? (
        <>
          <Text dimColor> · </Text>
          <Text>{selected.stats!.totalRequests.toLocaleString()}</Text>
          <Text dimColor> total requests</Text>
          <Text dimColor> · </Text>
          {healthLabel.color === 'dim' ? (
            <Text dimColor>{healthLabel.text}</Text>
          ) : (
            <Text color={healthLabel.color}>{healthLabel.text}</Text>
          )}
        </>
      ) : (
        <>
          <Text dimColor> · </Text>
          <Text dimColor>no stats</Text>
        </>
      )}
    </Text>,
    <Text key="blank-1"> </Text>,
    <Text
      key="blockchains-label"
      dimColor
    >
      {'  '}Blockchains
    </Text>,
    ...visibleBlockchains.map((blockchain) => (
      <BlockchainLine
        key={blockchain.name}
        blockchain={blockchain}
      />
    )),
  ];

  if (hiddenCount > 0) {
    rows.push(
      <Text
        key="blockchains-more"
        dimColor
      >
        {'    '}... and {hiddenCount} more {hiddenCount === 1 ? 'chain' : 'chains'}
      </Text>
    );
  }

  rows.push(<Text key="blank-2"> </Text>);

  if (selected.rateLimit) {
    rows.push(
      <Text key="config">
        <Text dimColor>{'  '}Config: </Text>
        <Text>{selected.rateLimit}</Text>
        <Text dimColor> ({selected.configSource})</Text>
      </Text>
    );
  }

  if (selected.requiresApiKey && selected.apiKeyEnvName) {
    const environmentConfigurationStatus = getEnvironmentConfigurationStatus(selected.apiKeyConfigured);

    rows.push(
      <Text key="api-key">
        <Text dimColor>{'  '}API key: </Text>
        <Text color={environmentConfigurationStatus.color}>{environmentConfigurationStatus.text}</Text>
      </Text>
    );
  }

  if (selected.lastError && selected.lastErrorTime) {
    rows.push(
      <Text key="blank-3"> </Text>,
      <Text key="last-error">
        <Text dimColor>{'  '}Last error: </Text>
        <Text color="yellow">{selected.lastError}</Text>
        <Text dimColor> ({formatTimeAgo(selected.lastErrorTime)})</Text>
      </Text>
    );
  }

  if (!hasStats) {
    rows.push(
      <Text key="blank-4"> </Text>,
      <Text
        key="no-stats-tip"
        dimColor
      >
        {'  '}No usage data. Run an import to generate stats:
      </Text>,
      <Text
        key="no-stats-command"
        dimColor
      >
        {'  '}exitbook accounts add example-wallet --blockchain {selected.blockchains[0]?.name ?? 'ethereum'} --address{' '}
        {'<address>'}
      </Text>,
      <Text
        key="no-stats-import-command"
        dimColor
      >
        {'  '}exitbook import --account-name example-wallet
      </Text>
    );
  }

  return rows;
}

const BlockchainLine: FC<{ blockchain: ProviderBlockchainItem }> = ({ blockchain }) => {
  const name = blockchain.name.substring(0, 14).padEnd(14);
  const capabilities = blockchain.capabilities.join(' · ');
  const rateLimit = blockchain.rateLimit ? `${blockchain.rateLimit}` : '';
  const hasStats = blockchain.stats !== undefined;

  return (
    <Text>
      {'    '}
      <Text color="cyan">{name}</Text>
      {'  '}
      <Text>{capabilities}</Text>
      {rateLimit && (
        <>
          {'   '}
          <Text dimColor>{rateLimit}</Text>
        </>
      )}
      {hasStats && (
        <>
          {'   '}
          <Text>{blockchain.stats!.totalSuccesses + blockchain.stats!.totalFailures}</Text>
          <Text dimColor> req</Text>
          {'   '}
          <Text color={getErrorRateColor(blockchain.stats!.errorRate)}>{blockchain.stats!.errorRate}%</Text>
          {'   '}
          <Text color={getResponseTimeColor(blockchain.stats!.avgResponseTime)}>
            {blockchain.stats!.avgResponseTime}ms
          </Text>
          {blockchain.stats!.errorRate >= 5 && (
            <>
              {'   '}
              <Text color="yellow">⚠ high error rate</Text>
            </>
          )}
          {blockchain.stats!.avgResponseTime > 500 && blockchain.stats!.errorRate < 5 && (
            <>
              {'   '}
              <Text color="yellow">⚠ slow</Text>
            </>
          )}
        </>
      )}
    </Text>
  );
};

// --- Controls & Empty State ---

const ControlsBar: FC = () => {
  return <Text dimColor>↑↓/j/k · ^U/^D page · Home/End · q/esc quit</Text>;
};

const ProvidersEmptyState: FC<{ state: ProvidersViewState }> = ({ state }) => {
  const { blockchainFilter, healthFilter, totalCount } = state;

  const hasFilter = blockchainFilter || healthFilter || state.missingApiKeyFilter;

  return (
    <Box flexDirection="column">
      <Text> </Text>
      <ProvidersHeader state={state} />
      <Text> </Text>
      {!hasFilter && totalCount === 0 ? (
        <Box flexDirection="column">
          <Text>{'  '}No providers registered.</Text>
          <Text> </Text>
          <Text>{'  '}This likely means provider registration failed.</Text>
          <Text dimColor>{'  '}Run: pnpm blockchain-providers:validate</Text>
        </Box>
      ) : (
        <Text>
          {'  '}No providers found{blockchainFilter ? ` for ${blockchainFilter}` : ''}
          {healthFilter ? ` with status ${healthFilter}` : ''}.
        </Text>
      )}
      <Text> </Text>
      <Text dimColor>q quit</Text>
    </Box>
  );
};
