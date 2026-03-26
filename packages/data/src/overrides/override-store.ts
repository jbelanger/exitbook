import { existsSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';

import { OverrideEventSchema, type OverrideEvent, type Scope } from '@exitbook/core';
import type { CreateOverrideEventOptions } from '@exitbook/core';
import { wrapError, randomUUID } from '@exitbook/foundation';
import { err, ok, type Result } from '@exitbook/foundation';
import { getLogger, type Logger } from '@exitbook/logger';
import type { Selectable } from '@exitbook/sqlite';

import { withOverridesDatabase } from './database.js';
import type { OverrideEventsTable } from './schema.js';

/**
 * Override Store - durable SQLite persistence for user override events
 *
 * Stores user decisions (confirmed links, manual prices, etc.) separately from
 * derived data so they survive database wipes and reprocessing.
 *
 * Storage: ${dataDir}/overrides.db
 *
 * Events are returned in append order via an autoincrement sequence column.
 * Writes are still serialized by an internal queue so command-level callers
 * keep the same "append and continue" behavior as before.
 */
export class OverrideStore {
  private readonly dbPath: string;
  private readonly logger: Logger;
  private writeQueue: Promise<void> = Promise.resolve();

  constructor(dataDir: string) {
    this.dbPath = path.join(dataDir, 'overrides.db');
    this.logger = getLogger('OverrideStore');
  }

  /**
   * Append a new override event to the store
   * Returns the created event with generated ID and timestamp
   *
   * Thread-safe: Uses a write queue to serialize appends and prevent
   * concurrent writes from corrupting the JSONL file.
   */
  async append(options: CreateOverrideEventOptions): Promise<Result<OverrideEvent, Error>> {
    // Queue this write to ensure serialization while returning the operation result.
    // The queue itself is always reset to a resolved state so later appends continue.
    const appendResult = this.writeQueue.then(() => this.appendImpl(options));

    this.writeQueue = appendResult
      .then(() => void 0)
      .catch((error: unknown) => {
        this.logger.error({ error }, 'Unexpected write queue failure, continuing with next write');
      });

    return appendResult.catch((error: unknown) => wrapError(error, 'Write queue failure'));
  }

  /**
   * Read all override events in chronological order
   * Events are returned in the order they were written (FIFO)
   */
  async readAll(): Promise<Result<OverrideEvent[], Error>> {
    try {
      const ensureResult = await this.ensureDatabaseReady();
      if (ensureResult.isErr()) {
        return err(ensureResult.error);
      }

      if (!ensureResult.value) {
        this.logger.debug({ dbPath: this.dbPath }, 'Override database does not exist, returning empty array');
        return ok([]);
      }

      return withOverridesDatabase(this.dbPath, async (db) => {
        try {
          const rows = await db.selectFrom('override_events').selectAll().orderBy('sequence_id', 'asc').execute();

          const eventsResult = this.parseStoredEvents(rows);
          if (eventsResult.isErr()) {
            return err(eventsResult.error);
          }

          this.logger.debug({ count: eventsResult.value.length }, 'Read override events');
          return ok(eventsResult.value);
        } catch (error) {
          return wrapError(error, 'Failed to read override events');
        }
      });
    } catch (error) {
      return wrapError(error, 'Failed to read override events');
    }
  }

  /**
   * Read override events filtered by scope
   */
  async readByScope(profileKey: string, scope: Scope): Promise<Result<OverrideEvent[], Error>> {
    const eventsResult = await this.readByScopes(profileKey, [scope]);
    if (eventsResult.isErr()) {
      return err(eventsResult.error);
    }

    this.logger.debug({ profileKey, scope, count: eventsResult.value.length }, 'Read override events by scope');
    return ok(eventsResult.value);
  }

  /**
   * Read override events filtered by multiple scopes while preserving append order.
   */
  async readByScopes(profileKey: string, scopes: Scope[]): Promise<Result<OverrideEvent[], Error>> {
    try {
      if (scopes.length === 0) {
        return ok([]);
      }

      const ensureResult = await this.ensureDatabaseReady();
      if (ensureResult.isErr()) {
        return err(ensureResult.error);
      }

      if (!ensureResult.value) {
        this.logger.debug(
          { dbPath: this.dbPath, profileKey, scopes },
          'Override database does not exist, returning empty array'
        );
        return ok([]);
      }

      return withOverridesDatabase(this.dbPath, async (db) => {
        try {
          const rows = await db
            .selectFrom('override_events')
            .selectAll()
            .where('profile_key', '=', profileKey)
            .where('scope', 'in', scopes)
            .orderBy('sequence_id', 'asc')
            .execute();

          const eventsResult = this.parseStoredEvents(rows);
          if (eventsResult.isErr()) {
            return err(eventsResult.error);
          }

          this.logger.debug({ profileKey, scopes, count: eventsResult.value.length }, 'Read override events by scopes');
          return ok(eventsResult.value);
        } catch (error) {
          return wrapError(error, 'Failed to read override events by scopes');
        }
      });
    } catch (error) {
      return wrapError(error, 'Failed to read override events by scopes');
    }
  }

  async findLatestCreatedAt(profileKey: string, scopes: Scope[]): Promise<Result<Date | undefined, Error>> {
    try {
      if (scopes.length === 0) {
        return ok(undefined);
      }

      const ensureResult = await this.ensureDatabaseReady();
      if (ensureResult.isErr()) {
        return err(ensureResult.error);
      }

      if (!ensureResult.value) {
        this.logger.debug(
          { dbPath: this.dbPath, profileKey, scopes },
          'Override database does not exist, no latest timestamp'
        );
        return ok(undefined);
      }

      return withOverridesDatabase(this.dbPath, async (db) => {
        try {
          const row = await db
            .selectFrom('override_events')
            .select(({ fn }) => [fn.max<string>('created_at').as('latest')])
            .where('profile_key', '=', profileKey)
            .where('scope', 'in', scopes)
            .executeTakeFirst();

          if (!row?.latest) {
            return ok(undefined);
          }

          const latestCreatedAt = new Date(row.latest);
          if (Number.isNaN(latestCreatedAt.getTime())) {
            return err(new Error(`Invalid override event timestamp stored in database: ${row.latest}`));
          }

          return ok(latestCreatedAt);
        } catch (error) {
          return wrapError(error, 'Failed to read latest override event timestamp by scopes');
        }
      });
    } catch (error) {
      return wrapError(error, 'Failed to read latest override event timestamp by scopes');
    }
  }

  /**
   * Get the file path for the override store
   */
  getFilePath(): string {
    return this.dbPath;
  }

  /**
   * Check if the override store file exists
   */
  exists(): boolean {
    return existsSync(this.dbPath);
  }

  /**
   * Internal implementation of append operation
   */
  private async appendImpl(options: CreateOverrideEventOptions): Promise<Result<OverrideEvent, Error>> {
    try {
      const event: OverrideEvent = {
        id: randomUUID(),
        created_at: new Date().toISOString(),
        profile_key: options.profileKey,
        actor: 'user',
        source: 'cli',
        scope: options.scope,
        payload: options.payload,
        reason: options.reason,
      };

      // Validate event with schema
      const validationResult = OverrideEventSchema.safeParse(event);
      if (!validationResult.success) {
        this.logger.error({ validationError: validationResult.error, event }, 'Invalid override event');
        return err(new Error(`Invalid override event: ${validationResult.error.message}`));
      }

      const ensureResult = await this.ensureDatabaseReady({ createIfMissing: true });
      if (ensureResult.isErr()) {
        return err(ensureResult.error);
      }

      return withOverridesDatabase(this.dbPath, async (db) => {
        try {
          await db
            .insertInto('override_events')
            .values({
              event_id: event.id,
              created_at: event.created_at,
              profile_key: event.profile_key,
              actor: event.actor,
              source: event.source,
              scope: event.scope,
              reason: event.reason,
              payload_json: JSON.stringify(event.payload),
            })
            .execute();

          this.logger.info(
            {
              eventId: event.id,
              profileKey: event.profile_key,
              scope: event.scope,
            },
            'Appended override event'
          );

          return ok(event);
        } catch (error) {
          return wrapError(error, 'Failed to persist override event');
        }
      });
    } catch (error) {
      return wrapError(error, 'Failed to append override event');
    }
  }

  private async ensureDatabaseReady(options?: {
    createIfMissing?: boolean | undefined;
  }): Promise<Result<boolean, Error>> {
    try {
      if (existsSync(this.dbPath)) {
        return ok(true);
      }

      if (!options?.createIfMissing) {
        return ok(false);
      }

      await mkdir(path.dirname(this.dbPath), { recursive: true });
      const dbReadyResult = await withOverridesDatabase(this.dbPath, async () => ok(undefined));

      if (dbReadyResult.isErr()) {
        return err(dbReadyResult.error);
      }

      return ok(true);
    } catch (error) {
      return wrapError(error, 'Failed to initialize override database');
    }
  }

  private parseStoredEvents(rows: Selectable<OverrideEventsTable>[]): Result<OverrideEvent[], Error> {
    const events: OverrideEvent[] = [];

    for (const row of rows) {
      const parsedPayload: unknown = JSON.parse(row.payload_json);
      const eventCandidate = {
        id: row.event_id,
        created_at: row.created_at,
        profile_key: row.profile_key,
        actor: row.actor,
        source: row.source,
        scope: row.scope as Scope,
        reason: row.reason ?? undefined,
        payload: parsedPayload,
      };

      const validationResult = OverrideEventSchema.safeParse(eventCandidate);
      if (!validationResult.success) {
        return err(new Error(`Invalid override event stored in database: ${validationResult.error.message}`));
      }

      events.push(validationResult.data);
    }

    return ok(events);
  }
}
