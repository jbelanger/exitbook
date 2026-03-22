import { parseDecimal } from '@exitbook/foundation';
import { Decimal } from 'decimal.js';
import { describe, expect, it } from 'vitest';

import {
  formatThetaAmount,
  isThetaTokenTransfer,
  parseCommaFormattedNumber,
  selectThetaCurrency,
  THETA_GAS_ASSET_SYMBOL,
  THETA_NATIVE_DECIMALS,
  THETA_PRIMARY_ASSET_SYMBOL,
} from '../theta-format-utils.js';

describe('theta/mapper-utils', () => {
  it('selects THETA before TFUEL when both amounts are present', () => {
    const result = selectThetaCurrency(parseDecimal('100'), new Decimal('50'));

    expect(result).toEqual({
      currency: THETA_PRIMARY_ASSET_SYMBOL,
      amount: parseDecimal('100'),
    });
  });

  it('falls back to TFUEL when only TFUEL is present', () => {
    const result = selectThetaCurrency(parseDecimal('0'), new Decimal('50'));

    expect(result).toEqual({
      currency: THETA_GAS_ASSET_SYMBOL,
      amount: new Decimal('50'),
    });
  });

  it('parses ThetaScan comma-formatted numbers', () => {
    expect(parseCommaFormattedNumber('1,234,567.89').toFixed()).toBe('1234567.89');
  });

  it('identifies THETA transfers as symbol-preserving token transfers', () => {
    expect(isThetaTokenTransfer(THETA_PRIMARY_ASSET_SYMBOL)).toBe(true);
    expect(isThetaTokenTransfer(THETA_GAS_ASSET_SYMBOL)).toBe(false);
  });

  it('formats THETA amounts in decimal units and TFUEL amounts in wei units', () => {
    const thetaResult = formatThetaAmount(parseDecimal('1500000000000000000'), true, THETA_NATIVE_DECIMALS);
    const tfuelResult = formatThetaAmount(parseDecimal('1500000000000000000'), false, THETA_NATIVE_DECIMALS);

    expect(thetaResult).toBe('1.5');
    expect(tfuelResult).toBe('1500000000000000000');
  });
});
