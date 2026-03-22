import type { Currency } from '@exitbook/foundation';
import { err, ok, parseDecimal, type Result } from '@exitbook/foundation';
import type { Decimal } from 'decimal.js';

/**
 * Validate a raw price value from an API response and convert it to Decimal.
 */
export function validateRawPrice(
  price: string | number | undefined,
  assetSymbol: Currency,
  context: string
): Result<Decimal, Error> {
  const priceValue = typeof price === 'number' ? price.toString() : price;
  const decimal = parseDecimal(priceValue);

  if (decimal.lessThanOrEqualTo(0)) {
    const reason = price === undefined ? 'not found' : `invalid (${price}, must be positive)`;
    return err(new Error(`${context} price for ${assetSymbol}: ${reason}`));
  }

  return ok(decimal);
}
