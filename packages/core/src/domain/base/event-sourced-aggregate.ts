import type { Option } from 'effect';
import { Data } from 'effect';

import type { DomainEvent } from './domain-event.js';

export abstract class EventSourcedAggregate extends Data.Class<{
  readonly events: readonly DomainEvent[];
  readonly version: number;
}> {
  protected abstract get aggregateId(): Option.Option<string>;

  getUncommittedEvents(): readonly DomainEvent[] {
    return this.events.slice(this.version);
  }

  markEventsAsCommitted(): this {
    return this.copy({ version: this.events.length });
  }

  protected copy(updates: Partial<unknown>): this {
    const Constructor = this.constructor as new (data: unknown) => this;
    return new Constructor({ ...this, ...updates });
  }

  protected addEvent(event: DomainEvent): this {
    return this.copy({
      events: [...this.events, event]
    });
  }
}