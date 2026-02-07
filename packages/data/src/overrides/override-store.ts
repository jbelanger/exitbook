import { randomUUID } from 'node:crypto';
import { createReadStream, existsSync } from 'node:fs';
import { appendFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { createInterface } from 'node:readline';

import { wrapError } from '@exitbook/core';
import { getDataDirectory } from '@exitbook/env';
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
 * Location: ${EXITBOOK_DATA_DIR}/overrides.jsonl
 */
export class OverrideStore {
  private readonly filePath: string;
  private readonly logger: Logger;

  constructor(dataDir?: string) {
    const dir = dataDir ?? getDataDirectory();
    this.filePath = path.join(dir, 'overrides.jsonl');
    this.logger = getLogger('OverrideStore');
  }

  /**
   * Append a new override event to the store
   * Returns the created event with generated ID and timestamp
   */
  async append(options: CreateOverrideEventOptions): Promise<Result<OverrideEvent, Error>> {
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
}
