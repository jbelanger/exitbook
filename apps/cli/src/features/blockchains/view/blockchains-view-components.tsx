/**
 * Blockchains view TUI components
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
import type { BlockchainViewItem, ProviderViewItem } from '../blockchains-view-model.js';

import { handleBlockchainsKeyboardInput, blockchainsViewReducer } from './blockchains-view-controller.js';
import {
  buildBlockchainDetailFields,
  buildBlockchainTitleParts,
  buildBlockchainsEmptyStateMessage,
  buildBlockchainsFilterLabel,
  buildCategoryParts,
  formatBlockchainLayer,
  formatProviderApiKeyStatus,
  formatProviderCapabilities,
  formatProviderCount,
  getBlockchainKeyStatusDisplay,
} from './blockchains-view-formatters.js';
import type { BlockchainsViewState } from './blockchains-view-state.js';

const BLOCKCHAINS_DETAIL_LINES = 10;

function getBlockchainsVisibleRows(terminalHeight: number): number {
  const chromeLines = calculateChromeLines({
    beforeHeader: 1,
    header: 1,
    afterHeader: 1,
    listScrollIndicators: 2,
    divider: 1,
    detail: BLOCKCHAINS_DETAIL_LINES,
    beforeControls: 1,
    controls: 1,
    buffer: 1,
  });

  return calculateVisibleRows(terminalHeight, chromeLines);
}

/**
 * Main blockchains view app component
 */
export const BlockchainsViewApp: FC<{
  initialState: BlockchainsViewState;
  onQuit: () => void;
}> = ({ initialState, onQuit }) => {
  const [state, dispatch] = useReducer(blockchainsViewReducer, initialState);

  const { stdout } = useStdout();
  const terminalHeight = stdout?.rows || 24;
  const terminalWidth = stdout?.columns || 80;

  const visibleRows = getBlockchainsVisibleRows(terminalHeight);

  useInput((input, key) => {
    handleBlockchainsKeyboardInput(input, key, dispatch, onQuit, visibleRows);
  });

  if (state.blockchains.length === 0) {
    return <BlockchainsEmptyState state={state} />;
  }

  return (
    <Box flexDirection="column">
      <Text> </Text>
      <BlockchainsHeader state={state} />
      <Text> </Text>
      <BlockchainList
        state={state}
        visibleRows={visibleRows}
      />
      <Divider width={terminalWidth} />
      <BlockchainDetailPanel state={state} />
      <Text> </Text>
      <ControlsBar />
    </Box>
  );
};

// --- Header ---

const BlockchainsHeader: FC<{ state: BlockchainsViewState }> = ({ state }) => {
  const { categoryCounts, totalCount, totalProviders, categoryFilter, requiresApiKeyFilter } = state;

  const filterLabel = buildBlockchainsFilterLabel({ categoryFilter, requiresApiKeyFilter });

  // Build category parts (only show when not filtered by category)
  const categoryParts = !categoryFilter ? buildCategoryParts(categoryCounts) : [];

  return (
    <Box>
      <Text bold>Blockchains{filterLabel}</Text>
      <Text dimColor> </Text>
      <Text dimColor>{totalCount} total</Text>
      {categoryParts.map((part) => (
        <Text
          key={part.label}
          dimColor
        >
          {' · '}
          {part.count} {part.label}
        </Text>
      ))}
      <Text dimColor>{' · '}</Text>
      <Text dimColor>{totalProviders} providers</Text>
    </Box>
  );
};

// --- List ---

const BlockchainList: FC<{ state: BlockchainsViewState; visibleRows: number }> = ({ state, visibleRows }) => {
  const { blockchains, selectedIndex, scrollOffset } = state;
  const columns = createColumns(blockchains, {
    displayName: { format: (item) => item.displayName, minWidth: 10 },
    category: { format: (item) => item.category, minWidth: 6 },
    layer: { format: (item) => (item.layer ? formatBlockchainLayer(item.layer) : ''), minWidth: 2 },
    providers: {
      format: (item) => formatProviderCount(item.providerCount),
      align: 'right',
      minWidth: 10,
    },
    keyStatus: {
      format: (item) => getBlockchainKeyStatusDisplay(item.keyStatus, item.missingKeyCount).label,
      minWidth: 12,
    },
  });

  const startIndex = scrollOffset;
  const endIndex = Math.min(startIndex + visibleRows, blockchains.length);
  const visible = blockchains.slice(startIndex, endIndex);

  const hasMoreAbove = startIndex > 0;
  const hasMoreBelow = endIndex < blockchains.length;

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
          <BlockchainRow
            key={item.name}
            item={item}
            isSelected={actualIndex === selectedIndex}
            columns={columns}
          />
        );
      })}
      {hasMoreBelow && (
        <Text dimColor>
          {'  '}▼ {blockchains.length - endIndex} more below
        </Text>
      )}
    </Box>
  );
};

