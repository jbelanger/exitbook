import { Decimal } from 'decimal.js';

/**
 * Format crypto quantity for display: max 8dp, trim trailing zeros (min 2dp), show <0.00000001 for dust.
 */
export function formatCryptoQuantity(quantity: Decimal | string): string {
  const decimal = typeof quantity === 'string' ? new Decimal(quantity) : quantity;

  const formatted = decimal.toFixed(8);
  if (decimal.gt(0) && formatted === '0.00000000') {
    return '<0.00000001';
  }

  const parts = formatted.split('.');
  if (parts[1]) {
    const trimmed = parts[1].replace(/0+$/, '');
    const minDecimals = Math.max(trimmed.length, 2);
    return decimal.toFixed(minDecimals);
  }

  return decimal.toFixed(2);
}
