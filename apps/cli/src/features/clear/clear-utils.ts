import type { Result } from 'neverthrow';
import { ok } from 'neverthrow';

/**
 * Clear command options
 */
export interface ClearCommandOptions {
  accountId?: number | undefined;
  source?: string | undefined;
  includeRaw?: boolean | undefined;
  confirm?: boolean | undefined;
  json?: boolean | undefined;
}

/**
 * Clear handler parameters
 */
export interface ClearHandlerParams {
  accountId?: number | undefined;
  source?: string | undefined;
  includeRaw: boolean;
}

/**
 * Build handler params from command flags.
 */
export function buildClearParamsFromFlags(options: ClearCommandOptions): Result<ClearHandlerParams, Error> {
  return ok({
    accountId: options.accountId,
    source: options.source,
    includeRaw: options.includeRaw ?? false,
  });
}

/**
 * Deletion preview for confirmation
 */
export interface DeletionPreview {
  sessions: number;
  rawData: number;
  transactions: number;
  links: number;
  lots: number;
  disposals: number;
  transfers: number;
  calculations: number;
}
