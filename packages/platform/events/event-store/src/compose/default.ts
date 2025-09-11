import { DatabaseDefault } from '@exitbook/platform-database';
import { Layer, Effect } from 'effect';

import { EventStoreDatabaseTag, EventStoreTag } from '..';
import { makePgEventStoreDatabase } from '../adapters/pg-eventstore-db';
import { makeEventStore } from '../impl/make-event-store';

// Main EventStore layer - depends on EventStoreDatabase
export const EventStoreLive = Layer.effect(
  EventStoreTag,
  Effect.map(EventStoreDatabaseTag, makeEventStore),
);

// Layer that provides EventStoreDatabase from DatabasePool
export const PgEventStoreDatabaseLive = Layer.effect(
  EventStoreDatabaseTag,
  makePgEventStoreDatabase(),
);

// Default production composition - EventStore + PostgreSQL adapter + Database pool
export const EventStoreDefault = Layer.provide(
  EventStoreLive,
  Layer.provide(PgEventStoreDatabaseLive, DatabaseDefault),
);
