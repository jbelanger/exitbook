import { EventStoreDefault, EventStoreTag } from '@exitbook/platform-event-store';
import { MessageBusProducerLive, MessageBusProducer } from '@exitbook/platform-messaging';
import { Layer, Effect } from 'effect';

import { makePgCheckpointStore } from '../adapters/pg-checkpoint-store';
import { CheckpointStore } from '../checkpoint-store';
import { UnifiedEventBus, makeUnifiedEventBus } from '../event-bus';

// CheckpointStore layer using Kysely with DatabasePool
export const CheckpointStoreLive = Layer.effect(CheckpointStore, makePgCheckpointStore());

export const UnifiedEventBusLive = Layer.effect(
  UnifiedEventBus,
  Effect.gen(function* () {
    const es = yield* EventStoreTag;
    const prod = yield* MessageBusProducer;
    const cp = yield* CheckpointStore;
    const ueb = yield* makeUnifiedEventBus(es, prod, cp);
    return ueb;
  }),
);

export const UnifiedEventBusDefault = Layer.provide(
  UnifiedEventBusLive,
  Layer.mergeAll(EventStoreDefault, MessageBusProducerLive, CheckpointStoreLive),
);
