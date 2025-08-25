import { getLogger } from '@crypto/shared-logger';
import type { Logger } from '@crypto/shared-logger';

import type { IImporter, ImportParams, ValidationResult } from './interfaces.ts';

/**
 * Base class providing common functionality for all importers.
 * Implements logging, basic validation, and error handling patterns.
 */
export abstract class BaseImporter<TRawData> implements IImporter<TRawData> {
  protected logger: Logger;

  constructor(protected adapterId: string) {
    this.logger = getLogger(`${adapterId}Importer`);
  }

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

  abstract importFromSource(params: ImportParams): Promise<TRawData[]>;

  validateRawData(data: TRawData[]): ValidationResult {
    this.logger.debug(`Validating ${data.length} raw data items for ${this.adapterId}`);

    const result: ValidationResult = {
      errors: [],
      isValid: true,
      warnings: [],
    };

    if (!Array.isArray(data)) {
      result.isValid = false;
      result.errors.push('Raw data must be an array');
      return result;
    }

    if (data.length === 0) {
      result.warnings.push('No data imported');
    }

    // Let subclasses add specific validation
    return this.validateRawDataSpecific(data, result);
  }

  /**
   * Subclasses can add specific raw data validation logic.
   */
  protected validateRawDataSpecific(_data: TRawData[], result: ValidationResult): ValidationResult {
    // Default implementation - subclasses can override
    return result;
  }

  async validateSource(params: ImportParams): Promise<boolean> {
    this.logger.debug(`Validating source for ${this.adapterId}`);

    try {
      // Basic parameter validation
      if (!params) {
        this.logger.error('Import parameters are required');
        return false;
      }

      // Let subclasses implement specific validation
      return this.validateSourceSpecific(params);
    } catch (error) {
      this.logger.error(`Source validation failed for ${this.adapterId}: ${error}`);
      return false;
    }
  }

  /**
   * Subclasses should implement source-specific validation logic.
   */
  protected abstract validateSourceSpecific(params: ImportParams): Promise<boolean>;
}
