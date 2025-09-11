import type { DomainEvent } from '@exitbook/core';
import type { PositionedEvent } from '@exitbook/platform-event-store';

export type LivePattern =
  | string
  | { category?: string; stream?: string; type?: DomainEvent['_tag'] };

export const matchesPattern = (e: DomainEvent, pattern: LivePattern): boolean => {
  const streamName = (e as PositionedEvent).streamName as string | undefined;
  if (typeof pattern === 'string') {
    if (!streamName) return e._tag === pattern; // allow type-only pattern
    if (streamName === pattern) return true;
    const dash = streamName.indexOf('-');
    if (dash > 0 && streamName.slice(0, dash) === pattern) return true; // category
    return e._tag === pattern;
  }
  if (pattern.stream && streamName === pattern.stream) return true;
  if (pattern.category && streamName?.startsWith(`${pattern.category}-`)) return true;
  if (pattern.type && e._tag === pattern.type) return true;
  return false;
};
