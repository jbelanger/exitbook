/**
 * Balance view controller — reducer and keyboard handler.
 */

import {
  dispatchListNavigationKeys,
  isListNavigationAction,
  type ListNavigationAction,
  type ListNavigationKey,
  reduceListNavigation,
} from '../../../ui/shared/list-navigation.js';
import { getStoredBalanceAssetsVisibleRows } from '../../shared/stored-balance-assets-view.js';

import { getBalanceAccountsVisibleRows, getBalanceAssetsVisibleRows } from './balance-view-components.jsx';
import type {
  AccountVerificationItem,
  BalanceAction,
  BalanceStoredSnapshotState,
  BalanceState,
  BalanceVerificationState,
} from './balance-view-state.js';
import { createBalanceStoredSnapshotAssetState, createBalanceVerificationAssetState } from './balance-view-state.js';
import { sortAccountsByStatus, sortAssetsByStatus } from './balance-view-utils.js';

// ─── Reducer ─────────────────────────────────────────────────────────────────

export function balanceViewReducer(state: BalanceState, action: BalanceAction): BalanceState {
  if (isListNavigationAction(action)) {
    const cleared = 'error' in state && state.error ? { ...state, error: undefined } : state;
    return handleNavigation(cleared, action);
  }

  switch (action.type) {
    case 'VERIFICATION_STARTED':
      return handleVerificationStarted(state, action.accountId);
    case 'VERIFICATION_COMPLETED':
      return handleVerificationCompleted(state, action.accountId, action.result);
    case 'VERIFICATION_SKIPPED':
      return handleVerificationSkipped(state, action.accountId, action.reason);
    case 'VERIFICATION_ERROR':
      return handleVerificationError(state, action.accountId, action.error);
    case 'ALL_VERIFICATIONS_COMPLETE':
      return handleAllComplete(state);
    case 'DRILL_DOWN':
      return handleDrillDown(state);
    case 'DRILL_UP':
      return handleDrillUp(state);
    case 'SET_ERROR':
      if ('error' in state) {
        return { ...state, error: action.error };
      }
      return state;
    case 'CLEAR_ERROR':
      if ('error' in state) {
        return { ...state, error: undefined };
      }
      return state;
    case 'ABORTING':
      if (state.view === 'accounts' && state.mode === 'verification') {
        return { ...state, aborting: true };
      }
      return state;
    default:
      return state;
  }
}

// ─── Navigation ──────────────────────────────────────────────────────────────

function handleNavigation(state: BalanceState, action: ListNavigationAction): BalanceState {
  const itemCount = state.view === 'accounts' ? state.accounts.length : state.assets.length;
  const nav = reduceListNavigation(
    { selectedIndex: state.selectedIndex, scrollOffset: state.scrollOffset },
    action,
    itemCount
  );
  return { ...state, ...nav };
}

// ─── Verification Events ─────────────────────────────────────────────────────

function isVerificationState(state: BalanceState): state is BalanceVerificationState {
  return state.view === 'accounts' && state.mode === 'verification';
}

function handleVerificationStarted(state: BalanceState, accountId: number): BalanceState {
  if (!isVerificationState(state)) return state;

  const accounts = state.accounts.map((a) => (a.accountId === accountId ? { ...a, status: 'verifying' as const } : a));

  return { ...state, accounts };
}

function handleVerificationCompleted(
  state: BalanceState,
  accountId: number,
  result: AccountVerificationItem
): BalanceState {
  if (!isVerificationState(state)) return state;

  const accounts = state.accounts.map((a) => (a.accountId === accountId ? result : a));

  // Re-sort: completed accounts bubble to their status position
  const sorted = sortAccountsByStatus(accounts);

  // Recompute summary
  const verified = sorted.filter(
    (a) => a.status === 'success' || a.status === 'warning' || a.status === 'failed'
  ).length;
  const skipped = sorted.filter((a) => a.status === 'skipped').length;
  const matches = sorted.filter((a) => a.status === 'success').length;
  const mismatches = sorted.filter((a) => a.status === 'failed' || a.status === 'warning').length;

  return {
    ...state,
    accounts: sorted,
    summary: { verified, skipped, matches, mismatches },
  };
}

function handleVerificationSkipped(state: BalanceState, accountId: number, reason: string): BalanceState {
  if (!isVerificationState(state)) return state;

  const accounts = state.accounts.map((a) =>
    a.accountId === accountId ? { ...a, skipReason: reason, status: 'skipped' as const } : a
  );

  const skipped = accounts.filter((a) => a.status === 'skipped').length;

  return { ...state, accounts, summary: { ...state.summary, skipped } };
}

