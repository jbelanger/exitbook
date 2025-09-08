import { Data } from 'effect';

export class ValidationError extends Data.TaggedError('ValidationError')<{
  readonly field: string;
  readonly message: string;
}> {}

export class NotFoundError extends Data.TaggedError('NotFoundError')<{
  readonly entityType: string;
  readonly identifier: string;
}> {}

export class ConcurrencyError extends Data.TaggedError('ConcurrencyError')<{
  readonly actualVersion: number;
  readonly entityType: string;
  readonly expectedVersion: number;
  readonly identifier: string;
}> {}

export class BusinessRuleViolationError extends Data.TaggedError('BusinessRuleViolationError')<{
  readonly message: string;
  readonly rule: string;
}> {}