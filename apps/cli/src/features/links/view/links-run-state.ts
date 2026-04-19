/**
 * Links run operation tree state
 */

import type { OperationStatus } from '../../../ui/shared/monitoring.js';

/**
 * Phase 1: Load transactions
 */
export interface LoadPhase {
  status: OperationStatus;
  startedAt: number;
  completedAt?: number | undefined;
  totalTransactions: number;
}

/**
 * Phase 3: Matching
 */
export interface MatchPhase {
  status: OperationStatus;
  startedAt: number;
  completedAt?: number | undefined;
  sourceCandidateCount: number; // outflows (sources)
  targetCandidateCount: number; // inflows (targets)
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
}

/**
 * Create initial links run state
 */
export function createLinksRunState(): LinksRunState {
  return {
    load: undefined,
    existingCleared: undefined,
    match: undefined,
    save: undefined,
    isComplete: false,
    aborted: undefined,
    errorMessage: undefined,
    totalDurationMs: undefined,
  };
}
