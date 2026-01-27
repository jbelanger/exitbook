import type { AccountType } from '@exitbook/core';

import type { OutputManager } from '../shared/output.ts';
import type { CommonViewFilters } from '../shared/view-utils.js';

/**
 * Parameters for view accounts command.
 */
export interface ViewAccountsParams extends CommonViewFilters {
  accountId?: number | undefined;
  accountType?: AccountType | undefined;
  showSessions?: boolean | undefined;
}

/**
 * Account info for display.
 */
export interface AccountInfo {
  id: number;
  accountType: AccountType;
  sourceName: string;
  identifier: string;
  parentAccountId?: number | undefined;
  providerName?: string | undefined;
  lastBalanceCheckAt?: string | undefined;
  verificationStatus?: 'match' | 'mismatch' | 'never-checked' | undefined;
  sessionCount: number | undefined;
  childAccounts?: AccountInfo[] | undefined;
  createdAt: string;
}

/**
 * Session summary for display (minimal info).
 */
export interface SessionSummary {
  id: number;
  status: 'started' | 'completed' | 'failed' | 'cancelled';
  startedAt: string;
  completedAt?: string | undefined;
}

/**
 * Result of view accounts command.
 */
export interface ViewAccountsResult {
  accounts: AccountInfo[];
  sessions?: Map<number, SessionSummary[]> | undefined;
  count: number;
}

/**
 * Get verification status icon.
 */
export function getVerificationIcon(status: 'match' | 'mismatch' | 'never-checked' | undefined): string {
  switch (status) {
    case 'match':
      return '✓';
    case 'mismatch':
      return '✗';
    case 'never-checked':
      return '⊘';
    default:
      return '?';
  }
}

/**
 * Get status icon for session.
 */
export function getSessionStatusIcon(status: string): string {
  switch (status) {
    case 'completed':
      return '✓';
    case 'failed':
      return '✗';
    case 'started':
      return '⏳';
    case 'cancelled':
      return '⊘';
    default:
      return '•';
  }
}

/**
 * Format a single account for text display.
 */
export function formatAccountForDisplay(
  output: OutputManager,
  account: AccountInfo,
  sessions?: SessionSummary[],
  allSessions?: Map<number, SessionSummary[]>
) {
  // Display xpub indicator for parent accounts with children
  let accountLabel = account.sourceName;
  if (account.childAccounts && account.childAccounts.length > 0) {
    accountLabel = `${account.sourceName} (xpub with ${account.childAccounts.length} derived addresses)`;
  }

  output.info(`Account ID ${account.id} - ${accountLabel} (${account.accountType})`);
  output.log(`Identifier: ${account.identifier}`);

  if (account.providerName) {
    output.log(`Provider: ${account.providerName}`);
  }

  if (account.lastBalanceCheckAt) {
    const verifyIcon = getVerificationIcon(account.verificationStatus);
    output.log(`Last Balance Check: ${account.lastBalanceCheckAt} ${verifyIcon}`);
    if (account.verificationStatus) {
      output.log(`Verification Status: ${account.verificationStatus}`);
    }
  }

  if (account.sessionCount !== undefined && account.sessionCount > 0) {
    output.log(`Import Sessions: ${account.sessionCount}`);
  }

  output.log(`Created: ${account.createdAt}`);

  if (sessions && sessions.length > 0) {
    output.log(`Recent Sessions:`);
    for (const session of sessions) {
      const statusIcon = getSessionStatusIcon(session.status);
      const completedInfo = session.completedAt ? ` → ${session.completedAt}` : '';
      output.log(`  ${statusIcon} Session #${session.id} (${session.status}): ${session.startedAt}${completedInfo}`);
    }
  }

  // Display child accounts if present
  if (account.childAccounts && account.childAccounts.length > 0) {
    output.log(`Child Accounts:`);
    for (const child of account.childAccounts) {
      const childSessions = allSessions?.get(child.id);
      formatAccountForDisplay(output, child, childSessions, allSessions);
    }
  }
}

/**
 * Format accounts list for text display.
 */
export function formatAccountsListForDisplay(
  output: OutputManager,
  accounts: AccountInfo[],
  sessions?: Map<number, SessionSummary[]>
) {
  if (accounts.length === 0) {
    output.warn('No accounts found.');
  } else {
    for (const account of accounts) {
      const accountSessions = sessions?.get(account.id);
      formatAccountForDisplay(output, account, accountSessions, sessions);
    }
  }
}
