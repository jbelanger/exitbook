import { describe, expect, it, vi } from 'vitest';

import {
  dispatchListNavigationKeys,
  isListNavigationAction,
  type ListNavigationAction,
  reduceListNavigation,
} from '../list-navigation.js';

const at = (selectedIndex: number, scrollOffset: number) => ({ selectedIndex, scrollOffset });

// ─── reduceListNavigation ────────────────────────────────────────────────────

describe('reduceListNavigation', () => {
  it('moves up within viewport without scrolling', () => {
    expect(reduceListNavigation(at(2, 0), { type: 'NAVIGATE_UP', visibleRows: 5 }, 5)).toEqual(at(1, 0));
  });

  it('moves down within viewport without scrolling', () => {
    expect(reduceListNavigation(at(1, 0), { type: 'NAVIGATE_DOWN', visibleRows: 5 }, 5)).toEqual(at(2, 0));
  });

  it('wraps to bottom when navigating up from first item', () => {
    const state = reduceListNavigation(at(0, 0), { type: 'NAVIGATE_UP', visibleRows: 2 }, 4);

    expect(state.selectedIndex).toBe(3);
    expect(state.scrollOffset).toBe(2);
  });

  it('wraps to top when navigating down from last item', () => {
    const state = reduceListNavigation(at(3, 2), { type: 'NAVIGATE_DOWN', visibleRows: 2 }, 4);

    expect(state.selectedIndex).toBe(0);
    expect(state.scrollOffset).toBe(0);
  });

  it('scrolls viewport when navigating down past visible range', () => {
    const state = reduceListNavigation(at(1, 0), { type: 'NAVIGATE_DOWN', visibleRows: 2 }, 4);

    expect(state.selectedIndex).toBe(2);
    expect(state.scrollOffset).toBe(1);
  });

  it('scrolls viewport when navigating up above visible range', () => {
    const state = reduceListNavigation(at(3, 3), { type: 'NAVIGATE_UP', visibleRows: 2 }, 6);

    expect(state.selectedIndex).toBe(2);
    expect(state.scrollOffset).toBe(2);
  });

  it('moves one page up and down', () => {
    const up = reduceListNavigation(at(7, 6), { type: 'PAGE_UP', visibleRows: 5 }, 20);
    expect(up.selectedIndex).toBe(2);
    expect(up.scrollOffset).toBe(1);

    const down = reduceListNavigation(at(7, 6), { type: 'PAGE_DOWN', visibleRows: 5 }, 20);
    expect(down.selectedIndex).toBe(12);
    expect(down.scrollOffset).toBe(11);
  });

  it('jumps to boundaries with home/end', () => {
    expect(reduceListNavigation(at(5, 3), { type: 'HOME' }, 9)).toEqual(at(0, 0));
    expect(reduceListNavigation(at(0, 0), { type: 'END', visibleRows: 4 }, 9)).toEqual(at(8, 5));
  });

  it('returns stable empty-list state for all operations', () => {
    const empty = at(0, 0);
    expect(reduceListNavigation(empty, { type: 'NAVIGATE_UP', visibleRows: 4 }, 0)).toEqual(empty);
    expect(reduceListNavigation(empty, { type: 'NAVIGATE_DOWN', visibleRows: 4 }, 0)).toEqual(empty);
    expect(reduceListNavigation(empty, { type: 'PAGE_UP', visibleRows: 4 }, 0)).toEqual(empty);
    expect(reduceListNavigation(empty, { type: 'PAGE_DOWN', visibleRows: 4 }, 0)).toEqual(empty);
    expect(reduceListNavigation(empty, { type: 'END', visibleRows: 4 }, 0)).toEqual(empty);
  });
});

// ─── isListNavigationAction ──────────────────────────────────────────────────

