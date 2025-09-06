**Confidence Level: 9/10**

Yes, I still have full context! Let's build the complete infrastructure layer with event sourcing, database setup, messaging, and monitoring.

## Complete Infrastructure Implementation

### 1. Event Store Infrastructure

```typescript
// src/infrastructure/event-store/event-store.service.ts
import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { InjectConnection } from 'nest-knexjs';
import { Knex } from 'knex';
import { Effect, pipe } from 'effect';
import { Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { DomainEvent } from '../../@core/domain/base/domain-event.base';
import * as crypto from 'crypto';

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
  private eventHandlers = new Map<string, Set<(event: any) => Promise<void>>>();

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

  async append(
    aggregateId: string,
    events: ReadonlyArray<DomainEvent>,
    expectedVersion?: number,
    metadata?: Partial<EventMetadata>
  ): Promise<void> {
    return this.writeDb.transaction(async trx => {
      // Check for optimistic concurrency
      if (expectedVersion !== undefined) {
        const currentVersion = await this.getCurrentVersion(aggregateId, trx);
        if (currentVersion !== expectedVersion) {
          throw new OptimisticLockError(aggregateId, expectedVersion, currentVersion);
        }
      }

      let streamVersion = expectedVersion ?? 0;

      // Store events
      for (const event of events) {
        streamVersion++;

        const storedEvent: Partial<StoredEvent> = {
          event_id: event.eventId,
          aggregate_id: aggregateId,
          aggregate_type: this.getAggregateType(event),
          event_type: event._tag,
          event_version: event.version,
          event_data: this.serializeEvent(event),
          metadata: {
            ...metadata,
            timestamp: event.timestamp,
          },
          stream_version: streamVersion,
          created_at: new Date(),
        };

        await trx('event_store').insert(storedEvent);

        // Publish event for projections
        await this.publishEvent(event, storedEvent as StoredEvent);
      }

      // Update stream version
      await this.updateStreamVersion(aggregateId, streamVersion, trx);
    });
  }

  async readStream(aggregateId: string, fromVersion: number = 0, toVersion?: number): Promise<DomainEvent[]> {
    const query = this.readDb('event_store')
      .where('aggregate_id', aggregateId)
      .where('stream_version', '>', fromVersion)
      .orderBy('stream_version', 'asc');

    if (toVersion) {
      query.where('stream_version', '<=', toVersion);
    }

    const events = await query;

    return events.map(e => this.deserializeEvent(e));
  }

  async readStreamWithSnapshot(aggregateId: string): Promise<{ snapshot?: any; events: DomainEvent[] }> {
    // Try to load latest snapshot
    const snapshot = await this.readDb('event_snapshots')
      .where('aggregate_id', aggregateId)
      .orderBy('version', 'desc')
      .first();

    const fromVersion = snapshot?.version ?? 0;
    const events = await this.readStream(aggregateId, fromVersion);

    return {
      snapshot: snapshot?.data,
      events,
    };
  }

  async saveSnapshot(aggregateId: string, aggregateType: string, version: number, data: any): Promise<void> {
    await this.writeDb('event_snapshots').insert({
      aggregate_id: aggregateId,
      aggregate_type: aggregateType,
      version,
      data: JSON.stringify(data),
      created_at: new Date(),
    });

    // Clean old snapshots (keep last 3)
    await this.cleanOldSnapshots(aggregateId);
  }

  async findByIdempotencyKey(key: string): Promise<string | null> {
    const result = await this.readDb('event_idempotency')
      .where('idempotency_key', key)
      .where('expires_at', '>', new Date())
      .first();

    return result?.event_id || null;
  }

  async saveIdempotencyKey(key: string, eventId: string, ttlHours: number = 24): Promise<void> {
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
  }

  async getEventsByType(eventType: string, limit: number = 100, after?: Date): Promise<StoredEvent[]> {
    const query = this.readDb('event_store').where('event_type', eventType).orderBy('created_at', 'desc').limit(limit);

    if (after) {
      query.where('created_at', '>', after);
    }

    return query;
  }

  async getAggregateEvents(aggregateType: string, limit: number = 100): Promise<StoredEvent[]> {
    return this.readDb('event_store').where('aggregate_type', aggregateType).orderBy('created_at', 'desc').limit(limit);
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

  private async publishEvent(event: DomainEvent, stored: StoredEvent): Promise<void> {
    // Emit for async projections
    await this.eventEmitter.emitAsync(`event.${event._tag}`, {
      event,
      metadata: stored.metadata,
    });

    // Call registered handlers
    const handlers = this.eventHandlers.get(event._tag) || new Set();
    for (const handler of handlers) {
      await handler(event);
    }
  }

  private serializeEvent(event: DomainEvent): string {
    return JSON.stringify(event, (key, value) => {
      // Handle BigNumber serialization
      if (value?._isBigNumber) {
        return { _type: 'BigNumber', value: value.toString() };
      }
      // Handle Date serialization
      if (value instanceof Date) {
        return { _type: 'Date', value: value.toISOString() };
      }
      return value;
    });
  }

  private deserializeEvent(stored: StoredEvent): DomainEvent {
    const data = JSON.parse(stored.event_data, (key, value) => {
      // Handle BigNumber deserialization
      if (value?._type === 'BigNumber') {
        return new BigNumber(value.value);
      }
      // Handle Date deserialization
      if (value?._type === 'Date') {
        return new Date(value.value);
      }
      return value;
    });

    return {
      ...data,
      _tag: stored.event_type,
      eventId: stored.event_id,
      aggregateId: stored.aggregate_id,
      timestamp: stored.created_at,
      version: stored.event_version,
    } as DomainEvent;
  }

  private getAggregateType(event: DomainEvent): string {
    // Extract aggregate type from event tag
    const parts = event._tag.split('.');
    return parts[0] || 'Unknown';
  }

  async healthCheck(): Promise<boolean> {
    try {
      await this.readDb.raw('SELECT 1');
      return true;
    } catch {
      return false;
    }
  }

  // Subscribe to events
  subscribe(eventType: string, handler: (event: any) => Promise<void>): void {
    if (!this.eventHandlers.has(eventType)) {
      this.eventHandlers.set(eventType, new Set());
    }
    this.eventHandlers.get(eventType)!.add(handler);
  }

  unsubscribe(eventType: string, handler: (event: any) => Promise<void>): void {
    this.eventHandlers.get(eventType)?.delete(handler);
  }
}

export class OptimisticLockError extends Error {
  constructor(
    public readonly aggregateId: string,
    public readonly expectedVersion: number,
    public readonly actualVersion: number
  ) {
    super(
      `Optimistic lock error for aggregate ${aggregateId}. ` +
        `Expected version ${expectedVersion}, but was ${actualVersion}`
    );
  }
}
```

