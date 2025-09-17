## Enhanced Infrastructure Implementation

### 1. Event Store with Outbox Pattern Support

```typescript
// src/infrastructure/event-store/event-store.service.ts
import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { InjectConnection } from 'nest-knexjs';
import { Knex } from 'knex';
import { Effect, Data, pipe, Schema } from 'effect';
import { Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { DomainEvent } from '../../@core/domain/base/domain-event.base';
import * as crypto from 'crypto';
import BigNumber from 'bignumber.js';

// Event Store Errors
export class SaveEventError extends Data.TaggedError('SaveEventError')<{
  readonly reason: string;
}> {}

export class ReadEventError extends Data.TaggedError('ReadEventError')<{
  readonly reason: string;
}> {}

export class IdempotencyError extends Data.TaggedError('IdempotencyError')<{
  readonly reason: string;
}> {}

export class OptimisticLockError extends Data.TaggedError(
  'OptimisticLockError',
)<{
  readonly aggregateId: string;
  readonly expectedVersion: number;
  readonly actualVersion: number;
}> {}

// Schema for event validation
const EventMetadataSchema = Schema.struct({
  userId: Schema.optional(Schema.string),
  correlationId: Schema.optional(Schema.string),
  causationId: Schema.optional(Schema.string),
  timestamp: Schema.Date,
  source: Schema.optional(Schema.string),
});

const StoredEventSchema = Schema.struct({
  id: Schema.number,
  event_id: Schema.string,
  aggregate_id: Schema.string,
  aggregate_type: Schema.string,
  event_type: Schema.string,
  event_schema_version: Schema.number,
  event_data: Schema.unknown,
  metadata: EventMetadataSchema,
  created_at: Schema.Date,
  stream_version: Schema.number,
});

export type StoredEvent = Schema.Schema.Type<typeof StoredEventSchema>;
export type EventMetadata = Schema.Schema.Type<typeof EventMetadataSchema>;

@Injectable()
export class EventStore implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(EventStore.name);
  private isConnected = false;

  constructor(
    @InjectConnection('write') private readonly writeDb: Knex,
    @InjectConnection('read') private readonly readDb: Knex,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  async onModuleInit() {
    await this.initializeEventStore();
    this.isConnected = true;
    this.logger.log('Event Store initialized');
  }

  async onModuleDestroy() {
    this.isConnected = false;
  }

  private async initializeEventStore() {
    const hasTable = await this.writeDb.schema.hasTable('event_store');
    if (!hasTable) {
      await this.createEventStoreTables();
    }
  }

  private async createEventStoreTables() {
    // Events table with timestamptz
    await this.writeDb.schema.createTable('event_store', (table) => {
      table.bigIncrements('id').primary();
      table.uuid('event_id').notNullable().unique();
      table.string('aggregate_id', 255).notNullable();
      table.string('aggregate_type', 100).notNullable();
      table.string('event_type', 100).notNullable();
      table.integer('event_schema_version').notNullable().defaultTo(1); // Schema version for upcasting
      table.jsonb('event_data').notNullable();
      table.jsonb('metadata').notNullable();
      table.integer('stream_version').notNullable(); // Position in aggregate stream
      table.timestamptz('created_at').defaultTo(this.writeDb.fn.now());

      // Indexes for performance
      table.index(['aggregate_id', 'stream_version']);
      table.index(['aggregate_type', 'created_at']);
      table.index('event_type');
      table.index('created_at');

      // Unique constraint for optimistic concurrency
      table.unique(['aggregate_id', 'stream_version']);

      // Data validation constraints
      table.check('stream_version >= 1', [], 'chk_stream_version_pos');
      table.check(
        "jsonb_typeof(event_data) = 'object'",
        [],
        'chk_event_data_obj',
      );
    });

    // Outbox table for CDC with proper constraints
    await this.writeDb.schema.createTable('event_outbox', (table) => {
      table.bigIncrements('id').primary();
      table.uuid('event_id').notNullable().unique(); // Prevent duplicates
      table.string('aggregate_id', 255).notNullable();
      table.string('aggregate_type', 100).notNullable();
      table.string('event_type', 100).notNullable();
      table.jsonb('payload').notNullable();
      table.jsonb('metadata').notNullable();
      table
        .enum('status', ['PENDING', 'PROCESSED', 'FAILED'])
        .defaultTo('PENDING');
      table.timestamptz('created_at').defaultTo(this.writeDb.fn.now());
      table.timestamptz('processed_at').nullable();

      table.index(['status', 'created_at']);

      // Add check constraint for payload type
      table.check(
        "jsonb_typeof(payload) = 'object'",
        [],
        'check_payload_is_object',
      );
    });

    // Snapshots table
    await this.writeDb.schema.createTable('event_snapshots', (table) => {
      table.bigIncrements('id').primary();
      table.string('aggregate_id', 255).notNullable();
      table.string('aggregate_type', 100).notNullable();
      table.integer('version').notNullable();
      table.integer('schema_version').notNullable().defaultTo(1);
      table.jsonb('data').notNullable();
      table.timestamptz('created_at').defaultTo(this.writeDb.fn.now());

      table.unique(['aggregate_id', 'version']);
      table.index(['aggregate_id', 'created_at']);
    });

    // Idempotency table
    await this.writeDb.schema.createTable('event_idempotency', (table) => {
      table.string('idempotency_key', 255).primary();
      table.uuid('event_id').notNullable();
      table.timestamptz('created_at').defaultTo(this.writeDb.fn.now());
      table.timestamptz('expires_at').notNullable();

      table.index('expires_at');
    });
  }

  public append(
    aggregateId: string,
    aggregateType: string,
    events: ReadonlyArray<DomainEvent>,
    expectedVersion: number,
    options?: {
      metadata?: Partial<EventMetadata>;
      idempotencyKey?: string;
    },
  ): Effect.Effect<
    void,
    OptimisticLockError | SaveEventError | IdempotencyError
  > {
    const program = Effect.tryPromise({
      try: () =>
        this.writeDb.transaction(async (trx) => {
          // Handle idempotency inside transaction
          if (options?.idempotencyKey) {
            const existing = await trx('event_idempotency')
              .where('idempotency_key', options.idempotencyKey)
              .where('expires_at', '>', new Date())
              .first();

            if (existing) {
              throw new IdempotencyError({
                reason: `Duplicate request with key: ${options.idempotencyKey}`,
              });
            }
          }

          // Check optimistic concurrency
          const currentVersion = await this.getCurrentVersion(aggregateId, trx);
          if (currentVersion !== expectedVersion) {
            throw new OptimisticLockError({
              aggregateId,
              expectedVersion,
              actualVersion: currentVersion,
            });
          }

          let streamVersion = expectedVersion;

          // Prepare events for storage
          const eventsToStore = events.map((event) => {
            streamVersion++;
            const eventData = {
              event_id: event.eventId,
              aggregate_id: aggregateId,
              aggregate_type: aggregateType,
              event_type: event._tag,
              event_schema_version: 1, // Track schema version for upcasting
              event_data: this.serializeEvent(event),
              metadata: {
                ...options?.metadata,
                timestamp: event.timestamp,
              },
              stream_version: streamVersion,
            };

            return eventData;
          });

          if (eventsToStore.length > 0) {
            // Store events
            await trx('event_store').insert(eventsToStore);

            // Add to outbox for CDC
            const outboxEntries = eventsToStore.map((e) => ({
              event_id: e.event_id,
              aggregate_id: e.aggregate_id,
              aggregate_type: e.aggregate_type,
              event_type: e.event_type,
              payload: e.event_data,
              metadata: e.metadata,
              status: 'PENDING',
            }));

            await trx('event_outbox').insert(outboxEntries);

            // Save idempotency key if provided
            if (options?.idempotencyKey) {
              const expiresAt = new Date();
              expiresAt.setHours(expiresAt.getHours() + 24);

              await trx('event_idempotency').insert({
                idempotency_key: options.idempotencyKey,
                event_id: eventsToStore[0].event_id,
                expires_at: expiresAt,
              });
            }
          }
        }),
      catch: async (error: any) => {
        // Unique violation?
        if (error?.code === '23505') {
          const table = String(error.table ?? '');
          const constraint = String(error.constraint ?? '');

          // outbox duplicate (typical default name: event_outbox_event_id_key)
          if (
            table.includes('event_outbox') ||
            constraint.includes('event_outbox') ||
            constraint.includes('event_id_key')
          ) {
            return new IdempotencyError({
              reason: 'Duplicate request (idempotency or outbox)',
            });
          }

          // idempotency table duplicates
          if (
            table.includes('event_idempotency') ||
            constraint.includes('event_idempotency')
          ) {
            return new IdempotencyError({
              reason: 'Duplicate request (idempotency or outbox)',
            });
          }

          // aggregate stream unique -> optimistic lock
          if (
            (table.includes('event_store') ||
              constraint.includes('event_store')) &&
            constraint.includes('aggregate_id') &&
            constraint.includes('stream_version')
          ) {
            const actual = await this.getCurrentVersion(aggregateId);
            return new OptimisticLockError({
              aggregateId,
              expectedVersion,
              actualVersion: actual,
            });
          }
        }

        if (
          error instanceof OptimisticLockError ||
          error instanceof IdempotencyError
        )
          return error;
        return new SaveEventError({
          reason: `Failed to append events: ${error}`,
        });
      },
    });

    // Publish events locally after transaction commits
    return pipe(
      program,
      Effect.tap(() =>
        Effect.sync(() => {
          for (const event of events) {
            this.eventEmitter.emit(`event.${event._tag}`, event);
          }
        }),
      ),
      Effect.asVoid,
    );
  }

  readStream(
    aggregateId: string,
    fromVersion: number = 0,
    toVersion?: number,
  ): Effect.Effect<DomainEvent[], ReadEventError> {
    return pipe(
      Effect.tryPromise({
        try: async () => {
          const query = this.readDb('event_store')
            .where('aggregate_id', aggregateId)
            .where('stream_version', '>', fromVersion)
            .orderBy('stream_version', 'asc');

          if (toVersion !== undefined) {
            query.where('stream_version', '<=', toVersion);
          }

          return await query;
        },
        catch: (error) =>
          new ReadEventError({ reason: `Failed to read stream: ${error}` }),
      }),
      Effect.flatMap((events) =>
        Effect.forEach(events, (e) =>
          this.deserializeEvent(e, e.event_schema_version || 1),
        ),
      ),
    );
  }

  private async getCurrentVersion(
    aggregateId: string,
    trx?: Knex.Transaction,
  ): Promise<number> {
    const db = trx ?? this.writeDb;
    const result = await db('event_store')
      .where('aggregate_id', aggregateId)
      .max('stream_version as version')
      .first();

    return result?.version || 0;
  }

  private async cleanOldSnapshots(aggregateId: string): Promise<void> {
    const keepCount = parseInt(process.env.SNAPSHOT_RETENTION_COUNT || '3', 10);
    const snapshots = await this.writeDb('event_snapshots')
      .where('aggregate_id', aggregateId)
      .orderBy('version', 'desc')
      .select('id');

    if (snapshots.length > keepCount) {
      const idsToDelete = snapshots.slice(keepCount).map((s) => s.id);
      await this.writeDb('event_snapshots').whereIn('id', idsToDelete).delete();

      // Emit metric for monitoring
      this.logger.debug(
        `Deleted ${idsToDelete.length} old snapshots for aggregate ${aggregateId}`,
      );
    }
  }

  private serializeEvent(event: DomainEvent): any {
    const transformValue = (value: any): any => {
      if (value?._isBigNumber || BigNumber.isBigNumber(value)) {
        return { _type: 'BigNumber', value: value.toString() };
      }
      if (value instanceof Date)
        return { _type: 'Date', value: value.toISOString() };
      if (Array.isArray(value)) return value.map(transformValue);
      if (value && typeof value === 'object' && value.constructor === Object) {
        const transformedObj: { [key: string]: any } = {};
        for (const key in value) {
          if (Object.prototype.hasOwnProperty.call(value, key)) {
            transformedObj[key] = transformValue((value as any)[key]);
          }
        }
        return transformedObj;
      }
      return value;
    };
    return transformValue(event);
  }

  private deserializeEvent(
    stored: StoredEvent,
    schemaVersion: number,
  ): Effect.Effect<DomainEvent, ReadEventError> {
    return Effect.try({
      try: () => {
        // Apply schema migrations/upcasters based on version
        let eventData = this.deserializeEventData(stored.event_data);

        if (schemaVersion < 1) {
          // Apply migration from v0 to v1
          eventData = this.migrateEventV0ToV1(eventData);
        }

        const reconstructedEvent = {
          ...eventData,
          _tag: stored.event_type,
          eventId: stored.event_id,
          aggregateId: stored.aggregate_id,
          timestamp: new Date(stored.metadata?.timestamp ?? stored.created_at),
          version: stored.stream_version,
        };

        return reconstructedEvent as DomainEvent;
      },
      catch: (e) =>
        new ReadEventError({ reason: `Failed to deserialize event: ${e}` }),
    });
  }

  private deserializeEventData(data: any): any {
    const reviver = (key: string, value: any) => {
      if (value?._type === 'BigNumber') return new BigNumber(value.value);
      if (value?._type === 'Date') return new Date(value.value);
      return value;
    };

    const rawPayload =
      typeof data === 'string'
        ? JSON.parse(data, reviver)
        : JSON.parse(JSON.stringify(data), reviver);

    return rawPayload;
  }

  private migrateEventV0ToV1(eventData: any): any {
    // Example migration logic
    return eventData;
  }

  // ✅ fail -> false, success -> true
  healthCheck(): Effect.Effect<boolean, never> {
    return pipe(
      Effect.tryPromise(async () => {
        await this.readDb.raw('SELECT 1');
      }),
      Effect.map(() => true),
      Effect.catchAll(() => Effect.succeed(false)),
    );
  }
}
```

