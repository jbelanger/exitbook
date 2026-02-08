import { describe, expect, it } from 'vitest';

import { end, home, navigateDown, navigateUp, pageDown, pageUp } from '../list-navigation.js';

describe('list navigation primitive', () => {
  it('wraps to bottom when navigating up from first item', () => {
    const state = navigateUp({ selectedIndex: 0, scrollOffset: 0 }, { itemCount: 4, visibleRows: 2, wrapAround: true });

    expect(state.selectedIndex).toBe(3);
    expect(state.scrollOffset).toBe(2);
  });

  it('wraps to top when navigating down from last item', () => {
    const state = navigateDown(
      { selectedIndex: 3, scrollOffset: 2 },
      { itemCount: 4, visibleRows: 2, wrapAround: true }
    );

    expect(state.selectedIndex).toBe(0);
    expect(state.scrollOffset).toBe(0);
  });

  it('moves viewport when navigating down past visible range', () => {
    const state = navigateDown(
      { selectedIndex: 1, scrollOffset: 0 },
      { itemCount: 4, visibleRows: 2, wrapAround: true }
    );

    expect(state.selectedIndex).toBe(2);
    expect(state.scrollOffset).toBe(1);
  });

  it('moves one page up and down', () => {
    const up = pageUp({ selectedIndex: 7, scrollOffset: 6 }, { itemCount: 20, visibleRows: 5, wrapAround: true });
    expect(up.selectedIndex).toBe(2);
    expect(up.scrollOffset).toBe(1);

    const down = pageDown({ selectedIndex: 7, scrollOffset: 6 }, { itemCount: 20, visibleRows: 5, wrapAround: true });
    expect(down.selectedIndex).toBe(12);
    expect(down.scrollOffset).toBe(11);
  });

  it('jumps to boundaries with home/end', () => {
    expect(home()).toEqual({ selectedIndex: 0, scrollOffset: 0 });
    expect(end({ itemCount: 9, visibleRows: 4, wrapAround: true })).toEqual({
      selectedIndex: 8,
      scrollOffset: 5,
    });
  });

  it('returns stable empty-list state for all operations', () => {
    expect(navigateUp({ selectedIndex: 0, scrollOffset: 0 }, { itemCount: 0, visibleRows: 4 })).toEqual({
      selectedIndex: 0,
      scrollOffset: 0,
    });
    expect(navigateDown({ selectedIndex: 0, scrollOffset: 0 }, { itemCount: 0, visibleRows: 4 })).toEqual({
      selectedIndex: 0,
      scrollOffset: 0,
    });
    expect(pageUp({ selectedIndex: 0, scrollOffset: 0 }, { itemCount: 0, visibleRows: 4 })).toEqual({
      selectedIndex: 0,
      scrollOffset: 0,
    });
    expect(pageDown({ selectedIndex: 0, scrollOffset: 0 }, { itemCount: 0, visibleRows: 4 })).toEqual({
      selectedIndex: 0,
      scrollOffset: 0,
    });
    expect(end({ itemCount: 0, visibleRows: 4 })).toEqual({ selectedIndex: 0, scrollOffset: 0 });
  });
});