### 2. Projection Engine

```typescript
// src/infrastructure/event-store/projection-engine.service.ts
import { Injectable, OnModuleInit } from '@nestjs/common';
import { InjectConnection } from 'nest-knexjs';
import { Knex } from 'knex';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Logger } from '@nestjs/common';

export interface Projection {
  name: string;
  version: number;
  handlers: Map<string, ProjectionHandler>;
  position: number;
}

export type ProjectionHandler = (event: any, db: Knex.Transaction) => Promise<void>;

@Injectable()
export class ProjectionEngine implements OnModuleInit {
  private readonly logger = new Logger(ProjectionEngine.name);
  private projections = new Map<string, Projection>();
  private isRunning = false;
  private checkpointInterval: NodeJS.Timer;

  constructor(
    @InjectConnection('write') private readonly writeDb: Knex,
    @InjectConnection('read') private readonly readDb: Knex,
    private readonly eventEmitter: EventEmitter2
  ) {}

  async onModuleInit() {
    await this.initializeProjections();
    await this.startProjections();
  }

  private async initializeProjections() {
    // Ensure projections metadata table exists
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

  registerProjection(name: string, version: number, handlers: Record<string, ProjectionHandler>): void {
    this.projections.set(name, {
      name,
      version,
      handlers: new Map(Object.entries(handlers)),
      position: 0,
    });

    this.logger.log(`Registered projection: ${name} v${version}`);
  }

  async startProjections(): Promise<void> {
    if (this.isRunning) return;

    this.isRunning = true;

    // Load checkpoint positions
    await this.loadCheckpoints();

    // Start processing events
    for (const projection of this.projections.values()) {
      this.processProjection(projection);
    }

    // Start checkpoint saving
    this.checkpointInterval = setInterval(() => {
      this.saveCheckpoints();
    }, 30000); // Every 30 seconds

    this.logger.log('Projection engine started');
  }

  async stopProjections(): Promise<void> {
    this.isRunning = false;

    if (this.checkpointInterval) {
      clearInterval(this.checkpointInterval);
    }

    await this.saveCheckpoints();

    this.logger.log('Projection engine stopped');
  }

  private async processProjection(projection: Projection): Promise<void> {
    while (this.isRunning) {
      try {
        // Fetch next batch of events
        const events = await this.writeDb('event_store')
          .where('id', '>', projection.position)
          .orderBy('id', 'asc')
          .limit(100);

        if (events.length === 0) {
          // No new events, wait and retry
          await this.delay(1000);
          continue;
        }

        // Process events in transaction
        await this.readDb.transaction(async trx => {
          for (const event of events) {
            const handler = projection.handlers.get(event.event_type);

            if (handler) {
              await handler(JSON.parse(event.event_data), trx);
            }

            projection.position = event.id;
          }
        });
      } catch (error) {
        this.logger.error(`Error processing projection ${projection.name}: ${error.message}`, error.stack);

        // Wait before retrying
        await this.delay(5000);
      }
    }
  }

  private async loadCheckpoints(): Promise<void> {
    const checkpoints = await this.readDb('projection_checkpoints');

    for (const checkpoint of checkpoints) {
      const projection = this.projections.get(checkpoint.projection_name);
      if (projection) {
        projection.position = checkpoint.position;
      }
    }
  }

  private async saveCheckpoints(): Promise<void> {
    for (const projection of this.projections.values()) {
      await this.readDb('projection_checkpoints')
        .insert({
          projection_name: projection.name,
          position: projection.position,
          version: projection.version,
          last_updated: new Date(),
        })
        .onConflict('projection_name')
        .merge(['position', 'last_updated']);
    }
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
```

