import type { ExchangeCredentials } from '@exitbook/exchanges';
import { err, ok, type Result } from 'neverthrow';

/**
 * Balance command options from CLI flags
 */
export interface BalanceCommandOptions {
  exchange?: string | undefined;
  blockchain?: string | undefined;
  address?: string | undefined;
  apiKey?: string | undefined;
  apiSecret?: string | undefined;
  apiPassphrase?: string | undefined;
}

/**
 * Parameters for balance handler
 */
export interface BalanceHandlerParams {
  sourceType: 'exchange' | 'blockchain';
  sourceName: string;
  address?: string | undefined;
  credentials?: ExchangeCredentials | undefined;
}

/**
 * Build balance handler parameters from CLI flags.
 * Pure function that validates and transforms command line options.
 */
export function buildBalanceParamsFromFlags(options: BalanceCommandOptions): Result<BalanceHandlerParams, Error> {
  // Validate that either exchange or blockchain is specified
  if (!options.exchange && !options.blockchain) {
    return err(new Error('Either --exchange or --blockchain must be specified'));
  }

  if (options.exchange && options.blockchain) {
    return err(new Error('Cannot specify both --exchange and --blockchain'));
  }

  // Exchange path
  if (options.exchange) {
    // Validate that credentials are complete (both key and secret required)
    if ((options.apiKey || options.apiSecret) && !(options.apiKey && options.apiSecret)) {
      return err(new Error('Both --api-key and --api-secret must be provided together'));
    }

    // Build credentials if API key/secret provided (ExchangeCredentials = Record<string, string>)
    let credentials: ExchangeCredentials | undefined;
    if (options.apiKey && options.apiSecret) {
      const creds: ExchangeCredentials = {
        apiKey: options.apiKey,
        secret: options.apiSecret,
      };
      if (options.apiPassphrase) {
        creds.passphrase = options.apiPassphrase;
      }
      credentials = creds;
    }

    return ok({
      sourceType: 'exchange',
      sourceName: options.exchange,
      credentials,
    });
  }

  // Blockchain path
  if (options.blockchain) {
    if (!options.address) {
      return err(new Error('--address is required when using --blockchain'));
    }

    return ok({
      sourceType: 'blockchain',
      sourceName: options.blockchain,
      address: options.address,
    });
  }

  return err(new Error('Invalid command options'));
}

/**
 * Validate balance handler parameters.
 * Pure function that checks parameter validity.
 */
export function validateBalanceParams(params: BalanceHandlerParams): Result<void, Error> {
  if (!params.sourceName) {
    return err(new Error('Source name is required'));
  }

  if (params.sourceType === 'blockchain' && !params.address) {
    return err(new Error('Address is required for blockchain sources'));
  }

  return ok();
}
