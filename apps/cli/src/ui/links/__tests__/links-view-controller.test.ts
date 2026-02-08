/**
 * Tests for links view controller
 */

import { Decimal } from 'decimal.js';
import { describe, expect, it } from 'vitest';

import type { LinkGapAnalysis } from '../../../features/links/links-gap-utils.js';
import { handleKeyboardInput, linksViewReducer } from '../links-view-controller.js';
import { createGapsViewState, createLinksViewState, type LinkWithTransactions } from '../links-view-state.js';

describe('linksViewReducer', () => {
  it('navigates up and wraps to bottom', () => {
    const links = createMockLinks();
    const state = createLinksViewState(links);
    state.selectedIndex = 1;

    // Navigate up
    const newState = linksViewReducer(state, { type: 'NAVIGATE_UP', visibleRows: 10 });
    expect(newState.selectedIndex).toBe(0);

    // Navigate up again - should wrap to bottom
    const wrappedState = linksViewReducer(newState, { type: 'NAVIGATE_UP', visibleRows: 10 });
    expect(wrappedState.selectedIndex).toBe(3);
  });

  it('navigates down and wraps to top', () => {
    const links = createMockLinks();
    const state = createLinksViewState(links);
    state.selectedIndex = 2;

    // Navigate down
    const newState = linksViewReducer(state, { type: 'NAVIGATE_DOWN', visibleRows: 10 });
    expect(newState.selectedIndex).toBe(3);

    // Navigate down again - should wrap to top
    const wrappedState = linksViewReducer(newState, { type: 'NAVIGATE_DOWN', visibleRows: 10 });
    expect(wrappedState.selectedIndex).toBe(0);
  });

  it('clears error on navigation', () => {
    const links = createMockLinks();
    const state = createLinksViewState(links);
    state.error = 'Something went wrong';

    const newState = linksViewReducer(state, { type: 'NAVIGATE_DOWN', visibleRows: 10 });
    expect(newState.mode).toBe('links');
    if (newState.mode === 'links') {
      expect(newState.error).toBeUndefined();
    }
  });

  it('scrolls down when navigating below visible window', () => {
    const links = createMockLinks();
    const state = createLinksViewState(links);
    state.selectedIndex = 0;
    state.scrollOffset = 0;

    // Navigate down beyond visible rows (visibleRows = 2)
    const state1 = linksViewReducer(state, { type: 'NAVIGATE_DOWN', visibleRows: 2 });
    expect(state1.selectedIndex).toBe(1);
    expect(state1.scrollOffset).toBe(0); // Still visible

    const state2 = linksViewReducer(state1, { type: 'NAVIGATE_DOWN', visibleRows: 2 });
    expect(state2.selectedIndex).toBe(2);
    expect(state2.scrollOffset).toBe(1); // Scroll down to keep selected visible
  });

  it('scrolls up when navigating above visible window', () => {
    const links = createMockLinks();
    const state = createLinksViewState(links);
    state.selectedIndex = 2;
    state.scrollOffset = 2;

    // Navigate up
    const state1 = linksViewReducer(state, { type: 'NAVIGATE_UP', visibleRows: 2 });
    expect(state1.selectedIndex).toBe(1);
    expect(state1.scrollOffset).toBe(1); // Scroll up to show selected

    const state2 = linksViewReducer(state1, { type: 'NAVIGATE_UP', visibleRows: 2 });
    expect(state2.selectedIndex).toBe(0);
    expect(state2.scrollOffset).toBe(0); // Scroll to top
  });

  it('scrolls to end when wrapping to bottom', () => {
    const links = createMockLinks();
    const state = createLinksViewState(links);
    state.selectedIndex = 0;
    state.scrollOffset = 0;

    // Navigate up - should wrap to bottom and scroll to show it
    const newState = linksViewReducer(state, { type: 'NAVIGATE_UP', visibleRows: 2 });
    expect(newState.selectedIndex).toBe(3);
    expect(newState.scrollOffset).toBe(2); // Show last 2 items
  });

  it('scrolls to top when wrapping to top', () => {
    const links = createMockLinks();
    const state = createLinksViewState(links);
    state.selectedIndex = 3;
    state.scrollOffset = 2;

    // Navigate down - should wrap to top and scroll to beginning
    const newState = linksViewReducer(state, { type: 'NAVIGATE_DOWN', visibleRows: 2 });
    expect(newState.selectedIndex).toBe(0);
    expect(newState.scrollOffset).toBe(0);
  });

  it('handles PAGE_UP navigation', () => {
    const links = createMockLinks();
    const state = createLinksViewState(links);
    state.selectedIndex = 3;
    state.scrollOffset = 2;

    const newState = linksViewReducer(state, { type: 'PAGE_UP', visibleRows: 2 });
    expect(newState.selectedIndex).toBe(1);
    expect(newState.scrollOffset).toBe(0);
  });

  it('handles PAGE_DOWN navigation', () => {
    const links = createMockLinks();
    const state = createLinksViewState(links);
    state.selectedIndex = 0;
    state.scrollOffset = 0;

    const newState = linksViewReducer(state, { type: 'PAGE_DOWN', visibleRows: 2 });
    expect(newState.selectedIndex).toBe(2);
    expect(newState.scrollOffset).toBe(2);
  });

  it('sets both selected index and scroll offset for END', () => {
    const links = createMockLinks();
    const state = createLinksViewState(links);

    const endState = linksViewReducer(state, { type: 'END', visibleRows: 2 });
    expect(endState.selectedIndex).toBe(3);
    expect(endState.scrollOffset).toBe(2);
  });

  it('keeps navigation state stable when list is empty', () => {
    const state = createLinksViewState([]);
    state.selectedIndex = 0;
    state.scrollOffset = 0;

    const upState = linksViewReducer(state, { type: 'NAVIGATE_UP', visibleRows: 10 });
    expect(upState.selectedIndex).toBe(0);
    expect(upState.scrollOffset).toBe(0);

    const downState = linksViewReducer(state, { type: 'NAVIGATE_DOWN', visibleRows: 10 });
    expect(downState.selectedIndex).toBe(0);
    expect(downState.scrollOffset).toBe(0);
  });

  it('confirms suggested link', () => {
    const links = createMockLinks();
    const state = createLinksViewState(links);
    state.selectedIndex = 2; // suggested link

    const newState = linksViewReducer(state, { type: 'CONFIRM_SELECTED' });
    expect(newState.mode).toBe('links');
    if (newState.mode === 'links') {
      expect(newState.pendingAction).toEqual({
        linkId: 'link-003-suggested',
        action: 'confirm',
      });
      expect(newState.error).toBeUndefined();
    }
  });

  it('rejects suggested link', () => {
    const links = createMockLinks();
    const state = createLinksViewState(links);
    state.selectedIndex = 2; // suggested link

    const newState = linksViewReducer(state, { type: 'REJECT_SELECTED' });
    expect(newState.mode).toBe('links');
    if (newState.mode === 'links') {
      expect(newState.pendingAction).toEqual({
        linkId: 'link-003-suggested',
        action: 'reject',
      });
      expect(newState.error).toBeUndefined();
    }
  });

  it('prevents confirming non-suggested link', () => {
    const links = createMockLinks();
    const state = createLinksViewState(links);
    state.selectedIndex = 0; // confirmed link

    const newState = linksViewReducer(state, { type: 'CONFIRM_SELECTED' });
    expect(newState.mode).toBe('links');
    if (newState.mode === 'links') {
      expect(newState.pendingAction).toBeUndefined();
      expect(newState.error).toBe('Can only confirm suggested links');
    }
  });

  it('prevents rejecting non-suggested link', () => {
    const links = createMockLinks();
    const state = createLinksViewState(links);
    state.selectedIndex = 0; // confirmed link

    const newState = linksViewReducer(state, { type: 'REJECT_SELECTED' });
    expect(newState.mode).toBe('links');
    if (newState.mode === 'links') {
      expect(newState.pendingAction).toBeUndefined();
      expect(newState.error).toBe('Can only reject suggested links');
    }
  });

  it('sets error message', () => {
    const links = createMockLinks();
    const state = createLinksViewState(links);
    state.pendingAction = { linkId: 'link-003-suggested', action: 'confirm' };

    const newState = linksViewReducer(state, { type: 'SET_ERROR', error: 'Network error' });
    expect(newState.mode).toBe('links');
    if (newState.mode === 'links') {
      expect(newState.error).toBe('Network error');
      expect(newState.pendingAction).toBeUndefined();
    }
  });

  it('clears error message', () => {
    const links = createMockLinks();
    const state = createLinksViewState(links);
    state.error = 'Something went wrong';

    const newState = linksViewReducer(state, { type: 'CLEAR_ERROR' });
    expect(newState.mode).toBe('links');
    if (newState.mode === 'links') {
      expect(newState.error).toBeUndefined();
    }
  });
});

