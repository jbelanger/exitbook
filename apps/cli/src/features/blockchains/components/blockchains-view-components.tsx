/**
 * Blockchains view TUI components
 */

import { Box, Text, useInput, useStdout } from 'ink';
import { useReducer, type FC } from 'react';

import { calculateChromeLines, calculateVisibleRows, Divider, getSelectionCursor } from '../../../ui/shared/index.js';

import { handleBlockchainsKeyboardInput, blockchainsViewReducer } from './blockchains-view-controller.js';
import type { BlockchainViewItem, BlockchainsViewState, ProviderViewItem } from './blockchains-view-state.js';

export const CHROME_LINES = calculateChromeLines({
  beforeHeader: 1, // blank line
  header: 1, // "Blockchains · N registered"
  afterHeader: 1, // blank line
  listScrollIndicators: 2, // "▲/▼ N more above/below"
  divider: 1, // separator line
  detail: 7, // blockchain detail panel (providers list)
  beforeControls: 1, // blank line
  controls: 1, // control hints
  buffer: 1, // bottom margin
});

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

  useInput((input, key) => {
    handleBlockchainsKeyboardInput(input, key, dispatch, onQuit, terminalHeight);
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
        terminalHeight={terminalHeight}
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

const BlockchainList: FC<{ state: BlockchainsViewState; terminalHeight: number }> = ({ state, terminalHeight }) => {
  const { blockchains, selectedIndex, scrollOffset } = state;
  const visibleRows = calculateVisibleRows(terminalHeight, CHROME_LINES);

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

const BlockchainRow: FC<{ isSelected: boolean; item: BlockchainViewItem }> = ({ item, isSelected }) => {
  const cursor = getSelectionCursor(isSelected);
  const icon = getKeyStatusIcon(item.keyStatus);
  const displayName = item.displayName.padEnd(14).substring(0, 14);
  const category = item.category.padEnd(10).substring(0, 10);
  const layer = item.layer ? `L${item.layer}`.padEnd(4) : '    ';
  const providerLabel = item.providerCount === 1 ? 'provider ' : 'providers';
  const providerText = `${item.providerCount} ${providerLabel}`.padStart(14);
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
      <Text dimColor>{layer}</Text> {item.providerCount} <Text dimColor>{providerLabel}</Text>
      {'   '}
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
