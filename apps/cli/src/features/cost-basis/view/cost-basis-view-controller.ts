/**
 * Cost basis view controller — reducer and keyboard handler.
 */

import { calculateVisibleRows } from '../../../ui/shared/chrome-layout.js';
import {
  dispatchListNavigationKeys,
  isListNavigationAction,
  type ListNavigationAction,
  reduceListNavigation,
} from '../../../ui/shared/list-navigation.js';

import { COST_BASIS_ASSETS_CHROME_LINES, COST_BASIS_TIMELINE_CHROME_LINES } from './cost-basis-view-components.jsx';
import type { CostBasisAction, CostBasisState } from './cost-basis-view-state.js';
import { createCostBasisTimelineState } from './cost-basis-view-state.js';

// ─── Reducer ─────────────────────────────────────────────────────────────────

export function costBasisViewReducer(state: CostBasisState, action: CostBasisAction): CostBasisState {
  if (isListNavigationAction(action)) {
    const cleared = state.error ? { ...state, error: undefined } : state;
    return handleNavigation(cleared, action);
  }

  switch (action.type) {
    case 'DRILL_DOWN':
      return handleDrillDown(state);
    case 'DRILL_UP':
      return handleDrillUp(state);
    case 'SET_ERROR':
      return { ...state, error: action.error };
    case 'CLEAR_ERROR':
      return { ...state, error: undefined };
    default:
      return state;
  }
}

// ─── Navigation ──────────────────────────────────────────────────────────────

function handleNavigation(state: CostBasisState, action: ListNavigationAction): CostBasisState {
  const itemCount = state.view === 'assets' ? state.assets.length : state.events.length;
  const nav = reduceListNavigation(
    { selectedIndex: state.selectedIndex, scrollOffset: state.scrollOffset },
    action,
    itemCount
  );
  return { ...state, ...nav };
}

// ─── Drill-Down ──────────────────────────────────────────────────────────────

function handleDrillDown(state: CostBasisState): CostBasisState {
  if (state.view !== 'assets') return state;

  const selected = state.assets[state.selectedIndex];
  if (!selected) return state;

  // Allow drill-down if any events exist (lots, disposals, or transfers)
  const hasEvents = selected.lots.length > 0 || selected.disposals.length > 0 || selected.transfers.length > 0;
  if (!hasEvents) return state;

  return createCostBasisTimelineState(selected, state, state.selectedIndex);
}

function handleDrillUp(state: CostBasisState): CostBasisState {
  if (state.view !== 'timeline') return state;

  return state.parentState;
}

// ─── Keyboard Handler ────────────────────────────────────────────────────────

export function handleCostBasisKeyboardInput(
  input: string,
  key: {
    backspace: boolean;
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
  state: CostBasisState,
  dispatch: (action: CostBasisAction) => void,
  onQuit: () => void,
  terminalHeight: number
): void {
  const visibleRows =
    state.view === 'assets'
      ? calculateVisibleRows(terminalHeight, COST_BASIS_ASSETS_CHROME_LINES)
      : calculateVisibleRows(terminalHeight, COST_BASIS_TIMELINE_CHROME_LINES);

  const isDrilledDown = state.view === 'timeline';

  // Quit / back
  if (key.escape) {
    if (isDrilledDown) {
      dispatch({ type: 'DRILL_UP' });
    } else {
      onQuit();
    }
    return;
  }

  if (input === 'q') {
    if (isDrilledDown) {
      dispatch({ type: 'DRILL_UP' });
    } else {
      onQuit();
    }
    return;
  }

  // Backspace: back from timeline view
  if (key.backspace && isDrilledDown) {
    dispatch({ type: 'DRILL_UP' });
    return;
  }

  // Enter: drill down into asset history timeline
  if (key.return && state.view === 'assets') {
    dispatch({ type: 'DRILL_DOWN' });
    return;
  }

  dispatchListNavigationKeys(key, input, dispatch, visibleRows);
}
