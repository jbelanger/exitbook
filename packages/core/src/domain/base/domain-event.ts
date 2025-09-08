import { Data } from 'effect';
import { v4 as uuidv4 } from 'uuid';

export abstract class DomainEvent extends Data.Class<{
  readonly aggregateId: string;
  readonly eventId: string;
  readonly timestamp: Date;
  readonly version: number;
}> {
  abstract readonly _tag: string;

  protected constructor(data: {
    aggregateId: string;
    eventId?: string;
    timestamp?: Date;
    version?: number;
  }) {
    super({
      aggregateId: data.aggregateId,
      eventId: data.eventId || uuidv4(),
      timestamp: data.timestamp || new Date(),
      version: data.version || 1,
    });
  }
}