### 2. Enhanced Message Bus with golevelup Integration

```typescript
// packages/platform/messaging/message-bus.service.ts
import { Injectable, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AmqpConnection } from '@golevelup/nestjs-rabbitmq';
import { Logger } from '@nestjs/common';
import { v4 as uuidv4 } from 'uuid';
import { Effect, Data, Schema, pipe } from 'effect';

// Message schema for validation
const MessageMetadataSchema = Schema.struct({
  correlationId: Schema.string,
  causationId: Schema.optional(Schema.string),
  userId: Schema.optional(Schema.string),
  timestamp: Schema.Date,
  source: Schema.string,
  version: Schema.string,
});

const MessageSchema = Schema.struct({
  id: Schema.string,
  type: Schema.string,
  data: Schema.unknown,
  metadata: MessageMetadataSchema,
});

export type Message = Schema.Schema.Type<typeof MessageSchema>;
export type MessageMetadata = Schema.Schema.Type<typeof MessageMetadataSchema>;

export class MessageBusError extends Data.TaggedError('MessageBusError')<{
  readonly reason: string;
}> {}

@Injectable()
export class MessageBus implements OnModuleInit {
  private readonly logger = new Logger(MessageBus.name);

  constructor(
    private readonly amqpConnection: AmqpConnection,
    private readonly configService: ConfigService,
  ) {}

  async onModuleInit() {
    // Handle unroutable messages with correlation ID logging
    this.amqpConnection.channel.on('return', (msg) => {
      const cid = msg.properties.headers?.['x-correlation-id'];
      this.logger.error(`Unroutable ${msg.properties.messageId} (${cid})`, {
        exchange: msg.fields.exchange,
        routingKey: msg.fields.routingKey,
      });
    });

    // Setup DLQ manually since queues array isn't used by golevelup
    await this.setupDeadLetterQueue();

    this.logger.log('Message bus initialized with golevelup/nestjs-rabbitmq');
  }

  private async setupDeadLetterQueue(): Promise<void> {
    try {
      await this.amqpConnection.channel.assertQueue('dead.letter.queue', {
        durable: true,
        arguments: {
          'x-queue-mode': 'lazy', // 👈 tiny but helpful in prod
          'x-message-ttl': 86400000, // 24 hours
          'x-max-length': 10000,
        },
      });

      await this.amqpConnection.channel.bindQueue(
        'dead.letter.queue',
        'dlx',
        '',
      );

      this.logger.log('Dead letter queue configured');
    } catch (error) {
      this.logger.error('Failed to setup dead letter queue', error);
    }
  }

  publish(
    exchange: string,
    routingKey: string,
    message: any,
    options?: PublishOptions,
  ): Effect.Effect<void, MessageBusError> {
    return pipe(
      Effect.sync(() => {
        const messageId = uuidv4();
        const envelope: Message = {
          id: messageId,
          type: routingKey,
          data: message,
          metadata: {
            correlationId: options?.correlationId || uuidv4(),
            causationId: options?.causationId,
            userId: options?.userId,
            timestamp: new Date(),
            source:
              this.configService.get('SERVICE_NAME') ?? 'crypto-portfolio',
            version: '1.0',
          },
        };
        return envelope;
      }),
      Effect.flatMap((envelope) =>
        pipe(
          // Validate message schema
          Schema.decodeUnknown(MessageSchema)(envelope),
          Effect.mapError(
            (e) =>
              new MessageBusError({ reason: `Invalid message format: ${e}` }),
          ),
        ),
      ),
      Effect.flatMap((validEnvelope) =>
        Effect.tryPromise({
          try: async () => {
            // Build headers, only including defined values
            const headers: Record<string, any> = {
              'x-correlation-id': validEnvelope.metadata.correlationId,
            };

            if (validEnvelope.metadata.causationId) {
              headers['x-causation-id'] = validEnvelope.metadata.causationId;
            }

            if (validEnvelope.metadata.userId) {
              headers['x-user-id'] = validEnvelope.metadata.userId;
            }

            await this.amqpConnection.publish(
              exchange,
              routingKey,
              validEnvelope,
              {
                persistent: true,
                mandatory: true, // Ensure message is routable
                messageId: validEnvelope.id,
                timestamp: Math.floor(Date.now() / 1000),
                contentType: 'application/json',
                headers,
              },
            );
          },
          catch: (error) =>
            new MessageBusError({
              reason: `Failed to publish message: ${error}`,
            }),
        }),
      ),
      Effect.asVoid,
    );
  }
}

export interface PublishOptions {
  correlationId?: string;
  causationId?: string;
  userId?: string;
}
```

