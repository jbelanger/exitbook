/**
 * Links run state updater - Pure functions to update state from events
 */

import { performance } from 'node:perf_hooks';

import type { LinkingEvent } from '../../features/links/events.js';

import type { LinksRunState } from './links-run-state.js';

/**
 * Actions that drive state transitions in the links run UI.
 */
export type LinksRunAction =
  | {
      event: LinkingEvent;
      type: 'event';
    }
  | { type: 'complete' }
  | { errorMessage: string; type: 'fail' }
  | { type: 'abort' }
  | { type: 'tick' };

/**
 * Reducer wrapper for links run state.
 * Shallow-copies state before delegating to the mutable updater,
 * giving React a new top-level reference for change detection.
 */
export function linksRunReducer(state: LinksRunState, action: LinksRunAction): LinksRunState {
  if (action.type === 'event') {
    const next = { ...state };
    updateStateFromEvent(next, action.event);
    return next;
  }

  if (action.type === 'tick') {
    return { ...state };
  }

  if (state.isComplete) {
    return state;
  }

  const totalDurationMs = state.load?.startedAt ? performance.now() - state.load.startedAt : undefined;

  if (action.type === 'complete') {
    return {
      ...state,
      isComplete: true,
      totalDurationMs,
    };
  }

  if (action.type === 'abort') {
    return {
      ...state,
      aborted: true,
      isComplete: true,
      errorMessage: undefined,
      totalDurationMs,
    };
  }

  if (action.type === 'fail') {
    const now = performance.now();
    const next: LinksRunState = {
      ...state,
      errorMessage: action.errorMessage,
      aborted: false,
      isComplete: true,
      totalDurationMs,
    };

    if (state.load?.status === 'active') {
      next.load = { ...state.load, status: 'failed', completedAt: now };
    }
    if (state.match?.status === 'active') {
      next.match = { ...state.match, status: 'failed', completedAt: now };
    }
    if (state.save?.status === 'active') {
      next.save = { ...state.save, status: 'failed', completedAt: now };
    }

    return next;
  }

  return state;
}

/**
 * Update state from linking event (mutates state in place for performance).
 */
function updateStateFromEvent(state: LinksRunState, event: LinkingEvent): void {
  switch (event.type) {
    case 'load.started':
      state.load = {
        status: 'active',
        startedAt: performance.now(),
        totalTransactions: 0,
        sourceCount: 0,
        targetCount: 0,
      };
      break;

    case 'load.completed':
      if (state.load) {
        state.load.status = 'completed';
        state.load.completedAt = performance.now();
        state.load.totalTransactions = event.totalTransactions;
        state.load.sourceCount = event.sourceCount;
        state.load.targetCount = event.targetCount;
      }
      break;

    case 'existing.cleared':
      state.existingCleared = event.count;
      break;

    case 'match.started':
      state.match = {
        status: 'active',
        startedAt: performance.now(),
        internalCount: 0,
        confirmedCount: 0,
        suggestedCount: 0,
      };
      break;

    case 'match.completed':
      if (state.match) {
        state.match.status = 'completed';
        state.match.completedAt = performance.now();
        state.match.internalCount = event.internalCount;
        state.match.confirmedCount = event.confirmedCount;
        state.match.suggestedCount = event.suggestedCount;
      }
      break;

    case 'save.started':
      state.save = {
        status: 'active',
        startedAt: performance.now(),
        totalSaved: 0,
      };
      break;

    case 'save.completed':
      if (state.save) {
        state.save.status = 'completed';
        state.save.completedAt = performance.now();
        state.save.totalSaved = event.totalSaved;
      }
      break;
  }
}
