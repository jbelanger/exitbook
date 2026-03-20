/**
 * Providers view controller — reducer and keyboard handler
 */

import { calculateVisibleRows } from '../../../ui/shared/chrome-layout.js';
import {
  dispatchListNavigationKeys,
  type ListNavigationAction,
  type ListNavigationKey,
  reduceListNavigation,
} from '../../../ui/shared/list-navigation.js';

import { CHROME_LINES } from './providers-view-components.jsx';
import type { ProvidersViewState } from './providers-view-state.js';

/**
 * Action types (navigation only — read-only view)
 */
type ProvidersViewAction = ListNavigationAction;

export function providersViewReducer(state: ProvidersViewState, action: ProvidersViewAction): ProvidersViewState {
  const nav = reduceListNavigation(
    { selectedIndex: state.selectedIndex, scrollOffset: state.scrollOffset },
    action,
    state.providers.length
  );
  return { ...state, ...nav };
}

export function handleProvidersKeyboardInput(
  input: string,
  key: ListNavigationKey,
  dispatch: (action: ProvidersViewAction) => void,
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
