/**
 * Events emitted by ingestion operations.
 * Used for CLI progress display and UI decoupling.
 */

import type { ImportSession } from '@exitbook/core';

export type ImportEvent =
  | {
      /**
       * Emitted when an import begins for an account.
       * Used by CLI dashboard to set header/timer state.
       */
      accountId: number;
      address?: string | undefined;
      /**
       * True if this is the first import for this account (no prior cursor data).
       * False means the account has prior data and is using a cursor (incremental import).
       */
      isNewAccount: boolean;
      /**
       * Parent account ID if this is a child account of an xpub import.
       * Present when importing derived addresses from an extended public key.
       */
      parentAccountId?: number | undefined;
      sourceName: string;
      sourceType: 'blockchain' | 'exchange-api' | 'exchange-csv';
      /**
       * Transaction counts by stream type (only present for existing accounts)
       */
      transactionCounts?: Map<string, number> | undefined;
      type: 'import.started';
    }
  | {
      /**
       * Emitted for each saved batch (after dedup + cursor update).
       * Used by CLI dashboard counters and "no new records" messages.
       */
      accountId: number;
      batchInserted: number; // Successfully inserted
      batchSkipped: number; // Skipped (duplicates)
      cursorProgress?: number | undefined; // cursor.totalFetched if available (lifetime, internal)
      deduplicated: number; // Count filtered by importer/provider-level dedup (0 when unavailable)
      fetched: number; // Raw count fetched before importer/provider-level dedup
      isComplete: boolean;
      sourceName: string;
      streamType: string;
      totalFetchedRun: number; // Total fetched this run (per-process)
      totalImported: number;
      totalSkipped: number;
      type: 'import.batch';
    }
  | {
      /**
       * Emitted when importer reports a warning (partial data, skipped ops).
       * Warnings currently force import to fail to prevent partial processing.
       * Used by CLI dashboard activity log.
       */
      accountId: number;
      sourceName: string;
      streamType?: string | undefined;
      type: 'import.warning';
      warning: string;
    }
  | {
      /**
       * Emitted when import completes successfully (session finalized).
       */
      accountId: number;
      durationMs: number;
      sourceName: string;
      totalImported: number;
      totalSkipped: number;
      type: 'import.completed';
    }
  | {
      /**
       * Emitted when import fails (error or warnings promoted to failure).
       * Used by CLI dashboard activity log.
       */
      accountId: number;
      error: string;
      sourceName: string;
      type: 'import.failed';
    }
  | {
      /**
       * Emitted when xpub address derivation begins.
       * Location: ImportCoordinator.importFromXpub() - before calling deriveAddressesFromXpub()
       */
      blockchain: string;
      gapLimit: number;
      isRederivation: boolean;
      parentAccountId: number;
      parentIsNew: boolean;
      previousGap?: number | undefined;
      type: 'xpub.derivation.started';
    }
  | {
      /**
       * Emitted when xpub address derivation completes successfully.
       * Location: ImportCoordinator.importFromXpub() - after deriveAddressesFromXpub() returns
       */
      derivedCount: number;
      durationMs: number;
      newCount?: number | undefined;
      parentAccountId: number;
      type: 'xpub.derivation.completed';
    }
  | {
      /**
       * Emitted when xpub derivation fails.
       * Location: ImportCoordinator.importFromXpub() - if deriveAddressesFromXpub() returns error
       */
      durationMs: number;
      error: string;
      parentAccountId: number;
      type: 'xpub.derivation.failed';
    }
  | {
      /**
       * Emitted when xpub import begins (wrapper for all child imports).
       * Location: ImportCoordinator.importFromXpub() - after creating child accounts, before importing them
       */
      blockchain: string;
      childAccountCount: number;
      parentAccountId: number;
      parentIsNew: boolean;
      type: 'xpub.import.started';
    }
  | {
      /**
       * Emitted when xpub import completes (all children imported).
       * Location: ImportCoordinator.importFromXpub() - after all child imports succeed
       */
      parentAccountId: number;
      sessions: ImportSession[];
      totalImported: number;
      totalSkipped: number;
      type: 'xpub.import.completed';
    }
  | {
      /**
       * Emitted when any child import fails (entire xpub import fails).
       * Location: ImportCoordinator.importFromXpub() - when a child import returns error
       */
      error: string;
      failedChildAccountId: number;
      parentAccountId: number;
      type: 'xpub.import.failed';
    }
  | {
      /**
       * Emitted when xpub has no active addresses found.
       * Location: ImportCoordinator.importFromXpub() - when derivedAddresses.length === 0
       */
      blockchain: string;
      parentAccountId: number;
      type: 'xpub.empty';
    };

