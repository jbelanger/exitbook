import type { CanadaTaxInputEvent } from './canada-tax-types.js';

function getEventPriority(kind: CanadaTaxInputEvent['kind']): number {
  switch (kind) {
    case 'transfer-out':
      return 0;
    case 'disposition':
      return 1;
    case 'acquisition':
      return 2;
    case 'transfer-in':
      return 3;
    case 'fee-adjustment':
      return 4;
    case 'superficial-loss-adjustment':
      return 5;
  }
}

export function compareCanadaEvents(
  left: Pick<CanadaTaxInputEvent, 'eventId' | 'kind' | 'timestamp' | 'transactionId'>,
  right: Pick<CanadaTaxInputEvent, 'eventId' | 'kind' | 'timestamp' | 'transactionId'>
): number {
  const timestampDiff = left.timestamp.getTime() - right.timestamp.getTime();
  if (timestampDiff !== 0) return timestampDiff;

  const transactionDiff = left.transactionId - right.transactionId;
  if (transactionDiff !== 0) return transactionDiff;

  const priorityDiff = getEventPriority(left.kind) - getEventPriority(right.kind);
  if (priorityDiff !== 0) return priorityDiff;

  return left.eventId.localeCompare(right.eventId);
}

export function sortCanadaEvents(events: CanadaTaxInputEvent[]): CanadaTaxInputEvent[] {
  return [...events].sort(compareCanadaEvents);
}
