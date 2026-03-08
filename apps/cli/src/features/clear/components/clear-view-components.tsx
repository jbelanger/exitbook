/**
 * Clear view TUI components
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
  getSelectionCursor,
  StatusIcon,
} from '../../../ui/shared/index.js';
import type { ClearHandler, ClearParams, FlatDeletionPreview } from '../clear-handler.js';

import { clearViewReducer, handleClearKeyboardInput } from './clear-view-controller.js';
import {
  buildCategoryItems,
  buildResultCategoryItems,
  calculateTotalToDelete,
  type ClearCategoryItem,
  type ClearViewState,
} from './clear-view-state.js';

export const CHROME_LINES = calculateChromeLines({
  beforeHeader: 1, // blank line
  header: 1, // "Clear Data"
  afterHeader: 1, // blank line
  divider: 1, // separator line
  detail: 4, // category detail panel
  beforeControls: 1, // blank line
  controls: 1, // control hints
  buffer: 4, // bottom margin
});
import { formatCount, getCategoryDescription } from '../clear-view-utils.js';

/**
 * Main clear view app component
 */
export const ClearViewApp: FC<{
  clearHandler: ClearHandler;
  initialState: ClearViewState;
  onQuit: () => void;
  params: ClearParams;
}> = ({ initialState, clearHandler, params, onQuit }) => {
  const [state, dispatch] = useReducer(clearViewReducer, initialState);

  const { stdout } = useStdout();
  const terminalHeight = stdout?.rows || 24;
  const terminalWidth = stdout?.columns || 80;

  // Execution callback
  const executeDelete = async () => {
    const result = await clearHandler.execute({
      ...params,
      includeRaw: state.includeRaw,
    });
    if (result.isOk()) {
      const flat: FlatDeletionPreview = {
        transactions: result.value.deleted.processedTransactions.transactions,
        links: result.value.deleted.links.links,
        accounts: result.value.deleted.purge?.accounts ?? 0,
        sessions: result.value.deleted.purge?.sessions ?? 0,
        rawData: result.value.deleted.purge?.rawData ?? 0,
      };
      dispatch({ type: 'EXECUTION_COMPLETE', result: flat });
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
  const visibleRows = calculateVisibleRows(terminalHeight, CHROME_LINES);
  const cols = createColumns(categoryItems, {
    label: { format: (item) => item.label, minWidth: 25 },
    count: { format: (item) => formatCount(item.count), align: 'right', minWidth: 8 },
  });

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
            cols={cols}
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

const CategoryRow: FC<{
  cols: Columns<ClearCategoryItem, 'label' | 'count'>;
  isComplete: boolean;
  isSelected: boolean;
  item: ClearCategoryItem;
}> = ({ item, isSelected, isComplete, cols }) => {
  const cursor = getSelectionCursor(isSelected);
  const icon = getCategoryIcon(item.status);
  const { label: displayLabel, count: countStr } = cols.format(item);

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
    <FixedHeightDetail
      height={4}
      rows={buildPreviewDetailRows(item, description, totalToDelete)}
    />
  );
};

function buildPreviewDetailRows(item: ClearCategoryItem, description: string, totalToDelete: number): ReactElement[] {
  const rows: ReactElement[] = [
    <Text
      key="title"
      bold
    >
      {item.label}
    </Text>,
    <Text
      key="description"
      dimColor
    >
      {description}
    </Text>,
    <Text key="blank"> </Text>,
  ];

  if (totalToDelete === 0) {
    rows.push(
      <Text
        key="empty-all"
        dimColor
      >
        No data to clear. All categories are empty.
      </Text>,
      <Text key="blank-2"> </Text>
    );
  }

  if (item.status === 'will-delete') {
    rows.push(
      <Text
        key="status"
        color="red"
      >
        {formatCount(item.count)} {item.count === 1 ? 'item' : 'items'} will be deleted
      </Text>
    );
  }
  if (item.status === 'preserved') {
    rows.push(
      <Text
        key="status"
        color="green"
      >
        {formatCount(item.count)} {item.count === 1 ? 'item' : 'items'} will be preserved
      </Text>
    );
  }
  if (item.status === 'empty') {
    rows.push(
      <Text
        key="status"
        dimColor
      >
        No items to delete
      </Text>
    );
  }

  return rows;
}

const ConfirmingDetail: FC<{ state: ClearViewState }> = ({ state }) => {
  const totalToDelete = calculateTotalToDelete(state);

  return (
    <FixedHeightDetail
      height={4}
      rows={[
        <Text
          key="title"
          bold
          color="yellow"
        >
          ⚠ Confirm deletion
        </Text>,
        <Text key="blank-1"> </Text>,
        <Text key="summary">
          This will delete {formatCount(totalToDelete)} items{' '}
          {state.includeRaw && <Text color="red">(including raw data)</Text>}
        </Text>,
        state.includeRaw ? (
          <Text
            key="warning"
            color="red"
          >
            You will need to re-import from exchanges/blockchains (slow, rate-limited)
          </Text>
        ) : (
          <Text
            key="tip"
            dimColor
          >
            Press 'd' again to confirm, or any other key to cancel
          </Text>
        ),
        state.includeRaw ? (
          <Text
            key="tip"
            dimColor
          >
            Press 'd' again to confirm, or any other key to cancel
          </Text>
        ) : undefined,
      ]}
    />
  );
};

const ExecutingDetail: FC = () => {
  return (
    <FixedHeightDetail
      height={4}
      rows={[
        <Text key="status">
          <StatusIcon status="active" /> Clearing data...
        </Text>,
      ]}
    />
  );
};

const ErrorDetail: FC<{ state: ClearViewState }> = ({ state }) => {
  return (
    <FixedHeightDetail
      height={4}
      rows={[
        <Text
          key="title"
          color="red"
        >
          <StatusIcon status="failed" /> Clear failed
        </Text>,
        <Text key="blank-1"> </Text>,
        state.error ? (
          <Text
            key="error"
            color="red"
          >
            {state.error.message}
          </Text>
        ) : undefined,
        <Text key="blank-2"> </Text>,
        <Text
          key="tip"
          dimColor
        >
          Press 'q' to exit
        </Text>,
      ]}
    />
  );
};

const CompleteDetail: FC<{ state: ClearViewState }> = ({ state }) => {
  if (!state.result) {
    return (
      <FixedHeightDetail
        height={4}
        rows={[
          <Text
            key="title"
            color="green"
          >
            <StatusIcon status="completed" /> Clear complete
          </Text>,
        ]}
      />
    );
  }

  const parts: string[] = [];
  if (state.result.transactions > 0) parts.push(`${formatCount(state.result.transactions)} transactions`);
  if (state.result.links > 0) parts.push(`${formatCount(state.result.links)} links`);
  if (state.result.accounts > 0) parts.push(`${formatCount(state.result.accounts)} accounts`);
  if (state.result.sessions > 0) parts.push(`${formatCount(state.result.sessions)} sessions`);
  if (state.result.rawData > 0) parts.push(`${formatCount(state.result.rawData)} raw items`);

  return (
    <FixedHeightDetail
      height={4}
      rows={[
        <Text
          key="title"
          color="green"
        >
          <StatusIcon status="completed" /> Clear complete
        </Text>,
        <Text key="blank-1"> </Text>,
        parts.length > 0 ? (
          <Text
            key="summary"
            dimColor
          >
            Deleted: {parts.join(', ')}
          </Text>
        ) : (
          <Text
            key="summary"
            dimColor
          >
            No data was deleted
          </Text>
        ),
        <Text key="blank-2"> </Text>,
        <Text
          key="tip"
          dimColor
        >
          Press 'q' to exit
        </Text>,
      ]}
    />
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
