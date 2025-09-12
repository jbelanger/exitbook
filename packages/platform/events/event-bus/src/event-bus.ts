import type { DomainEvent } from '@exitbook/core';
import type { PositionedEvent, EventStore, StreamName } from '@exitbook/platform-event-store';
import type { MessageBusProducer } from '@exitbook/platform-messaging';
import { Effect, Stream, PubSub, Duration, Context, Chunk, Option } from 'effect';

import type { CheckpointStore } from './checkpoint-store';
import { AppendError, SubscriptionError } from './errors';
import { matchesPattern, type LivePattern } from './pattern';

const DEFAULT_BATCH_SIZE = 500;
const DEFAULT_CHECKPOINT_BATCH = 200;

const toBigInt = (p: bigint | number | undefined): bigint | undefined =>
  p === undefined ? undefined : typeof p === 'number' ? BigInt(p) : p;

// Namespace keys for checkpoints following ADR specification
const nsKeyAll = (id: string) => `all:${id}`;
const nsKeyCat = (id: string, category: string) => `cat:${category}:${id}`;
const nsKeyStr = (id: string, stream: string) => `stream:${stream}:${id}`;

export interface UnifiedEventBus {
  append: (
    streamName: StreamName,
    events: readonly DomainEvent[],
    expectedVersion: number,
    options?: { idempotencyKey?: string; metadata?: Record<string, unknown> },
  ) => Effect.Effect<
    { appended: readonly PositionedEvent[]; lastPosition: bigint; lastVersion: number },
    AppendError
  >;

  publishExternal: (
    topic: string,
    event: DomainEvent,
    options?: { correlationId?: string; userId?: string },
  ) => Effect.Effect<void, unknown>;

  read: (
    streamName: StreamName,
    fromVersion?: number,
  ) => Stream.Stream<DomainEvent, SubscriptionError>;

  subscribeAll: (
    subscriptionId: string,
    fromPosition?: bigint,
  ) => Stream.Stream<PositionedEvent, SubscriptionError>;

  subscribeCategory: (
    subscriptionId: string,
    category: string,
    fromPosition?: bigint,
  ) => Stream.Stream<PositionedEvent, SubscriptionError>;

  subscribeLive: (pattern: LivePattern) => Stream.Stream<DomainEvent, never>;

  subscribeStream: (
    subscriptionId: string,
    streamName: StreamName,
    fromVersion?: number,
  ) => Stream.Stream<DomainEvent, SubscriptionError>;
}

export const UnifiedEventBusTag = Context.GenericTag<UnifiedEventBus>('@platform/UnifiedEventBus');

