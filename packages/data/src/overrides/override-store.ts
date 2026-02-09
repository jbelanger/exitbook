import { randomUUID } from 'node:crypto';
import { createReadStream, existsSync } from 'node:fs';
import { appendFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { createInterface } from 'node:readline';

import { wrapError } from '@exitbook/core';
import { getLogger, type Logger } from '@exitbook/logger';
import { err, ok, type Result } from 'neverthrow';

import { OverrideEventSchema, type OverrideEvent, type Scope } from './override.schemas.js';
import type { CreateOverrideEventOptions } from './override.types.js';

/**
 * Override Store - Append-only JSONL persistence for user override events
 *
 * Stores user decisions (confirmed links, manual prices, etc.) separately from
 * derived data so they survive database wipes and reprocessing.
 *
 * Format: JSONL (JSON Lines) - one JSON object per line
 * Location: ${dataDir}/overrides.jsonl
 *
 * Example content:
 * {"id":"abc-123","created_at":"2024-01-15T10:00:00Z","actor":"user","source":"cli","scope":"link","payload":{...}}
 * {"id":"def-456","created_at":"2024-01-15T11:00:00Z","actor":"user","source":"cli","scope":"price","payload":{...}}
 *
 * Events are replayed in chronological order during reprocessing.
 *
 * Concurrency: Uses a write queue to serialize append operations and prevent
 * interleaved writes that could corrupt the JSONL format.
 */
export class OverrideStore {
  private readonly filePath: string;
  private readonly logger: Logger;
  private writeQueue: Promise<unknown> = Promise.resolve();

  constructor(dataDir: string) {
    this.filePath = path.join(dataDir, 'overrides.jsonl');
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
    // Queue this write to ensure serialization
    this.writeQueue = this.writeQueue
      .then(() => this.appendImpl(options))
      .catch(() => {
        /* empty */
      }); // Prevent queue from stopping on error

    return this.writeQueue as Promise<Result<OverrideEvent, Error>>;
  }

  /**
   * Read all override events in chronological order
   * Events are returned in the order they were written (FIFO)
   */
  async readAll(): Promise<Result<OverrideEvent[], Error>> {
    try {
      if (!existsSync(this.filePath)) {
        this.logger.debug({ filePath: this.filePath }, 'Override file does not exist, returning empty array');
        return ok([]);
      }

      const events: OverrideEvent[] = [];
      const fileStream = createReadStream(this.filePath, 'utf-8');
      const rl = createInterface({
        input: fileStream,
        crlfDelay: Number.POSITIVE_INFINITY,
      });

      let lineNumber = 0;
      for await (const line of rl) {
        lineNumber++;

        if (!line.trim()) {
          continue;
        }

        let parsed: unknown;
        try {
          parsed = JSON.parse(line);
        } catch (parseError) {
          this.logger.warn({ lineNumber, line, error: parseError }, 'Failed to parse JSONL line, skipping');
          continue;
        }

        const validationResult = OverrideEventSchema.safeParse(parsed);
        if (!validationResult.success) {
          this.logger.warn(
            { lineNumber, error: validationResult.error, parsed },
            'Invalid override event in JSONL, skipping'
          );
          continue;
        }

        events.push(validationResult.data);
      }

      this.logger.debug({ count: events.length }, 'Read override events');
      return ok(events);
    } catch (error) {
      return wrapError(error, 'Failed to read override events');
    }
  }

  /**
   * Read override events filtered by scope
   */
  async readByScope(scope: Scope): Promise<Result<OverrideEvent[], Error>> {
    const allEventsResult = await this.readAll();
    if (allEventsResult.isErr()) {
      return err(allEventsResult.error);
    }

    const events = allEventsResult.value.filter((event) => event.scope === scope);
    this.logger.debug({ scope, count: events.length }, 'Read override events by scope');
    return ok(events);
  }

  /**
   * Get the file path for the override store
   */
  getFilePath(): string {
    return this.filePath;
  }

  /**
   * Check if the override store file exists
   */
  exists(): boolean {
    return existsSync(this.filePath);
  }

  /**
   * Internal implementation of append operation
   */
  private async appendImpl(options: CreateOverrideEventOptions): Promise<Result<OverrideEvent, Error>> {
    try {
      const event: OverrideEvent = {
        id: randomUUID(),
        created_at: new Date().toISOString(),
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

      // Ensure directory exists
      const dir = path.dirname(this.filePath);
      await mkdir(dir, { recursive: true });

      // Append event as JSONL (one line)
      const line = JSON.stringify(event) + '\n';
      await appendFile(this.filePath, line, 'utf-8');

      this.logger.info(
        {
          eventId: event.id,
          scope: event.scope,
        },
        'Appended override event'
      );

      return ok(event);
    } catch (error) {
      return wrapError(error, 'Failed to append override event');
    }
  }
}
