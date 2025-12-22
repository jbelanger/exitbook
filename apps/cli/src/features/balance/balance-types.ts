import type { AccountType, BalanceCommandStatus, SourceType } from '@exitbook/core';

/**
 * Balance command result data for JSON output.
 */
export interface BalanceCommandResult {
  status: BalanceCommandStatus;
  balances: {
    assetId: string;
    calculatedBalance: string;
    currency: string;
    difference: string;
    liveBalance: string;
    percentageDiff: number;
    status: 'match' | 'warning' | 'mismatch';
  }[];
  debug?:
    | {
        assetId: string;
        assetSymbol: string;
        topFees: {
          amount: string;
          datetime: string;
          transactionHash?: string | undefined;
        }[];
        topInflows: {
          amount: string;
          datetime: string;
          from?: string | undefined;
          to?: string | undefined;
          transactionHash?: string | undefined;
        }[];
        topOutflows: {
          amount: string;
          datetime: string;
          from?: string | undefined;
          to?: string | undefined;
          transactionHash?: string | undefined;
        }[];
        totals: {
          fees: string;
          inflows: string;
          net: string;
          outflows: string;
          txCount: number;
        };
      }
    | undefined;
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
    beaconWithdrawalsSkippedReason?: 'no-provider-support' | 'api-error' | 'unsupported-chain' | undefined;
    includesBeaconWithdrawals?: boolean | undefined;
    timestamp: string;
  };
  suggestion?: string | undefined;
}
