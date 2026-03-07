// Pure utility functions for import command
// All functions are pure - no side effects

import type { ExchangeCredentials } from '@exitbook/core';
import { err, ok, type Result } from '@exitbook/core';
import type { AdapterRegistry, ImportParams } from '@exitbook/ingestion';
import type { z } from 'zod';

import type { ImportCommandOptionsSchema } from '../shared/schemas.js';

/**
 * CLI options validated by Zod at CLI boundary
 */
export type ImportCommandOptions = z.infer<typeof ImportCommandOptionsSchema>;

/**
 * Build app-layer ImportParams from validated CLI flags.
 *
 * Address normalization and adapter validation are handled by ImportOperation —
 * this function is a pure options-to-params mapper.
 */
export function buildImportParams(
  options: ImportCommandOptions,
  registry: AdapterRegistry
): Result<ImportParams, Error> {
  const isBlockchain = !!options.blockchain;

  if (isBlockchain) {
    const sourceName = options.blockchain!;

    if (!options.address) {
      return err(new Error('Address is required for blockchain imports'));
    }

    return ok({
      blockchain: sourceName,
      address: options.address,
      providerName: options.provider,
      xpubGap: options.xpubGap,
    });
  }

  // Exchange import
  const sourceName = options.exchange!;
  const normalizedSourceName = sourceName.toLowerCase();

  const exchangeAdapterResult = registry.getExchange(normalizedSourceName);
  if (exchangeAdapterResult.isErr()) return err(exchangeAdapterResult.error);
  const exchangeAdapter = exchangeAdapterResult.value;

  if (options.csvDir) {
    if (!exchangeAdapter.capabilities.supportsCsv) {
      return err(
        new Error(`Exchange "${sourceName}" does not support CSV import. Use API credentials for this exchange.`)
      );
    }

    return ok({
      exchange: sourceName,
      csvDir: options.csvDir,
    });
  }

  // API import
  if (!exchangeAdapter.capabilities.supportsApi) {
    return err(new Error(`Exchange "${sourceName}" does not support API import. Use --csv-dir for this exchange.`));
  }

  if (!options.apiKey || !options.apiSecret) {
    return err(new Error('API credentials are required for API imports'));
  }

  const credentials: ExchangeCredentials = {
    apiKey: options.apiKey,
    apiSecret: options.apiSecret,
  };
  if (options.apiPassphrase) {
    credentials.apiPassphrase = options.apiPassphrase;
  }

  return ok({
    exchange: sourceName,
    credentials,
  });
}
