/**
 * Transactions view TUI components
 */

import { formatMovementFingerprintRef } from '@exitbook/core';
import { isFiat, type Currency } from '@exitbook/foundation';
import { Box, Text, useInput, useStdout } from 'ink';
import Spinner from 'ink-spinner';
import { useMemo, useReducer, type FC, type ReactElement } from 'react';

import {
  calculateChromeLines,
  calculateVisibleRows,
  type Columns,
  createColumns,
  Divider,
  FixedHeightDetail,
  SelectableRow,
} from '../../../ui/shared/index.js';
import type { FeeDisplayItem, MovementDisplayItem, OnExport, TransactionViewItem } from '../transactions-view-model.js';

import {
  FORMAT_OPTIONS,
  handleTransactionsKeyboardInput,
  transactionsViewReducer,
} from './transactions-view-controller.js';
import {
  buildCategoryParts,
  formatTransactionBalanceSummary,
  formatTransactionOperation,
  formatTransactionTimestamp,
  getTransactionPriceStatusDisplay,
} from './transactions-view-formatters.js';
import type { ExportPanelState, TransactionsViewPhase, TransactionsViewState } from './transactions-view-state.js';

const TRANSACTION_DETAIL_LINES = 9;

export const CHROME_LINES = calculateChromeLines({
  beforeHeader: 1, // blank line
  header: 1, // "Transactions · N total · category counts"
  afterHeader: 1, // blank line
  listScrollIndicators: 2, // "▲/▼ N more above/below"
  divider: 1, // separator line
  detail: TRANSACTION_DETAIL_LINES, // transaction detail panel (movements, fees, prices)
  beforeControls: 1, // blank line
  controls: 1, // control hints
  buffer: 1, // bottom margin
});

/**
 * Main transactions view app component
 */
export const TransactionsViewApp: FC<{
  initialState: TransactionsViewState;
  onExport?: OnExport | undefined;
  onQuit: () => void;
}> = ({ initialState, onExport, onQuit }) => {
  const [state, dispatch] = useReducer(transactionsViewReducer, initialState);

  const { stdout } = useStdout();
  const terminalHeight = stdout?.rows || 24;
  const terminalWidth = stdout?.columns || 80;

  useInput((input, key) => {
    const formatSelection = handleTransactionsKeyboardInput(
      input,
      key,
      dispatch,
      onQuit,
      terminalHeight,
      state.phase,
      state.exportPanel
    );

    if (formatSelection && onExport) {
      dispatch({ type: 'SELECT_FORMAT', format: formatSelection.format, csvFormat: formatSelection.csvFormat });
      onExport(formatSelection.format, formatSelection.csvFormat)
        .then((result) => {
          if (result.isOk()) {
            dispatch({
              type: 'EXPORT_COMPLETE',
              outputPaths: result.value.outputPaths,
              transactionCount: result.value.transactionCount,
            });
          } else {
            dispatch({ type: 'EXPORT_FAILED', message: result.error.message });
          }
        })
        .catch((error: unknown) => {
          dispatch({ type: 'EXPORT_FAILED', message: error instanceof Error ? error.message : String(error) });
        });
    }
  });

  if (state.transactions.length === 0) {
    return <TransactionsEmptyState state={state} />;
  }

  const showDetailPanel = state.phase === 'browse';

  return (
    <Box flexDirection="column">
      <Text> </Text>
      <TransactionsHeader state={state} />
      <Text> </Text>
      <TransactionList
        state={state}
        terminalHeight={terminalHeight}
      />
      <Divider width={terminalWidth} />
      {showDetailPanel ? <TransactionDetailPanel state={state} /> : <ExportPanel exportPanel={state.exportPanel} />}
      <Text> </Text>
      <ControlsBar
        phase={state.phase}
        hasExport={onExport !== undefined}
      />
    </Box>
  );
};

// ─── Header ─────────────────────────────────────────────────────────────────

const TransactionsHeader: FC<{ state: TransactionsViewState }> = ({ state }) => {
  const { categoryCounts, filters, displayedCount, totalCount } = state;
  const displayed = displayedCount ?? state.transactions.length;

  // Build title with filter label
  let filterLabel = '';
  if (filters.platformFilter) filterLabel = ` (${filters.platformFilter})`;
  else if (filters.assetIdFilter) filterLabel = ` (${filters.assetIdFilter})`;
  else if (filters.assetFilter) filterLabel = ` (${filters.assetFilter})`;
  else if (filters.noPriceFilter) filterLabel = ' (missing prices)';

  const categoryParts = buildCategoryParts(categoryCounts);
  const isLimited = displayedCount !== undefined;

  return (
    <Box>
      <Text bold>Transactions{filterLabel}</Text>
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
      {isLimited && (
        <>
          <Text dimColor> · </Text>
          <Text dimColor>
            showing {displayed} of {totalCount}
          </Text>
        </>
      )}
    </Box>
  );
};

