/**
 * Shared list navigation for TUI view controllers.
 * Maintains selected index + scroll offset for a fixed-size viewport.
 */

interface ListNavigationState {
  selectedIndex: number;
  scrollOffset: number;
}

interface ListNavigationContext {
  itemCount: number;
  visibleRows: number;
  wrapAround?: boolean | undefined;
}

/**
 * Shared action union for list navigation — include in each feature's action type.
 */
export type ListNavigationAction =
  | { type: 'NAVIGATE_UP'; visibleRows: number }
  | { type: 'NAVIGATE_DOWN'; visibleRows: number }
  | { type: 'PAGE_UP'; visibleRows: number }
  | { type: 'PAGE_DOWN'; visibleRows: number }
  | { type: 'HOME' }
  | { type: 'END'; visibleRows: number };

/**
 * Returns true when an action is a navigation action.
 */
export function isListNavigationAction(action: { type: string }): action is ListNavigationAction {
  return (
    action.type === 'NAVIGATE_UP' ||
    action.type === 'NAVIGATE_DOWN' ||
    action.type === 'PAGE_UP' ||
    action.type === 'PAGE_DOWN' ||
    action.type === 'HOME' ||
    action.type === 'END'
  );
}

/**
 * Applies a navigation action to the current position.
 * Returns the updated selectedIndex + scrollOffset.
 */
export function reduceListNavigation(
  nav: ListNavigationState,
  action: ListNavigationAction,
  itemCount: number
): ListNavigationState {
  const context = (visibleRows: number): ListNavigationContext => ({ itemCount, visibleRows, wrapAround: true });
  switch (action.type) {
    case 'NAVIGATE_UP':
      return navigateUp(nav, context(action.visibleRows));
    case 'NAVIGATE_DOWN':
      return navigateDown(nav, context(action.visibleRows));
    case 'PAGE_UP':
      return pageUp(nav, context(action.visibleRows));
    case 'PAGE_DOWN':
      return pageDown(nav, context(action.visibleRows));
    case 'HOME':
      return home();
    case 'END':
      return end(context(action.visibleRows));
  }
}

/**
 * Dispatches a navigation action for the pressed key.
 * Returns true if the key was handled, false otherwise.
 * Covers arrow keys, page up/down (and Ctrl+U/D), home/end, and vim j/k.
 */
export function dispatchListNavigationKeys(
  key: {
    ctrl: boolean;
    downArrow: boolean;
    end: boolean;
    home: boolean;
    pageDown: boolean;
    pageUp: boolean;
    upArrow: boolean;
  },
  input: string,
  dispatch: (action: ListNavigationAction) => void,
  visibleRows: number
): boolean {
  if (key.upArrow || input === 'k') {
    dispatch({ type: 'NAVIGATE_UP', visibleRows });
    return true;
  }
  if (key.downArrow || input === 'j') {
    dispatch({ type: 'NAVIGATE_DOWN', visibleRows });
    return true;
  }
  if (key.pageUp || (key.ctrl && input === 'u')) {
    dispatch({ type: 'PAGE_UP', visibleRows });
    return true;
  }
  if (key.pageDown || (key.ctrl && input === 'd')) {
    dispatch({ type: 'PAGE_DOWN', visibleRows });
    return true;
  }
  if (key.home) {
    dispatch({ type: 'HOME' });
    return true;
  }
  if (key.end) {
    dispatch({ type: 'END', visibleRows });
    return true;
  }
  return false;
}

function clampVisibleRows(visibleRows: number): number {
  return Math.max(1, visibleRows);
}

function normalizeContext(context: ListNavigationContext): {
  itemCount: number;
  visibleRows: number;
  wrapAround: boolean;
} {
  return {
    itemCount: context.itemCount,
    visibleRows: clampVisibleRows(context.visibleRows),
    wrapAround: context.wrapAround ?? true,
  };
}

function emptyListState(): ListNavigationState {
  return {
    selectedIndex: 0,
    scrollOffset: 0,
  };
}

/**
 * Move selection one row up.
 */
function navigateUp(state: ListNavigationState, context: ListNavigationContext): ListNavigationState {
  const { itemCount, visibleRows, wrapAround } = normalizeContext(context);
  if (itemCount <= 0) {
    return emptyListState();
  }

  const currentIndex = Math.min(Math.max(state.selectedIndex, 0), itemCount - 1);
  const newIndex = currentIndex > 0 ? currentIndex - 1 : wrapAround ? itemCount - 1 : 0;

  let newScrollOffset = Math.max(0, state.scrollOffset);

  const isWrappingToEnd = newIndex === itemCount - 1 && currentIndex === 0 && wrapAround;
  if (isWrappingToEnd) {
    newScrollOffset = Math.max(0, itemCount - visibleRows);
  } else if (newIndex < newScrollOffset) {
    newScrollOffset = newIndex;
  }

  return {
    selectedIndex: newIndex,
    scrollOffset: newScrollOffset,
  };
}

/**
 * Move selection one row down.
 */
function navigateDown(state: ListNavigationState, context: ListNavigationContext): ListNavigationState {
  const { itemCount, visibleRows, wrapAround } = normalizeContext(context);
  if (itemCount <= 0) {
    return emptyListState();
  }

  const currentIndex = Math.min(Math.max(state.selectedIndex, 0), itemCount - 1);
  const newIndex = currentIndex < itemCount - 1 ? currentIndex + 1 : wrapAround ? 0 : itemCount - 1;

  let newScrollOffset = Math.max(0, state.scrollOffset);

  const isWrappingToStart = newIndex === 0 && currentIndex === itemCount - 1 && wrapAround;
  if (isWrappingToStart) {
    newScrollOffset = 0;
  } else if (newIndex >= newScrollOffset + visibleRows) {
    newScrollOffset = newIndex - visibleRows + 1;
  }

  return {
    selectedIndex: newIndex,
    scrollOffset: newScrollOffset,
  };
}

/**
 * Move selection up by one page.
 */
function pageUp(state: ListNavigationState, context: ListNavigationContext): ListNavigationState {
  const { itemCount, visibleRows } = normalizeContext(context);
  if (itemCount <= 0) {
    return emptyListState();
  }

  return {
    selectedIndex: Math.max(0, state.selectedIndex - visibleRows),
    scrollOffset: Math.max(0, state.scrollOffset - visibleRows),
  };
}

/**
 * Move selection down by one page.
 */
function pageDown(state: ListNavigationState, context: ListNavigationContext): ListNavigationState {
  const { itemCount, visibleRows } = normalizeContext(context);
  if (itemCount <= 0) {
    return emptyListState();
  }

  return {
    selectedIndex: Math.min(itemCount - 1, state.selectedIndex + visibleRows),
    scrollOffset: Math.min(Math.max(0, itemCount - visibleRows), state.scrollOffset + visibleRows),
  };
}

/**
 * Jump to first row.
 */
function home(): ListNavigationState {
  return {
    selectedIndex: 0,
    scrollOffset: 0,
  };
}

/**
 * Jump to last row.
 */
function end(context: ListNavigationContext): ListNavigationState {
  const { itemCount, visibleRows } = normalizeContext(context);
  if (itemCount <= 0) {
    return emptyListState();
  }

  return {
    selectedIndex: itemCount - 1,
    scrollOffset: Math.max(0, itemCount - visibleRows),
  };
}
