/**
 * Clear view TUI components
 */

import type { ClearService, ClearServiceParams } from '@exitbook/ingestion';
import { Box, Text, useInput, useStdout } from 'ink';
import { useReducer, type FC } from 'react';

import { Divider, getSelectionCursor, StatusIcon } from '../../../ui/shared/index.js';

import { clearViewReducer, handleClearKeyboardInput } from './clear-view-controller.js';
import { getClearViewVisibleRows } from './clear-view-layout.js';
import {
  buildCategoryItems,
  buildResultCategoryItems,
  calculateTotalToDelete,
  type ClearCategoryItem,
  type ClearViewState,
} from './clear-view-state.js';
import { formatCount, getCategoryDescription } from './clear-view-utils.js';

/**
 * Main clear view app component
 */
export const ClearViewApp: FC<{
  clearService: ClearService;
  initialState: ClearViewState;
  onQuit: () => void;
  params: ClearServiceParams;
}> = ({ initialState, clearService, params, onQuit }) => {
  const [state, dispatch] = useReducer(clearViewReducer, initialState);

  const { stdout } = useStdout();
  const terminalHeight = stdout?.rows || 24;
  const terminalWidth = stdout?.columns || 80;

  // Execution callback
  const executeDelete = async () => {
    const result = await clearService.execute({
      ...params,
      includeRaw: state.includeRaw,
    });
    if (result.isOk()) {
      dispatch({ type: 'EXECUTION_COMPLETE', result: result.value.deleted });
    } else {
      dispatch({ type: 'EXECUTION_FAILED', error: result.error });
    }
  };

  // Keyboard input
  useInput((input, key) => {
    handleClearKeyboardInput(input, key, state, dispatch, onQuit, executeDelete, terminalHeight, totalToDelete);
  });

  const totalToDelete = calculateTotalToDelete(state);
  const categoryItems =
    state.phase === 'complete' && state.result ? buildResultCategoryItems(state.result) : buildCategoryItems(state);

  return (
    <Box flexDirection="column">
      <Text> </Text>
      <ClearHeader
        state={state}
        totalToDelete={totalToDelete}
      />
      <Text> </Text>
      <CategoryList
        state={state}
        categoryItems={categoryItems}
        terminalHeight={terminalHeight}
        isComplete={state.phase === 'complete'}
      />
      <Divider width={terminalWidth} />
      <DetailPanel
        state={state}
        categoryItems={categoryItems}
        totalToDelete={totalToDelete}
      />
      <Text> </Text>
      <ControlsBar
        state={state}
        totalToDelete={totalToDelete}
      />
    </Box>
  );
};

// --- Header ---

const ClearHeader: FC<{ state: ClearViewState; totalToDelete: number }> = ({ state, totalToDelete }) => {
  const rawStatus = state.includeRaw ? 'included' : 'preserved';

  return (
    <Box>
      <Text bold>Clear data</Text>
      <Text dimColor> — </Text>
      <Text>{state.scope.label}</Text>
      <Text> </Text>
      <Text dimColor>·</Text>
      <Text> </Text>
      <Text>{formatCount(totalToDelete)} items</Text>
      <Text> </Text>
      <Text dimColor>·</Text>
      <Text> </Text>
      <Text dimColor>raw data: </Text>
      <Text color={state.includeRaw ? 'red' : 'green'}>{rawStatus}</Text>
    </Box>
  );
};

// --- Category List ---

const CategoryList: FC<{
  categoryItems: ClearCategoryItem[];
  isComplete: boolean;
  state: ClearViewState;
  terminalHeight: number;
}> = ({ state, categoryItems, terminalHeight, isComplete }) => {
  const { selectedIndex, scrollOffset } = state;
  const visibleRows = getClearViewVisibleRows(terminalHeight);

  const startIndex = scrollOffset;
  const endIndex = Math.min(startIndex + visibleRows, categoryItems.length);
  const visible = categoryItems.slice(startIndex, endIndex);

  const hasMoreAbove = startIndex > 0;
  const hasMoreBelow = endIndex < categoryItems.length;

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
          <CategoryRow
            key={item.key}
            item={item}
            isSelected={actualIndex === selectedIndex}
            isComplete={isComplete}
          />
        );
      })}
      {hasMoreBelow && (
        <Text dimColor>
          {'  '}▼ {categoryItems.length - endIndex} more below
        </Text>
      )}
    </Box>
  );
};

