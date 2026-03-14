/**
 * Blockchains view controller — reducer and keyboard handler
 */

import {
  dispatchListNavigationKeys,
  type ListNavigationAction,
  reduceListNavigation,
} from '../../../ui/shared/list-navigation.js';

import type { BlockchainsViewState } from './blockchains-view-state.js';

/**
 * Action types (navigation only — read-only view)
 */
type BlockchainsViewAction = ListNavigationAction;

/**
 * Reducer function for blockchains view state
 */
export function blockchainsViewReducer(
  state: BlockchainsViewState,
  action: BlockchainsViewAction
): BlockchainsViewState {
  const nav = reduceListNavigation(
    { selectedIndex: state.selectedIndex, scrollOffset: state.scrollOffset },
    action,
    state.blockchains.length
  );
  return { ...state, ...nav };
}

/**
 * Handle keyboard input for blockchains view
 */
export function handleBlockchainsKeyboardInput(
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
  dispatch: (action: BlockchainsViewAction) => void,
  onQuit: () => void,
  visibleRows: number
): void {
  if (input === 'q' || key.escape) {
    onQuit();
    return;
  }

  dispatchListNavigationKeys(key, input, dispatch, visibleRows);
}
