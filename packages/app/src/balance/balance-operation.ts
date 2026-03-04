import type { BlockchainProviderManager } from '@exitbook/blockchain-providers';
import type { ExchangeCredentials } from '@exitbook/core';
import type { DataContext } from '@exitbook/data';
import type { Decimal } from 'decimal.js';
import type { Result } from 'neverthrow';

export interface BalanceParams {
  accountId: number;
  credentials?: ExchangeCredentials | undefined;
}

export interface BalanceComparison {
  asset: string;
  calculated: Decimal;
  live: Decimal;
  difference: Decimal;
  match: boolean;
}

export interface BalanceResult {
  accountId: number;
  comparisons: BalanceComparison[];
  overallMatch: boolean;
}

/**
 * Compare live vs calculated balances and persist verification metadata.
 *
 * Fetches live balances from providers, calculates from stored transactions,
 * compares, and writes verification results to accounts.
 */
export class BalanceOperation {
  constructor(
    private readonly db: DataContext,
    private readonly providerManager: BlockchainProviderManager
  ) {}
  // eslint-disable-next-line @typescript-eslint/no-unused-vars, @typescript-eslint/require-await -- will be there when implemented
  async execute(params: BalanceParams): Promise<Result<BalanceResult, Error>> {
    throw new Error('Not implemented');
  }
}