describe('linksViewReducer - gaps mode', () => {
  it('navigates up and down using issues array', () => {
    const state = createGapsViewState(createMockGapAnalysis());
    expect(state.selectedIndex).toBe(0);

    const state1 = linksViewReducer(state, { type: 'NAVIGATE_DOWN', visibleRows: 10 });
    expect(state1.selectedIndex).toBe(1);

    const state2 = linksViewReducer(state1, { type: 'NAVIGATE_DOWN', visibleRows: 10 });
    expect(state2.selectedIndex).toBe(2);

    // Wrap to top
    const state3 = linksViewReducer(state2, { type: 'NAVIGATE_DOWN', visibleRows: 10 });
    expect(state3.selectedIndex).toBe(0);

    // Navigate up from top wraps to bottom
    const state4 = linksViewReducer(state3, { type: 'NAVIGATE_UP', visibleRows: 10 });
    expect(state4.selectedIndex).toBe(2);
  });

  it('handles HOME and END navigation', () => {
    const state = createGapsViewState(createMockGapAnalysis());
    state.selectedIndex = 1;

    const homeState = linksViewReducer(state, { type: 'HOME' });
    expect(homeState.selectedIndex).toBe(0);
    expect(homeState.scrollOffset).toBe(0);

    const endState = linksViewReducer(state, { type: 'END', visibleRows: 2 });
    expect(endState.selectedIndex).toBe(2);
  });

  it('CONFIRM_SELECTED is a no-op in gaps mode', () => {
    const state = createGapsViewState(createMockGapAnalysis());

    const newState = linksViewReducer(state, { type: 'CONFIRM_SELECTED' });
    expect(newState).toBe(state); // Exact same reference
  });

  it('REJECT_SELECTED is a no-op in gaps mode', () => {
    const state = createGapsViewState(createMockGapAnalysis());

    const newState = linksViewReducer(state, { type: 'REJECT_SELECTED' });
    expect(newState).toBe(state);
  });

  it('SET_ERROR is a no-op in gaps mode', () => {
    const state = createGapsViewState(createMockGapAnalysis());

    const newState = linksViewReducer(state, { type: 'SET_ERROR', error: 'test' });
    expect(newState).toBe(state);
  });

  it('CLEAR_ERROR is a no-op in gaps mode', () => {
    const state = createGapsViewState(createMockGapAnalysis());

    const newState = linksViewReducer(state, { type: 'CLEAR_ERROR' });
    expect(newState).toBe(state);
  });
});

