// Pure utility functions for import command
// All functions are pure - no side effects

import type { SourceType } from '@exitbook/core';
import type { Result } from 'neverthrow';
import { ok } from 'neverthrow';
import type { z } from 'zod';

import type { ImportCommandOptionsSchema } from '../shared/schemas.js';

import type { ImportHandlerParams } from './import-handler.js';

/**
 * CLI options validated by Zod at CLI boundary
 */
export type ImportCommandOptions = z.infer<typeof ImportCommandOptionsSchema>;

/**
 * Build import parameters from validated CLI flags.
 * No validation needed - options are already validated by Zod schema.
 */
export function buildImportParamsFromFlags(options: ImportCommandOptions): Result<ImportHandlerParams, Error> {
  const sourceName = (options.exchange || options.blockchain)!;
  const sourceType: SourceType = options.exchange ? 'exchange' : 'blockchain';

  // Build credentials if API keys provided
  let credentials: { apiKey: string; apiPassphrase?: string | undefined; secret: string } | undefined;
  if (options.apiKey && options.apiSecret) {
    credentials = {
      apiKey: options.apiKey,
      secret: options.apiSecret,
      apiPassphrase: options.apiPassphrase,
    };
  }

  return ok({
    sourceName,
    sourceType,
    address: options.address,
    providerName: options.provider,
    csvDir: options.csvDir,
    credentials,
    shouldProcess: options.process,
    xpubGap: options.xpubGap,
  });
}