// --- Row ---

const BlockchainRow: FC<{
  columns: Columns<BlockchainViewItem, 'displayName' | 'category' | 'layer' | 'providers' | 'keyStatus'>;
  isSelected: boolean;
  item: BlockchainViewItem;
}> = ({ item, isSelected, columns }) => {
  const status = getBlockchainKeyStatusDisplay(item.keyStatus, item.missingKeyCount);
  const { displayName, category, layer, providers, keyStatus } = columns.format(item);

  return (
    <SelectableRow isSelected={isSelected}>
      {displayName} <Text dimColor>{category}</Text> <Text dimColor>{layer}</Text> {providers}
      {'  '}
      <Text color={status.color}>{keyStatus}</Text>
    </SelectableRow>
  );
};

// --- Detail Panel ---

const BlockchainDetailPanel: FC<{ state: BlockchainsViewState }> = ({ state }) => {
  const selected = state.blockchains[state.selectedIndex];
  if (!selected) return null;

  return (
    <FixedHeightDetail
      height={BLOCKCHAINS_DETAIL_LINES}
      rows={buildBlockchainDetailRows(selected)}
    />
  );
};

function buildBlockchainDetailRows(selected: BlockchainViewItem): ReactElement[] {
  const title = buildBlockchainTitleParts(selected);
  const detailFields = buildBlockchainDetailFields(selected);

  const rows: ReactElement[] = [
    <Text key="title">
      <Text bold>▸ {title.displayName}</Text> <Text dimColor>{title.key}</Text>{' '}
      <Text color="cyan">{title.category}</Text>
      {title.layerLabel && (
        <>
          {' '}
          <Text dimColor>{title.layerLabel}</Text>
        </>
      )}
    </Text>,
    <Text key="blank-1"> </Text>,
    ...detailFields.map((field) => (
      <Text key={field.label}>
        <Text dimColor>{field.label}:</Text> {field.value}
      </Text>
    )),
    <Text key="blank-2"> </Text>,
    <Text
      key="providers-label"
      dimColor
    >
      Providers
    </Text>,
  ];

  if (selected.providers.length > 0) {
    rows.push(
      ...selected.providers.map((provider) => (
        <ProviderLine
          key={provider.name}
          provider={provider}
        />
      ))
    );
  } else {
    rows.push(
      <Text
        key="no-providers"
        dimColor
      >
        No providers registered for this blockchain.
      </Text>
    );
  }

  return rows;
}

const ProviderLine: FC<{ provider: ProviderViewItem }> = ({ provider }) => {
  const icon = getProviderIcon(provider);
  const capabilities = formatProviderCapabilities(provider);
  const rateLimit = provider.rateLimit ? `${provider.rateLimit}` : '';
  const apiKeyStatus = formatProviderApiKeyStatus(provider);

  return (
    <Text>
      {'    '}
      <Text color={icon.color}>{icon.char}</Text>
      {'  '}
      <Text color="cyan">{provider.displayName.padEnd(14).substring(0, 14)}</Text>
      {'  '}
      <Text>{capabilities}</Text>
      {rateLimit && (
        <>
          {'   '}
          <Text dimColor>{rateLimit}</Text>
        </>
      )}
      {provider.requiresApiKey && (
        <>
          {'   '}
          <Text color={provider.apiKeyConfigured ? 'green' : 'yellow'}>{apiKeyStatus}</Text>
        </>
      )}
      {!provider.requiresApiKey && (
        <>
          {'   '}
          <Text dimColor>{apiKeyStatus}</Text>
        </>
      )}
    </Text>
  );
};

// --- Controls & Empty State ---

const ControlsBar: FC = () => {
  return <Text dimColor>↑↓/j/k · ^U/^D page · Home/End · q/esc quit</Text>;
};

const BlockchainsEmptyState: FC<{ state: BlockchainsViewState }> = ({ state }) => {
  const emptyMessage = buildBlockchainsEmptyStateMessage({
    categoryFilter: state.categoryFilter,
    requiresApiKeyFilter: state.requiresApiKeyFilter,
  });

  return (
    <Box flexDirection="column">
      <Text> </Text>
      <BlockchainsHeader state={state} />
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

// --- Helpers ---

function getProviderIcon(provider: ProviderViewItem): { char: string; color: string } {
  if (!provider.requiresApiKey) {
    return { char: '⊘', color: 'dim' };
  }
  if (provider.apiKeyConfigured) {
    return { char: '✓', color: 'green' };
  }
  return { char: '⚠', color: 'yellow' };
}
