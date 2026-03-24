/**
 * Prices view controller — reducer + keyboard handler
 */

import { calculateVisibleRows } from '../../../ui/shared/chrome-layout.js';
import {
  dispatchListNavigationKeys,
  isListNavigationAction,
  type ListNavigationAction,
  type ListNavigationKey,
  reduceListNavigation,
} from '../../../ui/shared/list-navigation.js';
import type { AssetBreakdownEntry, MissingPriceMovement } from '../prices-view-model.js';

import { getCoverageChromeLines, getMissingChromeLines } from './prices-view-components.jsx';
import { missingRowKey, type PricesViewCoverageState, type PricesViewState } from './prices-view-state.js';

/**
 * Action types
 */
type PricesViewAction =
  | ListNavigationAction
  | { type: 'START_INPUT' }
  | { type: 'UPDATE_INPUT'; value: string }
  | { type: 'CANCEL_INPUT' }
  | { type: 'SUBMIT_PRICE' }
  | { price: string; rowKey: string; type: 'PRICE_SAVED' }
  | { error: string; type: 'PRICE_SAVE_FAILED' }
  | { type: 'CLEAR_ERROR' }
  | { type: 'START_DRILL_DOWN' }
  | {
      asset: string;
      assetBreakdown: AssetBreakdownEntry[];
      movements: MissingPriceMovement[];
      parentState: PricesViewCoverageState;
      type: 'DRILL_DOWN_COMPLETE';
    }
  | { error: string; type: 'DRILL_DOWN_FAILED' }
  | { type: 'GO_BACK' };

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
  if (isListNavigationAction(action)) {
    const nav = reduceListNavigation(
      { selectedIndex: state.selectedIndex, scrollOffset: state.scrollOffset },
      action,
      getItemCount(state)
    );
    return { ...state, ...nav };
  }

  switch (action.type) {
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

    case 'START_DRILL_DOWN': {
      if (state.mode !== 'coverage') return state;
      const selected = state.coverage[state.selectedIndex];
      if (!selected || selected.missing_price === 0) return state;
      return { ...state, drillDownAsset: selected.assetSymbol, error: undefined };
    }

    case 'DRILL_DOWN_COMPLETE': {
      return {
        mode: 'missing',
        movements: action.movements,
        assetBreakdown: action.assetBreakdown,
        selectedIndex: 0,
        scrollOffset: 0,
        resolvedRows: new Set(),
        activeInput: undefined,
        assetFilter: action.asset,
        error: undefined,
        parentCoverageState: action.parentState,
      };
    }

    case 'DRILL_DOWN_FAILED': {
      if (state.mode !== 'coverage') return state;
      return { ...state, drillDownAsset: undefined, error: action.error };
    }

    case 'GO_BACK': {
      if (state.mode !== 'missing' || !state.parentCoverageState) return state;
      const parent = state.parentCoverageState;
      // Count unique transaction IDs — coverage stats are per-transaction, not per-movement.
      // A single transaction can contribute multiple resolved rows for the same asset.
      const resolvedTxIds = new Set<number>();
      for (const key of state.resolvedRows) {
        const txId = parseInt(key.split(':')[0]!, 10);
        resolvedTxIds.add(txId);
      }
      const resolvedCount = resolvedTxIds.size;

      // Optimistically update the parent coverage counts for the drilled asset
      if (resolvedCount > 0 && state.assetFilter) {
        const asset = state.assetFilter;
        const updatedCoverage = parent.coverage.map((c) => {
          if (c.assetSymbol !== asset) return c;
          const newMissing = Math.max(0, c.missing_price - resolvedCount);
          const newWithPrice = c.with_price + resolvedCount;
          const newPct = c.total_transactions > 0 ? (newWithPrice / c.total_transactions) * 100 : 0;
          return { ...c, missing_price: newMissing, with_price: newWithPrice, coverage_percentage: newPct };
        });

        const summaryMissing = Math.max(0, parent.summary.missing_price - resolvedCount);
        const summaryWith = parent.summary.with_price + resolvedCount;
        const totalForPct = summaryWith + summaryMissing;
        const summaryPct = totalForPct > 0 ? (summaryWith / totalForPct) * 100 : 0;

        return {
          ...parent,
          coverage: updatedCoverage,
          summary: {
            ...parent.summary,
            missing_price: summaryMissing,
            with_price: summaryWith,
            overall_coverage_percentage: summaryPct,
          },
          drillDownAsset: undefined,
        };
      }

      return { ...parent, drillDownAsset: undefined };
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
  key: ListNavigationKey & { backspace: boolean; delete: boolean; return: boolean },
  dispatch: (action: PricesViewAction) => void,
  onQuit: () => void,
  terminalHeight: number,
  state: PricesViewState
): void {
  const visibleRows =
    state.mode === 'coverage'
      ? calculateVisibleRows(terminalHeight, getCoverageChromeLines())
      : calculateVisibleRows(terminalHeight, getMissingChromeLines(state.assetBreakdown.length));

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

  // Coverage mode: Enter drills into missing prices
  if (state.mode === 'coverage' && key.return) {
    dispatch({ type: 'START_DRILL_DOWN' });
    return;
  }

  // Missing mode with parent: Esc goes back, q always quits
  if (state.mode === 'missing' && state.parentCoverageState) {
    if (key.escape) {
      dispatch({ type: 'GO_BACK' });
      return;
    }
    if (input === 'q') {
      onQuit();
      return;
    }
  } else if (input === 'q' || key.escape) {
    // Normal mode: quit
    onQuit();
    return;
  }

  // Navigation
  if (dispatchListNavigationKeys(key, input, dispatch, visibleRows)) {
    return;
  }

  // Set price (missing mode only)
  if (state.mode === 'missing' && input === 's') {
    dispatch({ type: 'START_INPUT' });
    return;
  }
}