### 3. Enhanced Redis Cache with Redlock

```typescript
// packages/platform/cache/redis-cache.service.ts
import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as Redis from 'ioredis';
import Redlock from 'redlock';
import { Logger } from '@nestjs/common';
import { Effect, Data, Option, pipe, Duration } from 'effect';

export class CacheError extends Data.TaggedError('CacheError')<{
  readonly operation: string;
  readonly reason: string;
}> {}

@Injectable()
export class RedisCacheService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RedisCacheService.name);
  private client: Redis.Redis;
  private subscriber: Redis.Redis;
  private publisher: Redis.Redis;
  private redlock: Redlock;
  private isConnected = false;

  constructor(private readonly configService: ConfigService) {}

  async onModuleInit() {
    await this.connect();
  }

  async onModuleDestroy() {
    await this.disconnect();
  }

  private async connect(): Promise<void> {
    const config = {
      host: this.configService.get('REDIS_HOST') || 'localhost',
      port: Number(this.configService.get('REDIS_PORT') ?? 6379), // FIXED: Coerce to number
      password: this.configService.get('REDIS_PASSWORD'),
      db: Number(this.configService.get('REDIS_DB') ?? 0), // FIXED: Coerce to number
      retryStrategy: (times: number) => Math.min(times * 50, 2000),
      enableReadyCheck: true,
      maxRetriesPerRequest: 3,
    };

    this.client = new Redis.Redis(config);
    this.subscriber = new Redis.Redis(config);
    this.publisher = new Redis.Redis(config);

    // Initialize Redlock with proper configuration
    this.redlock = new Redlock([this.client], {
      driftFactor: 0.01,
      retryCount: 10,
      retryDelay: 200,
      retryJitter: 200,
      automaticExtensionThreshold: 500,
    });

    this.redlock.on('error', (err) => {
      this.logger.error('Redlock error:', err);
    });

    await this.waitForConnection();

    this.isConnected = true;
    this.logger.log('Redis cache connected with Redlock support');
  }

  private async waitForConnection(): Promise<void> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Redis connection timeout'));
      }, 5000);

      this.client.once('ready', () => {
        clearTimeout(timeout);
        resolve();
      });

      this.client.once('error', (err) => {
        clearTimeout(timeout);
        reject(err);
      });
    });
  }

  // FIXED: Proper pipeline batching
  deleteByPattern(pattern: string): Effect.Effect<void, CacheError> {
    return Effect.tryPromise({
      try: async () => {
        const stream = this.client.scanStream({
          match: this.prefixKey(pattern),
          count: 100,
        });

        let pipeline = this.client.pipeline();
        let count = 0;

        for await (const keys of stream) {
          if (keys.length) {
            keys.forEach((key: string) => {
              pipeline.del(key);
              count++;
            });

            // Execute in batches of 1000
            if (count >= 1000) {
              await pipeline.exec();
              pipeline = this.client.pipeline(); // Create new pipeline
              count = 0;
            }
          }
        }

        if (count > 0) {
          await pipeline.exec();
        }
      },
      catch: (e) =>
        new CacheError({ operation: 'DELETE_PATTERN', reason: String(e) }),
    });
  }

  // Keep all other methods from previous implementation...

  private async disconnect(): Promise<void> {
    // No redlock.quit() - just close Redis connections
    if (this.client) {
      await this.client.quit();
    }
    if (this.subscriber) {
      await this.subscriber.quit();
    }
    if (this.publisher) {
      await this.publisher.quit();
    }

    this.isConnected = false;
    this.logger.log('Redis cache disconnected');
  }

  healthCheck(): Effect.Effect<boolean, never> {
    return pipe(
      Effect.tryPromise({ try: () => this.client.ping() }),
      Effect.map(() => true),
      Effect.catchAll(() => Effect.succeed(false)),
    );
  }
}
```

