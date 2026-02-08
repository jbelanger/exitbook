/**
 * Tests for prices view controller
 */

import { describe, expect, it } from 'vitest';

import type { MissingPriceMovement } from '../../prices-view-utils.js';
import { handlePricesKeyboardInput, pricesViewReducer } from '../prices-view-controller.js';
import { createCoverageViewState, createMissingViewState, missingRowKey } from '../prices-view-state.js';

describe('pricesViewReducer - coverage mode', () => {
  it('navigates up and wraps to bottom', () => {
    const state = createCoverageViewState(createMockCoverage(), createMockSummary());
    state.selectedIndex = 1;

    const s1 = pricesViewReducer(state, { type: 'NAVIGATE_UP', visibleRows: 10 });
    expect(s1.selectedIndex).toBe(0);

    const s2 = pricesViewReducer(s1, { type: 'NAVIGATE_UP', visibleRows: 10 });
    expect(s2.selectedIndex).toBe(2);
  });

  it('navigates down and wraps to top', () => {
    const state = createCoverageViewState(createMockCoverage(), createMockSummary());
    state.selectedIndex = 1;

    const s1 = pricesViewReducer(state, { type: 'NAVIGATE_DOWN', visibleRows: 10 });
    expect(s1.selectedIndex).toBe(2);

    const s2 = pricesViewReducer(s1, { type: 'NAVIGATE_DOWN', visibleRows: 10 });
    expect(s2.selectedIndex).toBe(0);
  });

  it('handles HOME and END', () => {
    const state = createCoverageViewState(createMockCoverage(), createMockSummary());
    state.selectedIndex = 1;

    const homeState = pricesViewReducer(state, { type: 'HOME' });
    expect(homeState.selectedIndex).toBe(0);
    expect(homeState.scrollOffset).toBe(0);

    const endState = pricesViewReducer(state, { type: 'END', visibleRows: 2 });
    expect(endState.selectedIndex).toBe(2);
  });

  it('handles PAGE_UP and PAGE_DOWN', () => {
    const state = createCoverageViewState(createMockCoverage(), createMockSummary());
    state.selectedIndex = 0;

    const downState = pricesViewReducer(state, { type: 'PAGE_DOWN', visibleRows: 2 });
    expect(downState.selectedIndex).toBe(2);

    const upState = pricesViewReducer(downState, { type: 'PAGE_UP', visibleRows: 2 });
    expect(upState.selectedIndex).toBe(0);
  });

  it('ignores START_INPUT in coverage mode', () => {
    const state = createCoverageViewState(createMockCoverage(), createMockSummary());
    const newState = pricesViewReducer(state, { type: 'START_INPUT' });
    expect(newState).toBe(state);
  });

  it('keeps stable state for empty list', () => {
    const state = createCoverageViewState([], createMockSummary());

    const s1 = pricesViewReducer(state, { type: 'NAVIGATE_UP', visibleRows: 10 });
    expect(s1.selectedIndex).toBe(0);

    const s2 = pricesViewReducer(state, { type: 'NAVIGATE_DOWN', visibleRows: 10 });
    expect(s2.selectedIndex).toBe(0);
  });
});