function handleVerificationError(state: BalanceState, accountId: number, errorMsg: string): BalanceState {
  if (!isVerificationState(state)) return state;

  const accounts = state.accounts.map((a) =>
    a.accountId === accountId ? { ...a, errorMessage: errorMsg, status: 'error' as const } : a
  );

  const sorted = sortAccountsByStatus(accounts);

  return { ...state, accounts: sorted };
}

function handleAllComplete(state: BalanceState): BalanceState {
  if (!isVerificationState(state)) return state;

  const sorted = sortAccountsByStatus(state.accounts);

  const verified = sorted.filter(
    (a) => a.status === 'success' || a.status === 'warning' || a.status === 'failed'
  ).length;
  const skipped = sorted.filter((a) => a.status === 'skipped').length;
  const matches = sorted.filter((a) => a.status === 'success').length;
  const mismatches = sorted.filter(
    (a) => a.status === 'failed' || a.status === 'warning' || a.status === 'error'
  ).length;

  return {
    ...state,
    accounts: sorted,
    phase: 'complete',
    summary: { verified, skipped, matches, mismatches },
  };
}

// ─── Drill-Down ──────────────────────────────────────────────────────────────

function isStoredSnapshotAccountsState(state: BalanceState): state is BalanceStoredSnapshotState {
  return state.view === 'accounts' && state.mode === 'stored-snapshot';
}

function handleDrillDown(state: BalanceState): BalanceState {
  if (state.view !== 'accounts') return state;

  if (isStoredSnapshotAccountsState(state)) {
    const selected = state.accounts[state.selectedIndex];
    if (!selected || selected.assets.length === 0) return state;

    return createBalanceStoredSnapshotAssetState(
      {
        accountId: selected.accountId,
        platformKey: selected.platformKey,
        accountType: selected.accountType,
        verificationStatus: selected.verificationStatus,
        statusReason: selected.statusReason,
        suggestion: selected.suggestion,
        lastRefreshAt: selected.lastRefreshAt,
      },
      selected.assets,
      { parentState: state }
    );
  }

  if (isVerificationState(state)) {
    const selected = state.accounts[state.selectedIndex];
    if (!selected) return state;

    // Only allow drill-down on completed accounts
    if (selected.status !== 'success' && selected.status !== 'warning' && selected.status !== 'failed') {
      return state;
    }

    if (!selected.comparisons || selected.comparisons.length === 0) return state;

    const sortedAssets = sortAssetsByStatus(selected.comparisons);

    return createBalanceVerificationAssetState(
      { accountId: selected.accountId, platformKey: selected.platformKey, accountType: selected.accountType },
      sortedAssets,
      { parentState: state }
    );
  }

  return state;
}

function handleDrillUp(state: BalanceState): BalanceState {
  if (state.view !== 'assets') return state;
  if (!state.parentState) return state;

  // Restore the parent accounts state
  return state.parentState;
}

// ─── Keyboard Handler ────────────────────────────────────────────────────────

export function handleBalanceKeyboardInput(
  input: string,
  key: ListNavigationKey & { backspace: boolean; return: boolean },
  state: BalanceState,
  dispatch: (action: BalanceAction) => void,
  onQuit: () => void,
  terminalHeight: number
): void {
  const visibleRows =
    state.view === 'accounts'
      ? getBalanceAccountsVisibleRows(terminalHeight)
      : state.mode === 'stored-snapshot'
        ? getStoredBalanceAssetsVisibleRows(terminalHeight)
        : getBalanceAssetsVisibleRows(terminalHeight);

  const isDrilledDown = state.view === 'assets' && state.parentState !== undefined;

  // Quit / back
  if (key.escape) {
    if (isDrilledDown) {
      dispatch({ type: 'DRILL_UP' });
    } else {
      onQuit();
    }
    return;
  }

  if (input === 'q') {
    if (isDrilledDown) {
      dispatch({ type: 'DRILL_UP' });
    } else {
      onQuit();
    }
    return;
  }

  // Backspace: back from asset list
  if (key.backspace && isDrilledDown) {
    dispatch({ type: 'DRILL_UP' });
    return;
  }

  // Enter: drill down
  if (key.return && state.view === 'accounts') {
    dispatch({ type: 'DRILL_DOWN' });
    return;
  }

  dispatchListNavigationKeys(key, input, dispatch, visibleRows);
}
