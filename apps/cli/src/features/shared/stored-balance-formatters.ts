import type { BalanceSnapshotVerificationStatus } from '@exitbook/core';

export type StoredBalanceStatusColor = 'green' | 'yellow' | 'red' | 'dim';

export interface StoredBalanceVerificationDisplay {
  color: StoredBalanceStatusColor;
  icon: string;
  label: string;
  listLabel: string;
}

export function getStoredBalanceVerificationDisplay(
  status: BalanceSnapshotVerificationStatus | undefined
): StoredBalanceVerificationDisplay | undefined {
  switch (status) {
    case 'unavailable':
      return { icon: '?', color: 'yellow', label: 'verification unavailable', listLabel: 'unavailable' };
    case 'never-run':
      return { icon: '⊘', color: 'dim', label: 'never verified', listLabel: 'never run' };
    case 'warning':
      return { icon: '!', color: 'yellow', label: 'last verification warned', listLabel: 'warning' };
    case 'mismatch':
      return { icon: '✗', color: 'red', label: 'last verification mismatched', listLabel: 'mismatch' };
    case 'match':
      return { icon: '✓', color: 'green', label: 'last verification matched', listLabel: 'match' };
    case undefined:
      return undefined;
  }

  const exhaustiveCheck: never = status;
  return exhaustiveCheck;
}

export function formatStoredBalanceTimestamp(isoString: string): string {
  const date = new Date(isoString);
  return Number.isNaN(date.getTime()) ? isoString : date.toLocaleString();
}
