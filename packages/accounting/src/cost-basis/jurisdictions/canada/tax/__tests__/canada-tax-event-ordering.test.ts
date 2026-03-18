import { describe, expect, it } from 'vitest';

import { compareCanadaEvents, sortCanadaEvents } from '../canada-tax-event-ordering.js';
import type { CanadaTaxInputEvent } from '../canada-tax-types.js';

type EventLike = Pick<CanadaTaxInputEvent, 'eventId' | 'kind' | 'timestamp' | 'transactionId'>;

function makeEvent(
  kind: CanadaTaxInputEvent['kind'],
  timestamp: string,
  transactionId: number,
  eventId = 'evt-1'
): EventLike {
  return { kind, timestamp: new Date(timestamp), transactionId, eventId };
}

describe('compareCanadaEvents', () => {
  it('should sort by timestamp first', () => {
    const earlier = makeEvent('acquisition', '2024-01-01T00:00:00Z', 1);
    const later = makeEvent('acquisition', '2024-01-02T00:00:00Z', 1);

    expect(compareCanadaEvents(earlier, later)).toBeLessThan(0);
    expect(compareCanadaEvents(later, earlier)).toBeGreaterThan(0);
  });

  it('should sort by transactionId when timestamps are equal', () => {
    const lower = makeEvent('acquisition', '2024-01-01T00:00:00Z', 1);
    const higher = makeEvent('acquisition', '2024-01-01T00:00:00Z', 2);

    expect(compareCanadaEvents(lower, higher)).toBeLessThan(0);
    expect(compareCanadaEvents(higher, lower)).toBeGreaterThan(0);
  });

  it('should sort by event kind priority when timestamp and transactionId are equal', () => {
    const transferOut = makeEvent('transfer-out', '2024-01-01T00:00:00Z', 1);
    const disposition = makeEvent('disposition', '2024-01-01T00:00:00Z', 1);
    const acquisition = makeEvent('acquisition', '2024-01-01T00:00:00Z', 1);
    const transferIn = makeEvent('transfer-in', '2024-01-01T00:00:00Z', 1);
    const feeAdj = makeEvent('fee-adjustment', '2024-01-01T00:00:00Z', 1);
    const slAdj = makeEvent('superficial-loss-adjustment', '2024-01-01T00:00:00Z', 1);

    // transfer-out (0) < disposition (1)
    expect(compareCanadaEvents(transferOut, disposition)).toBeLessThan(0);
    // disposition (1) < acquisition (2)
    expect(compareCanadaEvents(disposition, acquisition)).toBeLessThan(0);
    // acquisition (2) < transfer-in (3)
    expect(compareCanadaEvents(acquisition, transferIn)).toBeLessThan(0);
    // transfer-in (3) < fee-adjustment (4)
    expect(compareCanadaEvents(transferIn, feeAdj)).toBeLessThan(0);
    // fee-adjustment (4) < superficial-loss-adjustment (5)
    expect(compareCanadaEvents(feeAdj, slAdj)).toBeLessThan(0);
  });

  it('should sort by eventId as tiebreaker', () => {
    const evtA = makeEvent('acquisition', '2024-01-01T00:00:00Z', 1, 'evt-a');
    const evtB = makeEvent('acquisition', '2024-01-01T00:00:00Z', 1, 'evt-b');

    expect(compareCanadaEvents(evtA, evtB)).toBeLessThan(0);
    expect(compareCanadaEvents(evtB, evtA)).toBeGreaterThan(0);
  });

  it('should return 0 for identical events', () => {
    const event = makeEvent('acquisition', '2024-01-01T00:00:00Z', 1, 'evt-1');
    expect(compareCanadaEvents(event, event)).toBe(0);
  });
});

describe('sortCanadaEvents', () => {
  it('should return sorted copy without mutating input', () => {
    const events = [
      makeEvent('acquisition', '2024-01-02T00:00:00Z', 2, 'evt-2'),
      makeEvent('disposition', '2024-01-01T00:00:00Z', 1, 'evt-1'),
    ] as CanadaTaxInputEvent[];

    const originalOrder = events.map((e) => e.eventId);
    const sorted = sortCanadaEvents(events);

    expect(sorted[0]!.eventId).toBe('evt-1');
    expect(sorted[1]!.eventId).toBe('evt-2');
    expect(events.map((e) => e.eventId)).toEqual(originalOrder);
  });

  it('should sort empty array', () => {
    expect(sortCanadaEvents([])).toEqual([]);
  });
});
