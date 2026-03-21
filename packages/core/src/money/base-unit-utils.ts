import { Decimal } from 'decimal.js';

import { ok, type Result } from '../result/index.js';
import { wrapError } from '../utils/type-guard-utils.js';

import { parseDecimal } from './decimal-utils.js';

/**
 * Convert an amount in base units (wei, satoshis, lamports, etc.) to a
 * human-readable decimal string.
 */
export function fromBaseUnitsToDecimalString(amount: string | undefined, decimals?: number): Result<string, Error> {
  if (!amount || amount === '0') {
    return ok('0');
  }

  if (decimals === undefined || decimals === null) {
    return ok(amount);
  }

  try {
    const result = new Decimal(amount).dividedBy(parseDecimal('10').pow(decimals));
    return ok(result.toFixed(decimals).replace(/\.?0+$/, ''));
  } catch (error) {
    return wrapError(error, `Unable to normalize base-unit amount: ${amount}`);
  }
}