describe('isListNavigationAction', () => {
  it.each([
    { type: 'NAVIGATE_UP', visibleRows: 5 },
    { type: 'NAVIGATE_DOWN', visibleRows: 5 },
    { type: 'PAGE_UP', visibleRows: 5 },
    { type: 'PAGE_DOWN', visibleRows: 5 },
    { type: 'HOME' },
    { type: 'END', visibleRows: 5 },
  ] satisfies ListNavigationAction[])('returns true for $type', (action) => {
    expect(isListNavigationAction(action)).toBe(true);
  });

  it.each([{ type: 'CYCLE_FILTER' }, { type: 'TOGGLE_EXCLUSION' }, { type: 'SET_ERROR' }, { type: 'CONFIRM_REVIEW' }])(
    'returns false for $type',
    (action) => {
      expect(isListNavigationAction(action)).toBe(false);
    }
  );
});

// ─── dispatchListNavigationKeys ──────────────────────────────────────────────

describe('dispatchListNavigationKeys', () => {
  const baseKey = {
    ctrl: false,
    downArrow: false,
    end: false,
    home: false,
    pageDown: false,
    pageUp: false,
    upArrow: false,
  };

  function pressKey(overrides: Partial<typeof baseKey>, input = '') {
    const dispatch = vi.fn<(action: ListNavigationAction) => void>();
    const handled = dispatchListNavigationKeys({ ...baseKey, ...overrides }, input, dispatch, 10);
    return { dispatch, handled };
  }

  it('dispatches NAVIGATE_UP on upArrow', () => {
    const { dispatch, handled } = pressKey({ upArrow: true });
    expect(handled).toBe(true);
    expect(dispatch).toHaveBeenCalledWith({ type: 'NAVIGATE_UP', visibleRows: 10 });
  });

  it('dispatches NAVIGATE_UP on vim k', () => {
    const { dispatch, handled } = pressKey({}, 'k');
    expect(handled).toBe(true);
    expect(dispatch).toHaveBeenCalledWith({ type: 'NAVIGATE_UP', visibleRows: 10 });
  });

  it('dispatches NAVIGATE_DOWN on downArrow', () => {
    const { dispatch, handled } = pressKey({ downArrow: true });
    expect(handled).toBe(true);
    expect(dispatch).toHaveBeenCalledWith({ type: 'NAVIGATE_DOWN', visibleRows: 10 });
  });

  it('dispatches NAVIGATE_DOWN on vim j', () => {
    const { dispatch, handled } = pressKey({}, 'j');
    expect(handled).toBe(true);
    expect(dispatch).toHaveBeenCalledWith({ type: 'NAVIGATE_DOWN', visibleRows: 10 });
  });

  it('dispatches PAGE_UP on pageUp', () => {
    const { dispatch, handled } = pressKey({ pageUp: true });
    expect(handled).toBe(true);
    expect(dispatch).toHaveBeenCalledWith({ type: 'PAGE_UP', visibleRows: 10 });
  });

  it('dispatches PAGE_UP on Ctrl+u', () => {
    const { dispatch, handled } = pressKey({ ctrl: true }, 'u');
    expect(handled).toBe(true);
    expect(dispatch).toHaveBeenCalledWith({ type: 'PAGE_UP', visibleRows: 10 });
  });

  it('dispatches PAGE_DOWN on pageDown', () => {
    const { dispatch, handled } = pressKey({ pageDown: true });
    expect(handled).toBe(true);
    expect(dispatch).toHaveBeenCalledWith({ type: 'PAGE_DOWN', visibleRows: 10 });
  });

  it('dispatches PAGE_DOWN on Ctrl+d', () => {
    const { dispatch, handled } = pressKey({ ctrl: true }, 'd');
    expect(handled).toBe(true);
    expect(dispatch).toHaveBeenCalledWith({ type: 'PAGE_DOWN', visibleRows: 10 });
  });

  it('dispatches HOME on home', () => {
    const { dispatch, handled } = pressKey({ home: true });
    expect(handled).toBe(true);
    expect(dispatch).toHaveBeenCalledWith({ type: 'HOME' });
  });

  it('dispatches END on end', () => {
    const { dispatch, handled } = pressKey({ end: true });
    expect(handled).toBe(true);
    expect(dispatch).toHaveBeenCalledWith({ type: 'END', visibleRows: 10 });
  });

  it('returns false and does not dispatch for unhandled keys', () => {
    const { dispatch, handled } = pressKey({}, 'x');
    expect(handled).toBe(false);
    expect(dispatch).not.toHaveBeenCalled();
  });
});