### 4. OpenTelemetry Integration

```typescript
// packages/platform/monitoring/opentelemetry.service.ts
import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { NodeSDK } from '@opentelemetry/sdk-node';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { Resource } from '@opentelemetry/resources';
import { SemanticResourceAttributes } from '@opentelemetry/semantic-conventions';
import { JaegerExporter } from '@opentelemetry/exporter-jaeger';
import { BatchSpanProcessor } from '@opentelemetry/sdk-trace-base';
import { ConfigService } from '@nestjs/config';
import { Logger } from '@nestjs/common';

@Injectable()
export class OpenTelemetryService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(OpenTelemetryService.name);
  private sdk: NodeSDK;

  constructor(private readonly configService: ConfigService) {}

  async onModuleInit() {
    const serviceName = this.configService.get(
      'SERVICE_NAME',
      'crypto-portfolio',
    );
    const serviceVersion = this.configService.get('SERVICE_VERSION', '1.0.0');
    const environment = this.configService.get('NODE_ENV', 'development');

    const resource = Resource.default().merge(
      new Resource({
        [SemanticResourceAttributes.SERVICE_NAME]: serviceName,
        [SemanticResourceAttributes.SERVICE_VERSION]: serviceVersion,
        [SemanticResourceAttributes.DEPLOYMENT_ENVIRONMENT]: environment,
      }),
    );

    // Jaeger exporter for traces only
    const jaegerExporter = new JaegerExporter({
      endpoint: this.configService.get(
        'JAEGER_ENDPOINT',
        'http://localhost:14268/api/traces',
      ),
    });

    this.sdk = new NodeSDK({
      resource,
      spanProcessor: new BatchSpanProcessor(jaegerExporter),
      instrumentations: [
        getNodeAutoInstrumentations({
          '@opentelemetry/instrumentation-fs': {
            enabled: false,
          },
        }),
      ],
    });

    await this.sdk.start();
    this.logger.log('OpenTelemetry SDK initialized for tracing');
  }

  async onModuleDestroy() {
    await this.sdk.shutdown();
  }
}
```