// ─── List ───────────────────────────────────────────────────────────────────

const TransactionList: FC<{ state: TransactionsViewState; terminalHeight: number }> = ({ state, terminalHeight }) => {
  const { transactions, selectedIndex, scrollOffset } = state;
  const visibleRows = calculateVisibleRows(terminalHeight, CHROME_LINES);
  const columns = useMemo(
    () =>
      createColumns(transactions, {
        credit: {
          format: (item) => formatTransactionBalanceSummary(item.creditSummary),
          minWidth: 10,
        },
        debit: {
          format: (item) => formatTransactionBalanceSummary(item.debitSummary),
          minWidth: 10,
        },
        fees: {
          format: (item) => formatTransactionBalanceSummary(item.feeSummary),
          minWidth: 5,
        },
        txId: { format: (item) => `#${item.id}`, align: 'right', minWidth: 6 },
        platform: { format: (item) => item.platformKey, minWidth: 10 },
        operation: {
          format: (item) => formatTransactionOperation(item.operationCategory, item.operationType),
          minWidth: 15,
        },
      }),
    [transactions]
  );

  const startIndex = scrollOffset;
  const endIndex = Math.min(startIndex + visibleRows, transactions.length);
  const visible = transactions.slice(startIndex, endIndex);

  const hasMoreAbove = startIndex > 0;
  const hasMoreBelow = endIndex < transactions.length;

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
          <TransactionRow
            key={item.id}
            item={item}
            isSelected={actualIndex === selectedIndex}
            columns={columns}
          />
        );
      })}
      {hasMoreBelow && (
        <Text dimColor>
          {'  '}▼ {transactions.length - endIndex} more below
        </Text>
      )}
    </Box>
  );
};

// ─── Row ────────────────────────────────────────────────────────────────────

const TransactionRow: FC<{
  columns: Columns<TransactionViewItem, 'txId' | 'platform' | 'operation' | 'debit' | 'credit' | 'fees'>;
  isSelected: boolean;
  item: TransactionViewItem;
}> = ({ item, isSelected, columns }) => {
  const { credit, debit, fees, txId, platform, operation } = columns.format(item);
  const timestamp = formatTransactionTimestamp(item.datetime).slice(0, 16);
  const { icon, iconColor } = getTransactionPriceStatusDisplay(item.priceStatus);

  const isExcluded = item.excludedFromAccounting;

  if (isExcluded) {
    return (
      <SelectableRow
        dimWhenUnselected
        isSelected={isSelected}
      >
        {txId} {platform} {timestamp} {operation} {debit} {credit} {fees} {icon}
      </SelectableRow>
    );
  }

  return (
    <SelectableRow isSelected={isSelected}>
      {txId} <Text color="cyan">{platform}</Text> <Text dimColor>{timestamp}</Text> <Text dimColor>{operation}</Text>{' '}
      <SummaryValue
        color="yellow"
        value={debit}
      />{' '}
      <SummaryValue
        color="green"
        value={credit}
      />{' '}
      <SummaryValue
        color="red"
        value={fees}
      />{' '}
      <Text color={iconColor}>{icon}</Text>
    </SelectableRow>
  );
};

const SummaryValue: FC<{ color: 'green' | 'red' | 'yellow'; value: string }> = ({ color, value }) => {
  if (value === '—') {
    return <Text dimColor>{value}</Text>;
  }

  return <Text color={color}>{value}</Text>;
};

const SummaryValueInline: FC<{ color: 'green' | 'red' | 'yellow'; value: string | undefined }> = ({ color, value }) => {
  if (!value) {
    return <Text dimColor>—</Text>;
  }

  return <Text color={color}>{value}</Text>;
};

// ─── Detail Panel ───────────────────────────────────────────────────────────

const TransactionDetailPanel: FC<{ state: TransactionsViewState }> = ({ state }) => {
  const selected = state.transactions[state.selectedIndex];
  if (!selected) return null;

  return (
    <FixedHeightDetail
      height={TRANSACTION_DETAIL_LINES}
      rows={buildTransactionDetailRows(selected)}
    />
  );
};

