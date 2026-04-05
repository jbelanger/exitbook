import type { AccountViewItem, TypeCounts } from '../accounts-view-model.js';
export { ACCOUNT_FINGERPRINT_REF_LENGTH, formatAccountFingerprintRef } from '../account-selector.js';

export type AccountsStatusColor = 'green' | 'yellow' | 'red' | 'cyan' | 'dim';

export interface AccountsStatusDisplay {
  icon: string;
  iconColor: AccountsStatusColor;
  label: string;
  listLabel: string;
}

export function buildTypeParts(counts: TypeCounts): { count: number; label: string }[] {
  const parts: { count: number; label: string }[] = [];
  if (counts.blockchain > 0) parts.push({ label: 'blockchain', count: counts.blockchain });
  if (counts.exchangeApi > 0) parts.push({ label: 'exchange-api', count: counts.exchangeApi });
  if (counts.exchangeCsv > 0) parts.push({ label: 'exchange-csv', count: counts.exchangeCsv });
  return parts;
}

export function formatAccountType(accountType: string): string {
  switch (accountType) {
    case 'blockchain':
      return 'blockchain';
    case 'exchange-api':
      return 'exchange-api';
    case 'exchange-csv':
      return 'exchange-csv';
    default:
      return accountType;
  }
}

export function getVerificationDisplay(status: AccountViewItem['verificationStatus']): AccountsStatusDisplay {
  switch (status) {
    case 'match':
      return { icon: '✓', iconColor: 'green', label: 'verified', listLabel: 'ok' };
    case 'warning':
      return { icon: '!', iconColor: 'yellow', label: 'warning', listLabel: 'warn' };
    case 'mismatch':
      return { icon: '✗', iconColor: 'red', label: 'mismatch', listLabel: 'fail' };
    case 'unavailable':
      return { icon: '?', iconColor: 'yellow', label: 'unavailable', listLabel: 'n/a' };
    case 'never-checked':
      return { icon: '⊘', iconColor: 'dim', label: 'never checked', listLabel: '—' };
    case undefined:
      return { icon: '·', iconColor: 'dim', label: 'unknown', listLabel: '?' };
  }

  const exhaustiveCheck: never = status;
  return exhaustiveCheck;
}

export function getProjectionDisplay(status: AccountViewItem['balanceProjectionStatus']): AccountsStatusDisplay {
  switch (status) {
    case 'fresh':
      return { icon: '✓', iconColor: 'green', label: 'fresh', listLabel: 'fresh' };
    case 'stale':
      return { icon: '!', iconColor: 'yellow', label: 'stale', listLabel: 'stale' };
    case 'building':
      return { icon: '~', iconColor: 'cyan', label: 'building', listLabel: 'build' };
    case 'failed':
      return { icon: '✗', iconColor: 'red', label: 'failed', listLabel: 'fail' };
    case 'never-built':
      return { icon: '⊘', iconColor: 'dim', label: 'never built', listLabel: '—' };
    case undefined:
      return { icon: '·', iconColor: 'dim', label: 'unknown', listLabel: '?' };
  }

  const exhaustiveCheck: never = status;
  return exhaustiveCheck;
}

export function getLiveCheckDetailDisplay(status: AccountViewItem['verificationStatus']): AccountsStatusDisplay {
  switch (status) {
    case 'match':
      return { icon: '✓', iconColor: 'green', label: 'verified', listLabel: 'ok' };
    case 'warning':
      return { icon: '!', iconColor: 'yellow', label: 'warning', listLabel: 'warn' };
    case 'mismatch':
      return { icon: '✗', iconColor: 'red', label: 'mismatch', listLabel: 'fail' };
    case 'unavailable':
      return { icon: '?', iconColor: 'yellow', label: 'unavailable', listLabel: 'n/a' };
    case 'never-checked':
      return { icon: '·', iconColor: 'dim', label: 'not yet run', listLabel: '—' };
    case undefined:
      return { icon: '·', iconColor: 'dim', label: 'unknown', listLabel: '?' };
  }

  const exhaustiveCheck: never = status;
  return exhaustiveCheck;
}

export function getBalanceDataDetailDisplay(status: AccountViewItem['balanceProjectionStatus']): AccountsStatusDisplay {
  switch (status) {
    case 'fresh':
      return { icon: '✓', iconColor: 'green', label: 'up to date', listLabel: 'fresh' };
    case 'stale':
      return { icon: '!', iconColor: 'yellow', label: 'out of date', listLabel: 'stale' };
    case 'building':
      return { icon: '~', iconColor: 'cyan', label: 'building', listLabel: 'build' };
    case 'failed':
      return { icon: '✗', iconColor: 'red', label: 'failed', listLabel: 'fail' };
    case 'never-built':
      return { icon: '·', iconColor: 'dim', label: 'not yet calculated', listLabel: '—' };
    case undefined:
      return { icon: '·', iconColor: 'dim', label: 'unknown', listLabel: '?' };
  }

  const exhaustiveCheck: never = status;
  return exhaustiveCheck;
}

export function shouldShowAccountDetailStatus(
  account: Pick<AccountViewItem, 'balanceProjectionStatus' | 'verificationStatus'>
): boolean {
  const balanceStatus = account.balanceProjectionStatus ?? 'never-built';
  const liveCheckStatus = account.verificationStatus ?? 'never-checked';
  return !(balanceStatus === 'never-built' && liveCheckStatus === 'never-checked');
}

export function getSessionDisplay(status: string): { icon: string; iconColor: AccountsStatusColor } {
  switch (status) {
    case 'completed':
      return { icon: '✓', iconColor: 'green' };
    case 'failed':
      return { icon: '✗', iconColor: 'red' };
    case 'started':
      return { icon: '⏳', iconColor: 'yellow' };
    case 'cancelled':
      return { icon: '⊘', iconColor: 'dim' };
    default:
      return { icon: '•', iconColor: 'dim' };
  }
}

export function formatImportCount(count: number): string {
  return `${count} import${count === 1 ? '' : 's'}`;
}

export function truncateIdentifier(identifier: string, accountType: string, maxWidth: number): string {
  if (identifier.length <= maxWidth) return identifier.padEnd(maxWidth);

  if (accountType === 'blockchain') {
    const prefixLen = Math.floor((maxWidth - 3) / 2);
    const suffixLen = maxWidth - 3 - prefixLen;
    return `${identifier.substring(0, prefixLen)}...${identifier.substring(identifier.length - suffixLen)}`;
  }

  return identifier.substring(0, maxWidth - 3) + '...';
}

export function truncateLabel(label: string, maxWidth: number): string {
  if (label.length <= maxWidth) {
    return label.padEnd(maxWidth);
  }

  return `${label.slice(0, maxWidth - 3)}...`;
}

export function formatTimestamp(isoString: string): string {
  return isoString.replace('T', ' ').replace('Z', '').substring(0, 19);
}