// --- Category Row ---

const CategoryRow: FC<{ isComplete: boolean; isSelected: boolean; item: ClearCategoryItem }> = ({
  item,
  isSelected,
  isComplete,
}) => {
  const cursor = getSelectionCursor(isSelected);
  const icon = getCategoryIcon(item.status);
  const displayLabel = item.label.padEnd(25).substring(0, 25);
  const countStr = formatCount(item.count).padStart(8);

  // In complete phase, show "deleted" instead of "will delete"
  let statusLabel = '';
  let statusColor: 'red' | 'green' | 'yellow' | undefined;

  if (isComplete) {
    if (item.count > 0) {
      statusLabel = '(deleted)';
      statusColor = 'yellow';
    }
  } else {
    if (item.status === 'will-delete') {
      statusLabel = '(will delete)';
      statusColor = 'red';
    } else if (item.status === 'preserved') {
      statusLabel = '(preserved)';
      statusColor = 'green';
    }
  }

  return (
    <Box>
      <Text>{cursor} </Text>
      <Text color={getCategoryIconColor(item.status)}>{icon}</Text>
      <Text> </Text>
      <Text>{displayLabel}</Text>
      <Text dimColor>{countStr}</Text>
      <Text> </Text>
      {statusLabel && statusColor && <Text color={statusColor}>{statusLabel}</Text>}
    </Box>
  );
};

function getCategoryIcon(status: ClearCategoryItem['status']): string {
  switch (status) {
    case 'will-delete':
      return '✗';
    case 'preserved':
      return '✓';
    case 'empty':
      return '·';
  }
}

function getCategoryIconColor(status: ClearCategoryItem['status']): string {
  switch (status) {
    case 'will-delete':
      return 'red';
    case 'preserved':
      return 'green';
    case 'empty':
      return 'gray';
  }
}

// --- Detail Panel ---

const DetailPanel: FC<{
  categoryItems: ClearCategoryItem[];
  state: ClearViewState;
  totalToDelete: number;
}> = ({ state, categoryItems, totalToDelete }) => {
  const selectedItem = categoryItems[state.selectedIndex];

  if (!selectedItem) {
    return (
      <Box
        flexDirection="column"
        paddingLeft={2}
      >
        <Text dimColor>No category selected</Text>
      </Box>
    );
  }

  // Phase-specific rendering
  if (state.phase === 'preview') {
    return (
      <PreviewDetail
        item={selectedItem}
        totalToDelete={totalToDelete}
      />
    );
  }

  if (state.phase === 'confirming') {
    return <ConfirmingDetail state={state} />;
  }

  if (state.phase === 'executing') {
    return <ExecutingDetail />;
  }

  if (state.phase === 'complete') {
    return <CompleteDetail state={state} />;
  }

  if (state.phase === 'error') {
    return <ErrorDetail state={state} />;
  }

  return null;
};

const PreviewDetail: FC<{ item: ClearCategoryItem; totalToDelete: number }> = ({ item, totalToDelete }) => {
  const description = getCategoryDescription(item.key);

  return (
    <Box
      flexDirection="column"
      paddingLeft={2}
    >
      <Text bold>{item.label}</Text>
      <Text dimColor>{description}</Text>
      <Text> </Text>
      {totalToDelete === 0 && (
        <>
          <Text dimColor>No data to clear. All categories are empty.</Text>
          <Text> </Text>
        </>
      )}
      {item.status === 'will-delete' && (
        <Text color="red">
          {formatCount(item.count)} {item.count === 1 ? 'item' : 'items'} will be deleted
        </Text>
      )}
      {item.status === 'preserved' && (
        <Text color="green">
          {formatCount(item.count)} {item.count === 1 ? 'item' : 'items'} will be preserved
        </Text>
      )}
      {item.status === 'empty' && <Text dimColor>No items to delete</Text>}
    </Box>
  );
};

