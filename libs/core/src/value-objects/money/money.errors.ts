// Money-related error types for neverthrow Result handling

export abstract class MoneyError extends Error {
  abstract readonly code: string;
}

export class InvalidScaleError extends MoneyError {
  readonly code = 'INVALID_SCALE';

  constructor(scale: number) {
    super(`Scale must be non-negative, received: ${scale}`);
  }
}

export class InvalidCurrencyError extends MoneyError {
  readonly code = 'INVALID_CURRENCY';

  constructor(currency: string) {
    super(`Currency must not be empty, received: "${currency}"`);
  }
}

export class CurrencyMismatchError extends MoneyError {
  readonly code = 'CURRENCY_MISMATCH';

  constructor(currency1: string, currency2: string) {
    super(`Cannot operate on different currencies: ${currency1} vs ${currency2}`);
  }
}

export class ScaleMismatchError extends MoneyError {
  readonly code = 'SCALE_MISMATCH';

  constructor(scale1: number, scale2: number) {
    super(`Cannot operate on different scales: ${scale1} vs ${scale2}`);
  }
}

export class DivisionByZeroError extends MoneyError {
  readonly code = 'DIVISION_BY_ZERO';

  constructor() {
    super('Cannot divide by zero');
  }
}

export class InvalidDecimalError extends MoneyError {
  readonly code = 'INVALID_DECIMAL';

  constructor(value: string, reason: string) {
    super(`Invalid decimal value "${value}": ${reason}`);
  }
}

// Union type for all Money errors
export type MoneyErrorTypes =
  | InvalidScaleError
  | InvalidCurrencyError
  | CurrencyMismatchError
  | ScaleMismatchError
  | DivisionByZeroError
  | InvalidDecimalError;
