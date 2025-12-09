import * as prompts from '@clack/prompts';
import type { Account, ExchangeCredentials } from '@exitbook/core';
import { parseDecimal, type ImportSession, type UniversalTransactionData } from '@exitbook/core';
import type { AccountRepository, UserRepository } from '@exitbook/data';
import type { Decimal } from 'decimal.js';
import { err, ok, type Result } from 'neverthrow';
import type { z } from 'zod';

import type { BalanceCommandOptionsSchema } from '../shared/schemas.js';

/**
 * Balance command options validated by Zod at CLI boundary
 */
export type BalanceCommandOptions = z.infer<typeof BalanceCommandOptionsSchema>;

/**
 * Find and select account based on CLI options.
 * Handles account lookup, credential validation, and user prompts for multiple accounts.
 */
export async function findAccountForBalance(
  options: BalanceCommandOptions,
  accountRepository: AccountRepository,
  userRepository: UserRepository
): Promise<Result<Account, Error>> {
  try {
    // Get default user
    const userResult = await userRepository.ensureDefaultUser();
    if (userResult.isErr()) {
      return err(userResult.error);
    }
    const user = userResult.value;

    const sourceName = (options.exchange || options.blockchain)!;
    const isExchange = !!options.exchange;

    // Build credentials if provided
    let credentials: ExchangeCredentials | undefined;
    if (options.apiKey && options.apiSecret) {
      credentials = {
        apiKey: options.apiKey,
        apiSecret: options.apiSecret,
        ...(options.apiPassphrase && { apiPassphrase: options.apiPassphrase }),
      };
    }

    // For exchanges, try to get credentials from env if not provided
    if (isExchange && !credentials) {
      const envCredentials = getExchangeCredentialsFromEnv(sourceName);
      if (envCredentials.isOk()) {
        credentials = envCredentials.value;
      }
    }

    // Find accounts matching the source
    const accountsResult = await accountRepository.findBySourceName(sourceName, user.id);
    if (accountsResult.isErr()) {
      return err(accountsResult.error);
    }

    let matchingAccounts = accountsResult.value;

    // Filter by address if specified (blockchain only)
    if (options.address) {
      matchingAccounts = matchingAccounts.filter((a) => a.identifier === options.address);
    }

    // Filter by credentials if specified (exchange only)
    // if (credentials) {
    //   matchingAccounts = matchingAccounts.filter((a) => a.credentials?.apiKey === credentials.apiKey);
    // }

    if (matchingAccounts.length === 0) {
      if (isExchange) {
        return err(new Error(`No account found for ${sourceName}. Please run import first to create the account.`));
      } else {
        return err(
          new Error(
            `No account found for ${sourceName}${options.address ? ` with address ${options.address}` : ''}. Please run import first to create the account.`
          )
        );
      }
    }

    // If single account, use it
    if (matchingAccounts.length === 1) {
      return ok(matchingAccounts[0]!);
    }

    // Multiple accounts - prompt user to select
    const choices = matchingAccounts.map((account) => ({
      value: account.id,
      label: `${account.accountType} - ${account.identifier || 'N/A'} (ID: ${account.id})`,
    }));

    const selectedId = await prompts.select({
      message: `Multiple ${sourceName} accounts found. Select one:`,
      options: choices,
    });

    if (prompts.isCancel(selectedId)) {
      return err(new Error('Account selection cancelled'));
    }

    const selectedAccount = matchingAccounts.find((a) => a.id === selectedId);
    if (!selectedAccount) {
      return err(new Error(`Account with ID ${selectedId} not found`));
    }

    return ok(selectedAccount);
  } catch (error) {
    return err(error instanceof Error ? error : new Error(String(error)));
  }
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
    apiSecret: apiSecret,
  };

  if (apiPassphrase) {
    credentials.apiPassphrase = apiPassphrase;
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
