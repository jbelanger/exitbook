/**
 * Links view controller - manages state updates and keyboard input
 */

import type { LinksViewState } from './links-view-state.js';

/**
 * Action types for state updates
 */
export type LinksViewAction =
  | { type: 'NAVIGATE_UP'; visibleRows: number }
  | { type: 'NAVIGATE_DOWN'; visibleRows: number }
  | { type: 'PAGE_UP'; visibleRows: number }
  | { type: 'PAGE_DOWN'; visibleRows: number }
  | { type: 'HOME' }
  | { type: 'END'; visibleRows: number }
  | { type: 'CONFIRM_SELECTED' }
  | { type: 'REJECT_SELECTED' }
  | { type: 'CLEAR_ERROR' }
  | { error: string; type: 'SET_ERROR' };

/**
 * Get the item count for the current mode
 */
function getItemCount(state: LinksViewState): number {
  return state.mode === 'links' ? state.links.length : state.linkAnalysis.issues.length;
}

/**
 * Apply navigation updates and clear error if in links mode
 */
function applyNavigationUpdate(
  state: LinksViewState,
  updates: { scrollOffset?: number; selectedIndex?: number }
): LinksViewState {
  if (state.mode === 'gaps') {
    return { ...state, ...updates };
  }
  return { ...state, ...updates, error: undefined };
}

/**
 * Reducer function for state updates
 */
export function linksViewReducer(state: LinksViewState, action: LinksViewAction): LinksViewState {
  const itemCount = getItemCount(state);

  switch (action.type) {
    case 'NAVIGATE_UP': {
      const newIndex = state.selectedIndex > 0 ? state.selectedIndex - 1 : itemCount - 1;

      let newScrollOffset = state.scrollOffset;

      if (newIndex === itemCount - 1) {
        newScrollOffset = Math.max(0, itemCount - action.visibleRows);
      } else if (newIndex < state.scrollOffset) {
        newScrollOffset = newIndex;
      }

      return applyNavigationUpdate(state, {
        selectedIndex: newIndex,
        scrollOffset: newScrollOffset,
      });
    }

    case 'NAVIGATE_DOWN': {
      const newIndex = state.selectedIndex < itemCount - 1 ? state.selectedIndex + 1 : 0;

      let newScrollOffset = state.scrollOffset;

      if (newIndex === 0) {
        newScrollOffset = 0;
      } else if (newIndex >= state.scrollOffset + action.visibleRows) {
        newScrollOffset = newIndex - action.visibleRows + 1;
      }

      return applyNavigationUpdate(state, {
        selectedIndex: newIndex,
        scrollOffset: newScrollOffset,
      });
    }

    case 'PAGE_UP': {
      const newIndex = Math.max(0, state.selectedIndex - action.visibleRows);
      const newScrollOffset = Math.max(0, state.scrollOffset - action.visibleRows);

      return applyNavigationUpdate(state, {
        selectedIndex: newIndex,
        scrollOffset: newScrollOffset,
      });
    }

    case 'PAGE_DOWN': {
      const newIndex = Math.min(itemCount - 1, state.selectedIndex + action.visibleRows);
      const newScrollOffset = Math.min(
        Math.max(0, itemCount - action.visibleRows),
        state.scrollOffset + action.visibleRows
      );

      return applyNavigationUpdate(state, {
        selectedIndex: newIndex,
        scrollOffset: newScrollOffset,
      });
    }

    case 'HOME': {
      return applyNavigationUpdate(state, {
        selectedIndex: 0,
        scrollOffset: 0,
      });
    }

    case 'END': {
      const lastIndex = itemCount - 1;
      const newScrollOffset = Math.max(0, itemCount - action.visibleRows);

      return applyNavigationUpdate(state, {
        selectedIndex: lastIndex,
        scrollOffset: newScrollOffset,
      });
    }

    case 'CONFIRM_SELECTED': {
      if (state.mode === 'gaps') {
        return state;
      }

      const selected = state.links[state.selectedIndex];
      if (!selected || selected.link.status !== 'suggested') {
        return {
          ...state,
          error: 'Can only confirm suggested links',
        };
      }

      return {
        ...state,
        pendingAction: {
          linkId: selected.link.id,
          action: 'confirm',
        },
        error: undefined,
      };
    }

    case 'REJECT_SELECTED': {
      if (state.mode === 'gaps') {
        return state;
      }

      const selected = state.links[state.selectedIndex];
      if (!selected || selected.link.status !== 'suggested') {
        return {
          ...state,
          error: 'Can only reject suggested links',
        };
      }

      return {
        ...state,
        pendingAction: {
          linkId: selected.link.id,
          action: 'reject',
        },
        error: undefined,
      };
    }

    case 'CLEAR_ERROR': {
      if (state.mode === 'gaps') {
        return state;
      }

      return {
        ...state,
        error: undefined,
      };
    }

    case 'SET_ERROR': {
      if (state.mode === 'gaps') {
        return state;
      }

      return {
        ...state,
        error: action.error,
        pendingAction: undefined,
      };
    }

    default:
      return state;
  }
}

/**
 * Handle keyboard input
 */
export function handleKeyboardInput(
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
  dispatch: (action: LinksViewAction) => void,
  onQuit: () => void,
  terminalHeight: number,
  mode: 'links' | 'gaps' = 'links'
): void {
  // Calculate visible rows (same calculation as in LinkList)
  // Gaps mode has ~4 extra lines for asset breakdown
  const chromeLines = mode === 'gaps' ? 18 : 14;
  const visibleRows = Math.max(1, terminalHeight - chromeLines);

  // Quit
  if (input === 'q' || key.escape) {
    onQuit();
    return;
  }

  // Navigation - arrow keys
  if (key.upArrow) {
    dispatch({ type: 'NAVIGATE_UP', visibleRows });
    return;
  }

  if (key.downArrow) {
    dispatch({ type: 'NAVIGATE_DOWN', visibleRows });
    return;
  }

  // Navigation - page up/down (Ctrl+PgUp/PgDn or Ctrl+U/Ctrl+D)
  if (key.pageUp || (key.ctrl && input === 'u')) {
    dispatch({ type: 'PAGE_UP', visibleRows });
    return;
  }

  if (key.pageDown || (key.ctrl && input === 'd')) {
    dispatch({ type: 'PAGE_DOWN', visibleRows });
    return;
  }

  // Navigation - home/end
  if (key.home) {
    dispatch({ type: 'HOME' });
    return;
  }

  if (key.end) {
    dispatch({ type: 'END', visibleRows });
    return;
  }

  // Navigation - vim keys
  if (input === 'k') {
    dispatch({ type: 'NAVIGATE_UP', visibleRows });
    return;
  }

  if (input === 'j') {
    dispatch({ type: 'NAVIGATE_DOWN', visibleRows });
    return;
  }

  // Actions (links mode only)
  if (mode === 'links') {
    if (input === 'c') {
      dispatch({ type: 'CONFIRM_SELECTED' });
      return;
    }

    if (input === 'r') {
      dispatch({ type: 'REJECT_SELECTED' });
      return;
    }
  }
}
