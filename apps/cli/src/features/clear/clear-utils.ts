import type { Result } from 'neverthrow';
import { ok } from 'neverthrow';
import type { z } from 'zod';

import type { ClearCommandOptionsSchema } from '../shared/schemas.js';

/**
 * Clear command options validated by Zod at CLI boundary
 */
export type ClearCommandOptions = z.infer<typeof ClearCommandOptionsSchema>;

/**
 * Clear handler parameters
 */
export interface ClearHandlerParams {
  accountId?: number | undefined;
  source?: string | undefined;
  includeRaw: boolean;
}

/**
 * Build handler params from validated command flags.
 * No validation needed - options are already validated by Zod schema.
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
