import type { NewLinkableMovement } from '@exitbook/accounting';

/** Assign sequential IDs to NewLinkableMovements for dry-run mode (no DB). */
export function assignInMemoryIds<T extends NewLinkableMovement>(movements: T[]): (T & { id: number })[] {
  return movements.map((m, i) => ({ ...m, id: i + 1 }));
}

/** Build an empty result when no transactions exist. */
export function emptyLinkingResult(dryRun: boolean) {
  return {
    internalLinksCount: 0,
    confirmedLinksCount: 0,
    suggestedLinksCount: 0,
    totalSourceTransactions: 0,
    totalTargetTransactions: 0,
    unmatchedSourceCount: 0,
    unmatchedTargetCount: 0,
    dryRun,
  };
}
