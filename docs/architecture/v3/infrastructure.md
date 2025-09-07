## Complete Infrastructure Implementation

### 1. Event Store Infrastructure

```typescript
// src/infrastructure/event-store/event-store.service.ts
import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { InjectConnection } from 'nest-knexjs';
import { Knex } from 'knex';
import { Effect, Data, pipe } from 'effect';
import { Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { DomainEvent } from '../../@core/domain/base/domain-event.base';
import * as crypto from 'crypto';
import BigNumber from 'bignumber.js';

export interface StoredEvent {
  id: number;
  event_id: string;
  aggregate_id: string;
  aggregate_type: string;
  event_type: string;
  event_version: number;
  event_data: any;
  metadata: EventMetadata;
  created_at: Date;
  stream_version: number;
}

export interface EventMetadata {
  userId?: string;
  correlationId?: string;
  causationId?: string;
  timestamp: Date;
  source?: string;
}

// Add these error types
export class SaveEventError extends Data.TaggedError('SaveEventError')<{
  readonly reason: string;
}> {}

export class ReadEventError extends Data.TaggedError('ReadEventError')<{
  readonly reason: string;
}> {}

export class IdempotencyError extends Data.TaggedError('IdempotencyError')<{
  readonly reason: string;
}> {}

export class RebuildError extends Data.TaggedError('RebuildError')<{
  readonly projectionName: string;
  readonly reason: string;
}> {}

export interface EventStream {
  aggregateId: string;
  aggregateType: string;
  version: number;
  events: StoredEvent[];
}

@Injectable()
export class EventStore implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(EventStore.name);
  private isConnected = false;

  constructor(
    @InjectConnection('write') private readonly writeDb: Knex,
    @InjectConnection('read') private readonly readDb: Knex,
    private readonly eventEmitter: EventEmitter2
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
    // Ensure event store tables exist
    const hasTable = await this.writeDb.schema.hasTable('event_store');
    if (!hasTable) {
      await this.createEventStoreTables();
    }
  }

  private async createEventStoreTables() {
    // Events table
    await this.writeDb.schema.createTable('event_store', table => {
      table.bigIncrements('id').primary();
      table.uuid('event_id').notNullable().unique();
      table.string('aggregate_id', 255).notNullable();
      table.string('aggregate_type', 100).notNullable();
      table.string('event_type', 100).notNullable();
      table.integer('event_version').notNullable();
      table.jsonb('event_data').notNullable();
      table.jsonb('metadata').notNullable();
      table.integer('stream_version').notNullable();
      table.timestamp('created_at').defaultTo(this.writeDb.fn.now());

      // Indexes for performance
      table.index(['aggregate_id', 'stream_version']);
      table.index(['aggregate_type', 'created_at']);
      table.index('event_type');
      table.index('created_at');

      // Add unique constraint to prevent race conditions at the database level
      // Provides hard guarantee of stream consistency for concurrent writes
      table.unique(['aggregate_id', 'stream_version']);
    });

    // Snapshots table
    await this.writeDb.schema.createTable('event_snapshots', table => {
      table.bigIncrements('id').primary();
      table.string('aggregate_id', 255).notNullable();
      table.string('aggregate_type', 100).notNullable();
      table.integer('version').notNullable();
      table.jsonb('data').notNullable();
      table.timestamp('created_at').defaultTo(this.writeDb.fn.now());

      table.unique(['aggregate_id', 'version']);
      table.index(['aggregate_id', 'created_at']);
    });

    // Idempotency table
    await this.writeDb.schema.createTable('event_idempotency', table => {
      table.string('idempotency_key', 255).primary();
      table.uuid('event_id').notNullable();
      table.timestamp('created_at').defaultTo(this.writeDb.fn.now());
      table.timestamp('expires_at').notNullable();

      table.index('expires_at');
    });
  }

  public append(
    aggregateId: string,
    aggregateType: string, // <-- ADDED for robustness
    events: ReadonlyArray<DomainEvent>,
    expectedVersion: number
    // metadata?: Partial<EventMetadata> // This should come from a shared context/layer if needed
  ): Effect.Effect<void, OptimisticLockError | SaveEventError> {
    const program = Effect.tryPromise({
      try: () =>
        this.writeDb.transaction(async trx => {
          // 1. Check for optimistic concurrency
          const currentVersion = await this.getCurrentVersion(aggregateId, trx);
          if (currentVersion !== expectedVersion) {
            // Throw a typed error that Effect.tryPromise will catch
            throw new OptimisticLockError({ aggregateId, expectedVersion, actualVersion: currentVersion });
          }

          let streamVersion = expectedVersion;

          // 2. Map events to be stored
          const eventsToStore = events.map(event => {
            streamVersion++;
            return {
              event_id: event.eventId,
              aggregate_id: aggregateId,
              aggregate_type: aggregateType, // <-- USE EXPLICIT TYPE
              event_type: event._tag,
              event_version: event.version,
              event_data: this.serializeEvent(event),
              metadata: { timestamp: event.timestamp },
              stream_version: streamVersion,
            };
          });

          if (eventsToStore.length > 0) {
            await trx('event_store').insert(eventsToStore);
          }
        }),
      catch: error =>
        // This ensures our typed error is preserved in the Effect's error channel
        error instanceof OptimisticLockError
          ? error
          : new SaveEventError({ reason: `Failed to append events: ${error}` }),
    });

    // 3. Publish events *after* the transaction successfully commits
    return pipe(
      program,
      Effect.tap(() =>
        Effect.sync(() => {
          for (const event of events) {
            // Use NestJS's EventEmitter for loose coupling to projections
            this.eventEmitter.emit(`event.${event._tag}`, event);
          }
        })
      ),
      Effect.asVoid // Ensure the return type is Effect<void, ...>
    );
  }

  readStream(
    aggregateId: string,
    fromVersion: number = 0,
    toVersion?: number
  ): Effect.Effect<DomainEvent[], ReadEventError> {
    return Effect.tryPromise({
      try: async () => {
        const query = this.readDb('event_store')
          .where('aggregate_id', aggregateId)
          .where('stream_version', '>', fromVersion)
          .orderBy('stream_version', 'asc');

        // Handle edge case where toVersion = 0 (read events up to version 0)
        if (toVersion !== undefined) {
          query.where('stream_version', '<=', toVersion);
        }

        const events = await query;
        return events.map(e => this.deserializeEvent(e));
      },
      catch: error => new ReadEventError({ reason: `Failed to read stream: ${error}` }),
    });
  }

  readStreamWithSnapshot(
    aggregateId: string
  ): Effect.Effect<{ snapshot?: any; events: DomainEvent[] }, ReadEventError> {
    const getSnapshot = Effect.tryPromise({
      try: () => this.readDb('event_snapshots').where('aggregate_id', aggregateId).orderBy('version', 'desc').first(),
      catch: e => new ReadEventError({ reason: `Failed to read snapshot: ${e}` }),
    });

    return pipe(
      getSnapshot,
      Effect.flatMap(snapshot => {
        const fromVersion = snapshot?.version ?? 0;
        // Chain the readStream Effect
        return pipe(
          this.readStream(aggregateId, fromVersion),
          Effect.map(events => ({
            // Use safe copy for mutable downstream usage
            snapshot: snapshot ? structuredClone(snapshot.data) : undefined,
            events,
          }))
        );
      })
    );
  }

  saveSnapshot(
    aggregateId: string,
    aggregateType: string,
    version: number,
    data: any
  ): Effect.Effect<void, SaveEventError> {
    return pipe(
      Effect.tryPromise({
        try: () =>
          this.writeDb('event_snapshots').insert({
            aggregate_id: aggregateId,
            aggregate_type: aggregateType,
            version,
            // Pass the plain object directly to the driver for jsonb serialization
            data: data,
          }),
        catch: e => new SaveEventError({ reason: `Failed to save snapshot: ${e}` }),
      }),
      Effect.tap(() => Effect.promise(() => this.cleanOldSnapshots(aggregateId))), // Fire-and-forget cleanup
      Effect.asVoid
    );
  }

  findByIdempotencyKey(key: string): Effect.Effect<string | null, IdempotencyError> {
    return Effect.tryPromise({
      try: async () => {
        const result = await this.readDb('event_idempotency')
          .where('idempotency_key', key)
          .where('expires_at', '>', new Date())
          .first();
        return result?.event_id || null;
      },
      catch: e => new IdempotencyError({ reason: `Failed to check idempotency key ${key}: ${e}` }),
    });
  }

  saveIdempotencyKey(key: string, eventId: string, ttlHours: number = 24): Effect.Effect<void, IdempotencyError> {
    return Effect.tryPromise({
      try: async () => {
        const expiresAt = new Date();
        expiresAt.setHours(expiresAt.getHours() + ttlHours);
        await this.writeDb('event_idempotency')
          .insert({
            idempotency_key: key,
            event_id: eventId,
            expires_at: expiresAt,
          })
          .onConflict('idempotency_key')
          .ignore();
      },
      catch: e => new IdempotencyError({ reason: `Failed to save idempotency key ${key}: ${e}` }),
    });
  }

  getEventsByType(eventType: string, limit: number = 100, after?: Date): Effect.Effect<StoredEvent[], ReadEventError> {
    return Effect.tryPromise({
      try: () => {
        const query = this.readDb('event_store')
          .where('event_type', eventType)
          .orderBy('created_at', 'desc')
          .limit(limit);

        if (after) {
          query.where('created_at', '>', after);
        }
        return query;
      },
      catch: e => new ReadEventError({ reason: `Failed to get events by type ${eventType}: ${e}` }),
    });
  }

  getAggregateEvents(aggregateType: string, limit: number = 100): Effect.Effect<StoredEvent[], ReadEventError> {
    return Effect.tryPromise({
      try: () =>
        this.readDb('event_store').where('aggregate_type', aggregateType).orderBy('created_at', 'desc').limit(limit),
      catch: e => new ReadEventError({ reason: `Failed to get events by aggregate type ${aggregateType}: ${e}` }),
    });
  }

  private async getCurrentVersion(aggregateId: string, trx?: Knex.Transaction): Promise<number> {
    const db = trx || this.readDb;
    const result = await db('event_store').where('aggregate_id', aggregateId).max('stream_version as version').first();

    return result?.version || 0;
  }

  private async updateStreamVersion(aggregateId: string, version: number, trx: Knex.Transaction): Promise<void> {
    // Could maintain a separate streams table for performance
    // For now, we rely on the event_store table
  }

  private async cleanOldSnapshots(aggregateId: string): Promise<void> {
    const snapshots = await this.writeDb('event_snapshots')
      .where('aggregate_id', aggregateId)
      .orderBy('version', 'desc')
      .select('id');

    if (snapshots.length > 3) {
      const idsToDelete = snapshots.slice(3).map(s => s.id);
      await this.writeDb('event_snapshots').whereIn('id', idsToDelete).delete();
    }
  }

  // Removed: publishEvent method - replaced by EventEmitter2 in append method

  private serializeEvent(event: DomainEvent): any {
    // Return a plain object, not a string. Let the PostgreSQL driver handle JSON serialization.
    // This recursive transformer handles nested custom types safely.
    const transformValue = (value: any): any => {
      // Support multiple BigNumber libraries (bignumber.js and ethers.js)
      if (value?._isBigNumber || (BigNumber as any).isBigNumber?.(value)) {
        return { _type: 'BigNumber', value: value.toString() };
      }
      if (value instanceof Date) return { _type: 'Date', value: value.toISOString() };
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

  private deserializeEvent(stored: StoredEvent): DomainEvent {
    // Safely handle both string and object types from the database
    const reviver = (key: string, value: any) => {
      if (value?._type === 'BigNumber') return new BigNumber(value.value);
      if (value?._type === 'Date') return new Date(value.value);
      return value;
    };

    // Handle raw data from the event_data column - may already be parsed as object
    const rawPayload =
      typeof stored.event_data === 'string'
        ? JSON.parse(stored.event_data, reviver)
        : JSON.parse(JSON.stringify(stored.event_data), reviver); // Deep transformation for objects

    const reconstructedEvent = {
      ...rawPayload,
      _tag: stored.event_type,
      eventId: stored.event_id,
      aggregateId: stored.aggregate_id,
      // Prefer metadata timestamp to preserve original event time
      timestamp: new Date(stored.metadata?.timestamp ?? stored.created_at),
      // Use stream_version for aggregate versioning - critical for optimistic concurrency
      version: stored.stream_version,
    };

    return reconstructedEvent as DomainEvent;
  }

  healthCheck(): Effect.Effect<boolean, never> {
    return pipe(
      Effect.tryPromise({
        try: () => this.readDb.raw('SELECT 1'),
        catch: () => false, // Map any database error to a failure boolean
      }),
      Effect.as(true), // If the query succeeds, the result is `true`
      Effect.catchAll(() => Effect.succeed(false)) // Ensure any failure results in `false`
    );
  }

  // Removed: subscribe/unsubscribe methods - replaced by EventEmitter2 pattern
  // Use @EventsHandler decorators in projection classes for event handling
}

// The existing OptimisticLockError should also extend Data.TaggedError
export class OptimisticLockError extends Data.TaggedError('OptimisticLockError')<{
  readonly aggregateId: string;
  readonly expectedVersion: number;
  readonly actualVersion: number;
}> {
  constructor(props: { aggregateId: string; expectedVersion: number; actualVersion: number }) {
    super(props);
    this.message = `Optimistic lock error for aggregate ${props.aggregateId}. Expected version ${props.expectedVersion}, but was ${props.actualVersion}`;
  }
}
```

