/**
 * Links view controller - manages state updates and keyboard input
 */

import { calculateVisibleRows } from '../../../ui/shared/chrome-layout.js';
import { end, home, navigateDown, navigateUp, pageDown, pageUp } from '../../../ui/shared/list-navigation.js';
import { resolveLinkReviewScope } from '../links-review-utils.js';

import { getGapsChromeLines, LINKS_CHROME_LINES } from './links-view-layout.js';
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
  | { affectedLinkIds: number[]; newStatus: 'confirmed' | 'rejected'; type: 'ACTION_SUCCESS' }
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
  const buildNavigationContext = (visibleRows: number) => ({
    itemCount,
    visibleRows,
    wrapAround: true,
  });

  switch (action.type) {
    case 'NAVIGATE_UP': {
      const next = navigateUp(
        {
          selectedIndex: state.selectedIndex,
          scrollOffset: state.scrollOffset,
        },
        buildNavigationContext(action.visibleRows)
      );

      return applyNavigationUpdate(state, {
        selectedIndex: next.selectedIndex,
        scrollOffset: next.scrollOffset,
      });
    }

    case 'NAVIGATE_DOWN': {
      const next = navigateDown(
        {
          selectedIndex: state.selectedIndex,
          scrollOffset: state.scrollOffset,
        },
        buildNavigationContext(action.visibleRows)
      );

      return applyNavigationUpdate(state, {
        selectedIndex: next.selectedIndex,
        scrollOffset: next.scrollOffset,
      });
    }

    case 'PAGE_UP': {
      const next = pageUp(
        {
          selectedIndex: state.selectedIndex,
          scrollOffset: state.scrollOffset,
        },
        buildNavigationContext(action.visibleRows)
      );

      return applyNavigationUpdate(state, {
        selectedIndex: next.selectedIndex,
        scrollOffset: next.scrollOffset,
      });
    }

    case 'PAGE_DOWN': {
      const next = pageDown(
        {
          selectedIndex: state.selectedIndex,
          scrollOffset: state.scrollOffset,
        },
        buildNavigationContext(action.visibleRows)
      );

      return applyNavigationUpdate(state, {
        selectedIndex: next.selectedIndex,
        scrollOffset: next.scrollOffset,
      });
    }

    case 'HOME': {
      const next = home();
      return applyNavigationUpdate(state, {
        selectedIndex: next.selectedIndex,
        scrollOffset: next.scrollOffset,
      });
    }

    case 'END': {
      const next = end(buildNavigationContext(action.visibleRows));

      return applyNavigationUpdate(state, {
        selectedIndex: next.selectedIndex,
        scrollOffset: next.scrollOffset,
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

      const reviewScope = resolveLinkReviewScope(
        selected.link,
        state.links.map((item) => item.link)
      );

      return {
        ...state,
        pendingAction: {
          affectedLinkIds: reviewScope.links.map((candidate) => candidate.id),
          linkId: selected.link.id,
          action: 'confirm',
          reviewGroupKey: reviewScope.reviewGroupKey,
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

      const reviewScope = resolveLinkReviewScope(
        selected.link,
        state.links.map((item) => item.link)
      );

      return {
        ...state,
        pendingAction: {
          affectedLinkIds: reviewScope.links.map((candidate) => candidate.id),
          linkId: selected.link.id,
          action: 'reject',
          reviewGroupKey: reviewScope.reviewGroupKey,
        },
        error: undefined,
      };
    }

    case 'ACTION_SUCCESS': {
      if (state.mode === 'gaps') {
        return state;
      }

      const affectedLinkIds = new Set(action.affectedLinkIds);
      const updatedLinks = state.links
        .map((item) =>
          affectedLinkIds.has(item.link.id) ? { ...item, link: { ...item.link, status: action.newStatus } } : item
        )
        .filter((item) => state.statusFilter === undefined || item.link.status === state.statusFilter);

      const updatedCounts = updatedLinks.reduce(
        (acc, item) => {
          const status = item.link.status;
          if (status === 'confirmed') acc.confirmed += 1;
          else if (status === 'suggested') acc.suggested += 1;
          else if (status === 'rejected') acc.rejected += 1;
          return acc;
        },
        { confirmed: 0, suggested: 0, rejected: 0 }
      );

      return {
        ...state,
        links: updatedLinks,
        counts: updatedCounts,
        selectedIndex: normalizeSelectedIndex(state.selectedIndex, updatedLinks.length),
        scrollOffset: normalizeScrollOffset(state.scrollOffset, updatedLinks.length),
        pendingAction: undefined,
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
        pendingAction: undefined,
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

function normalizeSelectedIndex(selectedIndex: number, itemCount: number): number {
  if (itemCount <= 0) {
    return 0;
  }

  return Math.min(selectedIndex, itemCount - 1);
}

function normalizeScrollOffset(scrollOffset: number, itemCount: number): number {
  if (itemCount <= 0) {
    return 0;
  }

  return Math.min(scrollOffset, itemCount - 1);
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
  mode: 'links' | 'gaps' = 'links',
  gapAssetCount = 0
): void {
  const visibleRows =
    mode === 'links'
      ? calculateVisibleRows(terminalHeight, LINKS_CHROME_LINES)
      : calculateVisibleRows(terminalHeight, getGapsChromeLines(gapAssetCount));

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
