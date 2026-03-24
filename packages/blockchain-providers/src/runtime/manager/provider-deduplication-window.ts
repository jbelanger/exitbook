import type { NormalizedTransactionBase } from '../../contracts/normalized-transaction.js';

// Sized to cover typical replay overlap (5 blocks × ~200 txs/block = ~1000 items max)
export const DEFAULT_DEDUP_WINDOW_SIZE = 1000;

export interface DeduplicationWindow {
  queue: string[];
  set: Set<string>;
  head: number;
}

const DEDUP_WINDOW_COMPACTION_THRESHOLD = 1024;

function getActiveDeduplicationWindowSize(dedupWindow: DeduplicationWindow): number {
  return dedupWindow.queue.length - dedupWindow.head;
}

function compactDeduplicationWindowIfNeeded(dedupWindow: DeduplicationWindow): void {
  if (dedupWindow.head === 0) {
    return;
  }

  if (dedupWindow.head < DEDUP_WINDOW_COMPACTION_THRESHOLD && dedupWindow.head * 2 < dedupWindow.queue.length) {
    return;
  }

  dedupWindow.queue = dedupWindow.queue.slice(dedupWindow.head);
  dedupWindow.head = 0;
}

export function createDeduplicationWindow(initialIds: string[] = []): DeduplicationWindow {
  return {
    queue: [...initialIds],
    set: new Set(initialIds),
    head: 0,
  };
}

export function addToDeduplicationWindow(dedupWindow: DeduplicationWindow, id: string, maxSize: number): void {
  dedupWindow.queue.push(id);
  dedupWindow.set.add(id);

  if (getActiveDeduplicationWindowSize(dedupWindow) > maxSize) {
    const oldest = dedupWindow.queue[dedupWindow.head];
    dedupWindow.head += 1;

    if (oldest !== undefined) {
      dedupWindow.set.delete(oldest);
    }

    compactDeduplicationWindowIfNeeded(dedupWindow);
  }
}

export function isInDeduplicationWindow(dedupWindow: DeduplicationWindow, id: string): boolean {
  return dedupWindow.set.has(id);
}

export function deduplicateTransactions<T extends { normalized: NormalizedTransactionBase }>(
  transactions: T[],
  dedupWindow: DeduplicationWindow,
  maxWindowSize: number
): T[] {
  const deduplicated: T[] = [];

  for (const transaction of transactions) {
    const key = transaction.normalized.eventId;

    if (isInDeduplicationWindow(dedupWindow, key)) {
      continue;
    }

    deduplicated.push(transaction);
    addToDeduplicationWindow(dedupWindow, key, maxWindowSize);
  }

  return deduplicated;
}