### 5. Health Check Controller

```typescript
// packages/platform/monitoring/health.controller.ts
import { Controller, Get } from '@nestjs/common';
import { HealthCheck, HealthCheckService } from '@nestjs/terminus'; // ✅
import { EventStore } from '../event-store/event-store.service';
import { RedisCacheService } from '../cache/redis-cache.service';
import { Effect } from 'effect';

@Controller('health')
export class HealthController {
  constructor(
    private health: HealthCheckService,
    private readonly eventStore: EventStore,
    private readonly cache: RedisCacheService,
  ) {}

  @Get()
  @HealthCheck()
  async check() {
    return this.health.check([
      async () => {
        const isHealthy = await Effect.runPromise(
          this.eventStore.healthCheck(),
        );
        return {
          eventStore: {
            status: isHealthy ? 'up' : 'down',
          },
        };
      },
      async () => {
        const isHealthy = await Effect.runPromise(this.cache.healthCheck());
        return {
          redis: {
            status: isHealthy ? 'up' : 'down',
          },
        };
      },
    ]);
  }

  @Get('ready')
  async readiness() {
    const eventStoreReady = await Effect.runPromise(
      this.eventStore.healthCheck(),
    );
    const cacheReady = await Effect.runPromise(this.cache.healthCheck());

    if (eventStoreReady && cacheReady) {
      return { status: 'ready' };
    }

    throw new Error('Service not ready');
  }

  @Get('live')
  async liveness() {
    return { status: 'alive' };
  }
}
```

