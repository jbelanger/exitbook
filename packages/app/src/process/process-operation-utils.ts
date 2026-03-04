export interface ProcessParams {
  /** Reprocess only a specific account ID */
  accountId?: number | undefined;
}

export interface ProcessResult {
  /** Number of transactions processed */
  processed: number;

  /** Processing errors if any */
  errors: string[];
}
