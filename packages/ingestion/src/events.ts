/**
 * Events emitted by ingestion operations.
 * Used for CLI progress display and UI decoupling.
 */

export type ImportEvent =
  | {
      /**
       * Emitted when an import begins for an account (new or resumed).
       * Used by CLI dashboard to set header/timer state.
       */
      accountId: number;
      address?: string | undefined;
      resuming: boolean;
      sourceName: string;
      sourceType: 'blockchain' | 'exchange-api' | 'exchange-csv';
      type: 'import.started';
    }
  | {
      /**
       * Emitted when a new import session record is created.
       * Currently not surfaced in UI (reserved for observability).
       */
      accountId: number;
      sessionId: number;
      sourceName: string;
      type: 'import.session.created';
    }
  | {
      /**
       * Emitted when an import resumes an existing session and cursor.
       * Used by CLI dashboard activity log.
       */
      accountId: number;
      fromCursor: number | string;
      sessionId: number;
      sourceName: string;
      type: 'import.session.resumed';
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
      deduplicated: number; // Count after deduplication
      fetched: number; // Raw count fetched from provider
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
    };

export type ProcessEvent =
  | {
      /**
       * Emitted when processing begins for one or more accounts.
       * Used by CLI dashboard to set timing state.
       */
      accountIds: number[];
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

export interface TokenMetadataEvent {
  /**
   * Emitted when a metadata enrichment batch completes successfully.
   * Used by CLI dashboard cache hit-rate stats.
   */
  blockchain: string;
  batchNumber: number;
  cacheHits: number; // Per-batch delta (ProgressHandler accumulates)
  cacheMisses: number; // Per-batch delta (ProgressHandler accumulates)
  durationMs: number;
  type: 'metadata.batch.completed';
}

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

export type IngestionEvent = ImportEvent | ProcessEvent | TokenMetadataEvent | ScamDetectionEvent;
