/**
 * Tests for transactions view controller
 */

import { describe, expect, it } from 'vitest';

import { handleTransactionsKeyboardInput, transactionsViewReducer } from '../transactions-view-controller.js';
import { createTransactionsViewState, type TransactionViewItem } from '../transactions-view-state.js';

describe('transactionsViewReducer', () => {
  it('navigates up and wraps to bottom', () => {
    const state = createMockState();
    state.selectedIndex = 1;

    const newState = transactionsViewReducer(state, { type: 'NAVIGATE_UP', visibleRows: 10 });
    expect(newState.selectedIndex).toBe(0);

    const wrappedState = transactionsViewReducer(newState, { type: 'NAVIGATE_UP', visibleRows: 10 });
    expect(wrappedState.selectedIndex).toBe(3);
  });

  it('navigates down and wraps to top', () => {
    const state = createMockState();
    state.selectedIndex = 2;

    const newState = transactionsViewReducer(state, { type: 'NAVIGATE_DOWN', visibleRows: 10 });
    expect(newState.selectedIndex).toBe(3);

    const wrappedState = transactionsViewReducer(newState, { type: 'NAVIGATE_DOWN', visibleRows: 10 });
    expect(wrappedState.selectedIndex).toBe(0);
  });

  it('scrolls down when navigating below visible window', () => {
    const state = createMockState();
    state.selectedIndex = 0;
    state.scrollOffset = 0;

    const state1 = transactionsViewReducer(state, { type: 'NAVIGATE_DOWN', visibleRows: 2 });
    expect(state1.selectedIndex).toBe(1);
    expect(state1.scrollOffset).toBe(0);

    const state2 = transactionsViewReducer(state1, { type: 'NAVIGATE_DOWN', visibleRows: 2 });
    expect(state2.selectedIndex).toBe(2);
    expect(state2.scrollOffset).toBe(1);
  });

  it('scrolls up when navigating above visible window', () => {
    const state = createMockState();
    state.selectedIndex = 2;
    state.scrollOffset = 2;

    const state1 = transactionsViewReducer(state, { type: 'NAVIGATE_UP', visibleRows: 2 });
    expect(state1.selectedIndex).toBe(1);
    expect(state1.scrollOffset).toBe(1);

    const state2 = transactionsViewReducer(state1, { type: 'NAVIGATE_UP', visibleRows: 2 });
    expect(state2.selectedIndex).toBe(0);
    expect(state2.scrollOffset).toBe(0);
  });

  it('scrolls to end when wrapping to bottom', () => {
    const state = createMockState();
    state.selectedIndex = 0;
    state.scrollOffset = 0;

    const newState = transactionsViewReducer(state, { type: 'NAVIGATE_UP', visibleRows: 2 });
    expect(newState.selectedIndex).toBe(3);
    expect(newState.scrollOffset).toBe(2);
  });

  it('scrolls to top when wrapping to top', () => {
    const state = createMockState();
    state.selectedIndex = 3;
    state.scrollOffset = 2;

    const newState = transactionsViewReducer(state, { type: 'NAVIGATE_DOWN', visibleRows: 2 });
    expect(newState.selectedIndex).toBe(0);
    expect(newState.scrollOffset).toBe(0);
  });

  it('handles PAGE_UP navigation', () => {
    const state = createMockState();
    state.selectedIndex = 3;
    state.scrollOffset = 2;

    const newState = transactionsViewReducer(state, { type: 'PAGE_UP', visibleRows: 2 });
    expect(newState.selectedIndex).toBe(1);
    expect(newState.scrollOffset).toBe(0);
  });

  it('handles PAGE_DOWN navigation', () => {
    const state = createMockState();
    state.selectedIndex = 0;
    state.scrollOffset = 0;

    const newState = transactionsViewReducer(state, { type: 'PAGE_DOWN', visibleRows: 2 });
    expect(newState.selectedIndex).toBe(2);
    expect(newState.scrollOffset).toBe(2);
  });

  it('handles HOME navigation', () => {
    const state = createMockState();
    state.selectedIndex = 3;
    state.scrollOffset = 2;

    const newState = transactionsViewReducer(state, { type: 'HOME' });
    expect(newState.selectedIndex).toBe(0);
    expect(newState.scrollOffset).toBe(0);
  });

  it('handles END navigation', () => {
    const state = createMockState();

    const newState = transactionsViewReducer(state, { type: 'END', visibleRows: 2 });
    expect(newState.selectedIndex).toBe(3);
    expect(newState.scrollOffset).toBe(2);
  });

  it('keeps navigation state stable when list is empty', () => {
    const state = createTransactionsViewState([], {}, 0);

    const upState = transactionsViewReducer(state, { type: 'NAVIGATE_UP', visibleRows: 10 });
    expect(upState.selectedIndex).toBe(0);
    expect(upState.scrollOffset).toBe(0);

    const downState = transactionsViewReducer(state, { type: 'NAVIGATE_DOWN', visibleRows: 10 });
    expect(downState.selectedIndex).toBe(0);
    expect(downState.scrollOffset).toBe(0);
  });
});