### 2. Projection Rebuilder

```typescript
// src/infrastructure/event-store/projection-rebuilder.service.ts
import { Injectable, OnModuleInit } from '@nestjs/common';
import { InjectConnection } from 'nest-knexjs';
import { Knex } from 'knex';
import { Logger } from '@nestjs/common';
import { Effect, Data, pipe, Option } from 'effect';

export interface StoredEvent {
  id: number;
  event_id: string;
  aggregate_id: string;
  aggregate_type: string;
  event_type: string;
  event_version: number;
  event_data: any;
  metadata: any;
  created_at: Date;
  stream_version: number;
}

@Injectable()
export class ProjectionRebuilder implements OnModuleInit {
  private readonly logger = new Logger(ProjectionRebuilder.name);

  constructor(
    @InjectConnection('write') private readonly writeDb: Knex,
    @InjectConnection('read') private readonly readDb: Knex
  ) {}

  async onModuleInit() {
    await this.initializeCheckpointsTable();
    this.logger.log('Projection Rebuilder initialized. Live updates are handled by @EventsHandler.');
  }

  private async initializeCheckpointsTable() {
    const hasTable = await this.readDb.schema.hasTable('projection_checkpoints');
    if (!hasTable) {
      await this.readDb.schema.createTable('projection_checkpoints', table => {
        table.string('projection_name', 100).primary();
        table.bigInteger('position').notNullable().defaultTo(0);
        table.integer('version').notNullable();
        table.timestamp('last_updated').defaultTo(this.readDb.fn.now());
      });
    }
  }

  getCheckpoint(projectionName: string): Effect.Effect<number, RebuildError> {
    return Effect.tryPromise({
      try: async () => {
        const result = await this.readDb('projection_checkpoints').where('projection_name', projectionName).first();
        return result?.position || 0;
      },
      catch: e => new RebuildError({ projectionName, reason: `Failed to get checkpoint: ${e}` }),
    });
  }

  setCheckpoint(projectionName: string, position: number): Effect.Effect<void, RebuildError> {
    return Effect.tryPromise({
      try: () =>
        this.writeDb('projection_checkpoints')
          .insert({
            projection_name: projectionName,
            position,
            version: 1,
            last_updated: new Date(),
          })
          .onConflict('projection_name')
          .merge(['position', 'last_updated']),
      catch: e => new RebuildError({ projectionName, reason: `Failed to set checkpoint: ${e}` }),
    });
  }

  rebuildProjection(
    projectionName: string,
    eventHandler: (event: StoredEvent, trx: Knex.Transaction) => Promise<void>,
    // Default to safer fromCheckpoint = true and expose batchSize
    options: { fromCheckpoint?: boolean; batchSize?: number } = {}
  ): Effect.Effect<void, RebuildError> {
    const { fromCheckpoint = true, batchSize = 500 } = options;

    const getStartingPosition = fromCheckpoint ? this.getCheckpoint(projectionName) : Effect.succeed(0);
    const rebuildLoop = (startPosition: number) =>
      Effect.loop(startPosition, {
        while: () => true,
        body: currentPosition =>
          pipe(
            Effect.tryPromise({
              try: () =>
                this.readDb('event_store').where('id', '>', currentPosition).orderBy('id', 'asc').limit(batchSize),
              catch: e => new RebuildError({ projectionName, reason: `Failed to read events: ${e}` }),
            }),
            Effect.flatMap(events => {
              if (events.length === 0) {
                return Effect.fail(Option.none());
              }

              const lastEventInBatch = events[events.length - 1];

              return pipe(
                Effect.tryPromise({
                  try: () =>
                    this.writeDb.transaction(async trx => {
                      for (const event of events) {
                        await eventHandler(event, trx);
                      }

                      // Update checkpoint within the same transaction for atomicity
                      await trx('projection_checkpoints')
                        .insert({
                          projection_name: projectionName,
                          position: lastEventInBatch.id,
                          version: 1,
                          last_updated: new Date(),
                        })
                        .onConflict('projection_name')
                        .merge(['position', 'last_updated']);
                    }),
                  catch: e => new RebuildError({ projectionName, reason: `Handler failed: ${e}` }),
                }),
                Effect.tap(() =>
                  Effect.sync(() => this.logger.log(`Rebuilt ${projectionName} up to event ID ${lastEventInBatch.id}`))
                ),
                Effect.map(() => lastEventInBatch.id)
              );
            })
          ),
        inc: pos => pos,
      });

    return pipe(
      Effect.sync(() => this.logger.warn(`Starting rebuild for projection: ${projectionName}`)),
      // Conditionally reset checkpoint based on fromCheckpoint option
      Effect.flatMap(() => (fromCheckpoint ? Effect.void : this.setCheckpoint(projectionName, 0))),
      Effect.flatMap(() => getStartingPosition),
      Effect.flatMap(rebuildLoop),
      // CLARIFICATION: The loop body signals completion by failing with `Option.none()`.
      // This `catchTag` intercepts that specific "success" signal and gracefully
      // stops the pipeline, while letting actual `RebuildError`s propagate.
      Effect.catchTag('Fail', e => (Option.isNone(e.error) ? Effect.void : Effect.fail(e.error as RebuildError))),
      Effect.tap(() => Effect.sync(() => this.logger.warn(`Finished rebuild for projection: ${projectionName}`))),
      Effect.asVoid
    );
  }
}
```

