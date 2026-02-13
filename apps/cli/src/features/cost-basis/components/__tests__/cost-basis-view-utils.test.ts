import { Decimal } from 'decimal.js';
import { describe, expect, it } from 'vitest';

import { formatCryptoQuantity } from '../cost-basis-view-utils.js';

describe('formatCryptoQuantity', () => {
  it('should format normal quantities with trimmed trailing zeros (min 2dp)', () => {
    expect(formatCryptoQuantity(new Decimal('0.25000'))).toBe('0.25');
    expect(formatCryptoQuantity(new Decimal('1.5'))).toBe('1.50');
    expect(formatCryptoQuantity(new Decimal('1.50000000'))).toBe('1.50');
    expect(formatCryptoQuantity(new Decimal('10.12345'))).toBe('10.12345');
  });

  it('should preserve significant decimal places up to 8dp', () => {
    expect(formatCryptoQuantity(new Decimal('0.00000112'))).toBe('0.00000112');
    expect(formatCryptoQuantity(new Decimal('0.12345678'))).toBe('0.12345678');
    expect(formatCryptoQuantity(new Decimal('0.123456789'))).toBe('0.12345679'); // Rounded to 8dp
  });

  it('should show <0.00000001 for dust amounts (rounds to zero at 8dp)', () => {
    expect(formatCryptoQuantity(new Decimal('0.0000000000001'))).toBe('<0.00000001');
    expect(formatCryptoQuantity(new Decimal('0.000000001'))).toBe('<0.00000001');
    expect(formatCryptoQuantity(new Decimal('0.00000000499'))).toBe('<0.00000001');
  });

  it('should NOT show dust for values that round to 0.00000001 at 8dp', () => {
    expect(formatCryptoQuantity(new Decimal('0.000000005'))).toBe('0.00000001');
    expect(formatCryptoQuantity(new Decimal('0.00000000999'))).toBe('0.00000001');
  });

  it('should format zero with 2 decimal places', () => {
    expect(formatCryptoQuantity(new Decimal('0'))).toBe('0.00');
    expect(formatCryptoQuantity(new Decimal('0.0'))).toBe('0.00');
  });

  it('should handle string input', () => {
    expect(formatCryptoQuantity('0.25000')).toBe('0.25');
    expect(formatCryptoQuantity('0.00000112')).toBe('0.00000112');
  });

  it('should format whole numbers with 2 decimal places', () => {
    expect(formatCryptoQuantity(new Decimal('10'))).toBe('10.00');
    expect(formatCryptoQuantity(new Decimal('100'))).toBe('100.00');
  });
});
