// Utilities and types for view sessions command

/**
 * Parameters for view sessions command.
 */
export interface ViewSessionsParams {
  source?: string | undefined;
  status?: 'started' | 'completed' | 'failed' | 'cancelled' | undefined;
  limit?: number | undefined;
}

/**
 * Session info for display.
 */
export interface SessionInfo {
  id: number;
  source_id: string;
  source_type: 'exchange' | 'blockchain';
  provider_id: string | null | undefined;
  status: 'started' | 'completed' | 'failed' | 'cancelled';
  transactions_imported: number;
  transactions_failed: number;
  started_at: string;
  completed_at: string | null | undefined;
  duration_ms: number | null | undefined;
  error_message: string | null | undefined;
}

/**
 * Result of view sessions command.
 */
export interface ViewSessionsResult {
  sessions: SessionInfo[];
  count: number;
}