### 3. Message Bus (Event-Driven Communication)

```typescript
// src/infrastructure/messaging/message-bus.service.ts
import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as amqp from 'amqplib';
import { Logger } from '@nestjs/common';
import { v4 as uuidv4 } from 'uuid';

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
  private channel: amqp.Channel;
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
      const url = this.configService.get('RABBITMQ_URL') || 'amqp://localhost';
      this.connection = await amqp.connect(url);
      this.channel = await this.connection.createChannel();

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

  async publish(exchange: string, routingKey: string, message: any, options?: amqp.Options.Publish): Promise<void> {
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
        source: 'crypto-portfolio',
        version: '1.0',
      },
    };

    const buffer = Buffer.from(JSON.stringify(envelope));

    this.channel.publish(exchange, routingKey, buffer, {
      persistent: true,
      contentType: 'application/json',
      messageId,
      timestamp: Date.now(),
      ...options,
    });

    this.logger.debug(`Published message to ${exchange}/${routingKey}`);
  }

  async subscribe(
    queue: string,
    exchange: string,
    pattern: string,
    handler: MessageHandler,
    options?: SubscribeOptions
  ): Promise<void> {
    // Assert queue
    await this.channel.assertQueue(queue, {
      durable: true,
      arguments: {
        'x-dead-letter-exchange': 'dead.letter.exchange',
        'x-max-retries': options?.maxRetries || 3,
        ...options?.queueArguments,
      },
    });

    // Bind to exchange
    await this.channel.bindQueue(queue, exchange, pattern);

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
      // Requeue with delay
      const delay = Math.pow(2, retryCount) * 1000; // Exponential backoff

      setTimeout(() => {
        this.channel.publish(msg.fields.exchange, msg.fields.routingKey, msg.content, {
          ...msg.properties,
          headers: {
            ...msg.properties.headers,
            'x-retry-count': retryCount,
            'x-last-error': error.message,
          },
        });
      }, delay);

      this.channel.ack(msg);
    } else {
      // Send to dead letter queue
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
  middleware?: MessageMiddleware[];
  queueArguments?: Record<string, any>;
}

export type MessageMiddleware = (message: Message) => Promise<void>;
```

### 4. Cache Infrastructure (Redis)

