/**
 * Portfolio view controller — reducer and keyboard handler.
 */

import {
  dispatchListNavigationKeys,
  isListNavigationAction,
  type ListNavigationAction,
  type ListNavigationKey,
  reduceListNavigation,
} from '../../../ui/shared/list-navigation.js';
import { sortPositions } from '../command/portfolio-utils.js';

import { getPortfolioAssetsVisibleRows, getPortfolioHistoryVisibleRows } from './portfolio-view-components.jsx';
import type { PortfolioAction, PortfolioState } from './portfolio-view-state.js';
import { createPortfolioHistoryState, getVisiblePositions } from './portfolio-view-state.js';

const SORT_CYCLE: ('value' | 'gain' | 'loss' | 'allocation')[] = ['value', 'gain', 'loss', 'allocation'];
const PNL_MODE_CYCLE: ('unrealized' | 'realized' | 'both')[] = ['unrealized', 'realized', 'both'];

export function portfolioViewReducer(state: PortfolioState, action: PortfolioAction): PortfolioState {
  if (isListNavigationAction(action)) {
    const cleared = state.error ? { ...state, error: undefined } : state;
    return handleNavigation(cleared, action);
  }

  switch (action.type) {
    case 'CYCLE_SORT':
      return handleCycleSort(state);
    case 'CYCLE_PNL_MODE':
      return handleCyclePnlMode(state);
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

function handleNavigation(state: PortfolioState, action: ListNavigationAction): PortfolioState {
  const itemCount = state.view === 'assets' ? getVisiblePositions(state).length : state.transactions.length;
  const nav = reduceListNavigation(
    { selectedIndex: state.selectedIndex, scrollOffset: state.scrollOffset },
    action,
    itemCount
  );
  return { ...state, ...nav };
}

function handleCycleSort(state: PortfolioState): PortfolioState {
  if (state.view !== 'assets' || getVisiblePositions(state).length === 0) {
    return state;
  }

  const visiblePositions = getVisiblePositions(state);
  const currentIndex = SORT_CYCLE.indexOf(state.sortMode);
  const nextMode = SORT_CYCLE[(currentIndex + 1) % SORT_CYCLE.length]!;
  const selectedAssetId = visiblePositions[state.selectedIndex]?.assetId;

  const allPositions = [...state.positions, ...state.closedPositions];
  const sortedAll = sortPositions(allPositions, nextMode);

  const sortedHoldings = sortedAll.filter((position) => !position.isClosedPosition);
  const sortedClosed = sortedAll.filter((position) => position.isClosedPosition);

  const nextState = {
    ...state,
    sortMode: nextMode,
    positions: sortedHoldings,
    closedPositions: sortedClosed,
  };
  const nextVisiblePositions = getVisiblePositions(nextState);

  const selectedIndex = selectedAssetId
    ? Math.max(
        0,
        nextVisiblePositions.findIndex((position) => position.assetId === selectedAssetId)
      )
    : 0;

  return {
    ...nextState,
    selectedIndex,
    scrollOffset: Math.min(state.scrollOffset, Math.max(0, nextVisiblePositions.length - 1)),
  };
}

function handleCyclePnlMode(state: PortfolioState): PortfolioState {
  if (state.view !== 'assets') {
    return state;
  }

  const visiblePositions = getVisiblePositions(state);
  const selectedAssetId = visiblePositions[state.selectedIndex]?.assetId;
  const currentIndex = PNL_MODE_CYCLE.indexOf(state.pnlMode);
  const nextMode = PNL_MODE_CYCLE[(currentIndex + 1) % PNL_MODE_CYCLE.length]!;
  const nextState = {
    ...state,
    pnlMode: nextMode,
  };
  const nextVisiblePositions = getVisiblePositions(nextState);
  const selectedIndex = selectedAssetId
    ? Math.max(
        0,
        nextVisiblePositions.findIndex((position) => position.assetId === selectedAssetId)
      )
    : 0;

  return {
    ...nextState,
    selectedIndex,
    scrollOffset: Math.min(state.scrollOffset, Math.max(0, nextVisiblePositions.length - 1)),
  };
}

function handleDrillDown(state: PortfolioState): PortfolioState {
  if (state.view !== 'assets') {
    return state;
  }

  const selected = getVisiblePositions(state)[state.selectedIndex];
  if (!selected) {
    return state;
  }

  return createPortfolioHistoryState(selected, state, state.selectedIndex);
}

function handleDrillUp(state: PortfolioState): PortfolioState {
  if (state.view !== 'history') {
    return state;
  }

  return state.parentState;
}

export function handlePortfolioKeyboardInput(
  input: string,
  key: ListNavigationKey & { backspace: boolean; return: boolean },
  state: PortfolioState,
  dispatch: (action: PortfolioAction) => void,
  onQuit: () => void,
  terminalHeight: number
): void {
  const visibleRows =
    state.view === 'assets'
      ? getPortfolioAssetsVisibleRows(terminalHeight, state)
      : getPortfolioHistoryVisibleRows(terminalHeight);

  if (key.escape || input === 'q') {
    if (state.view === 'history') {
      dispatch({ type: 'DRILL_UP' });
    } else {
      onQuit();
    }
    return;
  }

  if (key.backspace && state.view === 'history') {
    dispatch({ type: 'DRILL_UP' });
    return;
  }

  if (key.return && state.view === 'assets') {
    dispatch({ type: 'DRILL_DOWN' });
    return;
  }

  if (input === 's' && state.view === 'assets') {
    dispatch({ type: 'CYCLE_SORT' });
    return;
  }

  if (input === 'r' && state.view === 'assets') {
    dispatch({ type: 'CYCLE_PNL_MODE' });
    return;
  }

  dispatchListNavigationKeys(key, input, dispatch, visibleRows);
}
