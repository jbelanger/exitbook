/**
 * Events emitted by ingestion operations.
 * Used for CLI progress display and UI decoupling.
 */

export type ImportEvent =
  | {
      accountId: number;
      resuming: boolean;
      sourceName: string;
      sourceType: 'blockchain' | 'exchange-api' | 'exchange-csv';
      type: 'import.started';
    }
  | {
      accountId: number;
      sessionId: number;
      sourceName: string;
      type: 'import.session.created';
    }
  | {
      accountId: number;
      fromCursor: number | string;
      sessionId: number;
      sourceName: string;
      type: 'import.session.resumed';
    }
  | {
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
      accountId: number;
      sourceName: string;
      type: 'import.warning';
      warning: string;
    }
  | {
      accountId: number;
      durationMs: number;
      sourceName: string;
      totalImported: number;
      totalSkipped: number;
      type: 'import.completed';
    }
  | {
      accountId: number;
      error: string;
      sourceName: string;
      type: 'import.failed';
    };

export type ProcessEvent =
  | {
      accountId: number;
      totalRaw: number;
      type: 'process.started';
    }
  | {
      accountId: number;
      batchProcessed: number;
      totalProcessed: number;
      type: 'process.batch';
    }
  | {
      accountId: number;
      durationMs: number;
      errors: string[];
      totalProcessed: number;
      type: 'process.completed';
    }
  | {
      accountId: number;
      error: string;
      type: 'process.failed';
    }
  | {
      accountId: number;
      reason: string;
      type: 'process.skipped';
    };

export type IngestionEvent = ImportEvent | ProcessEvent;