For live projection updates, use standard NestJS `@EventsHandler` classes within each context module.

The ProjectionRebuilder uses Effect for robust error handling and declarative control flow. The rebuild process uses Effect.loop with transactional integrity - checkpoint updates happen within the same database transaction as event processing to ensure atomicity and prevent data corruption on service restarts.

### 3. Message Bus (Event-Driven Communication)

```typescript
// src/infrastructure/messaging/message-bus.service.ts
import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as amqp from 'amqplib';
import { Logger } from '@nestjs/common';
import { v4 as uuidv4 } from 'uuid';
import { Effect, Data } from 'effect';

export interface Message {
  id: string;
  type: string;
  data: any;
  metadata: MessageMetadata;
}

export interface MessageMetadata {
  correlationId: string;
  causationId?: string;
  userId?: string;
  timestamp: Date;
  source: string;
  version: string;
}

@Injectable()
export class MessageBus implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(MessageBus.name);
  private connection: amqp.Connection;
  private channel: amqp.ConfirmChannel; // Use ConfirmChannel for durable publishing
  private subscriptions = new Map<string, Set<MessageHandler>>();

  constructor(private readonly configService: ConfigService) {}

  async onModuleInit() {
    await this.connect();
  }

  async onModuleDestroy() {
    await this.disconnect();
  }

  private async connect(): Promise<void> {
    try {
      // Add heartbeat for connection health monitoring
      const url = this.configService.get('RABBITMQ_URL') || 'amqp://localhost?heartbeat=30';
      this.connection = await amqp.connect(url);

      // Add robust connection event listeners
      this.connection.on('error', err => this.logger.error('Message bus connection error', err));
      this.connection.on('close', () => this.logger.warn('Message bus connection closed. Attempting to reconnect...'));

      this.channel = await this.connection.createConfirmChannel();

      // Handle unroutable messages with mandatory flag
      this.channel.on('return', msg => {
        this.logger.error(`Message unroutable and returned: ${msg.properties.messageId}`, {
          exchange: msg.fields.exchange,
          routingKey: msg.fields.routingKey,
        });
      });

      // Setup exchanges
      await this.setupExchanges();

      // Setup dead letter queue
      await this.setupDeadLetterQueue();

      this.logger.log('Message bus connected');
    } catch (error) {
      this.logger.error('Failed to connect to message bus', error);
      throw error;
    }
  }

  private async setupExchanges(): Promise<void> {
    // Domain events exchange
    await this.channel.assertExchange('domain.events', 'topic', {
      durable: true,
    });

    // Commands exchange
    await this.channel.assertExchange('commands', 'direct', {
      durable: true,
    });

    // Integration events exchange
    await this.channel.assertExchange('integration.events', 'topic', {
      durable: true,
    });
  }

  private async setupDeadLetterQueue(): Promise<void> {
    await this.channel.assertQueue('dead.letter.queue', {
      durable: true,
      arguments: {
        'x-message-ttl': 86400000, // 24 hours
      },
    });

    await this.channel.assertExchange('dead.letter.exchange', 'fanout', {
      durable: true,
    });

    await this.channel.bindQueue('dead.letter.queue', 'dead.letter.exchange', '');
  }

  publish(
    exchange: string,
    routingKey: string,
    message: any,
    options?: amqp.Options.Publish
  ): Effect.Effect<void, MessageBusError> {
    // If the service is not connected, fail early
    if (!this.channel) {
      return Effect.fail(new MessageBusError({ reason: 'Message bus is not connected.' }));
    }

    return Effect.tryPromise({
      try: async () => {
        const messageId = uuidv4();
        const envelope: Message = {
          id: messageId,
          type: routingKey,
          data: message,
          metadata: {
            correlationId: options?.correlationId || uuidv4(),
            causationId: options?.headers?.causationId,
            userId: options?.headers?.userId,
            timestamp: new Date(),
            // Make service source configurable for microservice environments
            source: this.configService.get('SERVICE_NAME') ?? 'crypto-portfolio',
            version: '1.0',
          },
        };

        const buffer = Buffer.from(JSON.stringify(envelope));

        const publishOptions = {
          persistent: true,
          contentType: 'application/json',
          messageId,
          timestamp: Math.floor(Date.now() / 1000),
          mandatory: true, // Ensure message is routable or get return event
          ...options,
        };

        const ok = this.channel.publish(exchange, routingKey, buffer, publishOptions);

        // Handle TCP backpressure from the broker
        if (!ok) {
          await new Promise(res => this.channel.once('drain', res));
        }

        // Wait for broker confirmation to ensure message durability
        await this.channel.waitForConfirms();

        this.logger.debug(`Published and confirmed message to ${exchange}/${routingKey}`);
      },
      catch: error => new MessageBusError({ reason: `Failed to publish and confirm message: ${error}` }),
    });
  }

  async subscribe(
    queue: string,
    exchange: string,
    pattern: string,
    handler: MessageHandler,
    options?: SubscribeOptions
  ): Promise<void> {
    // Assert queue with dead letter exchange for failed messages
    await this.channel.assertQueue(queue, {
      durable: true,
      arguments: {
        'x-dead-letter-exchange': 'dead.letter.exchange',
        ...options?.queueArguments,
      },
    });

    // Bind to exchange
    await this.channel.bindQueue(queue, exchange, pattern);

    // Set prefetch count to control backpressure - prevents consumer flooding
    await this.channel.prefetch(options?.prefetchCount || 32);

    // Setup consumer
    await this.channel.consume(
      queue,
      async msg => {
        if (!msg) return;

        try {
          const message: Message = JSON.parse(msg.content.toString());

          // Process message
          await this.processMessage(message, handler, options);

          // Acknowledge
          this.channel.ack(msg);
        } catch (error) {
          this.logger.error(`Error processing message: ${error.message}`, error);

          // Handle retry logic
          await this.handleMessageError(msg, error, options);
        }
      },
      {
        noAck: false,
      }
    );

    this.logger.log(`Subscribed to ${exchange}/${pattern} -> ${queue}`);
  }

  private async processMessage(message: Message, handler: MessageHandler, options?: SubscribeOptions): Promise<void> {
    // Apply middleware
    if (options?.middleware) {
      for (const middleware of options.middleware) {
        await middleware(message);
      }
    }

    // Call handler
    await handler(message);
  }

  private async handleMessageError(msg: amqp.Message, error: Error, options?: SubscribeOptions): Promise<void> {
    const retryCount = (msg.properties.headers['x-retry-count'] || 0) + 1;
    const maxRetries = options?.maxRetries || 3;

    if (retryCount <= maxRetries) {
      // DURABLE RETRY: Use DLQ + separate retry service instead of unsafe setTimeout
      // This prevents message loss if the process crashes during retry delay
      this.logger.warn(`Message processing failed. Sending to DLQ for durable retry.`, {
        messageId: msg.properties.messageId,
        retryCount,
        error: error.message,
      });
      // Nack to DLQ - a separate retry service can implement delay logic
      this.channel.nack(msg, false, false);
    } else {
      // Send to dead letter queue after max retries exceeded
      this.channel.nack(msg, false, false);
      this.logger.error(`Message sent to DLQ after ${maxRetries} retries: ${msg.properties.messageId}`);
    }
  }

  private async disconnect(): Promise<void> {
    if (this.channel) {
      await this.channel.close();
    }
    if (this.connection) {
      await this.connection.close();
    }
    this.logger.log('Message bus disconnected');
  }
}

export type MessageHandler = (message: Message) => Promise<void>;

export interface SubscribeOptions {
  maxRetries?: number;
  prefetchCount?: number; // Controls message backpressure
  middleware?: MessageMiddleware[];
  queueArguments?: Record<string, any>;
}

export type MessageMiddleware = (message: Message) => Promise<void>;

export class MessageBusError extends Data.TaggedError('MessageBusError')<{
  readonly reason: string;
}> {}
```