describe('handleKeyboardInput', () => {
  it('handles arrow up key', () => {
    let actionReceived = false;
    const dispatch = (action: unknown) => {
      expect(action).toEqual({ type: 'NAVIGATE_UP', visibleRows: 10 });
      actionReceived = true;
    };
    const onQuit = () => {
      /* empty */
    };

    handleKeyboardInput(
      '',
      {
        upArrow: true,
        downArrow: false,
        ctrl: false,
        end: false,
        escape: false,
        home: false,
        pageDown: false,
        pageUp: false,
      },
      dispatch,
      onQuit,
      24
    );
    expect(actionReceived).toBe(true);
  });

  it('handles arrow down key', () => {
    let actionReceived = false;
    const dispatch = (action: unknown) => {
      expect(action).toEqual({ type: 'NAVIGATE_DOWN', visibleRows: 10 });
      actionReceived = true;
    };
    const onQuit = () => {
      /* empty */
    };

    handleKeyboardInput(
      '',
      {
        upArrow: false,
        downArrow: true,
        ctrl: false,
        end: false,
        escape: false,
        home: false,
        pageDown: false,
        pageUp: false,
      },
      dispatch,
      onQuit,
      24
    );
    expect(actionReceived).toBe(true);
  });

  it('handles vim k key', () => {
    let actionReceived = false;
    const dispatch = (action: unknown) => {
      expect(action).toEqual({ type: 'NAVIGATE_UP', visibleRows: 10 });
      actionReceived = true;
    };
    const onQuit = () => {
      /* empty */
    };

    handleKeyboardInput(
      'k',
      {
        upArrow: false,
        downArrow: false,
        ctrl: false,
        end: false,
        escape: false,
        home: false,
        pageDown: false,
        pageUp: false,
      },
      dispatch,
      onQuit,
      24
    );
    expect(actionReceived).toBe(true);
  });

  it('handles vim j key', () => {
    let actionReceived = false;
    const dispatch = (action: unknown) => {
      expect(action).toEqual({ type: 'NAVIGATE_DOWN', visibleRows: 10 });
      actionReceived = true;
    };
    const onQuit = () => {
      /* empty */
    };

    handleKeyboardInput(
      'j',
      {
        upArrow: false,
        downArrow: false,
        ctrl: false,
        end: false,
        escape: false,
        home: false,
        pageDown: false,
        pageUp: false,
      },
      dispatch,
      onQuit,
      24
    );
    expect(actionReceived).toBe(true);
  });

  it('handles confirm key', () => {
    let actionReceived = false;
    const dispatch = (action: unknown) => {
      expect(action).toEqual({ type: 'CONFIRM_SELECTED' });
      actionReceived = true;
    };
    const onQuit = () => {
      /* empty */
    };

    handleKeyboardInput(
      'c',
      {
        upArrow: false,
        downArrow: false,
        ctrl: false,
        end: false,
        escape: false,
        home: false,
        pageDown: false,
        pageUp: false,
      },
      dispatch,
      onQuit,
      24
    );
    expect(actionReceived).toBe(true);
  });

  it('handles reject key', () => {
    let actionReceived = false;
    const dispatch = (action: unknown) => {
      expect(action).toEqual({ type: 'REJECT_SELECTED' });
      actionReceived = true;
    };
    const onQuit = () => {
      /* empty */
    };

    handleKeyboardInput(
      'r',
      {
        upArrow: false,
        downArrow: false,
        ctrl: false,
        end: false,
        escape: false,
        home: false,
        pageDown: false,
        pageUp: false,
      },
      dispatch,
      onQuit,
      24
    );
    expect(actionReceived).toBe(true);
  });

  it('handles quit key', () => {
    let quitCalled = false;
    const dispatch = () => {
      /* empty */
    };
    const onQuit = () => {
      quitCalled = true;
    };

    handleKeyboardInput(
      'q',
      {
        upArrow: false,
        downArrow: false,
        ctrl: false,
        end: false,
        escape: false,
        home: false,
        pageDown: false,
        pageUp: false,
      },
      dispatch,
      onQuit,
      24
    );
    expect(quitCalled).toBe(true);
  });

  it('does not dispatch c/r in gaps mode', () => {
    let dispatched = false;
    const dispatch = () => {
      dispatched = true;
    };
    const onQuit = () => {
      /* empty */
    };

    handleKeyboardInput(
      'c',
      {
        upArrow: false,
        downArrow: false,
        ctrl: false,
        end: false,
        escape: false,
        home: false,
        pageDown: false,
        pageUp: false,
      },
      dispatch,
      onQuit,
      24,
      'gaps'
    );
    expect(dispatched).toBe(false);

    handleKeyboardInput(
      'r',
      {
        upArrow: false,
        downArrow: false,
        ctrl: false,
        end: false,
        escape: false,
        home: false,
        pageDown: false,
        pageUp: false,
      },
      dispatch,
      onQuit,
      24,
      'gaps'
    );
    expect(dispatched).toBe(false);
  });

  it('uses different chrome lines for gaps mode visible rows', () => {
    let receivedVisibleRows = 0;
    const dispatch = (action: unknown) => {
      receivedVisibleRows = (action as { visibleRows: number }).visibleRows;
    };
    const onQuit = () => {
      /* empty */
    };

    // Links mode: terminalHeight(24) - 14 = 10
    handleKeyboardInput(
      'j',
      {
        upArrow: false,
        downArrow: false,
        ctrl: false,
        end: false,
        escape: false,
        home: false,
        pageDown: false,
        pageUp: false,
      },
      dispatch,
      onQuit,
      24,
      'links'
    );
    expect(receivedVisibleRows).toBe(10);

    // Gaps mode: terminalHeight(24) - 18 = 6
    handleKeyboardInput(
      'j',
      {
        upArrow: false,
        downArrow: false,
        ctrl: false,
        end: false,
        escape: false,
        home: false,
        pageDown: false,
        pageUp: false,
      },
      dispatch,
      onQuit,
      24,
      'gaps'
    );
    expect(receivedVisibleRows).toBe(6);
  });
});