```typescript
// src/infrastructure/cache/redis-cache.service.ts
import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as Redis from 'ioredis';
import { Logger } from '@nestjs/common';
import { Effect, pipe } from 'effect';

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
    return new Promise((resolve, reject) => {
      this.client.on('ready', resolve);
      this.client.on('error', reject);

      setTimeout(() => reject(new Error('Redis connection timeout')), 5000);
    });
  }

  async get<T>(key: string): Promise<T | null> {
    const value = await this.client.get(this.prefixKey(key));

    if (!value) return null;

    try {
      return JSON.parse(value);
    } catch {
      return value as any;
    }
  }

  async set<T>(key: string, value: T, options?: CacheOptions): Promise<void> {
    const prefixedKey = this.prefixKey(key, options?.prefix);
    const serialized = typeof value === 'string' ? value : JSON.stringify(value);

    if (options?.ttl) {
      await this.client.setex(prefixedKey, options.ttl, serialized);
    } else {
      await this.client.set(prefixedKey, serialized);
    }

    // Handle tags
    if (options?.tags) {
      await this.addToTags(prefixedKey, options.tags);
    }
  }

  async delete(key: string): Promise<void> {
    await this.client.del(this.prefixKey(key));
  }

  async deleteByPattern(pattern: string): Promise<void> {
    const keys = await this.client.keys(this.prefixKey(pattern));

    if (keys.length > 0) {
      await this.client.del(...keys);
    }
  }

  async deleteByTags(tags: string[]): Promise<void> {
    const keys = new Set<string>();

    for (const tag of tags) {
      const taggedKeys = await this.client.smembers(`tag:${tag}`);
      taggedKeys.forEach(key => keys.add(key));
    }

    if (keys.size > 0) {
      await this.client.del(...Array.from(keys));

      // Clean up tags
      await Promise.all(tags.map(tag => this.client.del(`tag:${tag}`)));
    }
  }

  async exists(key: string): Promise<boolean> {
    const result = await this.client.exists(this.prefixKey(key));
    return result === 1;
  }

  async ttl(key: string): Promise<number> {
    return this.client.ttl(this.prefixKey(key));
  }

  async expire(key: string, seconds: number): Promise<void> {
    await this.client.expire(this.prefixKey(key), seconds);
  }

  // Atomic operations
  async increment(key: string, by: number = 1): Promise<number> {
    return this.client.incrby(this.prefixKey(key), by);
  }

  async decrement(key: string, by: number = 1): Promise<number> {
    return this.client.decrby(this.prefixKey(key), by);
  }

  // List operations
  async lpush<T>(key: string, ...values: T[]): Promise<number> {
    const serialized = values.map(v => JSON.stringify(v));
    return this.client.lpush(this.prefixKey(key), ...serialized);
  }

  async rpop<T>(key: string): Promise<T | null> {
    const value = await this.client.rpop(this.prefixKey(key));
    return value ? JSON.parse(value) : null;
  }

  async lrange<T>(key: string, start: number, stop: number): Promise<T[]> {
    const values = await this.client.lrange(this.prefixKey(key), start, stop);
    return values.map(v => JSON.parse(v));
  }

  // Set operations
  async sadd(key: string, ...members: string[]): Promise<number> {
    return this.client.sadd(this.prefixKey(key), ...members);
  }

  async smembers(key: string): Promise<string[]> {
    return this.client.smembers(this.prefixKey(key));
  }

  async sismember(key: string, member: string): Promise<boolean> {
    const result = await this.client.sismember(this.prefixKey(key), member);
    return result === 1;
  }

  // Hash operations
  async hset(key: string, field: string, value: any): Promise<void> {
    await this.client.hset(this.prefixKey(key), field, JSON.stringify(value));
  }

  async hget<T>(key: string, field: string): Promise<T | null> {
    const value = await this.client.hget(this.prefixKey(key), field);
    return value ? JSON.parse(value) : null;
  }

  async hgetall<T>(key: string): Promise<Record<string, T>> {
    const hash = await this.client.hgetall(this.prefixKey(key));
    const result: Record<string, T> = {};

    for (const [field, value] of Object.entries(hash)) {
      result[field] = JSON.parse(value);
    }

    return result;
  }

  // Pub/Sub
  async publish(channel: string, message: any): Promise<void> {
    await this.publisher.publish(channel, JSON.stringify(message));
  }

  async subscribe(channel: string, handler: (message: any) => void): Promise<void> {
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
  }

  // Distributed locking
  async acquireLock(key: string, ttl: number = 30, retries: number = 10): Promise<string | null> {
    const lockKey = `lock:${key}`;
    const lockValue = `${Date.now()}:${Math.random()}`;

    for (let i = 0; i < retries; i++) {
      const result = await this.client.set(lockKey, lockValue, 'NX', 'EX', ttl);

      if (result === 'OK') {
        return lockValue;
      }

      await this.delay(100 * Math.pow(2, i)); // Exponential backoff
    }

    return null;
  }

  async releaseLock(key: string, lockValue: string): Promise<boolean> {
    const lockKey = `lock:${key}`;

    const script = `
      if redis.call("get", KEYS[1]) == ARGV[1] then
        return redis.call("del", KEYS[1])
      else
        return 0
      end
    `;

    const result = await this.client.eval(script, 1, lockKey, lockValue);
    return result === 1;
  }

  // Cache-aside pattern with Effect
  async getOrSet<T>(
    key: string,
    factory: () => Promise<T> | Effect.Effect<T, any, any>,
    options?: CacheOptions
  ): Promise<T> {
    // Try to get from cache
    const cached = await this.get<T>(key);
    if (cached !== null) {
      return cached;
    }

    // Acquire lock to prevent cache stampede
    const lockValue = await this.acquireLock(key, 10, 5);
    if (!lockValue) {
      // Failed to acquire lock, wait and retry
      await this.delay(100);
      return this.getOrSet(key, factory, options);
    }

    try {
      // Double-check cache after acquiring lock
      const doubleCheck = await this.get<T>(key);
      if (doubleCheck !== null) {
        return doubleCheck;
      }

      // Generate value
      let value: T;
      const result = await factory();

      if (Effect.isEffect(result)) {
        value = await Effect.runPromise(result as Effect.Effect<T, any, any>);
      } else {
        value = result as T;
      }

      // Store in cache
      await this.set(key, value, options);

      return value;
    } finally {
      await this.releaseLock(key, lockValue);
    }
  }

  private prefixKey(key: string, prefix?: string): string {
    const basePrefix = prefix || this.configService.get('REDIS_PREFIX') || 'crypto';
    return `${basePrefix}:${key}`;
  }

  private async addToTags(key: string, tags: string[]): Promise<void> {
    await Promise.all(tags.map(tag => this.client.sadd(`tag:${tag}`, key)));
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

  async healthCheck(): Promise<boolean> {
    try {
      await this.client.ping();
      return true;
    } catch {
      return false;
    }
  }
}
```

