import type { AccountType, BalanceCommandStatus, SourceType } from '@exitbook/core';

/**
 * Balance command result data for JSON output.
 */
export interface BalanceCommandResult {
  status: BalanceCommandStatus;
  balances: {
    calculatedBalance: string;
    currency: string;
    difference: string;
    liveBalance: string;
    percentageDiff: number;
    status: 'match' | 'warning' | 'mismatch';
  }[];
  summary: {
    matches: number;
    mismatches: number;
    totalCurrencies: number;
    warnings: number;
  };
  source: {
    address?: string | undefined;
    name: string;
    type: SourceType;
  };
  account?:
    | {
        id: number;
        identifier: string;
        providerName: string | undefined;
        sourceName: string;
        type: AccountType;
      }
    | undefined;
  meta: {
    timestamp: string;
  };
  suggestion?: string | undefined;
}