### 6. Outbox Dispatcher Worker

```typescript
// src/infrastructure/event-store/outbox-dispatcher.service.ts
import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { InjectConnection } from 'nest-knexjs';
import { Knex } from 'knex';
import { Logger } from '@nestjs/common';
import { MessageBus } from '../messaging/message-bus.service';

@Injectable()
export class OutboxDispatcher implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(OutboxDispatcher.name);
  private stop = false;

  constructor(
    @InjectConnection('write') private readonly db: Knex,
    private readonly bus: MessageBus,
  ) {}

  async onModuleInit() {
    this.loop();
  }

  async onModuleDestroy() {
    this.stop = true;
  }

  private async loop() {
    // simple forever loop; replace with Bull/worker if you prefer
    for (; !this.stop; ) {
      try {
        await this.db.transaction(async (trx) => {
          const rows = await trx<{
            id: number;
            event_type: string;
            payload: any;
            metadata: any;
          }>('event_outbox')
            .where({ status: 'PENDING' })
            .orderBy('id', 'asc')
            .limit(100)
            .forUpdate()
            .skipLocked();

          for (const r of rows) {
            try {
              await this.bus.publish('domain.events', r.event_type, r.payload, {
                correlationId: r.metadata?.correlationId,
                userId: r.metadata?.userId,
                causationId: r.metadata?.causationId,
              });
              await trx('event_outbox').where({ id: r.id }).update({
                status: 'PROCESSED',
                processed_at: trx.fn.now(),
              });
            } catch (error) {
              this.logger.error(
                `Failed to process outbox event ${r.id}:`,
                error,
              );
              await trx('event_outbox')
                .where({ id: r.id })
                .update({ status: 'FAILED' });
            }
          }
        });

        await new Promise((r) => setTimeout(r, 200));
      } catch (error) {
        this.logger.error('Error in outbox dispatcher loop:', error);
        await new Promise((r) => setTimeout(r, 1000)); // Longer wait on loop error
      }
    }
  }
}
```

### 7. Infrastructure Module

```typescript
// src/infrastructure/infrastructure.module.ts
import { Global, Module } from '@nestjs/common';
import { KnexModule } from 'nest-knexjs';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { RabbitMQModule } from '@golevelup/nestjs-rabbitmq';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { PrometheusModule } from '@willsoto/nestjs-prometheus';
import { TerminusModule } from '@nestjs/terminus';

import { EventStore } from './event-store/event-store.service';
import { ProjectionRebuilder } from './event-store/projection-rebuilder.service';
import { OutboxDispatcher } from './event-store/outbox-dispatcher.service';
import { RedisCacheService } from './cache/redis-cache.service';
import { MessageBus } from './messaging/message-bus.service';
import { MetricsService } from './monitoring/metrics.service';
import { OpenTelemetryService } from './monitoring/opentelemetry.service';
import { HealthController } from './monitoring/health.controller';

@Global()
@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
    }),
    EventEmitterModule.forRoot({
      wildcard: true,
      delimiter: '.',
      maxListeners: 10,
      verboseMemoryLeak: true,
    }),
    // ✅ WRITE
    KnexModule.forRootAsync({
      name: 'write',
      useFactory: (config: ConfigService) => ({
        config: {
          client: 'postgresql',
          connection: {
            host: config.get('DB_HOST'),
            port: Number(config.get('DB_PORT')),
            user: config.get('DB_USER'),
            password: config.get('DB_PASSWORD'),
            database: config.get('DB_NAME'),
          },
          pool: { min: 2, max: 10 },
          migrations: { directory: './migrations' },
        },
      }),
      inject: [ConfigService],
    }),
    // ✅ READ (point to replica, or same for now)
    KnexModule.forRootAsync({
      name: 'read',
      useFactory: (config: ConfigService) => ({
        config: {
          client: 'postgresql',
          connection: {
            host: config.get('DB_HOST'),
            port: Number(config.get('DB_PORT')),
            user: config.get('DB_USER'),
            password: config.get('DB_PASSWORD'),
            database: config.get('DB_NAME'),
          },
          pool: { min: 2, max: 10 },
        },
      }),
      inject: [ConfigService],
    }),
    RabbitMQModule.forRootAsync(RabbitMQModule, {
      useFactory: (configService: ConfigService) => ({
        exchanges: [
          {
            name: 'domain.events',
            type: 'topic',
            options: { durable: true },
          },
          {
            name: 'commands',
            type: 'direct',
            options: { durable: true },
          },
          {
            name: 'integration.events',
            type: 'topic',
            options: { durable: true },
          },
          {
            name: 'dlx',
            type: 'fanout',
            options: { durable: true },
          },
        ],
        // REMOVED queues array - not used by golevelup
        uri: configService.get('RABBITMQ_URL', 'amqp://localhost'),
        connectionInitOptions: { wait: true }, // ✅ Wait for connection
        enableControllerDiscovery: true,
        defaultRpcTimeout: 30000,
        defaultExchangeType: 'topic',
        defaultRpcErrorBehavior: 'REQUEUE',
        defaultSubscribeErrorBehavior: 'NACK', // ✅ safer default
        channels: {
          'channel-1': {
            prefetchCount: 32,
            default: true,
          },
        },
      }),
      inject: [ConfigService],
    }),
    PrometheusModule.register({
      defaultMetrics: {
        enabled: true,
        config: {},
      },
    }),
    TerminusModule,
  ],
  controllers: [HealthController],
  providers: [
    EventStore,
    ProjectionRebuilder,
    OutboxDispatcher,
    RedisCacheService,
    MessageBus,
    MetricsService,
    OpenTelemetryService,
  ],
  exports: [
    EventStore,
    ProjectionRebuilder,
    OutboxDispatcher,
    RedisCacheService,
    MessageBus,
    MetricsService,
  ],
})
export class InfrastructureModule {}
```

