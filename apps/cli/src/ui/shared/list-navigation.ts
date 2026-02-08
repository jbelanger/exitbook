/**
 * Pure list navigation primitive used by links view reducers.
 * Maintains selected index + scroll offset for a fixed-size viewport.
 */

export interface ListNavigationState {
  selectedIndex: number;
  scrollOffset: number;
}

export interface ListNavigationContext {
  itemCount: number;
  visibleRows: number;
  wrapAround?: boolean | undefined;
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
export function navigateUp(state: ListNavigationState, context: ListNavigationContext): ListNavigationState {
  const { itemCount, visibleRows, wrapAround } = normalizeContext(context);
  if (itemCount <= 0) {
    return emptyListState();
  }

  const currentIndex = Math.min(Math.max(state.selectedIndex, 0), itemCount - 1);
  const wrappedIndex = wrapAround ? itemCount - 1 : 0;
  const newIndex = currentIndex > 0 ? currentIndex - 1 : wrappedIndex;

  let newScrollOffset = Math.max(0, state.scrollOffset);

  if (newIndex === itemCount - 1 && currentIndex === 0 && wrapAround) {
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
export function navigateDown(state: ListNavigationState, context: ListNavigationContext): ListNavigationState {
  const { itemCount, visibleRows, wrapAround } = normalizeContext(context);
  if (itemCount <= 0) {
    return emptyListState();
  }

  const currentIndex = Math.min(Math.max(state.selectedIndex, 0), itemCount - 1);
  const wrappedIndex = wrapAround ? 0 : itemCount - 1;
  const newIndex = currentIndex < itemCount - 1 ? currentIndex + 1 : wrappedIndex;

  let newScrollOffset = Math.max(0, state.scrollOffset);

  if (newIndex === 0 && currentIndex === itemCount - 1 && wrapAround) {
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
export function pageUp(state: ListNavigationState, context: ListNavigationContext): ListNavigationState {
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
export function pageDown(state: ListNavigationState, context: ListNavigationContext): ListNavigationState {
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
export function home(): ListNavigationState {
  return {
    selectedIndex: 0,
    scrollOffset: 0,
  };
}

/**
 * Jump to last row.
 */
export function end(context: ListNavigationContext): ListNavigationState {
  const { itemCount, visibleRows } = normalizeContext(context);
  if (itemCount <= 0) {
    return emptyListState();
  }

  return {
    selectedIndex: itemCount - 1,
    scrollOffset: Math.max(0, itemCount - visibleRows),
  };
}