/**
 * Create mock links for testing
 */
function createMockLinks(): LinkWithTransactions[] {
  return [
    {
      link: {
        id: 'link-001-confirmed',
        sourceTransactionId: 1,
        targetTransactionId: 2,
        linkType: 'exchange_to_blockchain',
        assetSymbol: 'ETH',
        sourceAmount: new Decimal('1.5'),
        targetAmount: new Decimal('1.498'),
        confidenceScore: new Decimal('0.98'),
        matchCriteria: {
          assetMatch: true,
          amountSimilarity: new Decimal('0.998'),
          timingValid: true,
          timingHours: 0.03,
          addressMatch: false,
        },
        status: 'confirmed',
        reviewedBy: 'user@example.com',
        reviewedAt: new Date('2024-03-20T12:00:00Z'),
        createdAt: new Date('2024-03-15T10:00:00Z'),
        updatedAt: new Date('2024-03-20T12:00:00Z'),
      },
      sourceTransaction: undefined,
      targetTransaction: undefined,
    },
    {
      link: {
        id: 'link-002-confirmed',
        sourceTransactionId: 3,
        targetTransactionId: 4,
        linkType: 'exchange_to_blockchain',
        assetSymbol: 'BTC',
        sourceAmount: new Decimal('0.5'),
        targetAmount: new Decimal('0.4998'),
        confidenceScore: new Decimal('0.96'),
        matchCriteria: {
          assetMatch: true,
          amountSimilarity: new Decimal('0.998'),
          timingValid: true,
          timingHours: 0.05,
          addressMatch: false,
        },
        status: 'confirmed',
        reviewedBy: 'user@example.com',
        reviewedAt: new Date('2024-03-20T12:00:00Z'),
        createdAt: new Date('2024-03-15T10:00:00Z'),
        updatedAt: new Date('2024-03-20T12:00:00Z'),
      },
      sourceTransaction: undefined,
      targetTransaction: undefined,
    },
    {
      link: {
        id: 'link-003-suggested',
        sourceTransactionId: 5,
        targetTransactionId: 6,
        linkType: 'exchange_to_blockchain',
        assetSymbol: 'ETH',
        sourceAmount: new Decimal('2.0'),
        targetAmount: new Decimal('1.997'),
        confidenceScore: new Decimal('0.82'),
        matchCriteria: {
          assetMatch: true,
          amountSimilarity: new Decimal('0.998'),
          timingValid: true,
          timingHours: 0.02,
          addressMatch: false,
        },
        status: 'suggested',
        reviewedBy: undefined,
        reviewedAt: undefined,
        createdAt: new Date('2024-03-15T10:00:00Z'),
        updatedAt: new Date('2024-03-20T12:00:00Z'),
      },
      sourceTransaction: undefined,
      targetTransaction: undefined,
    },
    {
      link: {
        id: 'link-004-rejected',
        sourceTransactionId: 7,
        targetTransactionId: 8,
        linkType: 'exchange_to_blockchain',
        assetSymbol: 'ETH',
        sourceAmount: new Decimal('3.0'),
        targetAmount: new Decimal('2.85'),
        confidenceScore: new Decimal('0.52'),
        matchCriteria: {
          assetMatch: true,
          amountSimilarity: new Decimal('0.95'),
          timingValid: true,
          timingHours: 0.45,
          addressMatch: false,
        },
        status: 'rejected',
        reviewedBy: 'user@example.com',
        reviewedAt: new Date('2024-03-20T12:00:00Z'),
        createdAt: new Date('2024-03-15T10:00:00Z'),
        updatedAt: new Date('2024-03-20T12:00:00Z'),
      },
      sourceTransaction: undefined,
      targetTransaction: undefined,
    },
  ];
}

