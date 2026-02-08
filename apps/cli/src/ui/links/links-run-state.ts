/**
 * Links run operation tree state
 */

import type { OperationStatus } from '../shared/index.js';

/**
 * Lifecycle callbacks from controller to component.
 * Allows controller to trigger synchronous state transitions before process.exit().
 */
export interface LifecycleBridge {
  onAbort?: (() => void) | undefined;
  onComplete?: (() => void) | undefined;
  onFail?: ((errorMessage: string) => void) | undefined;
}

/**
 * Phase 1: Load transactions
 */
export interface LoadPhase {
  status: OperationStatus;
  startedAt: number;
  completedAt?: number | undefined;
  totalTransactions: number;
  sourceCount: number;
  targetCount: number;
}

/**
 * Phase 3: Matching
 */
export interface MatchPhase {
  status: OperationStatus;
  startedAt: number;
  completedAt?: number | undefined;
  internalCount: number; // same tx hash links
  confirmedCount: number; // ≥95% confidence
  suggestedCount: number; // 70-95% confidence
}

/**
 * Phase 4: Save
 */
export interface SavePhase {
  status: OperationStatus;
  startedAt: number;
  completedAt?: number | undefined;
  totalSaved: number;
}

/**
 * Links run state
 */
export interface LinksRunState {
  // Phase 1: Load
  load?: LoadPhase | undefined;

  // Phase 2: Clear existing (count only, shown after load completes)
  existingCleared?: number | undefined;

  // Phase 3: Match
  match?: MatchPhase | undefined;

  // Phase 4: Save
  save?: SavePhase | undefined;

  // Completion
  isComplete: boolean;
  aborted?: boolean | undefined;
  errorMessage?: string | undefined;
  totalDurationMs?: number | undefined;
  dryRun: boolean;
}

/**
 * Create initial links run state
 */
export function createLinksRunState(dryRun: boolean): LinksRunState {
  return {
    load: undefined,
    existingCleared: undefined,
    match: undefined,
    save: undefined,
    isComplete: false,
    aborted: undefined,
    errorMessage: undefined,
    totalDurationMs: undefined,
    dryRun,
  };
}
