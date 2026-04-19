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
} from '../../../ui/shared/layout.js';
import type { ProviderBlockchainItem, ProviderViewItem } from '../providers-view-model.js';

import { handleProvidersKeyboardInput, providersViewReducer } from './providers-view-controller.js';
import {
  buildProviderDetailFields,
  buildProviderHealthParts,
  buildProvidersEmptyStateMessage,
  buildProvidersFilterLabel,
  formatProviderApiKeyListStatus,
  getProviderHealthDisplay,
} from './providers-view-formatters.js';
import type { ProvidersViewState } from './providers-view-state.js';

const PROVIDER_DETAIL_LINES = 12;

export const CHROME_LINES = calculateChromeLines({
  beforeHeader: 1, // blank line
  header: 1, // "Providers · N total"
  afterHeader: 1, // blank line
  listScrollIndicators: 2, // "▲/▼ N more above/below"
  divider: 1, // separator line
  detail: PROVIDER_DETAIL_LINES, // provider detail panel
  beforeControls: 1, // blank line
  controls: 1, // control hints
  buffer: 1, // bottom margin
});

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

  const filterLabel = buildProvidersFilterLabel({ blockchainFilter, healthFilter, missingApiKeyFilter });
  const healthParts = buildProviderHealthParts(healthCounts);

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
  const health = getProviderHealthDisplay(item.healthStatus);
  const { displayName, chains, avgResponse, errorRate, totalReqs } = columns.format(item);

  const hasStats = item.stats !== undefined;
  const apiKeyStatus = formatProviderApiKeyListStatus(item);
  const apiKeyStatusColor = item.apiKeyConfigured ? 'green' : 'yellow';

  // No-stats rows are entirely dim
  if (item.healthStatus === 'no-stats') {
    return (
      <SelectableRow
        dimWhenUnselected
        isSelected={isSelected}
      >
        {health.icon} {displayName} {chains} {avgResponse} {errorRate} {totalReqs}
        {apiKeyStatus !== '—' ? `   ${apiKeyStatus}` : ''}
      </SelectableRow>
    );
  }

  // Normal row: use pre-formatted strings for alignment, apply colors to content
  return (
    <SelectableRow isSelected={isSelected}>
      <Text color={health.color}>{health.icon}</Text> {displayName} {chains}{' '}
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
      {apiKeyStatus !== '—' && (
        <>
          {'   '}
          <Text color={apiKeyStatusColor}>{apiKeyStatus}</Text>
        </>
      )}
    </SelectableRow>
  );
};

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
  const health = getProviderHealthDisplay(selected.healthStatus);
  const detailFields = buildProviderDetailFields(selected);
  const rows: ReactElement[] = [
    <Text key="title">
      <Text bold>▸ {selected.displayName}</Text>{' '}
      {health.color === 'dim' ? <Text dimColor>{health.label}</Text> : <Text color={health.color}>{health.label}</Text>}
    </Text>,
    <Text key="blank-1"> </Text>,
    ...detailFields.map((field) => (
      <Text key={field.label}>
        <Text dimColor>
          {'  '}
          {field.label}:
        </Text>{' '}
        {renderProviderDetailValue(field.label, field.value, health.color)}
      </Text>
    )),
    <Text
      key="blockchains-label"
      dimColor
    >
      {'  '}Blockchains
    </Text>,
    ...selected.blockchains.map((blockchain) => (
      <BlockchainLine
        key={blockchain.name}
        blockchain={blockchain}
      />
    )),
  ];

  if (selected.blockchains.length === 0) {
    rows.push(<Text key="no-blockchains">{'    '}No blockchains registered for this provider.</Text>);
  }

  return rows;
}

function renderProviderDetailValue(
  label: string,
  value: string,
  healthColor: 'dim' | 'green' | 'yellow' | 'red'
): ReactElement | string {
  if (label === 'Health') {
    return healthColor === 'dim' ? <Text dimColor>{value}</Text> : <Text color={healthColor}>{value}</Text>;
  }

  if (label === 'Last error') {
    return <Text color="yellow">{value}</Text>;
  }

  return value;
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
  const emptyMessage = buildProvidersEmptyStateMessage({
    blockchainFilter: state.blockchainFilter,
    healthFilter: state.healthFilter,
    missingApiKeyFilter: state.missingApiKeyFilter,
  });

  return (
    <Box flexDirection="column">
      <Text> </Text>
      <ProvidersHeader state={state} />
      <Text> </Text>
      <Text>
        {'  '}
        {emptyMessage}
      </Text>
      <Text> </Text>
      <Text dimColor>q quit</Text>
    </Box>
  );
};