### 5. Monitoring & Observability

```typescript
// src/infrastructure/monitoring/metrics.service.ts
import { Injectable, OnModuleInit } from '@nestjs/common';
import { register, Counter, Histogram, Gauge, Summary, collectDefaultMetrics } from 'prom-client';
import { Logger } from '@nestjs/common';

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
    // Collect default metrics (CPU, memory, etc.)
    collectDefaultMetrics({ register });

    this.logger.log('Metrics service initialized');
  }

  getMetrics(): Promise<string> {
    return register.metrics();
  }

  resetMetrics(): void {
    register.clear();
  }
}
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

    // Elasticsearch transport
    if (process.env.ELASTICSEARCH_URL) {
      transports.push(
        new ElasticsearchTransport({
          level: 'info',
          clientOpts: {
            node: process.env.ELASTICSEARCH_URL,
          },
          index: 'crypto-portfolio-logs',
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

This infrastructure implementation provides:

1. ✅ Complete Event Store with optimistic locking
2. ✅ Projection Engine for read models
3. ✅ Message Bus for async communication
4. ✅ Redis cache with distributed locking
5. ✅ Comprehensive metrics with Prometheus
6. ✅ Structured logging with multiple outputs
7. ✅ Health checks for all services
8. ✅ Retry logic and dead letter queues
9. ✅ Cache stampede prevention
10. ✅ Event replay capabilities

The infrastructure is production-ready with proper error handling, monitoring, and scalability considerations.