/**
 * Create mock gap analysis for testing
 */
function createMockGapAnalysis(): LinkGapAnalysis {
  return {
    issues: [
      {
        transactionId: 2041,
        externalId: 'eth-inflow-1',
        source: 'ethereum',
        blockchain: 'ethereum',
        timestamp: '2024-03-18T09:12:34Z',
        assetSymbol: 'ETH',
        missingAmount: '1.5',
        totalAmount: '1.5',
        confirmedCoveragePercent: '0',
        operationCategory: 'transfer',
        operationType: 'deposit',
        suggestedCount: 2,
        highestSuggestedConfidencePercent: '82.4',
        direction: 'inflow',
      },
      {
        transactionId: 2198,
        externalId: 'eth-inflow-2',
        source: 'ethereum',
        blockchain: 'ethereum',
        timestamp: '2024-04-02T14:45:00Z',
        assetSymbol: 'ETH',
        missingAmount: '2.0',
        totalAmount: '2.0',
        confirmedCoveragePercent: '0',
        operationCategory: 'transfer',
        operationType: 'deposit',
        suggestedCount: 0,
        direction: 'inflow',
      },
      {
        transactionId: 2456,
        externalId: 'kraken-outflow-1',
        source: 'kraken',
        timestamp: '2024-05-01T16:20:00Z',
        assetSymbol: 'ETH',
        missingAmount: '1.2',
        totalAmount: '1.2',
        confirmedCoveragePercent: '0',
        operationCategory: 'transfer',
        operationType: 'withdrawal',
        suggestedCount: 1,
        highestSuggestedConfidencePercent: '74.8',
        direction: 'outflow',
      },
    ],
    summary: {
      total_issues: 3,
      uncovered_inflows: 2,
      unmatched_outflows: 1,
      affected_assets: 1,
      assets: [
        {
          assetSymbol: 'ETH',
          inflowOccurrences: 2,
          inflowMissingAmount: '3.5',
          outflowOccurrences: 1,
          outflowMissingAmount: '1.2',
        },
      ],
    },
  };
}
