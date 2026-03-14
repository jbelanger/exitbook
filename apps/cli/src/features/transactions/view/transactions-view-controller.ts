/**
 * Transactions view controller — reducer and keyboard handler
 */

import { calculateVisibleRows } from '../../../ui/shared/chrome-layout.js';
import {
  dispatchListNavigationKeys,
  isListNavigationAction,
  type ListNavigationAction,
  reduceListNavigation,
} from '../../../ui/shared/list-navigation.js';
import type { CsvFormat, ExportFormat } from '../command/transactions-export-utils.js';

import { CHROME_LINES } from './transactions-view-components.jsx';
import type { TransactionsViewState } from './transactions-view-state.js';

/**
 * Format options for the export format selector.
 */
export const FORMAT_OPTIONS: { csvFormat: CsvFormat | undefined; format: ExportFormat; label: string }[] = [
  { label: 'CSV (normalized)', format: 'csv', csvFormat: 'normalized' },
  { label: 'CSV (simple)', format: 'csv', csvFormat: 'simple' },
  { label: 'JSON', format: 'json', csvFormat: undefined },
];

/**
 * Action types for transactions view (navigation + export flow).
 */
type TransactionsViewAction =
  | ListNavigationAction
  | { type: 'OPEN_EXPORT' }
  | { csvFormat: CsvFormat | undefined; format: ExportFormat; type: 'SELECT_FORMAT' }
  | { outputPaths: string[]; transactionCount: number; type: 'EXPORT_COMPLETE' }
  | { message: string; type: 'EXPORT_FAILED' }
  | { type: 'CANCEL_EXPORT' }
  | { type: 'DISMISS_EXPORT_RESULT' }
  | { direction: 'up' | 'down'; type: 'MOVE_FORMAT_CURSOR' };

/**
 * Reducer function for transactions view state
 */
export function transactionsViewReducer(
  state: TransactionsViewState,
  action: TransactionsViewAction
): TransactionsViewState {
  if (isListNavigationAction(action)) {
    const nav = reduceListNavigation(
      { selectedIndex: state.selectedIndex, scrollOffset: state.scrollOffset },
      action,
      state.transactions.length
    );
    return { ...state, ...nav };
  }

  switch (action.type) {
    case 'OPEN_EXPORT': {
      if (state.phase !== 'browse') return state;
      return { ...state, phase: 'export-format', exportPanel: { phase: 'export-format', selectedFormatIndex: 0 } };
    }

    case 'SELECT_FORMAT': {
      if (state.phase !== 'export-format') return state;
      return {
        ...state,
        phase: 'exporting',
        exportPanel: { phase: 'exporting', format: action.format, transactionCount: state.totalCount },
      };
    }

    case 'EXPORT_COMPLETE': {
      if (state.phase !== 'exporting') return state;
      return {
        ...state,
        phase: 'export-complete',
        exportPanel: {
          phase: 'export-complete',
          outputPaths: action.outputPaths,
          transactionCount: action.transactionCount,
        },
      };
    }

    case 'EXPORT_FAILED': {
      if (state.phase !== 'exporting') return state;
      return {
        ...state,
        phase: 'export-error',
        exportPanel: { phase: 'export-error', message: action.message },
      };
    }

    case 'CANCEL_EXPORT': {
      if (state.phase !== 'export-format') return state;
      return { ...state, phase: 'browse', exportPanel: undefined };
    }

    case 'DISMISS_EXPORT_RESULT': {
      if (state.phase !== 'export-complete' && state.phase !== 'export-error') return state;
      return { ...state, phase: 'browse', exportPanel: undefined };
    }

    case 'MOVE_FORMAT_CURSOR': {
      if (state.phase !== 'export-format' || state.exportPanel?.phase !== 'export-format') return state;
      const len = FORMAT_OPTIONS.length;
      const delta = action.direction === 'up' ? -1 : 1;
      const newIndex = (state.exportPanel.selectedFormatIndex + delta + len) % len;
      return { ...state, exportPanel: { phase: 'export-format', selectedFormatIndex: newIndex } };
    }

    default:
      return state;
  }
}

/**
 * Handle keyboard input for transactions view.
 *
 * Returns the selected format option when a format is chosen (caller must invoke onExport),
 * or undefined when the key was handled internally.
 */
export function handleTransactionsKeyboardInput(
  input: string,
  key: {
    ctrl: boolean;
    downArrow: boolean;
    end: boolean;
    escape: boolean;
    home: boolean;
    pageDown: boolean;
    pageUp: boolean;
    return: boolean;
    upArrow: boolean;
  },
  dispatch: (action: TransactionsViewAction) => void,
  onQuit: () => void,
  terminalHeight: number,
  phase: TransactionsViewState['phase'],
  exportPanel: TransactionsViewState['exportPanel']
): { csvFormat: CsvFormat | undefined; format: ExportFormat } | undefined {
  const visibleRows = calculateVisibleRows(terminalHeight, CHROME_LINES);

  // Ignore all input while exporting
  if (phase === 'exporting') return undefined;

  // Dismiss export result on any key
  if (phase === 'export-complete' || phase === 'export-error') {
    dispatch({ type: 'DISMISS_EXPORT_RESULT' });
    return undefined;
  }

  // Export format selector phase
  if (phase === 'export-format' && exportPanel?.phase === 'export-format') {
    // Escape cancels
    if (key.escape) {
      dispatch({ type: 'CANCEL_EXPORT' });
      return undefined;
    }

    // Direct number selection
    if (input === '1' || input === '2' || input === '3') {
      const option = FORMAT_OPTIONS[parseInt(input, 10) - 1]!;
      return { format: option.format, csvFormat: option.csvFormat };
    }

    // Navigate format list
    if (key.upArrow || input === 'k') {
      dispatch({ type: 'MOVE_FORMAT_CURSOR', direction: 'up' });
      return undefined;
    }
    if (key.downArrow || input === 'j') {
      dispatch({ type: 'MOVE_FORMAT_CURSOR', direction: 'down' });
      return undefined;
    }

    // Enter selects current
    if (key.return) {
      const option = FORMAT_OPTIONS[exportPanel.selectedFormatIndex]!;
      return { format: option.format, csvFormat: option.csvFormat };
    }

    return undefined;
  }

  // Browse phase

  // Quit
  if (input === 'q' || key.escape) {
    onQuit();
    return undefined;
  }

  // Export
  if (input === 'e') {
    dispatch({ type: 'OPEN_EXPORT' });
    return undefined;
  }

  dispatchListNavigationKeys(key, input, dispatch, visibleRows);
  return undefined;
}
