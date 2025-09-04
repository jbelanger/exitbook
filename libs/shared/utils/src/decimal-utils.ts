import type { Decimal } from 'decimal.js';

/**
 * Configuration options for safe decimal to number conversion
 */
export interface SafeDecimalToNumberOptions {
  /**
   * Whether to allow precision loss in the conversion
   * @default false
   */
  allowPrecisionLoss?: boolean;

  /**
   * Maximum number of decimal places to allow in the conversion
   * @default 15 (JavaScript's safe precision limit)
   */
  maxDecimalPlaces?: number;

  /**
   * Callback to call when precision loss is detected
   */
  warningCallback?: (message: string) => void;
}

/**
 * Checks if a Decimal value can be safely converted to a JavaScript number
 * without precision loss or overflow.
 *
 * @param decimal - The Decimal value to check
 * @returns true if the conversion is safe, false otherwise
 */
export function canSafelyConvertToNumber(decimal: Decimal): boolean {
  // Check if the value is within the safe integer range
  if (decimal.isInteger()) {
    const num = decimal.toNumber();
    return Number.isSafeInteger(num);
  }

  // For non-integers, check if conversion maintains precision
  const num = decimal.toNumber();

  // Check for overflow/underflow
  if (!Number.isFinite(num)) {
    return false;
  }

  // Check if converting back to Decimal maintains the same value
  // This catches precision loss issues
  const DecimalConstructor = decimal.constructor as new (value: number) => typeof decimal;
  const converted = new DecimalConstructor(num);
  return decimal.equals(converted);
}

/**
 * Safely converts a Decimal to a JavaScript number, with optional validation
 * to prevent precision loss.
 *
 * @param decimal - The Decimal value to convert
 * @param options - Configuration options for the conversion
 * @returns The converted number
 * @throws Error if precision loss is detected and throwOnPrecisionLoss is true
 */
export function safeDecimalToNumber(decimal: Decimal, options: SafeDecimalToNumberOptions = {}): number {
  const { allowPrecisionLoss = false, maxDecimalPlaces = 15, warningCallback } = options;

  let hasIssue = false;
  let issueMessage = '';

  // Check decimal places constraint
  if (decimal.decimalPlaces() > maxDecimalPlaces) {
    hasIssue = true;
    issueMessage = `Decimal has ${decimal.decimalPlaces()} decimal places, but maximum allowed is ${maxDecimalPlaces}`;
  }

  // Check if conversion is safe
  if (!hasIssue && !canSafelyConvertToNumber(decimal)) {
    hasIssue = true;
    issueMessage = `Cannot safely convert ${decimal.toString()} to number`;
  }

  if (hasIssue) {
    if (warningCallback) {
      warningCallback(`Precision loss detected: ${issueMessage}`);
    }

    if (!allowPrecisionLoss) {
      throw new Error(`Precision loss detected: ${issueMessage}`);
    }
  }

  return decimal.toNumber();
}
