import { HeaderNames } from '../port';

/**
 * Event metadata interface for header mapping.
 * This is a minimal interface that doesn't depend on event-store.
 */
export interface EventMetadataForHeaders {
  readonly causationId?: string | undefined;
  readonly correlationId?: string | undefined;
  readonly source?: string | undefined;
  readonly timestamp: Date;
  readonly userId?: string | undefined;
}

/**
 * Creates message headers from event metadata.
 * This centralizes the mapping and ensures consistency across publishers.
 */
export const headersFromMetadata = (
  metadata: EventMetadataForHeaders,
  eventId: string,
): Record<string, string> => ({
  [HeaderNames.X_MESSAGE_ID]: eventId,
  [HeaderNames.X_TIMESTAMP]: metadata.timestamp.toISOString(),
  ...(metadata.causationId && { [HeaderNames.X_CAUSATION_ID]: metadata.causationId }),
  ...(metadata.correlationId && { [HeaderNames.X_CORRELATION_ID]: metadata.correlationId }),
  ...(metadata.userId && { [HeaderNames.X_USER_ID]: metadata.userId }),
  ...(metadata.source && { [HeaderNames.X_SOURCE]: metadata.source }),
});