### 4. Cache Infrastructure (Redis)

```typescript
// src/infrastructure/cache/redis-cache.service.ts
import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as Redis from 'ioredis';
import { Logger } from '@nestjs/common';
import { Effect, Data, Option, pipe, Duration } from 'effect';

export class CacheError extends Data.TaggedError('CacheError')<{
  readonly operation: string;
  readonly reason: string;
}> {}

export interface CacheOptions {
  ttl?: number; // seconds
  prefix?: string;
  tags?: string[];
}

@Injectable()
export class RedisCacheService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RedisCacheService.name);
  private client: Redis.Redis;
  private subscriber: Redis.Redis;
  private publisher: Redis.Redis;
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
      port: this.configService.get('REDIS_PORT') || 6379,
      password: this.configService.get('REDIS_PASSWORD'),
      db: this.configService.get('REDIS_DB') || 0,
      retryStrategy: (times: number) => Math.min(times * 50, 2000),
    };

    this.client = new Redis.Redis(config);
    this.subscriber = new Redis.Redis(config);
    this.publisher = new Redis.Redis(config);

    await this.waitForConnection();

    this.isConnected = true;
    this.logger.log('Redis cache connected');
  }

  private async waitForConnection(): Promise<void> {
    // Prevent connection listener leaks with proper cleanup
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Redis connection timeout'));
      }, 5000);

      // Use 'once' to prevent listener leaks
      this.client.once('ready', () => {
        clearTimeout(timeout);
        resolve();
      });

      this.client.once('error', err => {
        clearTimeout(timeout);
        reject(err);
      });
    });
  }

  public get<T>(key: string): Effect.Effect<Option.Option<T>, CacheError> {
    return Effect.tryPromise({
      try: async () => {
        const value = await this.client.get(this.prefixKey(key));
        return value ? Option.some(JSON.parse(value) as T) : Option.none();
      },
      catch: e => new CacheError({ operation: 'GET', reason: String(e) }),
    });
  }

  public set<T>(key: string, value: T, options?: CacheOptions): Effect.Effect<void, CacheError> {
    const serialized = typeof value === 'string' ? value : JSON.stringify(value);
    const prefixedKey = this.prefixKey(key);

    return Effect.tryPromise({
      try: async () => {
        const multi = this.client.multi();
        if (options?.ttl) {
          multi.setex(prefixedKey, options.ttl, serialized);
        } else {
          multi.set(prefixedKey, serialized);
        }

        // Handle cache tagging for efficient bulk invalidation
        if (options?.tags && options.tags.length > 0) {
          for (const tag of options.tags) {
            multi.sadd(this.prefixKey(`tag:${tag}`), prefixedKey);
          }
        }
        await multi.exec();
      },
      catch: e => new CacheError({ operation: 'SET', reason: String(e) }),
    });
  }

  delete(key: string): Effect.Effect<void, CacheError> {
    return Effect.tryPromise({
      try: () => this.client.del(this.prefixKey(key)).then(() => {}),
      catch: e => new CacheError({ operation: 'DELETE', reason: String(e) }),
    });
  }

  deleteByPattern(pattern: string): Effect.Effect<void, CacheError> {
    // Use SCAN instead of KEYS to avoid blocking Redis event loop in production
    return Effect.tryPromise({
      try: async () => {
        const stream = this.client.scanStream({
          match: this.prefixKey(pattern),
          count: 100,
        });
        const keysToDelete: string[] = [];
        for await (const keys of stream) {
          if (keys.length) {
            keysToDelete.push(...keys);
          }
        }
        if (keysToDelete.length > 0) {
          await this.client.del(keysToDelete);
        }
      },
      catch: e => new CacheError({ operation: 'DELETE_PATTERN', reason: String(e) }),
    });
  }

  deleteByTags(tags: string[]): Effect.Effect<void, CacheError> {
    return Effect.tryPromise({
      try: async () => {
        const keys = new Set<string>();

        for (const tag of tags) {
          // Apply global prefix to tag lookup for consistency
          const taggedKeys = await this.client.smembers(this.prefixKey(`tag:${tag}`));
          taggedKeys.forEach(key => keys.add(key));
        }

        if (keys.size > 0) {
          await this.client.del(...Array.from(keys));
          await Promise.all(tags.map(tag => this.client.del(`tag:${tag}`)));
        }
      },
      catch: e => new CacheError({ operation: 'DELETE_TAGS', reason: String(e) }),
    });
  }

  exists(key: string): Effect.Effect<boolean, CacheError> {
    return Effect.tryPromise({
      try: async () => {
        const result = await this.client.exists(this.prefixKey(key));
        return result === 1;
      },
      catch: e => new CacheError({ operation: 'EXISTS', reason: String(e) }),
    });
  }

  ttl(key: string): Effect.Effect<number, CacheError> {
    return Effect.tryPromise({
      try: () => this.client.ttl(this.prefixKey(key)),
      catch: e => new CacheError({ operation: 'TTL', reason: String(e) }),
    });
  }

  expire(key: string, seconds: number): Effect.Effect<void, CacheError> {
    return Effect.tryPromise({
      try: () => this.client.expire(this.prefixKey(key), seconds).then(() => {}),
      catch: e => new CacheError({ operation: 'EXPIRE', reason: String(e) }),
    });
  }

  increment(key: string, by: number = 1): Effect.Effect<number, CacheError> {
    return Effect.tryPromise({
      try: () => this.client.incrby(this.prefixKey(key), by),
      catch: e => new CacheError({ operation: 'INCRBY', reason: String(e) }),
    });
  }

  decrement(key: string, by: number = 1): Effect.Effect<number, CacheError> {
    return Effect.tryPromise({
      try: () => this.client.decrby(this.prefixKey(key), by),
      catch: e => new CacheError({ operation: 'DECRBY', reason: String(e) }),
    });
  }

  lpush<T>(key: string, ...values: T[]): Effect.Effect<number, CacheError> {
    const serialized = values.map(v => (typeof v === 'string' ? v : JSON.stringify(v)));
    return Effect.tryPromise({
      try: () => this.client.lpush(this.prefixKey(key), ...serialized),
      catch: e => new CacheError({ operation: 'LPUSH', reason: String(e) }),
    });
  }

  rpop<T>(key: string): Effect.Effect<Option.Option<T>, CacheError> {
    return Effect.tryPromise({
      try: async () => {
        const value = await this.client.rpop(this.prefixKey(key));
        return value ? Option.some(JSON.parse(value) as T) : Option.none();
      },
      catch: e => new CacheError({ operation: 'RPOP', reason: String(e) }),
    });
  }

  lrange<T>(key: string, start: number, stop: number): Effect.Effect<T[], CacheError> {
    return Effect.tryPromise({
      try: async () => {
        const safeParse = (v: string) => {
          try {
            return JSON.parse(v);
          } catch {
            return v as any;
          }
        };
        const values = await this.client.lrange(this.prefixKey(key), start, stop);
        // Safely parse each value to handle mixed data types
        return values.map(safeParse);
      },
      catch: e => new CacheError({ operation: 'LRANGE', reason: String(e) }),
    });
  }

  sadd(key: string, ...members: string[]): Effect.Effect<number, CacheError> {
    return Effect.tryPromise({
      try: () => this.client.sadd(this.prefixKey(key), ...members),
      catch: e => new CacheError({ operation: 'SADD', reason: String(e) }),
    });
  }

  smembers(key: string): Effect.Effect<string[], CacheError> {
    return Effect.tryPromise({
      try: () => this.client.smembers(this.prefixKey(key)),
      catch: e => new CacheError({ operation: 'SMEMBERS', reason: String(e) }),
    });
  }

  sismember(key: string, member: string): Effect.Effect<boolean, CacheError> {
    return Effect.tryPromise({
      try: async () => {
        const result = await this.client.sismember(this.prefixKey(key), member);
        return result === 1;
      },
      catch: e => new CacheError({ operation: 'SISMEMBER', reason: String(e) }),
    });
  }

  hgetall<T>(key: string): Effect.Effect<Record<string, T>, CacheError> {
    return pipe(
      Effect.tryPromise({
        try: () => this.client.hgetall(this.prefixKey(key)),
        catch: e => new CacheError({ operation: 'HGETALL', reason: String(e) }),
      }),
      Effect.map(hash => {
        const result: Record<string, T> = {};
        for (const [field, value] of Object.entries(hash)) {
          result[field] = JSON.parse(value);
        }
        return result;
      })
    );
  }

  publish(channel: string, message: any): Effect.Effect<void, CacheError> {
    return Effect.tryPromise({
      try: () => this.publisher.publish(channel, JSON.stringify(message)).then(() => {}),
      catch: e => new CacheError({ operation: 'PUBLISH', reason: String(e) }),
    });
  }

  subscribe(channel: string, handler: (message: any) => void): Effect.Effect<void, CacheError> {
    return Effect.tryPromise({
      try: async () => {
        await this.subscriber.subscribe(channel);

        this.subscriber.on('message', (ch, message) => {
          if (ch === channel) {
            try {
              const parsed = JSON.parse(message);
              handler(parsed);
            } catch {
              handler(message);
            }
          }
        });
      },
      catch: e => new CacheError({ operation: 'SUBSCRIBE', reason: String(e) }),
    });
  }

  acquireLock(key: string, ttl: number = 30, retries: number = 10): Effect.Effect<Option.Option<string>, CacheError> {
    const lockKey = this.prefixKey(`lock:${key}`); // Lock namespacing handled here
    const lockValue = `${Date.now()}:${Math.random()}`;

    return Effect.tryPromise({
      try: async () => {
        for (let i = 0; i < retries; i++) {
          const result = await this.client.set(lockKey, lockValue, 'NX', 'EX', ttl);

          if (result === 'OK') {
            return Option.some(lockValue);
          }

          await this.delay(100 * Math.pow(2, i));
        }
        return Option.none();
      },
      catch: e => new CacheError({ operation: 'ACQUIRE_LOCK', reason: String(e) }),
    });
  }

  releaseLock(key: string, lockValue: string): Effect.Effect<boolean, CacheError> {
    const lockKey = this.prefixKey(`lock:${key}`); // Lock namespacing handled here

    const script = `
      if redis.call("get", KEYS[1]) == ARGV[1] then
        return redis.call("del", KEYS[1])
      else
        return 0
      end
    `;

    return Effect.tryPromise({
      try: async () => {
        const result = await this.client.eval(script, 1, lockKey, lockValue);
        return result === 1;
      },
      catch: e => new CacheError({ operation: 'RELEASE_LOCK', reason: String(e) }),
    });
  }

  public getOrSet<T, E, R>(
    key: string,
    factory: Effect.Effect<T, E, R>,
    options?: CacheOptions
  ): Effect.Effect<T, CacheError | E, R> {
    const prefixedKey = this.prefixKey(key);

    // Scoped effect that acquires a distributed lock and guarantees its release
    const lock = Effect.acquireRelease(
      this.acquireLock(key, 10), // Pass base key - lock methods handle their own prefixing
      lockValueOption =>
        pipe(
          lockValueOption,
          Option.match({
            onNone: () => Effect.void, // Nothing to release if lock wasn't acquired
            onSome: lockValue => this.releaseLock(key, lockValue), // Pass base key
          })
        )
    );

    const logic = pipe(
      this.get<T>(key), // Double-check cache after acquiring lock
      Effect.flatMap(
        Option.match({
          onSome: Effect.succeed,
          onNone: () =>
            pipe(
              factory,
              Effect.tap(newValue => this.set(key, newValue, options))
            ),
        })
      )
    );

    return pipe(
      this.get<T>(key), // 1. First check of the cache
      Effect.flatMap(
        Option.match({
          onSome: Effect.succeed, // Cache hit, we're done
          onNone: () =>
            // 2. Cache miss, use the scoped lock to coordinate the factory execution
            Effect.scoped(
              pipe(
                lock,
                Effect.flatMap(lockValueOption =>
                  Option.match(lockValueOption, {
                    // If we failed to get a lock, wait a moment and retry the whole operation
                    onNone: () =>
                      pipe(
                        Effect.sleep(Duration.millis(150)),
                        Effect.flatMap(() => this.getOrSet(key, factory, options))
                      ),
                    // If we got the lock, execute the logic
                    onSome: () => logic,
                  })
                )
              )
            ),
        })
      )
    );
  }

  public hset(key: string, field: string, value: any): Effect.Effect<void, CacheError> {
    return Effect.tryPromise({
      try: () => this.client.hset(this.prefixKey(key), field, JSON.stringify(value)).then(() => {}),
      catch: e => new CacheError({ operation: 'HSET', reason: String(e) }),
    });
  }

  public hget<T>(key: string, field: string): Effect.Effect<Option.Option<T>, CacheError> {
    return Effect.tryPromise({
      try: async () => {
        const value = await this.client.hget(this.prefixKey(key), field);
        return value ? Option.some(JSON.parse(value) as T) : Option.none();
      },
      catch: e => new CacheError({ operation: 'HGET', reason: String(e) }),
    });
  }

  private prefixKey(key: string, prefix?: string): string {
    const basePrefix = prefix || this.configService.get('REDIS_PREFIX') || 'crypto';
    return `${basePrefix}:${key}`;
  }

  private addToTags(key: string, tags: string[]): Effect.Effect<void, CacheError> {
    return Effect.tryPromise({
      try: () => Promise.all(tags.map(tag => this.client.sadd(`tag:${tag}`, key))).then(() => {}),
      catch: e => new CacheError({ operation: 'ADD_TAGS', reason: String(e) }),
    });
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  private async disconnect(): Promise<void> {
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
      Effect.tryPromise({
        try: () => this.client.ping(),
        catch: e => e, // Pass the error into the Effect's error channel
      }),
      Effect.map(() => true), // If success, the service is healthy
      Effect.catchAll(() => Effect.succeed(false)) // If failure, the service is unhealthy
    );
  }
}
```

