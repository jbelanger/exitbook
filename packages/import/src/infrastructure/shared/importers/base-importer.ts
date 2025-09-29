import type { Logger } from '@crypto/shared-logger';
import { getLogger } from '@crypto/shared-logger';

import type { IImporter, ImportParams, ImportRunResult } from '../../../app/ports/importers.ts';

/**
 * Base class providing common functionality for all importers.
 * Implements logging, basic validation, and error handling patterns.
 */
export abstract class BaseImporter implements IImporter {
  protected logger: Logger;

  constructor(protected sourceId: string) {
    this.logger = getLogger(`${sourceId}Importer`);
  }

  async canImport(params: ImportParams): Promise<boolean> {
    this.logger.debug(`Validating import parameters for ${this.sourceId}`);

    try {
      // Basic parameter validation
      if (!params) {
        this.logger.error('Import parameters are required');
        return false;
      }

      // Let subclasses implement specific validation
      return this.canImportSpecific(params);
    } catch (error) {
      this.logger.error(`Import parameters validation failed for ${this.sourceId}: ${String(error)}`);
      return false;
    }
  }

  /**
   * Subclasses should implement source-specific validation logic.
   */
  protected abstract canImportSpecific(params: ImportParams): Promise<boolean>;

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

  abstract import(params: ImportParams): Promise<ImportRunResult>;
}
