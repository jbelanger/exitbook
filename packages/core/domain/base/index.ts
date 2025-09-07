// Minimal domain base primitives (extend to your liking)
export type UUID = string;

export abstract class Entity<TProps> {
  constructor(public readonly id: UUID, public readonly props: Readonly<TProps>) {}
}

export abstract class AggregateRoot<TProps> extends Entity<TProps> {
  private _events: unknown[] = [];
  protected raise(event: unknown) { this._events.push(event); }
  pullEvents(): unknown[] { const e = this._events; this._events = []; return e; }
}
