import type { AccountType, BalanceCommandStatus, SourceType } from '@exitbook/core';

import type { BalanceCommandOptions } from './balance-utils.js';

/**
 * Extended balance command options (adds CLI-specific flags).
 */
export interface ExtendedBalanceCommandOptions extends BalanceCommandOptions {
  json?: boolean | undefined;
}

/**
 * Balance command result data for JSON output.
 */
export interface BalanceCommandResult {
  status: BalanceCommandStatus;
  liveBalances: Record<string, string>;
  calculatedBalances: Record<string, string>;
  comparisons: {
    calculatedBalance: string;
    currency: string;
    difference: string;
    liveBalance: string;
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
