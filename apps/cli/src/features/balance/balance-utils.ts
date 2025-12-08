import { parseDecimal, type ImportSession, type SourceType, type UniversalTransactionData } from '@exitbook/core';
import type { Decimal } from 'decimal.js';
import { err, ok, type Result } from 'neverthrow';
import type { z } from 'zod';

import type { BalanceCommandOptionsSchema } from '../shared/schemas.js';

/**
 * Balance command options validated by Zod at CLI boundary
 */
export type BalanceCommandOptions = z.infer<typeof BalanceCommandOptionsSchema>;

/**
 * Exchange credentials structure expected by balance service
 */
export interface ExchangeCredentials {
  apiKey: string;
  secret: string;
  passphrase?: string | undefined;
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
 * Build balance handler parameters from validated CLI flags.
 * No validation needed - options are already validated by Zod schema.
 */
export function buildBalanceParamsFromFlags(options: BalanceCommandOptions): Result<BalanceHandlerParams, Error> {
  const sourceName = (options.exchange || options.blockchain)!;
  const sourceType: SourceType = options.exchange ? 'exchange' : 'blockchain';

  // Build credentials if API key/secret provided
  let credentials: ExchangeCredentials | undefined;
  if (options.apiKey && options.apiSecret) {
    credentials = {
      apiKey: options.apiKey,
      secret: options.apiSecret,
      ...(options.apiPassphrase && { passphrase: options.apiPassphrase }),
    };
  }

  return ok({
    sourceType,
    sourceName,
    address: options.address,
    providerName: options.provider,
    credentials,
  });
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
export function sortSessionsByCompletedDate(sessions: ImportSession[]): ImportSession[] {
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
export function findMostRecentCompletedSession(sessions: ImportSession[]): ImportSession | undefined {
  const completedSessions = sessions.filter((s) => s.status === 'completed');
  if (completedSessions.length === 0) {
    return undefined;
  }
  const sorted = sortSessionsByCompletedDate(completedSessions);
  return sorted[0];
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
export function sumExcludedInflowAmounts(transactions: UniversalTransactionData[]): Record<string, Decimal> {
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
