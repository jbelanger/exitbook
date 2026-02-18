/**
 * Blockchains view TUI components
 */

import { Box, Text, useInput, useStdout } from 'ink';
import { useReducer, type FC } from 'react';

import {
  calculateChromeLines,
  calculateVisibleRows,
  computeColumnWidths,
  Divider,
  getSelectionCursor,
} from '../../../ui/shared/index.js';

import { handleBlockchainsKeyboardInput, blockchainsViewReducer } from './blockchains-view-controller.js';
import type { BlockchainViewItem, BlockchainsViewState, ProviderViewItem } from './blockchains-view-state.js';

function getDetailLines(selected: BlockchainViewItem | undefined): number {
  if (!selected) return 0;

  const providerLines = selected.providers.length > 0 ? 1 + selected.providers.length : 1;

  return (
    1 + // title line (▸ name, category, layer, providers)
    1 + // blank line
    providerLines + // "Providers" label + provider rows, or "No providers registered"
    1 + // blank line
    1 // example command
  );
}

function getBlockchainsVisibleRows(terminalHeight: number, selected: BlockchainViewItem | undefined): number {
  const chromeLines = calculateChromeLines({
    beforeHeader: 1,
    header: 1,
    afterHeader: 1,
    listScrollIndicators: 2,
    divider: 1,
    detail: getDetailLines(selected),
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

  const selected = state.blockchains[state.selectedIndex];
  const visibleRows = getBlockchainsVisibleRows(terminalHeight, selected);

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

  let filterLabel = '';
  if (categoryFilter) filterLabel = ` (${categoryFilter})`;
  else if (requiresApiKeyFilter) filterLabel = ' (requires API key)';

  // Build category parts (only show when not filtered by category)
  const categoryParts = !categoryFilter ? buildCategoryParts(categoryCounts) : [];

  return (
    <Box>
      <Text bold>Blockchains{filterLabel}</Text>
      <Text> </Text>
      <Text>{totalCount} total</Text>
      {categoryParts.length > 0 && (
        <>
          <Text dimColor> · </Text>
          {categoryParts.map((part, i) => (
            <Text key={part.label}>
              {i > 0 && <Text dimColor> · </Text>}
              {part.count} <Text dimColor>{part.label}</Text>
            </Text>
          ))}
        </>
      )}
      <Text> </Text>
      <Text>{totalProviders}</Text>
      <Text dimColor> providers</Text>
    </Box>
  );
};

function buildCategoryParts(counts: Record<string, number>): { count: number; label: string }[] {
  const order = ['evm', 'substrate', 'utxo', 'solana', 'cosmos'];
  const parts: { count: number; label: string }[] = [];
  for (const category of order) {
    const count = counts[category];
    if (count && count > 0) {
      parts.push({ label: category, count });
    }
  }
  // Add any remaining categories not in the preferred order
  for (const [category, count] of Object.entries(counts)) {
    if (!order.includes(category) && count > 0) {
      parts.push({ label: category, count });
    }
  }
  return parts;
}

// --- List ---

const BlockchainList: FC<{ state: BlockchainsViewState; visibleRows: number }> = ({ state, visibleRows }) => {
  const { blockchains, selectedIndex, scrollOffset } = state;
  const columnWidths = getBlockchainColumnWidths(blockchains);

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
            columnWidths={columnWidths}
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
  columnWidths: BlockchainColumnWidths;
  isSelected: boolean;
  item: BlockchainViewItem;
}> = ({ item, isSelected, columnWidths }) => {
  const cursor = getSelectionCursor(isSelected);
  const icon = getKeyStatusIcon(item.keyStatus);
  const displayName = item.displayName.padEnd(columnWidths.displayName);
  const category = item.category.padEnd(columnWidths.category);
  const layer = (item.layer ? `L${item.layer}` : '').padEnd(columnWidths.layer);
  const providerLabel = item.providerCount === 1 ? 'provider ' : 'providers';
  const providerText = `${item.providerCount} ${providerLabel}`.padStart(columnWidths.providers);
  const keyStatusText = getKeyStatusText(item.keyStatus, item.missingKeyCount);

  if (isSelected) {
    return (
      <Text bold>
        {cursor} {icon.char} {displayName} {category} {layer} {providerText} {keyStatusText}
      </Text>
    );
  }

  return (
    <Text>
      {cursor} <Text color={icon.color}>{icon.char}</Text> {displayName} <Text dimColor>{category}</Text>{' '}
      <Text dimColor>{layer}</Text> {providerText}
      {'  '}
      <Text color={icon.color}>{keyStatusText}</Text>
    </Text>
  );
};

// --- Detail Panel ---

const BlockchainDetailPanel: FC<{ state: BlockchainsViewState }> = ({ state }) => {
  const selected = state.blockchains[state.selectedIndex];
  if (!selected) return null;

  const layerLabel = selected.layer ? `Layer ${selected.layer}` : '';
  const providerLabel = selected.providerCount === 1 ? 'provider' : 'providers';

  return (
    <Box
      flexDirection="column"
      paddingTop={0}
    >
      <Text>
        <Text bold>▸ {selected.displayName}</Text>
        {'  '}
        <Text dimColor>{selected.category}</Text>
        {layerLabel && (
          <>
            <Text dimColor> · </Text>
            <Text dimColor>{layerLabel}</Text>
          </>
        )}
        {'   '}
        <Text>{selected.providerCount}</Text>
        <Text dimColor> {providerLabel}</Text>
      </Text>

      <Text> </Text>

      {selected.providers.length > 0 ? (
        <Box flexDirection="column">
          <Text dimColor>{'  '}Providers</Text>
          {selected.providers.map((provider) => (
            <ProviderLine
              key={provider.name}
              provider={provider}
            />
          ))}
        </Box>
      ) : (
        <Text dimColor>{'  '}No providers registered for this blockchain.</Text>
      )}

      <Text> </Text>
      <Text dimColor>
        {'  '}Example: exitbook import --blockchain {selected.name} --address {selected.exampleAddress}
      </Text>
    </Box>
  );
};

const ProviderLine: FC<{ provider: ProviderViewItem }> = ({ provider }) => {
  const icon = getProviderIcon(provider);
  const capabilities = provider.capabilities.join(' · ');
  const rateLimit = provider.rateLimit ? `${provider.rateLimit}` : '';

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
      {provider.requiresApiKey && provider.apiKeyEnvVar && (
        <>
          {'   '}
          {provider.apiKeyConfigured ? (
            <Text color="green">{provider.apiKeyEnvVar} ✓</Text>
          ) : (
            <>
              <Text color="yellow">{provider.apiKeyEnvVar}</Text> <Text color="red">✗</Text>
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

const BlockchainsEmptyState: FC<{ state: BlockchainsViewState }> = ({ state }) => {
  const { categoryFilter, totalCount } = state;

  return (
    <Box flexDirection="column">
      <Text> </Text>
      <BlockchainsHeader state={state} />
      <Text> </Text>
      {!categoryFilter && totalCount === 0 ? (
        <Box flexDirection="column">
          <Text>{'  '}No blockchains registered.</Text>
          <Text> </Text>
          <Text>{'  '}This likely means provider registration failed.</Text>
          <Text dimColor>{'  '}Run: pnpm blockchain-providers:validate</Text>
        </Box>
      ) : (
        <Text>
          {'  '}No blockchains found{categoryFilter ? ` for category ${categoryFilter}` : ''}.
        </Text>
      )}
      <Text> </Text>
      <Text dimColor>q quit</Text>
    </Box>
  );
};

// --- Helpers ---

function getKeyStatusIcon(status: BlockchainViewItem['keyStatus']): { char: string; color: string } {
  switch (status) {
    case 'all-configured':
      return { char: '✓', color: 'green' };
    case 'some-missing':
      return { char: '⚠', color: 'yellow' };
    case 'none-needed':
      return { char: '⊘', color: 'dim' };
  }
}

function getKeyStatusText(status: BlockchainViewItem['keyStatus'], missingCount: number): string {
  switch (status) {
    case 'all-configured':
      return '✓ all keys configured';
    case 'some-missing':
      return `⚠ ${missingCount} key${missingCount === 1 ? '' : 's'} missing`;
    case 'none-needed':
      return '⊘ no key needed';
  }
}

function getProviderIcon(provider: ProviderViewItem): { char: string; color: string } {
  if (!provider.requiresApiKey) {
    return { char: '⊘', color: 'dim' };
  }
  if (provider.apiKeyConfigured) {
    return { char: '✓', color: 'green' };
  }
  return { char: '⚠', color: 'yellow' };
}

// ─── Column Width Logic ──────────────────────────────────────────────────────

interface BlockchainColumnWidths {
  category: number;
  displayName: number;
  keyStatus: number;
  layer: number;
  providers: number;
}

function getBlockchainColumnWidths(blockchains: BlockchainViewItem[]): BlockchainColumnWidths {
  return computeColumnWidths(blockchains, {
    displayName: {
      minWidth: 10,
      format: (item) => item.displayName,
    },
    category: {
      minWidth: 6,
      format: (item) => item.category,
    },
    layer: {
      minWidth: 2,
      format: (item) => (item.layer ? `L${item.layer}` : ''),
    },
    providers: {
      minWidth: 10,
      format: (item) => {
        const label = item.providerCount === 1 ? 'provider ' : 'providers';
        return `${item.providerCount} ${label}`;
      },
    },
    keyStatus: {
      minWidth: 12,
      format: (item) => getKeyStatusText(item.keyStatus, item.missingKeyCount),
    },
  });
}
