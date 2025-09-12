import type { DomainEvent } from '@exitbook/core';
import BigNumber from 'bignumber.js';
import { Effect, Data, Schema } from 'effect';

export class EventCodecError extends Data.TaggedError('EventCodecError')<{
  readonly eventType: string;
  readonly reason: string;
}> {}

// Event codec registry for serialization/deserialization
export interface EventCodec<T extends DomainEvent> {
  readonly decode: (
    data: unknown,
    metadata: {
      eventId: string;
      streamName: string;
      streamVersion: number;
      timestamp: Date;
    },
  ) => Effect.Effect<T, EventCodecError>;
  readonly encode: (event: T) => Effect.Effect<unknown, EventCodecError>;
}

export class EventRegistry {
  private codecs = new Map<string, EventCodec<DomainEvent>>();

  register<T extends DomainEvent>(eventType: string, codec: EventCodec<T>): void {
    this.codecs.set(eventType, codec as unknown as EventCodec<DomainEvent>);
  }

  encode<T extends DomainEvent>(event: T): Effect.Effect<unknown, EventCodecError> {
    const codec = this.codecs.get(event._tag);
    if (!codec) {
      return Effect.succeed(this.defaultEncode(event));
    }
    return codec.encode(event);
  }

  decode(
    eventType: string,
    data: unknown,
    metadata: {
      eventId: string;
      streamName: string;
      streamVersion: number;
      timestamp: Date;
    },
  ): Effect.Effect<DomainEvent, EventCodecError> {
    const codec = this.codecs.get(eventType);
    if (!codec) {
      return Effect.fail(
        new EventCodecError({
          eventType,
          reason: `No codec registered for event type: ${eventType}`,
        }),
      );
    }
    return codec.decode(data, metadata);
  }

  deserializeValue(value: unknown): unknown {
    if (typeof value === 'object' && value !== null) {
      const obj = value as Record<string, unknown>;
      if (obj['_type'] === 'BigNumber') {
        return new BigNumber(obj['value'] as string);
      }
      if (obj['_type'] === 'Date') {
        return new Date(obj['value'] as string);
      }
      if (Array.isArray(value)) {
        return value.map((item) => this.deserializeValue(item));
      }
      if (value.constructor === Object) {
        const result: Record<string, unknown> = {};
        for (const [key, val] of Object.entries(value)) {
          result[key] = this.deserializeValue(val);
        }
        return result;
      }
    }
    return value;
  }

  private defaultEncode(event: DomainEvent & { data?: unknown }): unknown {
    return this.serializeValue(event.data ?? event);
  }

  private serializeValue(value: unknown): unknown {
    if (BigNumber.isBigNumber(value)) {
      return { _type: 'BigNumber', value: value.toString() };
    }
    if (value instanceof Date) {
      return { _type: 'Date', value: value.toISOString() };
    }
    if (Array.isArray(value)) {
      return value.map((item) => this.serializeValue(item));
    }
    if (value && typeof value === 'object' && value.constructor === Object) {
      const result: Record<string, unknown> = {};
      for (const [key, val] of Object.entries(value)) {
        result[key] = this.serializeValue(val);
      }
      return result;
    }
    return value;
  }
}

// Global event registry instance
export const eventRegistry = new EventRegistry();

// Helper to create schema-based codecs
export const makeSchemaCodec = <T extends DomainEvent & { data: unknown }>(
  eventType: string,
  schema: Schema.Schema<T['data'], unknown>,
): EventCodec<T> => ({
  decode: (data: unknown, metadata) =>
    Effect.try({
      catch: (error) =>
        new EventCodecError({
          eventType: eventType,
          reason: `Failed to decode event data: ${String(error)}`,
        }),
      try: () => {
        const decodedData = Schema.decodeUnknown(schema)(data);
        // Use the registered event type instead of parsing from stream name
        return {
          _tag: eventType,
          aggregateId: metadata.streamName.split('-').slice(1).join('-'),
          data: decodedData,
          eventId: metadata.eventId,
          timestamp: metadata.timestamp,
          version: metadata.streamVersion,
        } as T;
      },
    }),

  encode: (event: T) =>
    Effect.try({
      catch: (error) =>
        new EventCodecError({
          eventType: event._tag,
          reason: `Failed to encode event data: ${String(error)}`,
        }),
      try: () => Schema.encodeUnknown(schema)(event.data),
    }),
});