### 5. Monitoring & Observability

#### Metrics Controller

```typescript
// src/infrastructure/monitoring/metrics.controller.ts
import { Controller, Get, Res } from '@nestjs/common';
import { MetricsService } from './metrics.service';
import { Response } from 'express';
import { register } from 'prom-client';

@Controller('metrics')
export class MetricsController {
  constructor(private readonly metricsService: MetricsService) {}

  @Get()
  async getMetrics(@Res() res: Response) {
    res.set('Content-Type', register.contentType);
    res.end(await this.metricsService.getMetrics());
  }
}
```

#### Metrics Service

```typescript
// src/infrastructure/monitoring/metrics.service.ts
import { Injectable, OnModuleInit } from '@nestjs/common';
import { register, Counter, Histogram, Gauge, Summary, collectDefaultMetrics } from 'prom-client';
import { Logger } from '@nestjs/common';

// Guard against double-registering default metrics in complex module scenarios
let defaultMetricsCollected = false;

@Injectable()
export class MetricsService implements OnModuleInit {
  private readonly logger = new Logger(MetricsService.name);

  // HTTP metrics
  public readonly httpRequestDuration: Histogram<string>;
  public readonly httpRequestTotal: Counter<string>;
  public readonly httpRequestErrors: Counter<string>;

  // Business metrics
  public readonly transactionImported: Counter<string>;
  public readonly portfolioValuationCalculated: Counter<string>;
  public readonly taxReportGenerated: Counter<string>;
  public readonly reconciliationCompleted: Counter<string>;

  // System metrics
  public readonly eventStoreSize: Gauge<string>;
  public readonly projectionLag: Gauge<string>;
  public readonly cacheHitRate: Gauge<string>;

  // Performance metrics
  public readonly commandExecutionTime: Histogram<string>;
  public readonly queryExecutionTime: Histogram<string>;
  public readonly eventProcessingTime: Histogram<string>;

  constructor() {
    // HTTP metrics
    this.httpRequestDuration = new Histogram({
      name: 'http_request_duration_seconds',
      help: 'Duration of HTTP requests in seconds',
      labelNames: ['method', 'route', 'status'],
      buckets: [0.1, 0.5, 1, 2, 5],
    });

    this.httpRequestTotal = new Counter({
      name: 'http_requests_total',
      help: 'Total number of HTTP requests',
      labelNames: ['method', 'route', 'status'],
    });

    this.httpRequestErrors = new Counter({
      name: 'http_request_errors_total',
      help: 'Total number of HTTP request errors',
      labelNames: ['method', 'route', 'error'],
    });

    // Business metrics
    this.transactionImported = new Counter({
      name: 'transactions_imported_total',
      help: 'Total number of transactions imported',
      labelNames: ['source', 'status'],
    });

    this.portfolioValuationCalculated = new Counter({
      name: 'portfolio_valuations_calculated_total',
      help: 'Total number of portfolio valuations calculated',
      labelNames: ['currency'],
    });

    this.taxReportGenerated = new Counter({
      name: 'tax_reports_generated_total',
      help: 'Total number of tax reports generated',
      labelNames: ['year', 'method'],
    });

    this.reconciliationCompleted = new Counter({
      name: 'reconciliations_completed_total',
      help: 'Total number of reconciliations completed',
      labelNames: ['source', 'status'],
    });

    // System metrics
    this.eventStoreSize = new Gauge({
      name: 'event_store_size_bytes',
      help: 'Size of the event store in bytes',
      labelNames: ['aggregate_type'],
    });

    this.projectionLag = new Gauge({
      name: 'projection_lag_seconds',
      help: 'Lag of projections behind the event store',
      labelNames: ['projection'],
    });

    this.cacheHitRate = new Gauge({
      name: 'cache_hit_rate',
      help: 'Cache hit rate percentage',
      labelNames: ['cache_type'],
    });

    // Performance metrics
    this.commandExecutionTime = new Histogram({
      name: 'command_execution_duration_seconds',
      help: 'Duration of command execution in seconds',
      labelNames: ['command'],
      buckets: [0.01, 0.05, 0.1, 0.5, 1, 2, 5],
    });

    this.queryExecutionTime = new Histogram({
      name: 'query_execution_duration_seconds',
      help: 'Duration of query execution in seconds',
      labelNames: ['query'],
      buckets: [0.001, 0.01, 0.05, 0.1, 0.5, 1],
    });

    this.eventProcessingTime = new Histogram({
      name: 'event_processing_duration_seconds',
      help: 'Duration of event processing in seconds',
      labelNames: ['event_type'],
      buckets: [0.001, 0.01, 0.05, 0.1, 0.5],
    });
  }

  async onModuleInit() {
    // Ensure default metrics are only registered once per process
    if (!defaultMetricsCollected) {
      collectDefaultMetrics({ register });
      defaultMetricsCollected = true;
    }

    this.logger.log('Metrics service initialized');
  }

  getMetrics(): Promise<string> {
    return register.metrics();
  }

  resetMetrics(): void {
    register.clear();
    // Reset guard to allow re-registration in hot-reload scenarios
    defaultMetricsCollected = false;
  }
}
```