const ConfirmingDetail: FC<{ state: ClearViewState }> = ({ state }) => {
  const totalToDelete = calculateTotalToDelete(state);

  return (
    <Box
      flexDirection="column"
      paddingLeft={2}
    >
      <Text
        bold
        color="yellow"
      >
        ⚠ Confirm deletion
      </Text>
      <Text> </Text>
      <Text>
        This will delete {formatCount(totalToDelete)} items{' '}
        {state.includeRaw && <Text color="red">(including raw data)</Text>}
      </Text>
      {state.includeRaw && (
        <>
          <Text> </Text>
          <Text color="red">You will need to re-import from exchanges/blockchains (slow, rate-limited)</Text>
        </>
      )}
      <Text> </Text>
      <Text dimColor>Press 'd' again to confirm, or any other key to cancel</Text>
    </Box>
  );
};

const ExecutingDetail: FC = () => {
  return (
    <Box
      flexDirection="column"
      paddingLeft={2}
    >
      <Text>
        <StatusIcon status="active" /> Clearing data...
      </Text>
    </Box>
  );
};

const ErrorDetail: FC<{ state: ClearViewState }> = ({ state }) => {
  return (
    <Box
      flexDirection="column"
      paddingLeft={2}
    >
      <Text color="red">
        <StatusIcon status="failed" /> Clear failed
      </Text>
      <Text> </Text>
      {state.error && <Text color="red">{state.error.message}</Text>}
      <Text> </Text>
      <Text dimColor>Press 'q' to exit</Text>
    </Box>
  );
};

const CompleteDetail: FC<{ state: ClearViewState }> = ({ state }) => {
  if (!state.result) {
    return (
      <Box
        flexDirection="column"
        paddingLeft={2}
      >
        <Text color="green">
          <StatusIcon status="completed" /> Clear complete
        </Text>
      </Box>
    );
  }

  const parts: string[] = [];
  if (state.result.transactions > 0) parts.push(`${formatCount(state.result.transactions)} transactions`);
  if (state.result.links > 0) parts.push(`${formatCount(state.result.links)} links`);
  if (state.result.accounts > 0) parts.push(`${formatCount(state.result.accounts)} accounts`);
  if (state.result.sessions > 0) parts.push(`${formatCount(state.result.sessions)} sessions`);
  if (state.result.rawData > 0) parts.push(`${formatCount(state.result.rawData)} raw items`);

  return (
    <Box
      flexDirection="column"
      paddingLeft={2}
    >
      <Text color="green">
        <StatusIcon status="completed" /> Clear complete
      </Text>
      <Text> </Text>
      {parts.length > 0 ? <Text dimColor>Deleted: {parts.join(', ')}</Text> : <Text dimColor>No data was deleted</Text>}
      <Text> </Text>
      <Text dimColor>Press 'q' to exit</Text>
    </Box>
  );
};

// --- Controls Bar ---

const ControlsBar: FC<{ state: ClearViewState; totalToDelete: number }> = ({ state, totalToDelete }) => {
  if (state.phase === 'preview') {
    return (
      <Box>
        <Text dimColor>↑↓/j/k</Text>
        <Text> · </Text>
        {totalToDelete > 0 && (
          <>
            <Text dimColor>d</Text>
            <Text> delete · </Text>
          </>
        )}
        <Text dimColor>r</Text>
        <Text> toggle raw · </Text>
        <Text dimColor>q</Text>
        <Text> {totalToDelete > 0 ? 'cancel' : 'exit'}</Text>
      </Box>
    );
  }

  if (state.phase === 'confirming') {
    return (
      <Box>
        <Text dimColor>d</Text>
        <Text> confirm deletion · </Text>
        <Text dimColor>any key</Text>
        <Text> cancel</Text>
      </Box>
    );
  }

  if (state.phase === 'executing') {
    return (
      <Box>
        <Text dimColor>Deleting...</Text>
      </Box>
    );
  }

  if (state.phase === 'complete') {
    return (
      <Box>
        <Text dimColor>q</Text>
        <Text> exit</Text>
      </Box>
    );
  }

  if (state.phase === 'error') {
    return (
      <Box>
        <Text dimColor>q</Text>
        <Text> exit</Text>
      </Box>
    );
  }

  return null;
};
