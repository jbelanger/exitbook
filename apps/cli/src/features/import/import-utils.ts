// Pure utility functions for import command
// All functions are pure - no side effects

import type { SourceType } from '@exitbook/core';
import type { Result } from 'neverthrow';
import { err, ok } from 'neverthrow';

import type { ImportHandlerParams } from './import-handler.js';

/**
 * CLI options structure for building import parameters.
 */
export interface ImportCommandOptions {
  address?: string | undefined;
  apiKey?: string | undefined;
  apiPassphrase?: string | undefined;
  apiSecret?: string | undefined;
  blockchain?: string | undefined;
  csvDir?: string | undefined;
  exchange?: string | undefined;
  process?: boolean | undefined;
  provider?: string | undefined;
}

/**
 * Validate import parameters .
 * Returns Result<void, Error> to indicate validation success or failure.
 */
export function validateImportParams(params: ImportHandlerParams): Result<void, Error> {
  // Exchange validation
  if (params.sourceType === 'exchange') {
    if (!params.csvDir && !params.credentials) {
      return err(new Error('Either CSV directory or API credentials are required for exchange sources'));
    }
    if (params.csvDir && params.credentials) {
      return err(new Error('Cannot specify both CSV directory and API credentials. Choose one import method.'));
    }
  }

  // Blockchain validation
  if (params.sourceType === 'blockchain') {
    if (!params.address) {
      return err(new Error('Wallet address is required for blockchain sources'));
    }
  }

  return ok();
}

/**
 * Build import parameters from CLI flags .
 * Validates inputs and constructs ImportHandlerParams.
 */
export function buildImportParamsFromFlags(options: ImportCommandOptions): Result<ImportHandlerParams, Error> {
  // Validate source selection
  const sourceName = options.exchange || options.blockchain;
  if (!sourceName) {
    return err(
      new Error('Either --exchange or --blockchain is required. Examples: --exchange kraken, --blockchain bitcoin')
    );
  }

  if (options.exchange && options.blockchain) {
    return err(new Error('Cannot specify both --exchange and --blockchain. Choose one.'));
  }

  const sourceType: SourceType = options.exchange ? 'exchange' : 'blockchain';

  // Validate exchange requirements
  if (sourceType === 'exchange') {
    if (!options.csvDir && !options.apiKey) {
      return err(
        new Error('Either --csv-dir or API credentials (--api-key, --api-secret) are required for exchange sources')
      );
    }
    if (options.csvDir && options.apiKey) {
      return err(new Error('Cannot specify both --csv-dir and API credentials. Choose one import method.'));
    }
    if (options.apiKey && !options.apiSecret) {
      return err(new Error('--api-secret is required when using --api-key'));
    }
  }

  // Validate blockchain requirements
  if (sourceType === 'blockchain' && !options.address) {
    return err(new Error('--address is required for blockchain sources'));
  }

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
    providerId: options.provider,
    csvDir: options.csvDir,
    credentials,
    shouldProcess: options.process,
  });
}
