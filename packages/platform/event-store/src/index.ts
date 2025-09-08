// EventStore facade (append/read, snapshots, outbox, idempotency)
export interface EventRecord { data: unknown; streamId: string; type: string; version: number; }
export interface EventStore {
  append(streamId: string, expectedVersion: number, events: EventRecord[]): Promise<void>;
  read(streamId: string): Promise<EventRecord[]>;
}
