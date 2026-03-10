/**
 * Blockchains view controller — reducer and keyboard handler
 */

import { end, home, navigateDown, navigateUp, pageDown, pageUp } from '../../../ui/shared/list-navigation.js';

import type { BlockchainsViewState } from './blockchains-view-state.js';

/**
 * Action types (navigation only — read-only view)
 */
export type BlockchainsViewAction =
  | { type: 'NAVIGATE_UP'; visibleRows: number }
  | { type: 'NAVIGATE_DOWN'; visibleRows: number }
  | { type: 'PAGE_UP'; visibleRows: number }
  | { type: 'PAGE_DOWN'; visibleRows: number }
  | { type: 'HOME' }
  | { type: 'END'; visibleRows: number };

/**
 * Reducer function for blockchains view state
 */
export function blockchainsViewReducer(
  state: BlockchainsViewState,
  action: BlockchainsViewAction
): BlockchainsViewState {
  const itemCount = state.blockchains.length;
  const buildContext = (visibleRows: number) => ({
    itemCount,
    visibleRows,
    wrapAround: true,
  });

  switch (action.type) {
    case 'NAVIGATE_UP': {
      const next = navigateUp(
        { selectedIndex: state.selectedIndex, scrollOffset: state.scrollOffset },
        buildContext(action.visibleRows)
      );
      return { ...state, ...next };
    }

    case 'NAVIGATE_DOWN': {
      const next = navigateDown(
        { selectedIndex: state.selectedIndex, scrollOffset: state.scrollOffset },
        buildContext(action.visibleRows)
      );
      return { ...state, ...next };
    }

    case 'PAGE_UP': {
      const next = pageUp(
        { selectedIndex: state.selectedIndex, scrollOffset: state.scrollOffset },
        buildContext(action.visibleRows)
      );
      return { ...state, ...next };
    }

    case 'PAGE_DOWN': {
      const next = pageDown(
        { selectedIndex: state.selectedIndex, scrollOffset: state.scrollOffset },
        buildContext(action.visibleRows)
      );
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
  // Quit
  if (input === 'q' || key.escape) {
    onQuit();
    return;
  }

  // Arrow keys
  if (key.upArrow) {
    dispatch({ type: 'NAVIGATE_UP', visibleRows });
    return;
  }
  if (key.downArrow) {
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

  // Vim keys
  if (input === 'k') {
    dispatch({ type: 'NAVIGATE_UP', visibleRows });
    return;
  }
  if (input === 'j') {
    dispatch({ type: 'NAVIGATE_DOWN', visibleRows });
    return;
  }
}