export const makeUnifiedEventBus = (
  eventStore: EventStore,
  producer: MessageBusProducer,
  checkpoints: CheckpointStore,
) =>
  Effect.gen(function* () {
    const live = yield* PubSub.unbounded<DomainEvent>();

    const pollBackoff = (attempt: number) => {
      const base = 100; // ms
      const max = 5000; // ms
      const jitter = Math.floor(Math.random() * 50);
      const wait = Math.min(base * 2 ** attempt + jitter, max);
      return Duration.millis(wait);
    };

    // Helper to create checkpoint-aware subscription streams
    const createSubscription = <T>(
      subscriptionKey: string,
      startPosition: bigint | undefined,
      reader: (cursor: bigint, batchSize: number) => Effect.Effect<readonly T[], unknown>,
      positionExtractor: (item: T) => bigint,
    ): Stream.Stream<T, SubscriptionError> =>
      Stream.unwrap(
        Effect.gen(function* () {
          const savedPosition = yield* checkpoints
            .load(subscriptionKey)
            .pipe(
              Effect.mapError(
                (e) => new SubscriptionError({ reason: `Failed to load checkpoint: ${String(e)}` }),
              ),
            );
          const fromPosition = toBigInt(savedPosition) ?? startPosition ?? 0n;
          let processedCount = 0;

          return Stream.unfoldChunkEffect(fromPosition, (cursor) =>
            Effect.gen(function* () {
              const batch = yield* reader(cursor, DEFAULT_BATCH_SIZE).pipe(
                Effect.mapError(
                  (e) => new SubscriptionError({ reason: `Failed to read events: ${String(e)}` }),
                ),
              );

              if (batch.length === 0) {
                yield* Effect.sleep(pollBackoff(0));
                return Option.none();
              }

              const chunk = Chunk.fromIterable(batch);
              const lastPosition = positionExtractor(batch[batch.length - 1]!);

              processedCount += batch.length;

              // Save checkpoint every DEFAULT_CHECKPOINT_BATCH events
              if (processedCount >= DEFAULT_CHECKPOINT_BATCH) {
                yield* checkpoints.save(subscriptionKey, lastPosition).pipe(
                  Effect.mapError(
                    (e) =>
                      new SubscriptionError({
                        reason: `Failed to save checkpoint: ${String(e)}`,
                      }),
                  ),
                );
                processedCount = 0;
              }

              return Option.some([chunk, lastPosition + 1n] as const);
            }),
          );
        }),
      );

    return {
      append: (
        streamName: StreamName,
        events: readonly DomainEvent[],
        expected: number,
        opts?: { idempotencyKey?: string; metadata?: Record<string, unknown> },
      ) =>
        eventStore.appendAndReturn(streamName, events, expected, opts).pipe(
          Effect.tap(({ appended }) =>
            Effect.forEach(appended, (e) => PubSub.publish(live, e)).pipe(Effect.asVoid),
          ),
          Effect.mapError(
            (e) => new AppendError({ reason: `Failed to append events: ${String(e)}` }),
          ),
        ),

      publishExternal: (
        topic: string,
        event: DomainEvent,
        options?: { correlationId?: string; userId?: string },
      ) =>
        producer.publish(topic, event, {
          ...(options?.correlationId && { correlationId: options.correlationId }),
          ...(options?.userId && { userId: options.userId }),
          key: event.eventId,
        }),

      read: (streamName: StreamName, from = 0) =>
        Stream.fromEffect(eventStore.readStream(streamName, from)).pipe(
          Stream.flatMap(Stream.fromIterable),
          Stream.mapError(
            (e) => new SubscriptionError({ reason: `Failed to read stream: ${String(e)}` }),
          ),
        ),

      subscribeAll: (subscriptionId: string, fromPosition?: bigint) =>
        createSubscription(
          nsKeyAll(subscriptionId),
          fromPosition,
          (cursor, batchSize) => eventStore.readAll(cursor, batchSize),
          (event) => event.position,
        ),

      subscribeCategory: (subscriptionId: string, category: string, fromPosition?: bigint) =>
        createSubscription(
          nsKeyCat(subscriptionId, category),
          fromPosition,
          (cursor, batchSize) => eventStore.readCategory(category, cursor, batchSize),
          (event) => event.position,
        ),

      subscribeLive: (pattern: LivePattern) =>
        Stream.unwrap(
          Effect.scoped(
            Effect.gen(function* () {
              const subscription = yield* PubSub.subscribe(live);

              return Stream.fromQueue(subscription).pipe(
                Stream.filter((event) => matchesPattern(event, pattern)),
              );
            }),
          ),
        ),

      subscribeStream: (subscriptionId: string, streamName: StreamName, fromVersion?: number) =>
        Stream.unwrap(
          Effect.gen(function* () {
            const savedVersion = yield* checkpoints.load(nsKeyStr(subscriptionId, streamName)).pipe(
              Effect.map((pos) => (pos ? Number(pos) : undefined)),
              Effect.mapError(
                (e) => new SubscriptionError({ reason: `Failed to load checkpoint: ${String(e)}` }),
              ),
            );
            const startVersion = savedVersion ?? fromVersion ?? 0;
            let processedCount = 0;

            return Stream.unfoldChunkEffect(startVersion, (cursor) =>
              Effect.gen(function* () {
                const events = yield* eventStore
                  .readStream(streamName, cursor)
                  .pipe(
                    Effect.mapError(
                      (e) =>
                        new SubscriptionError({ reason: `Failed to read stream: ${String(e)}` }),
                    ),
                  );

                if (events.length === 0) {
                  yield* Effect.sleep(pollBackoff(0));
                  return Option.none();
                }

                const chunk = Chunk.fromIterable(events);
                const lastVersion = cursor + events.length;

                processedCount += events.length;

                // Save checkpoint every DEFAULT_CHECKPOINT_BATCH events
                if (processedCount >= DEFAULT_CHECKPOINT_BATCH) {
                  yield* checkpoints
                    .save(nsKeyStr(subscriptionId, streamName), BigInt(lastVersion))
                    .pipe(
                      Effect.mapError(
                        (e) =>
                          new SubscriptionError({
                            reason: `Failed to save checkpoint: ${String(e)}`,
                          }),
                      ),
                    );
                  processedCount = 0;
                }

                return Option.some([chunk, lastVersion] as const);
              }),
            );
          }),
        ),
    } satisfies UnifiedEventBus;
  });
