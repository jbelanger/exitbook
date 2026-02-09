/**
 * Transactions view controller — reducer and keyboard handler
 */

import { end, home, navigateDown, navigateUp, pageDown, pageUp } from '../../../ui/shared/list-navigation.js';
import type { CsvFormat, ExportFormat } from '../../export/export-utils.js';

import { getTransactionsViewVisibleRows } from './transactions-view-layout.js';
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
export type TransactionsViewAction =
  | { type: 'NAVIGATE_UP'; visibleRows: number }
  | { type: 'NAVIGATE_DOWN'; visibleRows: number }
  | { type: 'PAGE_UP'; visibleRows: number }
  | { type: 'PAGE_DOWN'; visibleRows: number }
  | { type: 'HOME' }
  | { type: 'END'; visibleRows: number }
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
  const itemCount = state.transactions.length;
  const buildContext = (visibleRows: number) => ({
    itemCount,
    visibleRows,
    wrapAround: true,
  });

  switch (action.type) {
    case 'NAVIGATE_UP': {
      const next = navigateUp(
        { selectedIndex: state.selectedIndex, scrollOffset: state.scrollOffset },
        buildContext(action.visibleRows)
      );
      return { ...state, ...next };
    }

    case 'NAVIGATE_DOWN': {
      const next = navigateDown(
        { selectedIndex: state.selectedIndex, scrollOffset: state.scrollOffset },
        buildContext(action.visibleRows)
      );
      return { ...state, ...next };
    }

    case 'PAGE_UP': {
      const next = pageUp(
        { selectedIndex: state.selectedIndex, scrollOffset: state.scrollOffset },
        buildContext(action.visibleRows)
      );
      return { ...state, ...next };
    }

    case 'PAGE_DOWN': {
      const next = pageDown(
        { selectedIndex: state.selectedIndex, scrollOffset: state.scrollOffset },
        buildContext(action.visibleRows)
      );
      return { ...state, ...next };
    }

    case 'HOME': {
      const next = home();
      return { ...state, ...next };
    }

    case 'END': {
      const next = end(buildContext(action.visibleRows));
      return { ...state, ...next };
    }

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
  const visibleRows = getTransactionsViewVisibleRows(terminalHeight);

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

  // Arrow keys
  if (key.upArrow) {
    dispatch({ type: 'NAVIGATE_UP', visibleRows });
    return undefined;
  }
  if (key.downArrow) {
    dispatch({ type: 'NAVIGATE_DOWN', visibleRows });
    return undefined;
  }

  // Page up/down
  if (key.pageUp || (key.ctrl && input === 'u')) {
    dispatch({ type: 'PAGE_UP', visibleRows });
    return undefined;
  }
  if (key.pageDown || (key.ctrl && input === 'd')) {
    dispatch({ type: 'PAGE_DOWN', visibleRows });
    return undefined;
  }

  // Home/End
  if (key.home) {
    dispatch({ type: 'HOME' });
    return undefined;
  }
  if (key.end) {
    dispatch({ type: 'END', visibleRows });
    return undefined;
  }

  // Vim keys
  if (input === 'k') {
    dispatch({ type: 'NAVIGATE_UP', visibleRows });
    return undefined;
  }
  if (input === 'j') {
    dispatch({ type: 'NAVIGATE_DOWN', visibleRows });
    return undefined;
  }

  return undefined;
}
