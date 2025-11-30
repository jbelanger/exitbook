import type { AccountType } from '@exitbook/core';

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
  providerName: string | undefined;
  lastBalanceCheckAt: string | undefined;
  verificationStatus: 'match' | 'mismatch' | 'never-checked' | undefined;
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
  completedAt: string | undefined;
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
 * Get account type icon.
 */
export function getAccountTypeIcon(accountType: AccountType): string {
  switch (accountType) {
    case 'blockchain':
      return '⛓️';
    case 'exchange-api':
    case 'exchange-csv':
      return '💱';
    default:
      return '•';
  }
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
  account: AccountInfo,
  sessions?: SessionSummary[],
  indent = '',
  allSessions?: Map<number, SessionSummary[]>
): string {
  const typeIcon = getAccountTypeIcon(account.accountType);
  const lines: string[] = [];

  // Display xpub indicator for parent accounts with children
  const accountLabel =
    account.childAccounts && account.childAccounts.length > 0
      ? `${account.sourceName} (xpub with ${account.childAccounts.length} derived addresses)`
      : account.sourceName;

  lines.push(`${indent}${typeIcon} Account #${account.id} - ${accountLabel} (${account.accountType})`);
  lines.push(`${indent}   Identifier: ${account.identifier}`);

  if (account.providerName) {
    lines.push(`${indent}   Provider: ${account.providerName}`);
  }

  if (account.lastBalanceCheckAt) {
    const verifyIcon = getVerificationIcon(account.verificationStatus);
    lines.push(`${indent}   Last Balance Check: ${account.lastBalanceCheckAt} ${verifyIcon}`);
    if (account.verificationStatus) {
      lines.push(`${indent}   Verification Status: ${account.verificationStatus}`);
    }
  }

  if (account.sessionCount !== undefined && account.sessionCount > 0) {
    lines.push(`${indent}   Import Sessions: ${account.sessionCount}`);
  }

  lines.push(`${indent}   Created: ${account.createdAt}`);

  if (sessions && sessions.length > 0) {
    lines.push(`${indent}   Recent Sessions:`);
    for (const session of sessions) {
      const statusIcon = getSessionStatusIcon(session.status);
      const completedInfo = session.completedAt ? ` → ${session.completedAt}` : '';
      lines.push(
        `${indent}     ${statusIcon} Session #${session.id} (${session.status}): ${session.startedAt}${completedInfo}`
      );
    }
  }

  // Display child accounts if present
  if (account.childAccounts && account.childAccounts.length > 0) {
    lines.push(`${indent}   Child Accounts:`);
    for (const child of account.childAccounts) {
      const childSessions = allSessions?.get(child.id);
      const childLines = formatAccountForDisplay(child, childSessions, `${indent}     `, allSessions);
      lines.push(childLines);
    }
  }

  return lines.join('\n');
}

/**
 * Format accounts list for text display.
 */
export function formatAccountsListForDisplay(
  accounts: AccountInfo[],
  count: number,
  sessions?: Map<number, SessionSummary[]>
): string {
  const lines: string[] = [];

  lines.push('');
  lines.push('Accounts:');
  lines.push('=============================');
  lines.push('');

  if (accounts.length === 0) {
    lines.push('No accounts found.');
  } else {
    for (const account of accounts) {
      const accountSessions = sessions?.get(account.id);
      lines.push(formatAccountForDisplay(account, accountSessions, '', sessions));
      lines.push('');
    }
  }

  lines.push('=============================');
  lines.push(`Total: ${count} accounts`);

  return lines.join('\n');
}
