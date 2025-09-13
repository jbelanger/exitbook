import { DbPoolLive, DbClientWithTelemetryLive, DbClient } from '@exitbook/platform-database';
import { EventStoreDefault, EventStoreTag } from '@exitbook/platform-event-store';
import { MessageBusDefault, MessageBusProducerTag } from '@exitbook/platform-messaging';
import { Layer, Effect } from 'effect';
import type { Kysely } from 'kysely';

import {
  makePgCheckpointStore,
  KyselyTag as CheckpointKyselyTag,
  type CheckpointStoreDB,
} from '../adapters/pg-checkpoint-store';
import { CheckpointStoreTag } from '../checkpoint-store';
import { UnifiedEventBusTag, makeUnifiedEventBus } from '../event-bus';

// Re-tag layer that provides typed Kysely instance from generic DbClient
const CheckpointKyselyRetagLive = Layer.effect(
  CheckpointKyselyTag,
  Effect.map(DbClient, (db) => db as Kysely<CheckpointStoreDB>),
);

// CheckpointStore layer using the typed Kysely
export const CheckpointStoreLive = Layer.effect(CheckpointStoreTag, makePgCheckpointStore);

export const UnifiedEventBusLive = Layer.effect(
  UnifiedEventBusTag,
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
  Layer.mergeAll(
    EventStoreDefault,
    MessageBusDefault,
    Layer.provide(
      CheckpointStoreLive,
      Layer.provide(
        CheckpointKyselyRetagLive,
        Layer.provide(DbClientWithTelemetryLive, DbPoolLive),
      ),
    ),
  ),
);