function buildTransactionDetailRows(selected: TransactionViewItem): ReactElement[] {
  const operation = formatTransactionOperation(selected.operationCategory, selected.operationType);
  const fullTimestamp = formatTransactionTimestamp(selected.datetime);
  const rows: ReactElement[] = [
    <Text key="title">
      <Text bold>▸ #{selected.id}</Text> <Text color="cyan">{selected.platformKey}</Text>{' '}
      <Text dimColor>{operation}</Text> <Text dimColor>{fullTimestamp}</Text>
    </Text>,
    <Text key="balance-summary">
      {'  '}
      <Text dimColor>Debit: </Text>
      <SummaryValueInline
        color="yellow"
        value={selected.debitSummary}
      />
      {'  '}
      <Text dimColor>Credit: </Text>
      <SummaryValueInline
        color="green"
        value={selected.creditSummary}
      />
      {'  '}
      <Text dimColor>Fees: </Text>
      <SummaryValueInline
        color="red"
        value={selected.feeSummary}
      />
    </Text>,
  ];

  if (selected.inflows.length > 0) {
    rows.push(
      <Text key="blank-inflows"> </Text>,
      <Text
        key="inflows-label"
        dimColor
      >
        {'  '}Inflows
      </Text>
    );
    rows.push(
      ...selected.inflows.map((movement, index) => (
        <MovementLine
          key={`in-${index}`}
          movement={movement}
          sign="+"
          amountColor="green"
        />
      ))
    );
  }

  if (selected.outflows.length > 0) {
    rows.push(
      <Text key="blank-outflows"> </Text>,
      <Text
        key="outflows-label"
        dimColor
      >
        {'  '}Outflows
      </Text>
    );
    rows.push(
      ...selected.outflows.map((movement, index) => (
        <MovementLine
          key={`out-${index}`}
          movement={movement}
          sign="-"
          amountColor="yellow"
        />
      ))
    );
  }

  rows.push(<Text key="blank-fees"> </Text>);
  if (selected.fees.length > 0) {
    rows.push(
      <Text
        key="fees-label"
        dimColor
      >
        {'  '}Fees
      </Text>
    );
    rows.push(
      ...selected.fees.map((fee, index) => (
        <FeeLine
          key={`fee-${index}`}
          fee={fee}
        />
      ))
    );
  } else {
    rows.push(
      <Text
        key="no-fees"
        dimColor
      >
        {'  '}No fees
      </Text>
    );
  }

  if (selected.diagnostics.length > 0) {
    rows.push(<Text key="blank-diagnostics"> </Text>, ...buildDiagnosticRows(selected));
  }

  if (selected.userNotes.length > 0) {
    rows.push(<Text key="blank-user-notes"> </Text>, ...buildUserNoteRows(selected));
  }

  rows.push(<Text key="blank-blockchain"> </Text>, ...buildBlockchainRows(selected));
  return rows;
}

function buildDiagnosticRows(selected: TransactionViewItem): ReactElement[] {
  const rows: ReactElement[] = [
    <Text
      key="diagnostics-label"
      dimColor
    >
      {'  '}Diagnostics
    </Text>,
  ];

  rows.push(
    ...selected.diagnostics.map((diagnostic, index) => {
      const severity = diagnostic.severity ? ` [${diagnostic.severity}]` : '';
      return (
        <Text key={`diagnostic-${index}`}>
          {'    '}
          <Text>{diagnostic.code}</Text>
          <Text dimColor>{severity}</Text>
          {'  '}
          {diagnostic.message}
        </Text>
      );
    })
  );

  return rows;
}

function buildUserNoteRows(selected: TransactionViewItem): ReactElement[] {
  const rows: ReactElement[] = [
    <Text
      key="user-notes-label"
      dimColor
    >
      {'  '}User Notes
    </Text>,
  ];

  rows.push(
    ...selected.userNotes.map((userNote, index) => (
      <Text key={`user-note-${index}`}>
        {'    '}
        <Text color="cyan">user</Text>
        {'  '}
        {userNote.message}
        <Text dimColor>{` (${userNote.createdAt}${userNote.author ? ` · ${userNote.author}` : ''})`}</Text>
      </Text>
    ))
  );

  return rows;
}

