import { CloudEvents, topic } from '@exitbook/platform-messaging';

import type { StoredEvent, OutboxEntryData } from '../port';

/**
 * Creates outbox entries from stored events by converting them to CloudEvents.
 * This separates CloudEvent formatting concerns from the core EventStore logic.
 */
export const createOutboxEntries = (events: readonly StoredEvent[]): readonly OutboxEntryData[] => {
  return events.map((event) => {
    // Extract metadata for tracking
    const metadata = event.metadata as Record<string, unknown>;
    const topicName = topic(event.category, event.event_type, `v${event.event_schema_version}`);

    // Create CloudEvent using convenience API with all the specific details
    const ce = CloudEvents.create(topicName, event.event_data, {
      ...metadata,
      id: event.event_id,
      time: event.created_at,
    });

    return {
      category: event.category,
      cloudevent: ce,
      event_id: event.event_id,
      event_position: BigInt(event.global_position || 0),
      event_schema_version: event.event_schema_version,
      event_type: event.event_type,
      status: 'PENDING' as const,
      stream_name: event.stream_name,
    };
  });
};