export type ProcessEvent =
  | {
      /**
       * Emitted when clearing derived data begins during reprocessing.
       * Used by CLI dashboard to show clearing progress.
       */
      accountId?: number | undefined;
      includeRaw: boolean;
      preview: {
        accounts: number;
        links: number;
        rawData: number;
        sessions: number;
        transactions: number;
      };
      type: 'clear.started';
    }
  | {
      /**
       * Emitted when clearing derived data completes during reprocessing.
       * Used by CLI dashboard to show clearing completion.
       */
      deleted: {
        accounts: number;
        links: number;
        rawData: number;
        sessions: number;
        transactions: number;
      };
      durationMs: number;
      type: 'clear.completed';
    }
  | {
      /**
       * Emitted when processing begins for one or more accounts.
       * Used by CLI dashboard to set timing state.
       */
      accountIds: number[];
      /**
       * Transaction counts by stream type per account (for reprocessing display)
       */
      accountTransactionCounts?: Map<number, Map<string, number>> | undefined;
      totalRaw: number;
      type: 'process.started';
    }
  | {
      /**
       * RESERVED: defined but not currently emitted.
       * Intended for aggregate processed-count progress updates.
       */
      accountId: number;
      batchProcessed: number;
      totalProcessed: number;
      type: 'process.batch';
    }
  | {
      /**
       * Emitted when a raw-data batch starts processing.
       * Currently not surfaced in UI (reserved for observability).
       */
      accountId: number;
      batchNumber: number;
      batchSize: number;
      pendingCount: number;
      type: 'process.batch.started';
    }
  | {
      /**
       * Emitted when a raw-data batch finishes processing.
       * Used by CLI dashboard activity log.
       */
      accountId: number;
      batchNumber: number;
      batchSize: number;
      durationMs: number;
      pendingCount: number;
      type: 'process.batch.completed';
    }
  | {
      /**
       * RESERVED: defined but not currently emitted.
       * Intended for per-group correlation progress (tx hash / trade ID).
       */
      accountId: number;
      groupId: string; // Transaction hash OR exchange trade ID
      groupType: 'transaction' | 'trade'; // Source type
      itemCount: number;
      type: 'process.group.processing';
    }
  | {
      /**
       * Emitted when processing completes for all requested accounts.
       */
      accountIds: number[];
      durationMs: number;
      errors: string[];
      totalProcessed: number;
      type: 'process.completed';
    }
  | {
      /**
       * Emitted when processing fails for an account or on unexpected error.
       * Used by CLI dashboard activity log and stop state.
       */
      accountIds: number[];
      error: string;
      type: 'process.failed';
    }
  | {
      /**
       * RESERVED: defined but not currently emitted.
       * Intended to signal intentional skip (no pending data, guard condition).
       */
      accountId?: number | undefined;
      reason: string;
      type: 'process.skipped';
    };

export interface ScamDetectionEvent {
  /**
   * Emitted when scam detection completes for a batch.
   * Used by CLI dashboard scam summary stats.
   */
  blockchain: string;
  batchNumber: number;
  exampleSymbols: string[]; // First 3
  scamsFound: number; // Per-batch count
  totalScanned: number;
  type: 'scam.batch.summary';
}

export type IngestionEvent = ImportEvent | ProcessEvent | ScamDetectionEvent;