describe('pricesViewReducer - missing mode', () => {
  it('navigates up and down', () => {
    const state = createMissingViewState(createMockMovements(), []);
    state.selectedIndex = 0;

    const s1 = pricesViewReducer(state, { type: 'NAVIGATE_DOWN', visibleRows: 10 });
    expect(s1.selectedIndex).toBe(1);

    const s2 = pricesViewReducer(s1, { type: 'NAVIGATE_UP', visibleRows: 10 });
    expect(s2.selectedIndex).toBe(0);
  });

  it('starts input on unresolved row', () => {
    const state = createMissingViewState(createMockMovements(), []);
    state.selectedIndex = 0;

    const newState = pricesViewReducer(state, { type: 'START_INPUT' });
    expect(newState.mode).toBe('missing');
    if (newState.mode === 'missing') {
      expect(newState.activeInput).toEqual({ rowIndex: 0, value: '' });
      expect(newState.error).toBeUndefined();
    }
  });

  it('prevents input on resolved row', () => {
    const movements = createMockMovements();
    const state = createMissingViewState(movements, []);
    state.selectedIndex = 0;
    state.resolvedRows.add(missingRowKey(movements[0]!));

    const newState = pricesViewReducer(state, { type: 'START_INPUT' });
    expect(newState.mode).toBe('missing');
    if (newState.mode === 'missing') {
      expect(newState.activeInput).toBeUndefined();
      expect(newState.error).toBe('Price already set for this row');
    }
  });

  it('updates input value', () => {
    const state = createMissingViewState(createMockMovements(), []);
    state.activeInput = { rowIndex: 0, value: '10' };

    const newState = pricesViewReducer(state, { type: 'UPDATE_INPUT', value: '105' });
    expect(newState.mode).toBe('missing');
    if (newState.mode === 'missing') {
      expect(newState.activeInput?.value).toBe('105');
      expect(newState.activeInput?.validationError).toBeUndefined();
    }
  });

  it('cancels input', () => {
    const state = createMissingViewState(createMockMovements(), []);
    state.activeInput = { rowIndex: 0, value: '100' };

    const newState = pricesViewReducer(state, { type: 'CANCEL_INPUT' });
    expect(newState.mode).toBe('missing');
    if (newState.mode === 'missing') {
      expect(newState.activeInput).toBeUndefined();
    }
  });

  it('validates empty price on submit', () => {
    const state = createMissingViewState(createMockMovements(), []);
    state.activeInput = { rowIndex: 0, value: '' };

    const newState = pricesViewReducer(state, { type: 'SUBMIT_PRICE' });
    expect(newState.mode).toBe('missing');
    if (newState.mode === 'missing') {
      expect(newState.activeInput?.validationError).toBe('Price cannot be empty');
    }
  });

  it('validates non-positive price on submit', () => {
    const state = createMissingViewState(createMockMovements(), []);
    state.activeInput = { rowIndex: 0, value: '0' };

    const newState = pricesViewReducer(state, { type: 'SUBMIT_PRICE' });
    expect(newState.mode).toBe('missing');
    if (newState.mode === 'missing') {
      expect(newState.activeInput?.validationError).toBe('Price must be a positive number');
    }
  });

  it('validates invalid number on submit', () => {
    const state = createMissingViewState(createMockMovements(), []);
    state.activeInput = { rowIndex: 0, value: 'abc' };

    const newState = pricesViewReducer(state, { type: 'SUBMIT_PRICE' });
    expect(newState.mode).toBe('missing');
    if (newState.mode === 'missing') {
      expect(newState.activeInput?.validationError).toBe('Price must be a positive number');
    }
  });

  it('sets submitted flag for valid price on submit', () => {
    const state = createMissingViewState(createMockMovements(), []);
    state.activeInput = { rowIndex: 0, value: '42500.50' };

    const newState = pricesViewReducer(state, { type: 'SUBMIT_PRICE' });
    expect(newState.mode).toBe('missing');
    if (newState.mode === 'missing') {
      expect(newState.activeInput?.submitted).toBe(true);
      expect(newState.activeInput?.validationError).toBeUndefined();
    }
  });

  it('marks row resolved, stores price, and advances cursor on PRICE_SAVED', () => {
    const movements = createMockMovements();
    const state = createMissingViewState(movements, []);
    state.selectedIndex = 0;
    state.activeInput = { rowIndex: 0, value: '42500' };
    const rowKey = missingRowKey(movements[0]!);

    const newState = pricesViewReducer(state, { type: 'PRICE_SAVED', rowKey, price: '42500' });
    expect(newState.mode).toBe('missing');
    if (newState.mode === 'missing') {
      expect(newState.resolvedRows.has(rowKey)).toBe(true);
      expect(newState.activeInput).toBeUndefined();
      expect(newState.selectedIndex).toBe(1); // Advanced to next unresolved
      expect(newState.error).toBeUndefined();
      expect(newState.movements[0]!.resolvedPrice).toBe('42500');
    }
  });

  it('sets error on PRICE_SAVE_FAILED', () => {
    const state = createMissingViewState(createMockMovements(), []);
    state.activeInput = { rowIndex: 0, value: '100' };

    const newState = pricesViewReducer(state, { type: 'PRICE_SAVE_FAILED', error: 'Network error' });
    expect(newState.mode).toBe('missing');
    if (newState.mode === 'missing') {
      expect(newState.error).toBe('Network error');
      expect(newState.activeInput).toBeUndefined();
    }
  });

  it('clears error', () => {
    const state = createMissingViewState(createMockMovements(), []);
    state.error = 'Something went wrong';

    const newState = pricesViewReducer(state, { type: 'CLEAR_ERROR' });
    expect(newState.mode).toBe('missing');
    if (newState.mode === 'missing') {
      expect(newState.error).toBeUndefined();
    }
  });
});