const MovementLine: FC<{ amountColor: string; movement: MovementDisplayItem; sign: string }> = ({
  movement,
  sign,
  amountColor,
}) => {
  const amount = `${sign}${movement.amount}`;
  const hasPrice = movement.priceAtTxTime !== undefined;
  const isFiatValue = isFiat(movement.assetSymbol as Currency);
  const roleLabel = movement.movementRole === 'principal' ? undefined : movement.movementRole;
  const movementRef = formatMovementFingerprintRef(movement.movementFingerprint);

  return (
    <Text>
      {'    '}
      {movement.assetSymbol.padEnd(8)}
      <Text color={amountColor}>{amount.padStart(12)}</Text>
      {roleLabel && (
        <>
          {'  '}
          <Text dimColor>[{roleLabel}]</Text>
        </>
      )}
      {hasPrice ? (
        <>
          {'    '}
          <Text>{movement.priceAtTxTime!.price}</Text> <Text dimColor>USD</Text>
          {'  '}
          <Text color="green">✓</Text> <Text dimColor>{movement.priceAtTxTime!.source}</Text>
        </>
      ) : isFiatValue ? (
        <>
          {'    '}
          <Text dimColor>—</Text>
        </>
      ) : (
        <>
          {'    '}
          <Text color="yellow">⚠ no price</Text>
        </>
      )}
      {'  '}
      <Text dimColor>{movementRef}</Text>
    </Text>
  );
};

const FeeLine: FC<{ fee: FeeDisplayItem }> = ({ fee }) => {
  const amount = `-${fee.amount}`;
  const hasPrice = fee.priceAtTxTime !== undefined;

  return (
    <Text>
      {'    '}
      {fee.assetSymbol.padEnd(8)}
      <Text color="yellow">{amount.padStart(12)}</Text>
      {'  '}
      <Text dimColor>
        {fee.scope}/{fee.settlement}
      </Text>
      {hasPrice && (
        <>
          {'    '}
          <Text>{fee.priceAtTxTime!.price}</Text> <Text dimColor>USD</Text>
          {'  '}
          <Text color="green">✓</Text> <Text dimColor>{fee.priceAtTxTime!.source}</Text>
        </>
      )}
    </Text>
  );
};

function buildBlockchainRows(item: TransactionViewItem): ReactElement[] {
  if (!item.blockchain) {
    return [
      <Text>
        {'  '}
        <Text dimColor>Blockchain: —</Text>
      </Text>,
    ];
  }

  const { name, blockHeight, transactionHash, isConfirmed } = item.blockchain;
  const confirmColor = isConfirmed ? 'green' : 'yellow';
  const confirmLabel = isConfirmed ? 'confirmed' : 'pending';

  const rows: ReactElement[] = [
    <Text>
      {'  '}
      <Text dimColor>Blockchain: </Text>
      <Text color="cyan">{name}</Text>
      {blockHeight !== undefined && (
        <>
          {'  '}
          <Text dimColor>block </Text>
          <Text>{blockHeight.toLocaleString('en-US')}</Text>
        </>
      )}
      {'  '}
      <Text color={confirmColor}>{confirmLabel}</Text>
    </Text>,
    <Text>
      {'  '}
      <Text dimColor>Hash: </Text>
      <Text dimColor>{truncateHash(transactionHash)}</Text>
    </Text>,
  ];

  if (item.from) {
    rows.push(
      <Text>
        {'  '}
        <Text dimColor>From: </Text>
        <Text dimColor>{truncateHash(item.from)}</Text>
      </Text>
    );
  }
  if (item.to) {
    rows.push(
      <Text>
        {'  '}
        <Text dimColor>To: </Text>
        <Text dimColor>{truncateHash(item.to)}</Text>
      </Text>
    );
  }

  return rows;
}

// ─── Export Panel ────────────────────────────────────────────────────────────

const ExportPanel: FC<{ exportPanel: ExportPanelState | undefined }> = ({ exportPanel }) => {
  if (!exportPanel) return null;

  switch (exportPanel.phase) {
    case 'export-format':
      return <FormatSelector selectedIndex={exportPanel.selectedFormatIndex} />;
    case 'exporting':
      return (
        <ExportingSpinner
          format={exportPanel.format}
          transactionCount={exportPanel.transactionCount}
        />
      );
    case 'export-complete':
      return (
        <ExportComplete
          outputPaths={exportPanel.outputPaths}
          transactionCount={exportPanel.transactionCount}
        />
      );
    case 'export-error':
      return <ExportError message={exportPanel.message} />;
  }
};

