import { Effect } from 'effect';

import type { OutboxDatabase } from '../port';

export type OutboxStatus = 'PENDING' | 'PROCESSING' | 'PROCESSED' | 'FAILED';

/**
 * Consolidates all outbox status transition logic in one place.
 * This makes the processor read like a story: claim → publish → resolve(status).
 */
export const createStatusTransitions = (db: OutboxDatabase) => {
  /**
   * Transitions an event from PROCESSING to PROCESSED with timestamp
   */
  const markProcessed = (eventId: string): Effect.Effect<void, { reason: string }> =>
    db.updateEventStatus(eventId, 'PROCESSED', new Date());

  /**
   * Transitions an event from PROCESSING to FAILED (DLQ)
   */
  const markFailed = (eventId: string): Effect.Effect<void, { reason: string }> =>
    db.markAsDLQ(eventId);

  /**
   * Transitions an event from PROCESSING back to PENDING for retry
   */
  const scheduleRetry = (
    eventId: string,
    nextAttemptAt: Date,
    lastError?: string,
  ): Effect.Effect<void, { reason: string }> =>
    db.updateEventForRetry(eventId, nextAttemptAt, lastError);

  /**
   * Resolves the final status of an event based on the result of processing
   */
  const resolveStatus = (
    eventId: string,
    attempts: number,
    maxAttempts: number,
    error?: string,
    calculateNextAttempt?: () => Date,
  ): Effect.Effect<'retry' | 'failed' | 'processed', { reason: string }> => {
    if (!error) {
      // Success case
      return markProcessed(eventId).pipe(Effect.map(() => 'processed' as const));
    }

    if (attempts >= maxAttempts) {
      // Exceeded max attempts - send to DLQ
      return markFailed(eventId).pipe(Effect.map(() => 'failed' as const));
    }

    // Schedule for retry
    const nextAttemptAt = calculateNextAttempt?.() ?? new Date(Date.now() + 60000); // 1 min default
    return scheduleRetry(eventId, nextAttemptAt, error).pipe(Effect.map(() => 'retry' as const));
  };

  return {
    markFailed,
    markProcessed,
    resolveStatus,
    scheduleRetry,
  };
};

export type StatusTransitions = ReturnType<typeof createStatusTransitions>;
