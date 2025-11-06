import {
  parseDecimal,
  type DataSource,
  type SourceParams,
  type SourceType,
  type UniversalTransaction,
} from '@exitbook/core';
import type { ExchangeCredentials } from '@exitbook/exchanges';
import type { Decimal } from 'decimal.js';
import { err, ok, type Result } from 'neverthrow';

/**
 * Balance command options from CLI flags
 */
export interface BalanceCommandOptions {
  exchange?: string | undefined;
  blockchain?: string | undefined;
  address?: string | undefined;
  provider?: string | undefined;
  apiKey?: string | undefined;
  apiSecret?: string | undefined;
  apiPassphrase?: string | undefined;
}

/**
 * Parameters for balance handler
 */
export interface BalanceHandlerParams {
  sourceType: SourceType;
  sourceName: string;
  address?: string | undefined;
  providerName?: string | undefined;
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
      providerName: options.provider,
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

/**
 * Get exchange credentials from environment variables.
 * Pure function that reads from process.env.
 */
export function getExchangeCredentialsFromEnv(exchangeName: string): Result<ExchangeCredentials, Error> {
  const upperName = exchangeName.toUpperCase();
  const apiKey = process.env[`${upperName}_API_KEY`];
  const apiSecret = process.env[`${upperName}_SECRET`];
  const apiPassphrase = process.env[`${upperName}_PASSPHRASE`];

  if (!apiKey || !apiSecret) {
    return err(new Error(`Missing ${upperName}_API_KEY or ${upperName}_SECRET in environment`));
  }

  const credentials: ExchangeCredentials = {
    apiKey,
    secret: apiSecret,
  };

  if (apiPassphrase) {
    credentials.passphrase = apiPassphrase;
  }

  return ok(credentials);
}

/**
 * Build source params for storage.
 * Pure function that constructs SourceParams from session data.
 */
export function buildSourceParams(session: DataSource, sourceType: SourceType, address?: string): SourceParams {
  if (sourceType === 'exchange') {
    return { exchange: session.sourceId };
  } else {
    // Use already-parsed importParams from domain model
    const effectiveAddress = address || session.importParams.address || 'unknown';
    return { address: effectiveAddress, blockchain: session.sourceId };
  }
}

/**
 * Convert Record<string, Decimal> to Record<string, string>.
 * Pure function for decimal-to-string conversion.
 * Uses toFixed() to avoid scientific notation for very small/large numbers.
 */
export function decimalRecordToStringRecord(record: Record<string, Decimal>): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(record)) {
    result[key] = value.toFixed();
  }
  return result;
}

/**
 * Sort sessions by completed date in descending order.
 * Pure function for session sorting.
 */
export function sortSessionsByCompletedDate(sessions: DataSource[]): DataSource[] {
  return [...sessions].sort((a, b) => {
    const aTime = a.completedAt ? new Date(a.completedAt).getTime() : 0;
    const bTime = b.completedAt ? new Date(b.completedAt).getTime() : 0;
    return bTime - aTime;
  });
}

/**
 * Find the most recent completed session from a list of sessions.
 * Pure function that filters to completed sessions and returns the most recent.
 */
export function findMostRecentCompletedSession(sessions: DataSource[]): DataSource | undefined {
  const completedSessions = sessions.filter((s) => s.status === 'completed');
  if (completedSessions.length === 0) {
    return undefined;
  }
  const sorted = sortSessionsByCompletedDate(completedSessions);
  return sorted[0];
}

/**
 * Find a session matching a specific blockchain address.
 * Pure function that searches for a session with matching address in import params.
 */
export function findSessionByAddress(sessions: DataSource[], address: string): DataSource | undefined {
  const normalizedAddress = address.toLowerCase();
  return sessions.find((session) => {
    const importParams = session.importParams;
    return importParams.address?.toLowerCase() === normalizedAddress;
  });
}

/**
 * Subtract excluded amounts from live balance.
 * For each asset with excluded amounts, subtract that amount from the live balance.
 * If the result is zero or negative, remove the asset entirely.
 * Pure function for balance arithmetic.
 */
export function subtractExcludedAmounts(
  balances: Record<string, Decimal>,
  excludedAmounts: Record<string, Decimal>
): Record<string, Decimal> {
  const adjusted: Record<string, Decimal> = { ...balances };

  for (const [asset, excludedAmount] of Object.entries(excludedAmounts)) {
    if (adjusted[asset]) {
      const newBalance = adjusted[asset].minus(excludedAmount);

      // If balance becomes zero or negative, remove the asset
      if (newBalance.lte(0)) {
        delete adjusted[asset];
      } else {
        adjusted[asset] = newBalance;
      }
    }
  }

  return adjusted;
}

/**
 * Sum up inflow amounts from excluded transactions.
 * Scam tokens are typically received via airdrops (inflows only).
 * Pure function for excluded amount calculation.
 */
export function sumExcludedInflowAmounts(transactions: UniversalTransaction[]): Record<string, Decimal> {
  const excludedAmounts: Record<string, Decimal> = {};

  for (const tx of transactions) {
    if (tx.excludedFromAccounting) {
      // Sum inflow amounts from scam transactions
      for (const inflow of tx.movements.inflows ?? []) {
        const currentAmount = excludedAmounts[inflow.asset] || parseDecimal('0');
        excludedAmounts[inflow.asset] = currentAmount.plus(inflow.grossAmount);
      }
    }
  }

  return excludedAmounts;
}
