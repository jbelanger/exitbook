import { parseDecimal } from '@exitbook/foundation';

export function getDirectionHint(amount: string): 'credit' | 'debit' | 'unknown' {
  const value = parseDecimal(amount);

  if (value.isNegative()) {
    return 'debit';
  }

  if (value.gt(0)) {
    return 'credit';
  }

  return 'unknown';
}
