import { DatabaseDefault } from '@exitbook/platform-database';
import { Layer, Effect } from 'effect';

import { EventStoreDatabaseTag, EventStoreTag, OutboxDatabaseTag } from '..';
import {
  KyselyLive,
  makePgEventStoreDatabase,
  makePgOutboxDatabase,
} from '../adapters/pg-eventstore-db';
import { makeEventStore } from '../impl/make-event-store';

/**
 * Clean composition layers with proper dependency flow:
 * Pool → Kysely → {EventStoreDB, OutboxDB} → EventStore → OutboxProcessor → Daemon
 */

// Core EventStore layer - depends on EventStoreDatabase
export const EventStoreLive = Layer.effect(
  EventStoreTag,
  Effect.map(EventStoreDatabaseTag, makeEventStore),
);

// Database adapter layers - both depend on shared Kysely
export const PgEventStoreDatabaseLive = Layer.effect(
  EventStoreDatabaseTag,
  makePgEventStoreDatabase(),
);

export const PgOutboxDatabaseLive = Layer.effect(OutboxDatabaseTag, makePgOutboxDatabase());

// Shared Kysely layer with Database dependency
export const EventStoreKyselyLive = Layer.provide(KyselyLive, DatabaseDefault);

// EventStore stack - just the core event store functionality
export const EventStoreStack = Layer.provide(
  EventStoreLive,
  Layer.provide(PgEventStoreDatabaseLive, EventStoreKyselyLive),
);

// EventStore with Outbox stack - adds outbox processing capabilities
export const EventStoreWithOutboxStack = Layer.mergeAll(
  EventStoreStack,
  Layer.provide(PgOutboxDatabaseLive, EventStoreKyselyLive),
);

// Aliases for backward compatibility
export const EventStoreDefault = EventStoreStack;
export const EventStoreWithOutboxDefault = EventStoreWithOutboxStack;
