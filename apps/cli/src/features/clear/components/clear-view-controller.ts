/**
 * Clear view controller — reducer and keyboard handler
 */

import type { DeletionPreview } from '@exitbook/ingestion';

import { end, home, navigateDown, navigateUp, pageDown, pageUp } from '../../../ui/shared/list-navigation.js';

import { getClearViewVisibleRows } from './clear-view-layout.js';
import type { ClearViewState } from './clear-view-state.js';

/**
 * Action types
 */
export type ClearViewAction =
  // Navigation (disabled in executing phase)
  | { type: 'NAVIGATE_UP'; visibleRows: number }
  | { type: 'NAVIGATE_DOWN'; visibleRows: number }
  | { type: 'PAGE_UP'; visibleRows: number }
  | { type: 'PAGE_DOWN'; visibleRows: number }
  | { type: 'HOME' }
  | { type: 'END'; visibleRows: number }
  // Toggle (only in preview phase)
  | { type: 'TOGGLE_INCLUDE_RAW' }
  // Confirmation flow
  | { type: 'INITIATE_DELETE' } // First 'd' press
  | { type: 'CONFIRM_DELETE' } // Second 'd' press
  | { type: 'CANCEL_CONFIRM' } // Any key (except 'd') in confirming
  // Execution
  | { result: DeletionPreview; type: 'EXECUTION_COMPLETE' }
  | { error: Error; type: 'EXECUTION_FAILED' };

/**
 * Reducer function for clear view state
 */
export function clearViewReducer(state: ClearViewState, action: ClearViewAction): ClearViewState {
  const itemCount = 9; // Fixed: 6 processed + 3 raw categories
  const buildContext = (visibleRows: number) => ({
    itemCount,
    visibleRows,
    wrapAround: true,
  });

  switch (action.type) {
    // Navigation actions (disabled during execution)
    case 'NAVIGATE_UP': {
      if (state.phase === 'executing') return state;
      const next = navigateUp(
        { selectedIndex: state.selectedIndex, scrollOffset: state.scrollOffset },
        buildContext(action.visibleRows)
      );
      return { ...state, ...next };
    }

    case 'NAVIGATE_DOWN': {
      if (state.phase === 'executing') return state;
      const next = navigateDown(
        { selectedIndex: state.selectedIndex, scrollOffset: state.scrollOffset },
        buildContext(action.visibleRows)
      );
      return { ...state, ...next };
    }

    case 'PAGE_UP': {
      if (state.phase === 'executing') return state;
      const next = pageUp(
        { selectedIndex: state.selectedIndex, scrollOffset: state.scrollOffset },
        buildContext(action.visibleRows)
      );
      return { ...state, ...next };
    }

    case 'PAGE_DOWN': {
      if (state.phase === 'executing') return state;
      const next = pageDown(
        { selectedIndex: state.selectedIndex, scrollOffset: state.scrollOffset },
        buildContext(action.visibleRows)
      );
      return { ...state, ...next };
    }

    case 'HOME': {
      if (state.phase === 'executing') return state;
      const next = home();
      return { ...state, ...next };
    }

    case 'END': {
      if (state.phase === 'executing') return state;
      const next = end(buildContext(action.visibleRows));
      return { ...state, ...next };
    }

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
  state: ClearViewState,
  dispatch: (action: ClearViewAction) => void,
  onQuit: () => void,
  executeDelete: () => Promise<void>,
  terminalHeight: number,
  totalToDelete: number
): void {
  const visibleRows = getClearViewVisibleRows(terminalHeight);

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
    if (key.upArrow || input === 'k') {
      dispatch({ type: 'NAVIGATE_UP', visibleRows });
      return;
    }
    if (key.downArrow || input === 'j') {
      dispatch({ type: 'NAVIGATE_DOWN', visibleRows });
      return;
    }
    if (key.pageUp || (key.ctrl && input === 'u')) {
      dispatch({ type: 'PAGE_UP', visibleRows });
      return;
    }
    if (key.pageDown || (key.ctrl && input === 'd')) {
      dispatch({ type: 'PAGE_DOWN', visibleRows });
      return;
    }
    if (key.home) {
      dispatch({ type: 'HOME' });
      return;
    }
    if (key.end) {
      dispatch({ type: 'END', visibleRows });
      return;
    }
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

    // Navigation
    if (key.upArrow || input === 'k') {
      dispatch({ type: 'NAVIGATE_UP', visibleRows });
      return;
    }
    if (key.downArrow || input === 'j') {
      dispatch({ type: 'NAVIGATE_DOWN', visibleRows });
      return;
    }
    if (key.pageUp || (key.ctrl && input === 'u')) {
      dispatch({ type: 'PAGE_UP', visibleRows });
      return;
    }
    if (key.pageDown || (key.ctrl && input === 'd')) {
      dispatch({ type: 'PAGE_DOWN', visibleRows });
      return;
    }
    if (key.home) {
      dispatch({ type: 'HOME' });
      return;
    }
    if (key.end) {
      dispatch({ type: 'END', visibleRows });
      return;
    }
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