const noop = (): void => undefined;

describe('handlePricesKeyboardInput', () => {
  const noKey = {
    backspace: false,
    ctrl: false,
    delete: false,
    downArrow: false,
    end: false,
    escape: false,
    home: false,
    pageDown: false,
    pageUp: false,
    return: false,
    upArrow: false,
  };

  it('dispatches NAVIGATE_UP on arrow up', () => {
    let received: unknown;
    const dispatch = (action: unknown) => {
      received = action;
    };
    const state = createCoverageViewState(createMockCoverage(), createMockSummary());

    handlePricesKeyboardInput('', { ...noKey, upArrow: true }, dispatch, noop, 24, state);
    expect(received).toEqual({ type: 'NAVIGATE_UP', visibleRows: 10 });
  });

  it('dispatches NAVIGATE_DOWN on j', () => {
    let received: unknown;
    const dispatch = (action: unknown) => {
      received = action;
    };
    const state = createCoverageViewState(createMockCoverage(), createMockSummary());

    handlePricesKeyboardInput('j', noKey, dispatch, noop, 24, state);
    expect(received).toEqual({ type: 'NAVIGATE_DOWN', visibleRows: 10 });
  });

  it('calls onQuit on q', () => {
    let quitCalled = false;
    const state = createCoverageViewState(createMockCoverage(), createMockSummary());

    handlePricesKeyboardInput(
      'q',
      noKey,
      noop,
      () => {
        quitCalled = true;
      },
      24,
      state
    );
    expect(quitCalled).toBe(true);
  });

  it('calls onQuit on escape', () => {
    let quitCalled = false;
    const state = createCoverageViewState(createMockCoverage(), createMockSummary());

    handlePricesKeyboardInput(
      '',
      { ...noKey, escape: true },
      noop,
      () => {
        quitCalled = true;
      },
      24,
      state
    );
    expect(quitCalled).toBe(true);
  });

  it('dispatches START_INPUT on s in missing mode', () => {
    let received: unknown;
    const dispatch = (action: unknown) => {
      received = action;
    };
    const state = createMissingViewState(createMockMovements(), []);

    handlePricesKeyboardInput('s', noKey, dispatch, noop, 24, state);
    expect(received).toEqual({ type: 'START_INPUT' });
  });

  it('does not dispatch START_INPUT on s in coverage mode', () => {
    let dispatched = false;
    const state = createCoverageViewState(createMockCoverage(), createMockSummary());

    handlePricesKeyboardInput(
      's',
      noKey,
      () => {
        dispatched = true;
      },
      noop,
      24,
      state
    );
    expect(dispatched).toBe(false);
  });

  it('handles input mode: digit appends to value', () => {
    let received: unknown;
    const dispatch = (action: unknown) => {
      received = action;
    };
    const state = createMissingViewState(createMockMovements(), []);
    state.activeInput = { rowIndex: 0, value: '10' };

    handlePricesKeyboardInput('5', noKey, dispatch, noop, 24, state);
    expect(received).toEqual({ type: 'UPDATE_INPUT', value: '105' });
  });

  it('handles input mode: backspace removes last char', () => {
    let received: unknown;
    const dispatch = (action: unknown) => {
      received = action;
    };
    const state = createMissingViewState(createMockMovements(), []);
    state.activeInput = { rowIndex: 0, value: '105' };

    handlePricesKeyboardInput('', { ...noKey, backspace: true }, dispatch, noop, 24, state);
    expect(received).toEqual({ type: 'UPDATE_INPUT', value: '10' });
  });

  it('handles input mode: escape cancels input', () => {
    let received: unknown;
    const dispatch = (action: unknown) => {
      received = action;
    };
    const state = createMissingViewState(createMockMovements(), []);
    state.activeInput = { rowIndex: 0, value: '100' };

    handlePricesKeyboardInput('', { ...noKey, escape: true }, dispatch, noop, 24, state);
    expect(received).toEqual({ type: 'CANCEL_INPUT' });
  });

  it('handles input mode: enter submits', () => {
    let received: unknown;
    const dispatch = (action: unknown) => {
      received = action;
    };
    const state = createMissingViewState(createMockMovements(), []);
    state.activeInput = { rowIndex: 0, value: '42500' };

    handlePricesKeyboardInput('', { ...noKey, return: true }, dispatch, noop, 24, state);
    expect(received).toEqual({ type: 'SUBMIT_PRICE' });
  });

  it('ignores non-digit chars in input mode', () => {
    let dispatched = false;
    const state = createMissingViewState(createMockMovements(), []);
    state.activeInput = { rowIndex: 0, value: '10' };

    handlePricesKeyboardInput(
      'a',
      noKey,
      () => {
        dispatched = true;
      },
      noop,
      24,
      state
    );
    expect(dispatched).toBe(false);
  });

  it('uses coverage chrome lines', () => {
    let receivedVisibleRows = 0;
    const dispatch = (action: unknown) => {
      receivedVisibleRows = (action as { visibleRows: number }).visibleRows;
    };
    const state = createCoverageViewState(createMockCoverage(), createMockSummary());

    // Coverage mode: 24 - 14 = 10
    handlePricesKeyboardInput('j', noKey, dispatch, noop, 24, state);
    expect(receivedVisibleRows).toBe(10);
  });

  it('uses missing chrome lines', () => {
    let receivedVisibleRows = 0;
    const dispatch = (action: unknown) => {
      receivedVisibleRows = (action as { visibleRows: number }).visibleRows;
    };
    const state = createMissingViewState(createMockMovements(), []);

    // Missing mode: 24 - 18 = 6
    handlePricesKeyboardInput('j', noKey, dispatch, noop, 24, state);
    expect(receivedVisibleRows).toBe(6);
  });
});

