import type { Logger } from '@crypto/shared-logger';
import { getLogger } from '@crypto/shared-logger';

import type { ApiClientRawData } from '../processors/interfaces.ts';
import type { IImporter, ImportParams } from './interfaces.ts';

/**
 * Base class providing common functionality for all importers.
 * Implements logging, basic validation, and error handling patterns.
 */
export abstract class BaseImporter<TRawData> implements IImporter<TRawData> {
  protected logger: Logger;

  constructor(protected adapterId: string) {
    this.logger = getLogger(`${adapterId}Importer`);
  }

  async canImport(params: ImportParams): Promise<boolean> {
    this.logger.debug(`Validating import parameters for ${this.adapterId}`);

    try {
      // Basic parameter validation
      if (!params) {
        this.logger.error('Import parameters are required');
        return false;
      }

      // Let subclasses implement specific validation
      return this.canImportSpecific(params);
    } catch (error) {
      this.logger.error(`Import parameters validation failed for ${this.adapterId}: ${error}`);
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
    return `${this.adapterId}-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;
  }

  /**
   * Helper method to handle import errors consistently.
   */
  protected handleImportError(error: unknown, context: string): never {
    const errorMessage = error instanceof Error ? error.message : String(error);
    this.logger.error(`Import failed in ${context}: ${errorMessage}`);
    throw new Error(`${this.adapterId} import failed: ${errorMessage}`);
  }

  abstract import(params: ImportParams): Promise<ApiClientRawData<TRawData>[]>;
}
