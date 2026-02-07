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
 * Reducer function for state updates
 */
export function linksViewReducer(state: LinksViewState, action: LinksViewAction): LinksViewState {
  switch (action.type) {
    case 'NAVIGATE_UP': {
      // Move selection up (wrap to bottom)
      const newIndex = state.selectedIndex > 0 ? state.selectedIndex - 1 : state.links.length - 1;

      // Update scroll offset to keep selected item visible
      let newScrollOffset = state.scrollOffset;

      // If we wrapped to the bottom, scroll to show the last items
      if (newIndex === state.links.length - 1) {
        newScrollOffset = Math.max(0, state.links.length - action.visibleRows);
      }
      // If selected item is above the visible window, scroll up
      else if (newIndex < state.scrollOffset) {
        newScrollOffset = newIndex;
      }

      return {
        ...state,
        selectedIndex: newIndex,
        scrollOffset: newScrollOffset,
        error: undefined, // Clear error on navigation
      };
    }

    case 'NAVIGATE_DOWN': {
      // Move selection down (wrap to top)
      const newIndex = state.selectedIndex < state.links.length - 1 ? state.selectedIndex + 1 : 0;

      // Update scroll offset to keep selected item visible
      let newScrollOffset = state.scrollOffset;

      // If we wrapped to the top, scroll to the beginning
      if (newIndex === 0) {
        newScrollOffset = 0;
      }
      // If selected item is below the visible window, scroll down
      else if (newIndex >= state.scrollOffset + action.visibleRows) {
        newScrollOffset = newIndex - action.visibleRows + 1;
      }

      return {
        ...state,
        selectedIndex: newIndex,
        scrollOffset: newScrollOffset,
        error: undefined, // Clear error on navigation
      };
    }

    case 'PAGE_UP': {
      // Jump up by visible rows
      const newIndex = Math.max(0, state.selectedIndex - action.visibleRows);
      const newScrollOffset = Math.max(0, state.scrollOffset - action.visibleRows);

      return {
        ...state,
        selectedIndex: newIndex,
        scrollOffset: newScrollOffset,
        error: undefined,
      };
    }

    case 'PAGE_DOWN': {
      // Jump down by visible rows
      const newIndex = Math.min(state.links.length - 1, state.selectedIndex + action.visibleRows);
      const newScrollOffset = Math.min(
        Math.max(0, state.links.length - action.visibleRows),
        state.scrollOffset + action.visibleRows
      );

      return {
        ...state,
        selectedIndex: newIndex,
        scrollOffset: newScrollOffset,
        error: undefined,
      };
    }

    case 'HOME': {
      // Jump to first item
      return {
        ...state,
        selectedIndex: 0,
        scrollOffset: 0,
        error: undefined,
      };
    }

    case 'END': {
      // Jump to last item
      const lastIndex = state.links.length - 1;
      const newScrollOffset = Math.max(0, state.links.length - action.visibleRows);

      return {
        ...state,
        selectedIndex: lastIndex,
        scrollOffset: newScrollOffset,
        error: undefined,
      };
    }

    case 'CONFIRM_SELECTED': {
      const selected = state.links[state.selectedIndex];
      if (!selected || selected.link.status !== 'suggested') {
        return {
          ...state,
          error: 'Can only confirm suggested links',
        };
      }

      // Set pending action (for optimistic UI update)
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
      const selected = state.links[state.selectedIndex];
      if (!selected || selected.link.status !== 'suggested') {
        return {
          ...state,
          error: 'Can only reject suggested links',
        };
      }

      // Set pending action (for optimistic UI update)
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
      return {
        ...state,
        error: undefined,
      };
    }

    case 'SET_ERROR': {
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
  terminalHeight: number
): void {
  // Calculate visible rows (same calculation as in LinkList)
  const visibleRows = Math.max(1, terminalHeight - 14);

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
  // Note: pageUp/pageDown only work with Ctrl in most terminals (terminal captures plain PgUp/PgDn for scrollback)
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

  // Actions
  if (input === 'c') {
    dispatch({ type: 'CONFIRM_SELECTED' });
    return;
  }

  if (input === 'r') {
    dispatch({ type: 'REJECT_SELECTED' });
    return;
  }
}
