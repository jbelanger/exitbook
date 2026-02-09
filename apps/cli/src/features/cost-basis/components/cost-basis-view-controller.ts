/**
 * Cost basis view controller — reducer and keyboard handler.
 */

import { end, home, navigateDown, navigateUp, pageDown, pageUp } from '../../../ui/shared/list-navigation.js';

import { getCostBasisAssetsVisibleRows, getCostBasisDisposalsVisibleRows } from './cost-basis-view-layout.js';
import type { CostBasisAction, CostBasisState } from './cost-basis-view-state.js';
import { createCostBasisDisposalState } from './cost-basis-view-state.js';

// ─── Reducer ─────────────────────────────────────────────────────────────────

export function costBasisViewReducer(state: CostBasisState, action: CostBasisAction): CostBasisState {
  // Clear error on any navigation action
  if (
    action.type === 'NAVIGATE_UP' ||
    action.type === 'NAVIGATE_DOWN' ||
    action.type === 'PAGE_UP' ||
    action.type === 'PAGE_DOWN' ||
    action.type === 'HOME' ||
    action.type === 'END'
  ) {
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

function handleNavigation(state: CostBasisState, action: CostBasisAction): CostBasisState {
  const itemCount = state.view === 'assets' ? state.assets.length : state.disposals.length;

  const buildContext = (visibleRows: number) => ({
    itemCount,
    visibleRows,
    wrapAround: true,
  });

  const current = { selectedIndex: state.selectedIndex, scrollOffset: state.scrollOffset };

  switch (action.type) {
    case 'NAVIGATE_UP': {
      const next = navigateUp(current, buildContext(action.visibleRows));
      return { ...state, ...next };
    }
    case 'NAVIGATE_DOWN': {
      const next = navigateDown(current, buildContext(action.visibleRows));
      return { ...state, ...next };
    }
    case 'PAGE_UP': {
      const next = pageUp(current, buildContext(action.visibleRows));
      return { ...state, ...next };
    }
    case 'PAGE_DOWN': {
      const next = pageDown(current, buildContext(action.visibleRows));
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
    default:
      return state;
  }
}

// ─── Drill-Down ──────────────────────────────────────────────────────────────

function handleDrillDown(state: CostBasisState): CostBasisState {
  if (state.view !== 'assets') return state;

  const selected = state.assets[state.selectedIndex];
  if (!selected || selected.disposals.length === 0) return state;

  return createCostBasisDisposalState(selected, state, state.selectedIndex);
}

function handleDrillUp(state: CostBasisState): CostBasisState {
  if (state.view !== 'disposals') return state;

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
      ? getCostBasisAssetsVisibleRows(terminalHeight)
      : getCostBasisDisposalsVisibleRows(terminalHeight);

  const isDrilledDown = state.view === 'disposals';

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

  // Backspace: back from disposal list
  if (key.backspace && isDrilledDown) {
    dispatch({ type: 'DRILL_UP' });
    return;
  }

  // Enter: drill down into disposals
  if (key.return && state.view === 'assets') {
    dispatch({ type: 'DRILL_DOWN' });
    return;
  }

  // Arrow keys
  if (key.upArrow || input === 'k') {
    dispatch({ type: 'NAVIGATE_UP', visibleRows });
    return;
  }
  if (key.downArrow || input === 'j') {
    dispatch({ type: 'NAVIGATE_DOWN', visibleRows });
    return;
  }

  // Page up/down
  if (key.pageUp || (key.ctrl && input === 'u')) {
    dispatch({ type: 'PAGE_UP', visibleRows });
    return;
  }
  if (key.pageDown || (key.ctrl && input === 'd')) {
    dispatch({ type: 'PAGE_DOWN', visibleRows });
    return;
  }

  // Home/End
  if (key.home) {
    dispatch({ type: 'HOME' });
    return;
  }
  if (key.end) {
    dispatch({ type: 'END', visibleRows });
    return;
  }
}