### 7. Package.json Dependencies

```json
{
  "name": "crypto-portfolio",
  "version": "1.0.0",
  "description": "Event-sourced crypto portfolio management system",
  "scripts": {
    "start": "nest start",
    "start:dev": "nest start --watch",
    "start:debug": "nest start --debug --watch",
    "start:prod": "node dist/main",
    "build": "nest build",
    "test": "jest",
    "test:watch": "jest --watch",
    "test:e2e": "jest --config ./test/jest-e2e.json",
    "migration:create": "knex migrate:make",
    "migration:run": "knex migrate:latest",
    "migration:rollback": "knex migrate:rollback"
  },
  "dependencies": {
    "@nestjs/common": "^10.0.0",
    "@nestjs/core": "^10.0.0",
    "@nestjs/platform-express": "^10.0.0",
    "@nestjs/cqrs": "^10.0.0",
    "@nestjs/event-emitter": "^2.0.0",
    "@nestjs/config": "^3.0.0",
    "@nestjs/terminus": "^10.0.0",
    "@nestjs/swagger": "^7.0.0",
    "@golevelup/nestjs-rabbitmq": "^4.0.0",
    "@willsoto/nestjs-prometheus": "^5.0.0",
    "@opentelemetry/sdk-node": "^0.45.0",
    "@opentelemetry/auto-instrumentations-node": "^0.40.0",
    "@opentelemetry/exporter-jaeger": "^1.18.0",
    "effect": "^2.0.0",
    "@effect/schema": "^0.48.0",
    "knex": "^3.0.0",
    "pg": "^8.11.0",
    "nest-knexjs": "^2.0.0",
    "ioredis": "^5.3.0",
    "redlock": "^5.0.0-beta.2",
    "amqplib": "^0.10.0",
    "winston": "^3.11.0",
    "winston-elasticsearch": "^0.17.0",
    "bignumber.js": "^9.1.0",
    "uuid": "^9.0.0",
    "class-transformer": "^0.5.0",
    "class-validator": "^0.14.0",
    "rxjs": "^7.8.0",
    "reflect-metadata": "^0.1.13"
  },
  "devDependencies": {
    "@nestjs/cli": "^10.0.0",
    "@nestjs/schematics": "^10.0.0",
    "@nestjs/testing": "^10.0.0",
    "@types/express": "^4.17.17",
    "@types/jest": "^29.5.0",
    "@types/node": "^20.3.1",
    "@types/amqplib": "^0.10.0",
    "@types/uuid": "^9.0.0",
    "@typescript-eslint/eslint-plugin": "^6.0.0",
    "@typescript-eslint/parser": "^6.0.0",
    "eslint": "^8.42.0",
    "eslint-config-prettier": "^9.0.0",
    "eslint-plugin-prettier": "^5.0.0",
    "jest": "^29.5.0",
    "prettier": "^3.0.0",
    "source-map-support": "^0.5.21",
    "ts-jest": "^29.1.0",
    "ts-loader": "^9.4.3",
    "ts-node": "^10.9.1",
    "tsconfig-paths": "^4.2.0",
    "typescript": "^5.1.3",
    "testcontainers": "^10.2.0"
  }
}
```

### 8. Environment Configuration

```bash
# .env.example
# Database
DB_HOST=localhost
DB_PORT=5432
DB_USER=postgres
DB_PASSWORD=postgres
DB_NAME=crypto_portfolio

# Redis
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=
REDIS_DB=0
REDIS_PREFIX=crypto

# RabbitMQ
RABBITMQ_URL=amqp://guest:guest@localhost:5672

# Service Configuration
SERVICE_NAME=crypto-portfolio
SERVICE_VERSION=1.0.0
NODE_ENV=development
LOG_LEVEL=info
LOG_TO_FILE=false

# Snapshot Configuration
SNAPSHOT_RETENTION_COUNT=3

# Elasticsearch (optional)
ELASTICSEARCH_URL=

# Jaeger (optional)
JAEGER_ENDPOINT=http://localhost:14268/api/traces

# API Port
PORT=3000
```

