import { DbPoolLive, DbClientWithTelemetryLive, DbClient } from '@exitbook/platform-database';
import { Layer, Effect } from 'effect';
import type { Kysely } from 'kysely';

import { EventStoreDatabaseTag, EventStoreTag, OutboxDatabaseTag } from '..';
import {
  makePgEventStoreDatabase,
  makePgOutboxDatabase,
  KyselyTag as EventStoreKyselyTag,
  type EventStoreDB,
} from '../internal/adapters/pg-eventstore-db';
import { makeEventStore } from '../internal/impl/make-event-store';
import { MonitoredEventStoreLive } from '../monitoring';

/**
 * Clean composition layers with proper dependency flow:
 * Pool → Kysely → {EventStoreDB, OutboxDB} → EventStore → OutboxProcessor → Daemon
 */

// Re-tag layer that provides typed Kysely instance from generic DbClient
const EventStoreKyselyRetagLive = Layer.effect(
  EventStoreKyselyTag,
  Effect.gen(function* () {
    const db = yield* DbClient;
    return db as Kysely<EventStoreDB>;
  }),
);

// Core EventStore layer - depends on EventStoreDatabase
export const EventStoreLive = Layer.effect(
  EventStoreTag,
  Effect.map(EventStoreDatabaseTag, makeEventStore),
);

// Database adapter layers - both depend on typed Kysely
export const PgEventStoreDatabaseLive = Layer.effect(
  EventStoreDatabaseTag,
  makePgEventStoreDatabase,
);

export const PgOutboxDatabaseLive = Layer.effect(OutboxDatabaseTag, makePgOutboxDatabase);

// Shared Kysely layer using the new centralized client with telemetry
export const EventStoreKyselyLive = Layer.provide(
  EventStoreKyselyRetagLive,
  Layer.provide(DbClientWithTelemetryLive, DbPoolLive),
);

// EventStore stack - just the core event store functionality
const EventStoreStackBase = Layer.provide(
  EventStoreLive,
  Layer.provide(PgEventStoreDatabaseLive, EventStoreKyselyLive),
);

// Monitored EventStore stack - wraps with telemetry
export const EventStoreStack = Layer.provide(MonitoredEventStoreLive, EventStoreStackBase);

// EventStore with Outbox stack - adds outbox processing capabilities
export const EventStoreWithOutboxStack = Layer.mergeAll(
  EventStoreStack,
  Layer.provide(PgOutboxDatabaseLive, EventStoreKyselyLive),
);

// Aliases for backward compatibility
export const EventStoreDefault = EventStoreStack;
export const EventStoreWithOutboxDefault = EventStoreWithOutboxStack;
