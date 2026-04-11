/**
 * Tests for links view controller
 */

import { describe, expect, it } from 'vitest';

import { createMockGapAnalysis, createMockLink, createMockLinksBatch } from '../../__tests__/test-utils.js';
import { handleLinksKeyboardInput, linksViewReducer } from '../links-view-controller.js';
import { createGapsViewState, createLinksViewState } from '../links-view-state.js';

describe('linksViewReducer', () => {
  it('navigates up and wraps to bottom', () => {
    const links = createMockLinksBatch();
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
    const links = createMockLinksBatch();
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
    const links = createMockLinksBatch();
    const state = createLinksViewState(links);
    state.error = 'Something went wrong';

    const newState = linksViewReducer(state, { type: 'NAVIGATE_DOWN', visibleRows: 10 });
    expect(newState.mode).toBe('links');
    if (newState.mode === 'links') {
      expect(newState.error).toBeUndefined();
    }
  });

  it('scrolls down when navigating below visible window', () => {
    const links = createMockLinksBatch();
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
    const links = createMockLinksBatch();
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
    const links = createMockLinksBatch();
    const state = createLinksViewState(links);
    state.selectedIndex = 0;
    state.scrollOffset = 0;

    // Navigate up - should wrap to bottom and scroll to show it
    const newState = linksViewReducer(state, { type: 'NAVIGATE_UP', visibleRows: 2 });
    expect(newState.selectedIndex).toBe(3);
    expect(newState.scrollOffset).toBe(2); // Show last 2 items
  });

  it('scrolls to top when wrapping to top', () => {
    const links = createMockLinksBatch();
    const state = createLinksViewState(links);
    state.selectedIndex = 3;
    state.scrollOffset = 2;

    // Navigate down - should wrap to top and scroll to beginning
    const newState = linksViewReducer(state, { type: 'NAVIGATE_DOWN', visibleRows: 2 });
    expect(newState.selectedIndex).toBe(0);
    expect(newState.scrollOffset).toBe(0);
  });

  it('handles PAGE_UP navigation', () => {
    const links = createMockLinksBatch();
    const state = createLinksViewState(links);
    state.selectedIndex = 3;
    state.scrollOffset = 2;

    const newState = linksViewReducer(state, { type: 'PAGE_UP', visibleRows: 2 });
    expect(newState.selectedIndex).toBe(1);
    expect(newState.scrollOffset).toBe(0);
  });

  it('handles PAGE_DOWN navigation', () => {
    const links = createMockLinksBatch();
    const state = createLinksViewState(links);
    state.selectedIndex = 0;
    state.scrollOffset = 0;

    const newState = linksViewReducer(state, { type: 'PAGE_DOWN', visibleRows: 2 });
    expect(newState.selectedIndex).toBe(2);
    expect(newState.scrollOffset).toBe(2);
  });

  it('sets both selected index and scroll offset for END', () => {
    const links = createMockLinksBatch();
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
    const links = createMockLinksBatch();
    const state = createLinksViewState(links);
    state.selectedIndex = 2; // suggested link

    const newState = linksViewReducer(state, { type: 'CONFIRM_SELECTED' });
    expect(newState.mode).toBe('links');
    if (newState.mode === 'links') {
      expect(newState.pendingAction).toEqual({
        affectedLinkIds: [3],
        linkId: 3,
        action: 'confirm',
        proposalKey:
          'single:v1:movement:exchange:source:3:btc:outflow:0:movement:blockchain:target:3:btc:inflow:0:exchange:source:btc:blockchain:target:btc',
        transferProposalKey: undefined,
      });
      expect(newState.error).toBeUndefined();
    }
  });

  it('confirms the remaining suggested legs in a mixed proposal', () => {
    const links = [
      {
        link: createMockLink(1, {
          status: 'confirmed',
          metadata: {
            transferProposalKey: 'partial-target:v1:target',
          },
        }),
        sourceTransaction: undefined,
        targetTransaction: undefined,
      },
      {
        link: createMockLink(2, {
          sourceTransactionId: 3,
          status: 'suggested',
          sourceMovementFingerprint: 'movement:exchange:source:3:btc:outflow:0',
          metadata: {
            transferProposalKey: 'partial-target:v1:target',
          },
        }),
        sourceTransaction: undefined,
        targetTransaction: undefined,
      },
    ];
    const state = createLinksViewState(links, 'suggested');

    expect(state.proposals).toHaveLength(1);
    expect(state.proposals[0]?.legs.map((leg) => leg.link.id)).toEqual([1, 2]);

    const newState = linksViewReducer(state, { type: 'CONFIRM_SELECTED' });
    expect(newState.mode).toBe('links');
    if (newState.mode === 'links') {
      expect(newState.pendingAction).toEqual({
        affectedLinkIds: [2],
        linkId: 2,
        action: 'confirm',
        proposalKey: 'partial-target:v1:target',
        transferProposalKey: 'partial-target:v1:target',
      });
      expect(newState.error).toBeUndefined();
    }
  });

  it('rejects suggested link', () => {
    const links = createMockLinksBatch();
    const state = createLinksViewState(links);
    state.selectedIndex = 2; // suggested link

    const newState = linksViewReducer(state, { type: 'REJECT_SELECTED' });
    expect(newState.mode).toBe('links');
    if (newState.mode === 'links') {
      expect(newState.pendingAction).toEqual({
        affectedLinkIds: [3],
        linkId: 3,
        action: 'reject',
        proposalKey:
          'single:v1:movement:exchange:source:3:btc:outflow:0:movement:blockchain:target:3:btc:inflow:0:exchange:source:btc:blockchain:target:btc',
        transferProposalKey: undefined,
      });
      expect(newState.error).toBeUndefined();
    }
  });

  it('allows rejecting confirmed proposals', () => {
    const links = createMockLinksBatch();
    const state = createLinksViewState(links);
    state.selectedIndex = 0; // confirmed link

    const newState = linksViewReducer(state, { type: 'REJECT_SELECTED' });
    expect(newState.mode).toBe('links');
    if (newState.mode === 'links') {
      expect(newState.pendingAction).toEqual({
        affectedLinkIds: [1],
        linkId: 1,
        action: 'reject',
        proposalKey:
          'single:v1:movement:exchange:source:1:btc:outflow:0:movement:blockchain:target:1:btc:inflow:0:exchange:source:btc:blockchain:target:btc',
        transferProposalKey: undefined,
      });
      expect(newState.error).toBeUndefined();
    }
  });

  it('prevents confirming non-suggested link', () => {
    const links = createMockLinksBatch();
    const state = createLinksViewState(links);
    state.selectedIndex = 0; // confirmed link

    const newState = linksViewReducer(state, { type: 'CONFIRM_SELECTED' });
    expect(newState.mode).toBe('links');
    if (newState.mode === 'links') {
      expect(newState.pendingAction).toBeUndefined();
      expect(newState.error).toBe('Can only confirm proposals with suggested links and no rejected legs');
    }
  });

  it('prevents rejecting fully rejected proposals', () => {
    const links = createMockLinksBatch();
    const state = createLinksViewState(links);
    state.selectedIndex = 3; // rejected link

    const newState = linksViewReducer(state, { type: 'REJECT_SELECTED' });
    expect(newState.mode).toBe('links');
    if (newState.mode === 'links') {
      expect(newState.pendingAction).toBeUndefined();
      expect(newState.error).toBe('Can only reject suggested or confirmed proposals');
    }
  });

  it('sets error message', () => {
    const links = createMockLinksBatch();
    const state = createLinksViewState(links);
    state.pendingAction = {
      affectedLinkIds: [3],
      linkId: 3,
      action: 'confirm',
      proposalKey:
        'single:v1:movement:exchange:source:3:btc:outflow:0:movement:blockchain:target:3:btc:inflow:0:exchange:source:btc:blockchain:target:btc',
    };

    const newState = linksViewReducer(state, { type: 'SET_ERROR', error: 'Network error' });
    expect(newState.mode).toBe('links');
    if (newState.mode === 'links') {
      expect(newState.error).toBe('Network error');
      expect(newState.pendingAction).toBeUndefined();
    }
  });

  it('clears error message and pending action', () => {
    const links = createMockLinksBatch();
    const state = createLinksViewState(links);
    state.error = 'Something went wrong';
    state.pendingAction = {
      affectedLinkIds: [3],
      linkId: 3,
      action: 'confirm',
      proposalKey:
        'single:v1:movement:exchange:source:3:btc:outflow:0:movement:blockchain:target:3:btc:inflow:0:exchange:source:btc:blockchain:target:btc',
    };

    const newState = linksViewReducer(state, { type: 'CLEAR_ERROR' });
    expect(newState.mode).toBe('links');
    if (newState.mode === 'links') {
      expect(newState.error).toBeUndefined();
      expect(newState.pendingAction).toBeUndefined();
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

  it('removes confirmed rows when filtered to suggested', () => {
    const links = createMockLinksBatch().filter((link) => link.link.status === 'suggested');
    const state = createLinksViewState(links, 'suggested');

    const newState = linksViewReducer(state, {
      type: 'ACTION_SUCCESS',
      affectedLinkIds: [3],
      newStatus: 'confirmed',
    });

    expect(newState.mode).toBe('links');
    if (newState.mode === 'links') {
      expect(newState.proposals).toHaveLength(0);
      expect(newState.selectedIndex).toBe(0);
      expect(newState.scrollOffset).toBe(0);
    }
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

describe('handleLinksKeyboardInput', () => {
  it('handles arrow up key', () => {
    let actionReceived = false;
    const dispatch = (action: unknown) => {
      expect(action).toEqual({ type: 'NAVIGATE_UP', visibleRows: 7 });
      actionReceived = true;
    };
    const onQuit = () => {
      /* empty */
    };

    handleLinksKeyboardInput(
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
      expect(action).toEqual({ type: 'NAVIGATE_DOWN', visibleRows: 7 });
      actionReceived = true;
    };
    const onQuit = () => {
      /* empty */
    };

    handleLinksKeyboardInput(
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
      expect(action).toEqual({ type: 'NAVIGATE_UP', visibleRows: 7 });
      actionReceived = true;
    };
    const onQuit = () => {
      /* empty */
    };

    handleLinksKeyboardInput(
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
      expect(action).toEqual({ type: 'NAVIGATE_DOWN', visibleRows: 7 });
      actionReceived = true;
    };
    const onQuit = () => {
      /* empty */
    };

    handleLinksKeyboardInput(
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

    handleLinksKeyboardInput(
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

    handleLinksKeyboardInput(
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

    handleLinksKeyboardInput(
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

    handleLinksKeyboardInput(
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

    handleLinksKeyboardInput(
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

    // Links mode: terminalHeight(24) - 17 = 7
    handleLinksKeyboardInput(
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
    expect(receivedVisibleRows).toBe(7);

    // Gaps mode with one summary asset: terminalHeight(24) - 20 = 4
    handleLinksKeyboardInput(
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
      'gaps',
      1
    );
    expect(receivedVisibleRows).toBe(4);
  });
});
