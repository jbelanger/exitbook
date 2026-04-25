import { err, ok, type Result } from '../result/index.js';

function normalizeBaseUnitDigits(amount: string): Result<{ digits: string; isNegative: boolean }, Error> {
  const trimmed = amount.trim();
  if (trimmed.length === 0) {
    return ok({ digits: '0', isNegative: false });
  }

  const isNegative = trimmed.startsWith('-');
  const unsigned = isNegative || trimmed.startsWith('+') ? trimmed.slice(1) : trimmed;
  if (!/^\d+$/.test(unsigned)) {
    return err(new Error(`Invalid argument: base-unit amount must be an integer string, received ${amount}`));
  }

  const digits = unsigned.replace(/^0+/, '') || '0';
  return ok({ digits, isNegative: isNegative && digits !== '0' });
}

function normalizeDecimals(decimals: number): Result<number, Error> {
  if (!Number.isInteger(decimals) || decimals < 0) {
    return err(new Error(`Invalid argument: base-unit decimals must be a non-negative integer, received ${decimals}`));
  }

  return ok(decimals);
}

function trimFractionalZeros(value: string): string {
  return value.replace(/0+$/, '');
}

function shiftBaseUnitDigits(digits: string, decimals: number): string {
  if (digits === '0') {
    return '0';
  }

  if (decimals === 0) {
    return digits;
  }

  if (digits.length <= decimals) {
    const fractional = trimFractionalZeros(`${'0'.repeat(decimals - digits.length)}${digits}`);
    return fractional.length === 0 ? '0' : `0.${fractional}`;
  }

  const integerPart = digits.slice(0, -decimals);
  const fractional = trimFractionalZeros(digits.slice(-decimals));
  return fractional.length === 0 ? integerPart : `${integerPart}.${fractional}`;
}

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

  const normalizedDecimalsResult = normalizeDecimals(decimals);
  if (normalizedDecimalsResult.isErr()) {
    return err(normalizedDecimalsResult.error);
  }

  const digitsResult = normalizeBaseUnitDigits(amount);
  if (digitsResult.isErr()) {
    return err(digitsResult.error);
  }

  const shifted = shiftBaseUnitDigits(digitsResult.value.digits, normalizedDecimalsResult.value);
  return ok(digitsResult.value.isNegative && shifted !== '0' ? `-${shifted}` : shifted);
}