const FormatSelector: FC<{ selectedIndex: number }> = ({ selectedIndex }) => {
  return (
    <Box
      flexDirection="column"
      paddingTop={0}
    >
      <Text bold>Export format:</Text>
      <Text> </Text>
      {FORMAT_OPTIONS.map((option, i) => {
        const isSelected = i === selectedIndex;
        const cursor = isSelected ? '▸' : ' ';
        const number = `${i + 1}`;
        return (
          <Text key={option.label}>
            {isSelected ? (
              <Text bold>
                {cursor} {number}. {option.label}
              </Text>
            ) : (
              <Text>
                {cursor} <Text dimColor>{number}.</Text> {option.label}
              </Text>
            )}
          </Text>
        );
      })}
    </Box>
  );
};

const ExportingSpinner: FC<{ format: string; transactionCount: number }> = ({ format, transactionCount }) => {
  return (
    <Box
      flexDirection="column"
      paddingTop={0}
    >
      <Text>
        <Text color="green">
          <Spinner type="dots" />
        </Text>{' '}
        Exporting {transactionCount} transactions as {format.toUpperCase()}...
      </Text>
    </Box>
  );
};

const ExportComplete: FC<{ outputPaths: string[]; transactionCount: number }> = ({ outputPaths, transactionCount }) => {
  return (
    <Box
      flexDirection="column"
      paddingTop={0}
    >
      <Text
        color="green"
        bold
      >
        Export complete!
      </Text>
      <Text> </Text>
      <Text>{transactionCount} transactions exported to:</Text>
      {outputPaths.map((p) => (
        <Text key={p}> {p}</Text>
      ))}
      <Text> </Text>
      <Text dimColor>Press any key to continue</Text>
    </Box>
  );
};

const ExportError: FC<{ message: string }> = ({ message }) => {
  return (
    <Box
      flexDirection="column"
      paddingTop={0}
    >
      <Text
        color="red"
        bold
      >
        Export failed
      </Text>
      <Text> </Text>
      <Text>{message}</Text>
      <Text> </Text>
      <Text dimColor>Press any key to continue</Text>
    </Box>
  );
};

// ─── Controls & Empty State ─────────────────────────────────────────────────

const ControlsBar: FC<{ hasExport: boolean; phase: TransactionsViewPhase }> = ({ phase, hasExport }) => {
  if (phase === 'export-format') {
    return <Text dimColor>↑↓/j/k select · 1/2/3 choose · enter confirm · esc cancel</Text>;
  }
  if (phase === 'exporting') {
    return <Text dimColor>Exporting...</Text>;
  }
  if (phase === 'export-complete' || phase === 'export-error') {
    return <Text dimColor>Press any key to continue</Text>;
  }
  const exportHint = hasExport ? ' · e export' : '';
  return <Text dimColor>↑↓/j/k · ^U/^D page · Home/End{exportHint} · q/esc quit</Text>;
};

const TransactionsEmptyState: FC<{ state: TransactionsViewState }> = ({ state }) => {
  const { filters, totalCount } = state;
  const hasFilters =
    filters.platformFilter ||
    filters.assetIdFilter ||
    filters.assetFilter ||
    filters.operationTypeFilter ||
    filters.noPriceFilter;

  return (
    <Box flexDirection="column">
      <Text> </Text>
      <TransactionsHeader state={state} />
      <Text> </Text>
      {!hasFilters && totalCount === 0 ? (
        <Box flexDirection="column">
          <Text>{'  '}No transactions found.</Text>
          <Text> </Text>
          <Text>{'  '}Add an account, then sync it:</Text>
          <Text dimColor>{'  '}exitbook accounts add kucoin-main --exchange kucoin --csv-dir ./exports/kucoin</Text>
          <Text dimColor>{'  '}exitbook import kucoin-main</Text>
        </Box>
      ) : filters.noPriceFilter ? (
        <Text>{'  '}All transactions have price data.</Text>
      ) : (
        <Text>
          {'  '}No transactions found
          {filters.platformFilter
            ? ` for ${filters.platformFilter}`
            : filters.assetIdFilter
              ? ` for ${filters.assetIdFilter}`
              : ''}
          .
        </Text>
      )}
      <Text> </Text>
      <Text dimColor>q quit</Text>
    </Box>
  );
};

// ─── Helpers ────────────────────────────────────────────────────────────────

function truncateHash(hash: string): string {
  if (hash.length <= 12) return hash;
  return `${hash.substring(0, 6)}...${hash.substring(hash.length - 4)}`;
}