describe('handleTransactionsKeyboardInput', () => {
  const defaultKey = {
    upArrow: false,
    downArrow: false,
    ctrl: false,
    end: false,
    escape: false,
    home: false,
    pageDown: false,
    pageUp: false,
  };

  it('handles arrow up key', () => {
    let actionReceived = false;
    const dispatch = (action: unknown) => {
      expect(action).toEqual({ type: 'NAVIGATE_UP', visibleRows: 6 });
      actionReceived = true;
    };

    handleTransactionsKeyboardInput(
      '',
      { ...defaultKey, upArrow: true },
      dispatch,
      () => {
        /* no-op */
      },
      24
    );
    expect(actionReceived).toBe(true);
  });

  it('handles arrow down key', () => {
    let actionReceived = false;
    const dispatch = (action: unknown) => {
      expect(action).toEqual({ type: 'NAVIGATE_DOWN', visibleRows: 6 });
      actionReceived = true;
    };

    handleTransactionsKeyboardInput(
      '',
      { ...defaultKey, downArrow: true },
      dispatch,
      () => {
        /* no-op */
      },
      24
    );
    expect(actionReceived).toBe(true);
  });

  it('handles vim k key', () => {
    let actionReceived = false;
    const dispatch = (action: unknown) => {
      expect(action).toEqual({ type: 'NAVIGATE_UP', visibleRows: 6 });
      actionReceived = true;
    };

    handleTransactionsKeyboardInput(
      'k',
      defaultKey,
      dispatch,
      () => {
        /* no-op */
      },
      24
    );
    expect(actionReceived).toBe(true);
  });

  it('handles vim j key', () => {
    let actionReceived = false;
    const dispatch = (action: unknown) => {
      expect(action).toEqual({ type: 'NAVIGATE_DOWN', visibleRows: 6 });
      actionReceived = true;
    };

    handleTransactionsKeyboardInput(
      'j',
      defaultKey,
      dispatch,
      () => {
        /* no-op */
      },
      24
    );
    expect(actionReceived).toBe(true);
  });

  it('handles quit key', () => {
    let quitCalled = false;
    const dispatch = () => {
      /* no-op */
    };

    handleTransactionsKeyboardInput(
      'q',
      defaultKey,
      dispatch,
      () => {
        quitCalled = true;
      },
      24
    );
    expect(quitCalled).toBe(true);
  });

  it('handles escape key', () => {
    let quitCalled = false;
    const dispatch = () => {
      /* no-op */
    };

    handleTransactionsKeyboardInput(
      '',
      { ...defaultKey, escape: true },
      dispatch,
      () => {
        quitCalled = true;
      },
      24
    );
    expect(quitCalled).toBe(true);
  });

  it('handles page up key', () => {
    let actionReceived = false;
    const dispatch = (action: unknown) => {
      expect(action).toEqual({ type: 'PAGE_UP', visibleRows: 6 });
      actionReceived = true;
    };

    handleTransactionsKeyboardInput(
      '',
      { ...defaultKey, pageUp: true },
      dispatch,
      () => {
        /* no-op */
      },
      24
    );
    expect(actionReceived).toBe(true);
  });

  it('handles page down key', () => {
    let actionReceived = false;
    const dispatch = (action: unknown) => {
      expect(action).toEqual({ type: 'PAGE_DOWN', visibleRows: 6 });
      actionReceived = true;
    };

    handleTransactionsKeyboardInput(
      '',
      { ...defaultKey, pageDown: true },
      dispatch,
      () => {
        /* no-op */
      },
      24
    );
    expect(actionReceived).toBe(true);
  });

  it('handles Ctrl+U for page up', () => {
    let actionReceived = false;
    const dispatch = (action: unknown) => {
      expect(action).toEqual({ type: 'PAGE_UP', visibleRows: 6 });
      actionReceived = true;
    };

    handleTransactionsKeyboardInput(
      'u',
      { ...defaultKey, ctrl: true },
      dispatch,
      () => {
        /* no-op */
      },
      24
    );
    expect(actionReceived).toBe(true);
  });

  it('handles Ctrl+D for page down', () => {
    let actionReceived = false;
    const dispatch = (action: unknown) => {
      expect(action).toEqual({ type: 'PAGE_DOWN', visibleRows: 6 });
      actionReceived = true;
    };

    handleTransactionsKeyboardInput(
      'd',
      { ...defaultKey, ctrl: true },
      dispatch,
      () => {
        /* no-op */
      },
      24
    );
    expect(actionReceived).toBe(true);
  });

  it('handles home key', () => {
    let actionReceived = false;
    const dispatch = (action: unknown) => {
      expect(action).toEqual({ type: 'HOME' });
      actionReceived = true;
    };

    handleTransactionsKeyboardInput(
      '',
      { ...defaultKey, home: true },
      dispatch,
      () => {
        /* no-op */
      },
      24
    );
    expect(actionReceived).toBe(true);
  });

  it('handles end key', () => {
    let actionReceived = false;
    const dispatch = (action: unknown) => {
      expect(action).toEqual({ type: 'END', visibleRows: 6 });
      actionReceived = true;
    };

    handleTransactionsKeyboardInput(
      '',
      { ...defaultKey, end: true },
      dispatch,
      () => {
        /* no-op */
      },
      24
    );
    expect(actionReceived).toBe(true);
  });

  it('computes visible rows from terminal height minus chrome', () => {
    let receivedVisibleRows = 0;
    const dispatch = (action: unknown) => {
      receivedVisibleRows = (action as { visibleRows: number }).visibleRows;
    };

    // terminalHeight(24) - 18 chrome lines = 6
    handleTransactionsKeyboardInput(
      'j',
      defaultKey,
      dispatch,
      () => {
        /* no-op */
      },
      24
    );
    expect(receivedVisibleRows).toBe(6);

    // terminalHeight(40) - 18 chrome lines = 22
    handleTransactionsKeyboardInput(
      'j',
      defaultKey,
      dispatch,
      () => {
        /* no-op */
      },
      40
    );
    expect(receivedVisibleRows).toBe(22);
  });
});

