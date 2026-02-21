import type { Result } from 'neverthrow';
import { err, ok } from 'neverthrow';

export interface BusinessDayFallbackContext {
  attemptIndex: number;
  attemptNumber: number;
  candidateDate: Date;
  isOriginalDate: boolean;
  maxAttempts: number;
  requestedDate: Date;
}

export type BusinessDayFetchAttemptResult<T> =
  | { error: Error; outcome: 'fail' }
  | { error: Error; outcome: 'retry' }
  | { outcome: 'success'; value: T };

export interface BusinessDayFallbackResult<T> {
  actualDate: Date;
  daysBack: number;
  value: T;
}

export class BusinessDayFallbackExhaustedError extends Error {
  readonly lastAttemptDate: Date;
  readonly lastError: Error | undefined;
  readonly maxAttempts: number;
  readonly requestedDate: Date;

  constructor(params: {
    lastAttemptDate: Date;
    lastError?: Error | undefined;
    maxAttempts: number;
    requestedDate: Date;
  }) {
    const message = `Business-day fallback exhausted after ${params.maxAttempts} attempts`;
    super(message);
    this.name = 'BusinessDayFallbackExhaustedError';
    this.lastAttemptDate = params.lastAttemptDate;
    this.lastError = params.lastError;
    this.maxAttempts = params.maxAttempts;
    this.requestedDate = params.requestedDate;
  }
}

export async function fetchWithBusinessDayFallback<T>(
  requestedDate: Date,
  params: {
    fetchForDate: (context: BusinessDayFallbackContext) => Promise<BusinessDayFetchAttemptResult<T>>;
    maxAttempts?: number | undefined;
  }
): Promise<Result<BusinessDayFallbackResult<T>, Error>> {
  const maxAttempts = params.maxAttempts ?? 7;
  if (maxAttempts < 1) {
    return err(new Error(`Business-day fallback maxAttempts must be at least 1, got ${maxAttempts}`));
  }

  const requestedDateCopy = new Date(requestedDate);
  let candidateDate = new Date(requestedDate);
  let lastError: Error | undefined;

  for (let attemptIndex = 0; attemptIndex < maxAttempts; attemptIndex++) {
    const context: BusinessDayFallbackContext = {
      attemptIndex,
      attemptNumber: attemptIndex + 1,
      candidateDate: new Date(candidateDate),
      isOriginalDate: attemptIndex === 0,
      maxAttempts,
      requestedDate: requestedDateCopy,
    };

    const attemptResult = await params.fetchForDate(context);

    if (attemptResult.outcome === 'success') {
      return ok({
        actualDate: new Date(candidateDate),
        daysBack: attemptIndex,
        value: attemptResult.value,
      });
    }

    if (attemptResult.outcome === 'fail') {
      return err(attemptResult.error);
    }

    lastError = attemptResult.error;
    if (attemptIndex < maxAttempts - 1) {
      candidateDate = subtractUtcDays(candidateDate, 1);
    }
  }

  return err(
    new BusinessDayFallbackExhaustedError({
      lastAttemptDate: candidateDate,
      lastError,
      maxAttempts,
      requestedDate: requestedDateCopy,
    })
  );
}

function subtractUtcDays(date: Date, days: number): Date {
  const result = new Date(date);
  result.setUTCDate(result.getUTCDate() - days);
  return result;
}
