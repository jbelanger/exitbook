/**
 * Accounts view controller — reducer and keyboard handler
 */

import { calculateVisibleRows } from '../../../ui/shared/chrome-layout.js';
import {
  dispatchListNavigationKeys,
  type ListNavigationAction,
  reduceListNavigation,
} from '../../../ui/shared/list-navigation.js';

import { CHROME_LINES } from './accounts-view-components.jsx';
import type { AccountsViewState } from './accounts-view-state.js';

/**
 * Action types (navigation only — read-only view)
 */
type AccountsViewAction = ListNavigationAction;

/**
 * Reducer function for accounts view state
 */
export function accountsViewReducer(state: AccountsViewState, action: AccountsViewAction): AccountsViewState {
  const nav = reduceListNavigation(
    { selectedIndex: state.selectedIndex, scrollOffset: state.scrollOffset },
    action,
    state.accounts.length
  );
  return { ...state, ...nav };
}

/**
 * Handle keyboard input for accounts view
 */
export function handleAccountsKeyboardInput(
  input: string,
  key: {
    ctrl: boolean;
    downArrow: boolean;
    end: boolean;
    escape: boolean;
    home: boolean;
    pageDown: boolean;
    pageUp: boolean;
    upArrow: boolean;
  },
  dispatch: (action: AccountsViewAction) => void,
  onQuit: () => void,
  terminalHeight: number
): void {
  const visibleRows = calculateVisibleRows(terminalHeight, CHROME_LINES);

  if (input === 'q' || key.escape) {
    onQuit();
    return;
  }

  dispatchListNavigationKeys(key, input, dispatch, visibleRows);
}