// ─── Test Helpers ───────────────────────────────────────────────────────────

function createMockCoverage() {
  return [
    {
      assetSymbol: 'BTC',
      total_transactions: 100,
      with_price: 90,
      missing_price: 10,
      coverage_percentage: 90,
      sources: [
        { name: 'kraken', count: 60 },
        { name: 'coinbase', count: 40 },
      ],
      missingSources: [
        { name: 'kraken', count: 7 },
        { name: 'coinbase', count: 3 },
      ],
      dateRange: { earliest: '2024-01-01T00:00:00Z', latest: '2024-12-31T23:59:59Z' },
    },
    {
      assetSymbol: 'ETH',
      total_transactions: 200,
      with_price: 200,
      missing_price: 0,
      coverage_percentage: 100,
      sources: [{ name: 'ethereum', count: 200 }],
      missingSources: [],
      dateRange: { earliest: '2024-02-01T00:00:00Z', latest: '2024-11-30T23:59:59Z' },
    },
    {
      assetSymbol: 'SOL',
      total_transactions: 50,
      with_price: 25,
      missing_price: 25,
      coverage_percentage: 50,
      sources: [{ name: 'solana', count: 50 }],
      missingSources: [{ name: 'solana', count: 25 }],
      dateRange: { earliest: '2024-06-01T00:00:00Z', latest: '2024-09-30T23:59:59Z' },
    },
  ];
}

function createMockSummary() {
  return {
    total_transactions: 300,
    with_price: 315,
    missing_price: 35,
    overall_coverage_percentage: 90,
  };
}

function createMockMovements(): MissingPriceMovement[] {
  return [
    {
      transactionId: 101,
      source: 'kraken',
      datetime: '2024-03-15T14:23:41Z',
      assetSymbol: 'BTC',
      amount: '1.5',
      direction: 'inflow',
      operationCategory: 'transfer',
      operationType: 'deposit',
    },
    {
      transactionId: 102,
      source: 'ethereum',
      datetime: '2024-03-16T10:15:22Z',
      assetSymbol: 'ETH',
      amount: '10.0',
      direction: 'outflow',
      operationCategory: 'transfer',
      operationType: 'withdrawal',
    },
    {
      transactionId: 103,
      source: 'coinbase',
      datetime: '2024-03-17T08:30:11Z',
      assetSymbol: 'SOL',
      amount: '100.0',
      direction: 'inflow',
      operationCategory: 'trade',
      operationType: 'buy',
    },
  ];
}
