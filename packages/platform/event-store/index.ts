// EventStore facade (append/read, snapshots, outbox, idempotency)
export interface EventRecord { streamId: string; version: number; type: string; data: unknown; }
export interface EventStore {
  read(streamId: string): Promise<EventRecord[]>;
  append(streamId: string, expectedVersion: number, events: EventRecord[]): Promise<void>;
}