### 9. Docker Compose for Local Development

```yaml
# docker-compose.yml
version: '3.8'

services:
  postgres:
    image: postgres:16-alpine
    environment:
      POSTGRES_USER: postgres
      POSTGRES_PASSWORD: postgres
      POSTGRES_DB: crypto_portfolio
    ports:
      - '5432:5432'
    volumes:
      - postgres_data:/var/lib/postgresql/data

  redis:
    image: redis:7-alpine
    ports:
      - '6379:6379'
    volumes:
      - redis_data:/data

  rabbitmq:
    image: rabbitmq:3-management-alpine
    ports:
      - '5672:5672'
      - '15672:15672'
    environment:
      RABBITMQ_DEFAULT_USER: guest
      RABBITMQ_DEFAULT_PASS: guest
    volumes:
      - rabbitmq_data:/var/lib/rabbitmq

  jaeger:
    image: jaegertracing/all-in-one:latest
    ports:
      - '16686:16686'
      - '14268:14268'
    environment:
      COLLECTOR_OTLP_ENABLED: true

  # Optional: Debezium for CDC (future enhancement)
  # connect:
  #   image: debezium/connect:2.4
  #   ports:
  #     - "8083:8083"
  #   environment:
  #     BOOTSTRAP_SERVERS: kafka:9092
  #     GROUP_ID: 1
  #     CONFIG_STORAGE_TOPIC: connect_configs
  #     OFFSET_STORAGE_TOPIC: connect_offsets
  #     STATUS_STORAGE_TOPIC: connect_statuses
  #   depends_on:
  #     - postgres
  #     - kafka

volumes:
  postgres_data:
  redis_data:
  rabbitmq_data:
```

### 10. Main Application Entry Point

```typescript
// src/main.ts
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ValidationPipe } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { ConfigService } from '@nestjs/config';
import { Logger } from '@nestjs/common';

async function bootstrap() {
  const logger = new Logger('Bootstrap');

  const app = await NestFactory.create(AppModule, {
    logger: ['error', 'warn', 'log', 'debug', 'verbose'],
  });

  const configService = app.get(ConfigService);

  // Global validation pipe
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: {
        enableImplicitConversion: true,
      },
    }),
  );

  // Swagger documentation
  const config = new DocumentBuilder()
    .setTitle('Crypto Portfolio API')
    .setDescription('Event-sourced crypto portfolio management system')
    .setVersion('1.0')
    .addBearerAuth()
    .build();

  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('api', app, document);

  // Enable graceful shutdown
  app.enableShutdownHooks();

  const port = configService.get('PORT', 3000);
  await app.listen(port);

  logger.log(`Application is running on: http://localhost:${port}`);
  logger.log(`Swagger documentation: http://localhost:${port}/api`);
  logger.log(`Health check: http://localhost:${port}/health`);
  logger.log(`Metrics: http://localhost:${port}/metrics`);
}

bootstrap();
```

### 11. App Module

```typescript
// src/app.module.ts
import { Module } from '@nestjs/common';
import { CqrsModule } from '@nestjs/cqrs';
import { CoreModule } from './@core/core.module';
import { InfrastructureModule } from './infrastructure/infrastructure.module';
import { TradingModule } from './contexts/trading/trading.module';
import { PortfolioModule } from './contexts/portfolio/portfolio.module';
import { TaxationModule } from './contexts/taxation/taxation.module';
import { ReconciliationModule } from './contexts/reconciliation/reconciliation.module';

@Module({
  imports: [
    // Core and infrastructure
    CoreModule,
    InfrastructureModule,
    CqrsModule.forRoot(),

    // Bounded contexts
    TradingModule,
    PortfolioModule,
    TaxationModule,
    ReconciliationModule,
  ],
})
export class AppModule {}
```

### 12. Example Consumer with DLQ Configuration

```typescript
// packages/contexts/trading/src/application/event-handlers/transaction-imported.handler.ts
import { Injectable } from '@nestjs/common';
import { RabbitSubscribe } from '@golevelup/nestjs-rabbitmq';
import { TransactionImported } from '../../domain/events/transaction.events';

@Injectable()
export class TransactionImportedHandler {
  @RabbitSubscribe({
    exchange: 'domain.events',
    routingKey: 'transaction.imported',
    queue: 'trading.transaction.imported',
    queueOptions: {
      durable: true,
      arguments: {
        'x-dead-letter-exchange': 'dlx',
        'x-dead-letter-routing-key': '',
        'x-message-ttl': 3600000, // 1 hour TTL for messages
      },
    },
  })
  async handle(message: TransactionImported) {
    console.log(`Handling transaction imported: ${message.data.transactionId}`);

    // Process the event
    // If this throws, the message will be sent to DLQ after retries
  }
}
```
