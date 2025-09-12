import { EventStoreDefault, EventStoreTag } from '@exitbook/platform-event-store';
import { MessageBusDefault, MessageBusProducerTag } from '@exitbook/platform-messaging';
import { Layer, Effect } from 'effect';

import { makePgCheckpointStore } from '../adapters/pg-checkpoint-store';
import { CheckpointStoreTag } from '../checkpoint-store';
import { UnifiedEventBus, makeUnifiedEventBus } from '../event-bus';

// CheckpointStore layer using Kysely with DatabasePool
export const CheckpointStoreLive = Layer.effect(CheckpointStoreTag, makePgCheckpointStore());

export const UnifiedEventBusLive = Layer.effect(
  UnifiedEventBus,
  Effect.gen(function* () {
    const es = yield* EventStoreTag;
    const prod = yield* MessageBusProducerTag;
    const cp = yield* CheckpointStoreTag;
    const ueb = yield* makeUnifiedEventBus(es, prod, cp);
    return ueb;
  }),
);

export const UnifiedEventBusDefault = Layer.provide(
  UnifiedEventBusLive,
  Layer.mergeAll(EventStoreDefault, MessageBusDefault, CheckpointStoreLive),
);
