// Pure utility functions for import command
// All functions are pure - no side effects

import type { AccountType, ExchangeCredentials } from '@exitbook/core';
import type { AdapterRegistry, ImportParams } from '@exitbook/ingestion';
import { err, ok, type Result } from 'neverthrow';
import type { z } from 'zod';

import type { ImportCommandOptionsSchema } from '../shared/schemas.js';

/**
 * CLI options validated by Zod at CLI boundary
 */
export type ImportCommandOptions = z.infer<typeof ImportCommandOptionsSchema>;

/**
 * Build canonical ImportParams from validated CLI flags.
 * Performs normalization (e.g., address normalization for blockchains).
 * This is the single transformation point - all downstream code uses ImportParams as-is.
 */
export function buildImportParams(
  options: ImportCommandOptions,
  registry: AdapterRegistry
): Result<ImportParams, Error> {
  const sourceName = (options.exchange || options.blockchain)!;
  const isBlockchain = !!options.blockchain;

  // Determine account type
  let accountType: AccountType;
  if (isBlockchain) {
    accountType = 'blockchain';
  } else if (options.csvDir) {
    accountType = 'exchange-csv';
  } else {
    accountType = 'exchange-api';
  }

  // Build params based on source type
  if (isBlockchain) {
    // Blockchain import - normalize address
    if (!options.address) {
      return err(new Error('Address is required for blockchain imports'));
    }

    const adapterResult = registry.getBlockchain(sourceName.toLowerCase());
    if (adapterResult.isErr()) {
      return err(adapterResult.error);
    }

    const normalizedAddressResult = adapterResult.value.normalizeAddress(options.address);
    if (normalizedAddressResult.isErr()) {
      return err(normalizedAddressResult.error);
    }

    return ok({
      sourceName,
      sourceType: accountType,
      address: normalizedAddressResult.value,
      providerName: options.provider,
      xpubGap: options.xpubGap,
    });
  }

  // Exchange import
  if (accountType === 'exchange-csv') {
    // CSV import
    if (!options.csvDir) {
      return err(new Error('CSV directory is required for CSV imports'));
    }

    return ok({
      sourceName,
      sourceType: accountType,
      csvDirectory: options.csvDir,
    });
  }

  // API import
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
    sourceName,
    sourceType: accountType,
    credentials,
  });
}
