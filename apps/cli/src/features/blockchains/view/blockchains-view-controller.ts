/**
 * Blockchains view controller — reducer and keyboard handler
 */

import {
  dispatchListNavigationKeys,
  type ListNavigationAction,
  type ListNavigationKey,
  reduceListNavigation,
} from '../../../ui/shared/list-navigation.js';

import type { BlockchainsViewState } from './blockchains-view-state.js';

/**
 * Action types (navigation only — read-only view)
 */
type BlockchainsViewAction = ListNavigationAction;

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

export function handleBlockchainsKeyboardInput(
  input: string,
  key: ListNavigationKey,
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
