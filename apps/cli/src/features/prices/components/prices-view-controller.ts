/**
 * Prices view controller — reducer + keyboard handler
 */

import { end, home, navigateDown, navigateUp, pageDown, pageUp } from '../../../ui/shared/list-navigation.js';

import { getPricesViewVisibleRows } from './prices-view-layout.js';
import { missingRowKey, type PricesViewState } from './prices-view-state.js';

/**
 * Action types
 */
export type PricesViewAction =
  | { type: 'NAVIGATE_UP'; visibleRows: number }
  | { type: 'NAVIGATE_DOWN'; visibleRows: number }
  | { type: 'PAGE_UP'; visibleRows: number }
  | { type: 'PAGE_DOWN'; visibleRows: number }
  | { type: 'HOME' }
  | { type: 'END'; visibleRows: number }
  | { type: 'START_INPUT' }
  | { type: 'UPDATE_INPUT'; value: string }
  | { type: 'CANCEL_INPUT' }
  | { type: 'SUBMIT_PRICE' }
  | { price: string; rowKey: string; type: 'PRICE_SAVED' }
  | { error: string; type: 'PRICE_SAVE_FAILED' }
  | { type: 'CLEAR_ERROR' };

/**
 * Get item count for the current mode
 */
function getItemCount(state: PricesViewState): number {
  return state.mode === 'coverage' ? state.coverage.length : state.movements.length;
}

/**
 * Reducer function
 */
export function pricesViewReducer(state: PricesViewState, action: PricesViewAction): PricesViewState {
  const itemCount = getItemCount(state);
  const buildNavContext = (visibleRows: number) => ({
    itemCount,
    visibleRows,
    wrapAround: true,
  });

  switch (action.type) {
    case 'NAVIGATE_UP': {
      const next = navigateUp(
        { selectedIndex: state.selectedIndex, scrollOffset: state.scrollOffset },
        buildNavContext(action.visibleRows)
      );
      return { ...state, selectedIndex: next.selectedIndex, scrollOffset: next.scrollOffset };
    }

    case 'NAVIGATE_DOWN': {
      const next = navigateDown(
        { selectedIndex: state.selectedIndex, scrollOffset: state.scrollOffset },
        buildNavContext(action.visibleRows)
      );
      return { ...state, selectedIndex: next.selectedIndex, scrollOffset: next.scrollOffset };
    }

    case 'PAGE_UP': {
      const next = pageUp(
        { selectedIndex: state.selectedIndex, scrollOffset: state.scrollOffset },
        buildNavContext(action.visibleRows)
      );
      return { ...state, selectedIndex: next.selectedIndex, scrollOffset: next.scrollOffset };
    }

    case 'PAGE_DOWN': {
      const next = pageDown(
        { selectedIndex: state.selectedIndex, scrollOffset: state.scrollOffset },
        buildNavContext(action.visibleRows)
      );
      return { ...state, selectedIndex: next.selectedIndex, scrollOffset: next.scrollOffset };
    }

    case 'HOME': {
      const next = home();
      return { ...state, selectedIndex: next.selectedIndex, scrollOffset: next.scrollOffset };
    }

    case 'END': {
      const next = end(buildNavContext(action.visibleRows));
      return { ...state, selectedIndex: next.selectedIndex, scrollOffset: next.scrollOffset };
    }

    case 'START_INPUT': {
      if (state.mode !== 'missing') return state;
      const movement = state.movements[state.selectedIndex];
      if (!movement) return state;
      const key = missingRowKey(movement);
      if (state.resolvedRows.has(key)) return { ...state, error: 'Price already set for this row' };
      return { ...state, activeInput: { rowIndex: state.selectedIndex, value: '' }, error: undefined };
    }

    case 'UPDATE_INPUT': {
      if (state.mode !== 'missing' || !state.activeInput) return state;
      return { ...state, activeInput: { ...state.activeInput, value: action.value, validationError: undefined } };
    }

    case 'CANCEL_INPUT': {
      if (state.mode !== 'missing') return state;
      return { ...state, activeInput: undefined };
    }

    case 'SUBMIT_PRICE': {
      if (state.mode !== 'missing' || !state.activeInput) return state;
      const price = state.activeInput.value.trim();
      if (!price) {
        return { ...state, activeInput: { ...state.activeInput, validationError: 'Price cannot be empty' } };
      }
      const num = parseFloat(price);
      if (isNaN(num) || num <= 0) {
        return {
          ...state,
          activeInput: { ...state.activeInput, validationError: 'Price must be a positive number' },
        };
      }
      // Signal submission — useEffect watches the submitted flag
      return { ...state, activeInput: { ...state.activeInput, submitted: true, validationError: undefined } };
    }

    case 'PRICE_SAVED': {
      if (state.mode !== 'missing') return state;
      const newResolved = new Set(state.resolvedRows);
      newResolved.add(action.rowKey);

      // Store resolved price on the movement for detail panel display
      const updatedMovements = state.movements.map((m) =>
        missingRowKey(m) === action.rowKey ? { ...m, resolvedPrice: action.price } : m
      );

      // Advance cursor to next unresolved row
      let nextIndex = state.selectedIndex;
      for (let i = state.selectedIndex + 1; i < updatedMovements.length; i++) {
        if (!newResolved.has(missingRowKey(updatedMovements[i]!))) {
          nextIndex = i;
          break;
        }
      }

      return {
        ...state,
        movements: updatedMovements,
        resolvedRows: newResolved,
        activeInput: undefined,
        selectedIndex: nextIndex,
        error: undefined,
      };
    }

    case 'PRICE_SAVE_FAILED': {
      if (state.mode !== 'missing') return state;
      return { ...state, activeInput: undefined, error: action.error };
    }

    case 'CLEAR_ERROR': {
      if (state.mode !== 'missing') return state;
      return { ...state, error: undefined };
    }

    default:
      return state;
  }
}

