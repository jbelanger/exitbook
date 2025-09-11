import { Data } from 'effect';

// Event bus specific errors
export class AppendError extends Data.TaggedError('AppendError')<{
  readonly cause?: unknown;
  readonly reason: string;
}> {}

export class SubscriptionError extends Data.TaggedError('SubscriptionError')<{
  readonly cause?: unknown;
  readonly reason: string;
}> {}

export class CheckpointError extends Data.TaggedError('CheckpointError')<{
  readonly cause?: unknown;
  readonly reason: string;
}> {}
