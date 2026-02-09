/**
 * Transactions view TUI components
 */

import { Currency } from '@exitbook/core';
import { Box, Text, useInput, useStdout } from 'ink';
import Spinner from 'ink-spinner';
import { useReducer, type FC } from 'react';

import { Divider } from '../../../ui/shared/index.js';

import {
  FORMAT_OPTIONS,
  handleTransactionsKeyboardInput,
  transactionsViewReducer,
} from './transactions-view-controller.js';
import { getTransactionsViewVisibleRows } from './transactions-view-layout.js';
import type {
  CategoryCounts,
  ExportPanelState,
  FeeDisplayItem,
  MovementDisplayItem,
  OnExport,
  TransactionViewItem,
  TransactionsViewPhase,
  TransactionsViewState,
} from './transactions-view-state.js';

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
  if (filters.sourceFilter) filterLabel = ` (${filters.sourceFilter})`;
  else if (filters.assetFilter) filterLabel = ` (${filters.assetFilter})`;
  else if (filters.noPriceFilter) filterLabel = ' (missing prices)';

  const categoryParts = buildCategoryParts(categoryCounts);
  const isLimited = displayedCount !== undefined;

  return (
    <Box>
      <Text bold>Transactions{filterLabel}</Text>
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

function buildCategoryParts(counts: CategoryCounts): { count: number; label: string }[] {
  const parts: { count: number; label: string }[] = [];
  if (counts.trade > 0) parts.push({ label: 'trade', count: counts.trade });
  if (counts.transfer > 0) parts.push({ label: 'transfer', count: counts.transfer });
  if (counts.staking > 0) parts.push({ label: 'staking', count: counts.staking });
  if (counts.other > 0) parts.push({ label: 'other', count: counts.other });
  return parts;
}

// ─── List ───────────────────────────────────────────────────────────────────

const TransactionList: FC<{ state: TransactionsViewState; terminalHeight: number }> = ({ state, terminalHeight }) => {
  const { transactions, selectedIndex, scrollOffset } = state;
  const visibleRows = getTransactionsViewVisibleRows(terminalHeight);

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

const TransactionRow: FC<{ isSelected: boolean; item: TransactionViewItem }> = ({ item, isSelected }) => {
  const cursor = isSelected ? '▸' : ' ';
  const txId = `#${item.id}`.padStart(6);
  const source = item.source.padEnd(10).substring(0, 10);
  const timestamp = item.datetime.substring(0, 16).replace('T', ' ');
  const operation = formatOperationShort(item.operationCategory, item.operationType).padEnd(15).substring(0, 15);
  const asset = (item.primaryAsset ?? '').padEnd(10).substring(0, 10);
  const dir = item.primaryDirection === 'in' ? 'IN ' : item.primaryDirection === 'out' ? 'OUT' : '   ';
  const amount = formatAmount(item.primaryAmount ?? '', 12);
  const { icon, iconColor } = getPriceStatusIcon(item.priceStatus);

  const isExcluded = item.excludedFromAccounting || item.isSpam;

  if (isSelected) {
    return (
      <Text bold>
        {cursor} {txId} {source} <Text dimColor>{timestamp}</Text> {operation} {asset} {dir} {amount} {icon}
      </Text>
    );
  }

  if (isExcluded) {
    return (
      <Text dimColor>
        {cursor} {txId} {source} {timestamp} {operation} {asset} {dir} {amount} {icon}
      </Text>
    );
  }

  const dirColor = item.primaryDirection === 'in' ? 'green' : 'yellow';

  return (
    <Text>
      {cursor} {txId} <Text color="cyan">{source}</Text> <Text dimColor>{timestamp}</Text>{' '}
      <Text dimColor>{operation}</Text> {asset} <Text color={dirColor}>{dir}</Text> <Text color="green">{amount}</Text>{' '}
      <Text color={iconColor}>{icon}</Text>
    </Text>
  );
};

// ─── Detail Panel ───────────────────────────────────────────────────────────

const TransactionDetailPanel: FC<{ state: TransactionsViewState }> = ({ state }) => {
  const selected = state.transactions[state.selectedIndex];
  if (!selected) return null;

  const operation = formatOperationShort(selected.operationCategory, selected.operationType);
  const fullTimestamp = selected.datetime.replace('T', ' ').replace('Z', '');

  return (
    <Box
      flexDirection="column"
      paddingTop={0}
    >
      <Text>
        <Text bold>▸ #{selected.id}</Text> <Text color="cyan">{selected.source}</Text> <Text dimColor>{operation}</Text>{' '}
        <Text dimColor>{fullTimestamp}</Text>
      </Text>

      {selected.inflows.length > 0 && (
        <>
          <Text> </Text>
          <Text dimColor>{'  '}Inflows</Text>
          {selected.inflows.map((m, i) => (
            <MovementLine
              key={`in-${i}`}
              movement={m}
              sign="+"
              amountColor="green"
            />
          ))}
        </>
      )}

      {selected.outflows.length > 0 && (
        <>
          <Text> </Text>
          <Text dimColor>{'  '}Outflows</Text>
          {selected.outflows.map((m, i) => (
            <MovementLine
              key={`out-${i}`}
              movement={m}
              sign="-"
              amountColor="yellow"
            />
          ))}
        </>
      )}

      <Text> </Text>
      {selected.fees.length > 0 ? (
        <>
          <Text dimColor>{'  '}Fees</Text>
          {selected.fees.map((f, i) => (
            <FeeLine
              key={`fee-${i}`}
              fee={f}
            />
          ))}
        </>
      ) : (
        <Text dimColor>{'  '}No fees</Text>
      )}

      <Text> </Text>
      <BlockchainSection item={selected} />
    </Box>
  );
};

const MovementLine: FC<{ amountColor: string; movement: MovementDisplayItem; sign: string }> = ({
  movement,
  sign,
  amountColor,
}) => {
  const amount = `${sign}${movement.amount}`;
  const hasPrice = movement.priceAtTxTime !== undefined;
  const isFiat = Currency.create(movement.assetSymbol).isFiat();

  return (
    <Text>
      {'    '}
      {movement.assetSymbol.padEnd(8)}
      <Text color={amountColor}>{amount.padStart(12)}</Text>
      {hasPrice ? (
        <>
          {'    '}
          <Text>{movement.priceAtTxTime!.price}</Text> <Text dimColor>USD</Text>
          {'  '}
          <Text color="green">✓</Text> <Text dimColor>{movement.priceAtTxTime!.source}</Text>
        </>
      ) : isFiat ? (
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

const BlockchainSection: FC<{ item: TransactionViewItem }> = ({ item }) => {
  if (!item.blockchain) {
    return (
      <Text>
        {'  '}
        <Text dimColor>Blockchain: —</Text>
      </Text>
    );
  }

  const { name, blockHeight, transactionHash, isConfirmed } = item.blockchain;
  const confirmColor = isConfirmed ? 'green' : 'yellow';
  const confirmLabel = isConfirmed ? 'confirmed' : 'pending';

  return (
    <Box flexDirection="column">
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
      </Text>
      <Text>
        {'  '}
        <Text dimColor>Hash: </Text>
        <Text dimColor>{truncateHash(transactionHash)}</Text>
      </Text>
      {item.from && (
        <Text>
          {'  '}
          <Text dimColor>From: </Text>
          <Text dimColor>{truncateHash(item.from)}</Text>
        </Text>
      )}
      {item.to && (
        <Text>
          {'  '}
          <Text dimColor>To: </Text>
          <Text dimColor>{truncateHash(item.to)}</Text>
        </Text>
      )}
    </Box>
  );
};

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
    filters.sourceFilter || filters.assetFilter || filters.operationTypeFilter || filters.noPriceFilter;

  return (
    <Box flexDirection="column">
      <Text> </Text>
      <TransactionsHeader state={state} />
      <Text> </Text>
      {!hasFilters && totalCount === 0 ? (
        <Box flexDirection="column">
          <Text>{'  '}No transactions found.</Text>
          <Text> </Text>
          <Text>{'  '}Import transactions first:</Text>
          <Text dimColor>{'  '}exitbook import --exchange kraken --csv-dir ./exports/kraken</Text>
        </Box>
      ) : filters.noPriceFilter ? (
        <Text>{'  '}All transactions have price data.</Text>
      ) : (
        <Text>
          {'  '}No transactions found{filters.sourceFilter ? ` for ${filters.sourceFilter}` : ''}.
        </Text>
      )}
      <Text> </Text>
      <Text dimColor>q quit</Text>
    </Box>
  );
};

// ─── Helpers ────────────────────────────────────────────────────────────────

function formatOperationShort(category: string, type: string): string {
  // Abbreviate common category names for list view
  const catShort =
    category === 'transfer'
      ? 'transfer'
      : category === 'staking'
        ? 'staking'
        : category === 'trade'
          ? 'trade'
          : category;
  return `${catShort}/${type}`;
}

function formatAmount(amount: string, width: number): string {
  const num = parseFloat(amount);
  if (isNaN(num)) return amount.padStart(width);
  return num.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 4 }).padStart(width);
}

function getPriceStatusIcon(status: string): { icon: string; iconColor: string } {
  switch (status) {
    case 'all':
      return { icon: '✓', iconColor: 'green' };
    case 'partial':
      return { icon: '⚠', iconColor: 'yellow' };
    case 'none':
      return { icon: '✗', iconColor: 'red' };
    case 'not-needed':
      return { icon: '·', iconColor: 'dim' };
    default:
      return { icon: '·', iconColor: 'dim' };
  }
}

function truncateHash(hash: string): string {
  if (hash.length <= 12) return hash;
  return `${hash.substring(0, 6)}...${hash.substring(hash.length - 4)}`;
}