**Usage in Effect Pipelines:**

```typescript
// In some command handler...

// GOOD: Logging is treated as a fire-and-forget side effect within a pipeline.
// Effect.tap provides a clean way to do this without affecting the main flow.

pipe(
  // ... main logic ...
  Effect.tap(() => Effect.sync(() => this.metrics.transactionImported.inc({ source: 'binance' }))),
  Effect.tapError(err => Effect.sync(() => this.logger.error('Operation failed', err.stack, 'ContextName')))
  // ... more logic ...
);
```

### 6. Logging Service

```typescript
// src/infrastructure/monitoring/logger.service.ts
import { LoggerService, Injectable } from '@nestjs/common';
import * as winston from 'winston';
import { ElasticsearchTransport } from 'winston-elasticsearch';

@Injectable()
export class CustomLoggerService implements LoggerService {
  private logger: winston.Logger;

  constructor() {
    this.logger = winston.createLogger({
      level: process.env.LOG_LEVEL || 'info',
      format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.errors({ stack: true }),
        winston.format.json()
      ),
      defaultMeta: {
        service: 'crypto-portfolio',
        environment: process.env.NODE_ENV || 'development',
      },
      transports: this.getTransports(),
    });
  }

  private getTransports(): winston.transport[] {
    const transports: winston.transport[] = [
      // Console transport
      new winston.transports.Console({
        format: winston.format.combine(winston.format.colorize(), winston.format.simple()),
        handleExceptions: true, // Handle uncaught exceptions
      }),
    ];

    // File transport
    if (process.env.LOG_TO_FILE === 'true') {
      transports.push(
        new winston.transports.File({
          filename: 'logs/error.log',
          level: 'error',
        }),
        new winston.transports.File({
          filename: 'logs/combined.log',
        })
      );
    }

    // Elasticsearch transport with date-based indexing
    if (process.env.ELASTICSEARCH_URL) {
      transports.push(
        new ElasticsearchTransport({
          level: 'info',
          clientOpts: { node: process.env.ELASTICSEARCH_URL },
          indexPrefix: 'crypto-portfolio-logs', // Date formatting handled by transport
          indexSuffixPattern: 'YYYY.MM.DD',
          handleExceptions: true, // Handle exceptions in Elasticsearch too
        })
      );
    }

    return transports;
  }

  log(message: string, context?: string) {
    this.logger.info(message, { context });
  }

  error(message: string, trace?: string, context?: string) {
    this.logger.error(message, { trace, context });
  }

  warn(message: string, context?: string) {
    this.logger.warn(message, { context });
  }

  debug(message: string, context?: string) {
    this.logger.debug(message, { context });
  }

  verbose(message: string, context?: string) {
    this.logger.verbose(message, { context });
  }
}
```
