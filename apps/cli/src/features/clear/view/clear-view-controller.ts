/**
 * Clear view controller — reducer and keyboard handler
 */

import { calculateVisibleRows } from '../../../ui/shared/chrome-layout.js';
import {
  dispatchListNavigationKeys,
  isListNavigationAction,
  type ListNavigationAction,
  type ListNavigationKey,
  reduceListNavigation,
} from '../../../ui/shared/list-navigation.js';
import type { FlatDeletionPreview } from '../command/clear-handler.js';

import { CHROME_LINES } from './clear-view-components.jsx';
import type { ClearViewState } from './clear-view-state.js';

/**
 * Action types
 */
export type ClearViewAction =
  // Navigation (disabled in executing phase)
  | ListNavigationAction
  // Toggle (only in preview phase)
  | { type: 'TOGGLE_INCLUDE_RAW' }
  // Confirmation flow
  | { type: 'INITIATE_DELETE' } // First 'd' press
  | { type: 'CONFIRM_DELETE' } // Second 'd' press
  | { type: 'CANCEL_CONFIRM' } // Any key (except 'd') in confirming
  // Execution
  | { result: FlatDeletionPreview; type: 'EXECUTION_COMPLETE' }
  | { error: Error; type: 'EXECUTION_FAILED' };

/**
 * Reducer function for clear view state
 */
export function clearViewReducer(state: ClearViewState, action: ClearViewAction): ClearViewState {
  if (isListNavigationAction(action)) {
    if (state.phase === 'executing') return state;
    const nav = reduceListNavigation(
      { selectedIndex: state.selectedIndex, scrollOffset: state.scrollOffset },
      action,
      9 // 6 processed + 3 raw categories
    );
    return { ...state, ...nav };
  }

  switch (action.type) {
    // Toggle include-raw (only in preview phase)
    case 'TOGGLE_INCLUDE_RAW': {
      if (state.phase !== 'preview') return state;
      return { ...state, includeRaw: !state.includeRaw };
    }

    // Confirmation flow
    case 'INITIATE_DELETE': {
      if (state.phase !== 'preview') return state;
      return { ...state, phase: 'confirming' };
    }

    case 'CONFIRM_DELETE': {
      if (state.phase !== 'confirming') return state;
      return { ...state, phase: 'executing' };
    }

    case 'CANCEL_CONFIRM': {
      if (state.phase !== 'confirming') return state;
      return { ...state, phase: 'preview' };
    }

    // Execution complete
    case 'EXECUTION_COMPLETE': {
      if (state.phase !== 'executing') return state;
      return { ...state, phase: 'complete', result: action.result };
    }

    case 'EXECUTION_FAILED': {
      if (state.phase !== 'executing') return state;
      return { ...state, phase: 'error', error: action.error };
    }

    default:
      return state;
  }
}

/**
 * Handle keyboard input for clear view
 */
export function handleClearKeyboardInput(
  input: string,
  key: ListNavigationKey,
  state: ClearViewState,
  dispatch: (action: ClearViewAction) => void,
  onQuit: () => void,
  executeDelete: () => Promise<void>,
  terminalHeight: number,
  totalToDelete: number
): void {
  const visibleRows = calculateVisibleRows(terminalHeight, CHROME_LINES);

  // Phase-specific keyboard handling

  // Preview phase
  if (state.phase === 'preview') {
    // Quit
    if (input === 'q' || key.escape) {
      onQuit();
      return;
    }

    // Toggle include-raw
    if (input === 'r') {
      dispatch({ type: 'TOGGLE_INCLUDE_RAW' });
      return;
    }

    // Initiate delete (only if there's something to delete)
    if (input === 'd') {
      if (totalToDelete > 0) {
        dispatch({ type: 'INITIATE_DELETE' });
      }
      return;
    }

    // Navigation
    dispatchListNavigationKeys(key, input, dispatch, visibleRows);
  }

  // Confirming phase
  if (state.phase === 'confirming') {
    if (input === 'd') {
      // Confirm delete (second press)
      dispatch({ type: 'CONFIRM_DELETE' });
      // Trigger async execution
      executeDelete().catch((error: unknown) => {
        dispatch({ error: error instanceof Error ? error : new Error(String(error)), type: 'EXECUTION_FAILED' });
      });
      return;
    }

    // Any other key cancels and then performs the action
    dispatch({ type: 'CANCEL_CONFIRM' });

    // Process the key as if we were in preview phase
    if (input === 'q' || key.escape) {
      onQuit();
      return;
    }

    if (input === 'r') {
      dispatch({ type: 'TOGGLE_INCLUDE_RAW' });
      return;
    }

    dispatchListNavigationKeys(key, input, dispatch, visibleRows);
  }

  // Executing phase - no keyboard input allowed
  if (state.phase === 'executing') {
    return;
  }

  // Complete phase
  if (state.phase === 'complete') {
    // Quit on any key
    if (input === 'q' || key.escape || input === '\r' || input === '\n') {
      onQuit();
      return;
    }
  }

  // Error phase
  if (state.phase === 'error') {
    // Quit on any key
    if (input === 'q' || key.escape || input === '\r' || input === '\n') {
      onQuit();
      return;
    }
  }
}
