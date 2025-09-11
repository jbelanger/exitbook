import { EventStoreTag } from '@exitbook/platform-event-store';
import { MessageBusProducer } from '@exitbook/platform-messaging';
import { Layer, Effect, Ref } from 'effect';

import { CheckpointStore } from '../checkpoint-store';
import { CheckpointError } from '../errors';
import { UnifiedEventBus, makeUnifiedEventBus } from '../event-bus';

export const CheckpointStoreTest = Layer.effect(
  CheckpointStore,
  Effect.gen(function* () {
    const table = yield* Ref.make(new Map<string, bigint>());
    return {
      load: (k) =>
        Ref.get(table).pipe(
          Effect.map((m) => m.get(k)),
          Effect.mapError(() => new CheckpointError({ reason: 'Test checkpoint store error' })),
        ),
      save: (k, p) =>
        Ref.update(table, (m) => new Map(m).set(k, p)).pipe(
          Effect.asVoid,
          Effect.mapError(() => new CheckpointError({ reason: 'Test checkpoint store error' })),
        ),
      saveWithMetadata: (k, p) =>
        Ref.update(table, (m) => new Map(m).set(k, p)).pipe(
          Effect.asVoid,
          Effect.mapError(() => new CheckpointError({ reason: 'Test checkpoint store error' })),
        ),
    };
  }),
);

export const UnifiedEventBusTestLive = Layer.effect(
  UnifiedEventBus,
  Effect.gen(function* () {
    const es = yield* EventStoreTag;
    const prod = yield* MessageBusProducer;
    const cp = yield* CheckpointStore;
    const ueb = yield* makeUnifiedEventBus(es, prod, cp);
    return ueb;
  }),
);

// Note: Import test layers from respective packages when available
// export const UnifiedEventBusTest = Layer.provide(
//   UnifiedEventBusTestLive,
//   Layer.mergeAll(EventStoreTest, MessageBusTest, CheckpointStoreTest),
// );