/**
 * Handle keyboard input — routes to reducer dispatch.
 * In input mode, only input-related keys are processed.
 */
export function handlePricesKeyboardInput(
  input: string,
  key: {
    backspace: boolean;
    ctrl: boolean;
    delete: boolean;
    downArrow: boolean;
    end: boolean;
    escape: boolean;
    home: boolean;
    pageDown: boolean;
    pageUp: boolean;
    return: boolean;
    upArrow: boolean;
  },
  dispatch: (action: PricesViewAction) => void,
  onQuit: () => void,
  terminalHeight: number,
  state: PricesViewState
): void {
  const visibleRows = getPricesViewVisibleRows(terminalHeight, state.mode);

  // Input mode (missing only)
  if (state.mode === 'missing' && state.activeInput) {
    if (key.escape) {
      dispatch({ type: 'CANCEL_INPUT' });
      return;
    }
    if (key.return) {
      dispatch({ type: 'SUBMIT_PRICE' });
      return;
    }
    if (key.backspace || key.delete) {
      dispatch({ type: 'UPDATE_INPUT', value: state.activeInput.value.slice(0, -1) });
      return;
    }
    // Accept digits and dot for price entry
    if (/^[\d.]$/.test(input)) {
      dispatch({ type: 'UPDATE_INPUT', value: state.activeInput.value + input });
      return;
    }
    return;
  }

  // Normal mode: quit
  if (input === 'q' || key.escape) {
    onQuit();
    return;
  }

  // Navigation
  if (key.upArrow || input === 'k') {
    dispatch({ type: 'NAVIGATE_UP', visibleRows });
    return;
  }
  if (key.downArrow || input === 'j') {
    dispatch({ type: 'NAVIGATE_DOWN', visibleRows });
    return;
  }
  if (key.pageUp || (key.ctrl && input === 'u')) {
    dispatch({ type: 'PAGE_UP', visibleRows });
    return;
  }
  if (key.pageDown || (key.ctrl && input === 'd')) {
    dispatch({ type: 'PAGE_DOWN', visibleRows });
    return;
  }
  if (key.home) {
    dispatch({ type: 'HOME' });
    return;
  }
  if (key.end) {
    dispatch({ type: 'END', visibleRows });
    return;
  }

  // Set price (missing mode only)
  if (state.mode === 'missing' && input === 's') {
    dispatch({ type: 'START_INPUT' });
    return;
  }
}
