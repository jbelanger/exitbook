import type { AccountViewItem, TypeCounts } from '../accounts-view-model.js';

export type AccountsStatusColor = 'green' | 'yellow' | 'red' | 'cyan' | 'dim';
export const ACCOUNT_FINGERPRINT_REF_LENGTH = 10;

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

export function formatAccountFingerprintRef(accountFingerprint: string): string {
  if (accountFingerprint.length <= ACCOUNT_FINGERPRINT_REF_LENGTH) {
    return accountFingerprint;
  }

  return accountFingerprint.slice(0, ACCOUNT_FINGERPRINT_REF_LENGTH);
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
