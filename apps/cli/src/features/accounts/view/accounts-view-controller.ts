/**
 * Accounts view controller — reducer and keyboard handler
 */

import { calculateVisibleRows } from '../../../ui/shared/chrome-layout.js';
import {
  dispatchListNavigationKeys,
  type ListNavigationAction,
  type ListNavigationKey,
  reduceListNavigation,
} from '../../../ui/shared/list-navigation.js';
import { getStoredBalanceAssetsVisibleRows } from '../../shared/stored-balance-assets-view.js';

import { CHROME_LINES } from './accounts-view-components.jsx';
import { createAccountsAssetsViewState, type AccountsViewState } from './accounts-view-state.js';

/**
 * Action types for the accounts explorer.
 */
type AccountsViewAction = ListNavigationAction | { type: 'DRILL_DOWN' } | { type: 'DRILL_UP' };

export function accountsViewReducer(state: AccountsViewState, action: AccountsViewAction): AccountsViewState {
  if (action.type === 'DRILL_DOWN') {
    return handleDrillDown(state);
  }

  if (action.type === 'DRILL_UP') {
    return handleDrillUp(state);
  }

  const nav = reduceListNavigation(
    { selectedIndex: state.selectedIndex, scrollOffset: state.scrollOffset },
    action,
    state.view === 'accounts' ? state.accounts.length : state.assets.length
  );

  return { ...state, ...nav };
}

export function handleAccountsKeyboardInput(
  input: string,
  key: ListNavigationKey & { backspace?: boolean | undefined; return?: boolean | undefined },
  state: AccountsViewState,
  dispatch: (action: AccountsViewAction) => void,
  onQuit: () => void,
  terminalHeight: number
): void {
  const visibleRows =
    state.view === 'accounts'
      ? calculateVisibleRows(terminalHeight, CHROME_LINES)
      : getStoredBalanceAssetsVisibleRows(terminalHeight);
  const isDrilledDown = state.view === 'assets' && state.parentState !== undefined;

  if (key.escape || input === 'q') {
    if (isDrilledDown) {
      dispatch({ type: 'DRILL_UP' });
    } else {
      onQuit();
    }
    return;
  }

  if (key.backspace === true && isDrilledDown) {
    dispatch({ type: 'DRILL_UP' });
    return;
  }

  if (key.return === true && state.view === 'accounts') {
    dispatch({ type: 'DRILL_DOWN' });
    return;
  }

  dispatchListNavigationKeys(key, input, dispatch, visibleRows);
}

function handleDrillDown(state: AccountsViewState): AccountsViewState {
  if (state.view !== 'accounts') {
    return state;
  }

  const selected = state.accounts[state.selectedIndex];
  if (!selected) {
    return state;
  }

  const detail = state.accountDetailsById?.[selected.id];
  if (!detail?.balance.readable || detail.balance.assets.length === 0) {
    return state;
  }

  return createAccountsAssetsViewState(detail.balance, { parentState: state });
}

function handleDrillUp(state: AccountsViewState): AccountsViewState {
  if (state.view !== 'assets' || !state.parentState) {
    return state;
  }

  return state.parentState;
}
