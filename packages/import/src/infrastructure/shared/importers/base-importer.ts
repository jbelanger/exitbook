import type { IImporter, ImportParams, ImportRunResult } from '@exitbook/import/app/ports/importers.js';
import type { Logger } from '@exitbook/shared-logger';
import { getLogger } from '@exitbook/shared-logger';
import type { Result } from 'neverthrow';

/**
 * Base class providing common functionality for all importers.
 * Implements logging and error handling patterns.
 */
export abstract class BaseImporter implements IImporter {
  protected logger: Logger;

  constructor(protected sourceId: string) {
    this.logger = getLogger(`${sourceId}Importer`);
  }

  abstract import(params: ImportParams): Promise<Result<ImportRunResult, Error>>;

  /**
   * Helper method to generate session IDs.
   */
  protected generateSessionId(): string {
    return `${this.sourceId}-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;
  }

  /**
   * Helper method to handle import errors consistently.
   */
  protected handleImportError(error: unknown, context: string): never {
    const errorMessage = error instanceof Error ? error.message : String(error);
    this.logger.error(`Import failed in ${context}: ${errorMessage}`);
    throw new Error(`${this.sourceId} import failed: ${errorMessage}`);
  }
}