// ─── Test Helpers ───────────────────────────────────────────────────────────

function createMockItems(): TransactionViewItem[] {
  return [
    {
      id: 2456,
      source: 'kraken',
      sourceType: 'exchange',
      externalId: 'tx-001',
      datetime: '2024-11-28T16:20:45Z',
      operationCategory: 'trade',
      operationType: 'buy',
      primaryAsset: 'BTC',
      primaryAmount: '0.5000',
      primaryDirection: 'in',
      inflows: [{ assetSymbol: 'BTC', amount: '0.5000', priceAtTxTime: { price: '$48,250.00', source: 'kraken' } }],
      outflows: [{ assetSymbol: 'USD', amount: '48250.00' }],
      fees: [{ assetSymbol: 'USD', amount: '12.50', scope: 'platform', settlement: 'balance' }],
      priceStatus: 'all',
      blockchain: undefined,
      from: undefined,
      to: undefined,
      notes: [],
      excludedFromAccounting: false,
      isSpam: false,
    },
    {
      id: 2412,
      source: 'ethereum',
      sourceType: 'blockchain',
      externalId: 'tx-002',
      datetime: '2024-11-15T08:33:12Z',
      operationCategory: 'transfer',
      operationType: 'deposit',
      primaryAsset: 'ETH',
      primaryAmount: '2.0000',
      primaryDirection: 'in',
      inflows: [{ assetSymbol: 'ETH', amount: '2.0000', priceAtTxTime: { price: '$7,841.20', source: 'coingecko' } }],
      outflows: [],
      fees: [
        {
          assetSymbol: 'ETH',
          amount: '0.0021',
          scope: 'network',
          settlement: 'balance',
          priceAtTxTime: { price: '$8.24', source: 'coingecko' },
        },
      ],
      priceStatus: 'all',
      blockchain: {
        name: 'ethereum',
        blockHeight: 19234567,
        transactionHash: '0x7a3f1234567890abcdef1234567890ab8b2e',
        isConfirmed: true,
      },
      from: '0x742d35Cc6634C0532925a3b844bBd38',
      to: '0x12345678901234567890123456785678',
      notes: [],
      excludedFromAccounting: false,
      isSpam: false,
    },
    {
      id: 2389,
      source: 'solana',
      sourceType: 'blockchain',
      externalId: 'tx-003',
      datetime: '2024-11-10T14:45:22Z',
      operationCategory: 'staking',
      operationType: 'reward',
      primaryAsset: 'SOL',
      primaryAmount: '1.2500',
      primaryDirection: 'in',
      inflows: [{ assetSymbol: 'SOL', amount: '1.2500' }],
      outflows: [],
      fees: [],
      priceStatus: 'none',
      blockchain: {
        name: 'solana',
        blockHeight: 245891023,
        transactionHash: '5Uh7abcdefghijklmnopqrstuvwxyzkQ3x',
        isConfirmed: true,
      },
      from: undefined,
      to: '7nYpabcdefghijklmnor4Wz',
      notes: [],
      excludedFromAccounting: false,
      isSpam: false,
    },
    {
      id: 2312,
      source: 'kraken',
      sourceType: 'exchange',
      externalId: 'tx-004',
      datetime: '2024-10-28T09:12:00Z',
      operationCategory: 'trade',
      operationType: 'sell',
      primaryAsset: 'BTC',
      primaryAmount: '0.2500',
      primaryDirection: 'out',
      inflows: [{ assetSymbol: 'USD', amount: '24500.00' }],
      outflows: [{ assetSymbol: 'BTC', amount: '0.2500', priceAtTxTime: { price: '$98,000.00', source: 'kraken' } }],
      fees: [{ assetSymbol: 'USD', amount: '6.25', scope: 'platform', settlement: 'balance' }],
      priceStatus: 'all',
      blockchain: undefined,
      from: undefined,
      to: undefined,
      notes: [],
      excludedFromAccounting: false,
      isSpam: false,
    },
  ];
}

function createMockState() {
  return createTransactionsViewState(createMockItems(), {}, 4);
}
