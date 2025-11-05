import type { SourceType } from '@exitbook/core';
import { PartialImportError } from '@exitbook/exchanges';
import type { BlockchainProviderManager } from '@exitbook/providers';
import type { Logger } from '@exitbook/shared-logger';
import { getLogger } from '@exitbook/shared-logger';
import type { Result } from 'neverthrow';
import { err, ok } from 'neverthrow';

import { getBlockchainConfig } from '../infrastructure/blockchains/index.ts';
import { createExchangeImporter } from '../infrastructure/exchanges/shared/exchange-importer-factory.ts';
import type { ImportParams, ImportResult } from '../types/importers.ts';
import type { IDataSourceRepository, IRawDataRepository } from '../types/repositories.ts';
import {
  normalizeBlockchainImportParams,
  prepareImportSession,
  shouldReuseExistingImport,
} from './import-service-utils.ts';

export class TransactionImportService {
  private logger: Logger;

  constructor(
    private rawDataRepository: IRawDataRepository,
    private dataSourceRepository: IDataSourceRepository,
    private providerManager: BlockchainProviderManager
  ) {
    this.logger = getLogger('TransactionImportService');
  }

  /**
   * Import raw data from source and store it in external_transaction_data table.
   */
  async importFromSource(
    sourceId: string,
    sourceType: SourceType,
    params: ImportParams
  ): Promise<Result<ImportResult, Error>> {
    if (sourceType === 'exchange') {
      return this.importFromExchange(sourceId, params);
    } else {
      return this.importFromBlockchain(sourceId, params);
    }
  }

  /**
   * Import raw data from blockchain and store it in external_transaction_data table.
   */
  private async importFromBlockchain(sourceId: string, params: ImportParams): Promise<Result<ImportResult, Error>> {
    const sourceType = 'blockchain';
    this.logger.info(`Starting blockchain import for ${sourceId}`);

    // Normalize sourceId to lowercase for config lookup (registry keys are lowercase)
    const normalizedSourceId = sourceId.toLowerCase();

    // Get blockchain config
    const config = getBlockchainConfig(normalizedSourceId);
    if (!config) {
      return err(new Error(`Unknown blockchain: ${sourceId}`));
    }

    // Normalize and validate params using pure function
    const normalizedParamsResult = normalizeBlockchainImportParams(sourceId, params, config);
    if (normalizedParamsResult.isErr()) {
      return err(normalizedParamsResult.error);
    }
    const normalizedParams = normalizedParamsResult.value;

    // Check for existing completed import
    const existingDataSourceResult = await this.dataSourceRepository.findCompletedWithMatchingParams(
      sourceId,
      sourceType,
      normalizedParams
    );

    if (existingDataSourceResult.isErr()) {
      return err(existingDataSourceResult.error);
    }

    const existingDataSource = existingDataSourceResult.value;

    // Use pure function to decide if we should reuse existing import
    if (shouldReuseExistingImport(existingDataSource ?? null, normalizedParams)) {
      this.logger.info(
        `Found existing completed data source ${existingDataSource!.id} with matching parameters - reusing data`
      );

      const rawDataResult = await this.rawDataRepository.load({
        dataSourceId: existingDataSource!.id,
      });

      if (rawDataResult.isErr()) {
        return err(rawDataResult.error);
      }

      const rawDataCount = rawDataResult.value.length;

      return ok({
        imported: rawDataCount,
        dataSourceId: existingDataSource!.id,
      });
    }

    const startTime = Date.now();
    let dataSourceCreated = false;
    let dataSourceId = 0;
    try {
      const dataSourceCreateResult = await this.dataSourceRepository.create(sourceId, sourceType, normalizedParams);

      if (dataSourceCreateResult.isErr()) {
        return err(dataSourceCreateResult.error);
      }

      dataSourceId = dataSourceCreateResult.value;
      dataSourceCreated = true;
      this.logger.info(`Created data source: ${dataSourceId}`);

      const importer = config.createImporter(this.providerManager, normalizedParams.providerId);
      this.logger.info(`Importer for ${sourceId} created successfully`);

      this.logger.info('Starting raw data import...');
      const importResultOrError = await importer.import(normalizedParams);

      if (importResultOrError.isErr()) {
        return err(importResultOrError.error);
      }

      const importResult = importResultOrError.value;
      const rawData = importResult.rawTransactions;

      const savedCountResult = await this.rawDataRepository.saveBatch(dataSourceId, rawData);

      if (savedCountResult.isErr()) {
        return err(savedCountResult.error);
      }
      const savedCount = savedCountResult.value;

      if (dataSourceCreated && typeof dataSourceId === 'number') {
        this.logger.debug(`Finalizing import source ${dataSourceId} with ${savedCount} transactions`);
        const finalizeResult = await this.dataSourceRepository.finalize(
          dataSourceId,
          'completed',
          startTime,
          undefined,
          undefined,
          importResult.metadata
        );

        if (finalizeResult.isErr()) {
          return err(finalizeResult.error);
        }

        this.logger.debug(`Successfully finalized import source ${dataSourceId}`);
      }

      this.logger.info(`Import completed for ${sourceId}: ${savedCount} items saved`);

      return ok({
        imported: savedCount,
        dataSourceId,
      });
    } catch (error) {
      const originalError = error instanceof Error ? error : new Error(String(error));

      if (dataSourceCreated && typeof dataSourceId === 'number' && dataSourceId > 0) {
        const finalizeResult = await this.dataSourceRepository.finalize(
          dataSourceId,
          'failed',
          startTime,
          originalError.message,
          error instanceof Error ? { stack: error.stack } : { error: String(error) }
        );

        if (finalizeResult.isErr()) {
          this.logger.error(`Failed to update session on error: ${finalizeResult.error.message}`);
          return err(
            new Error(
              `Import failed: ${originalError.message}. Additionally, failed to update session: ${finalizeResult.error.message}`
            )
          );
        }
      }

      this.logger.error(`Import failed for ${sourceId}: ${originalError.message}`);
      return err(originalError);
    }
  }

  /**
   * Import raw data from exchange and store it in external_transaction_data table.
   * Handles validation errors by saving successful items and recording errors.
   * Supports resumption using per-operation-type cursors.
   */
  private async importFromExchange(sourceId: string, params: ImportParams): Promise<Result<ImportResult, Error>> {
    const sourceType = 'exchange';
    this.logger.info(`Starting exchange import for ${sourceId}`);

    // Check for existing data source
    const existingDataSourceResult = await this.dataSourceRepository.findBySource(sourceId);
    if (existingDataSourceResult.isErr()) {
      return err(existingDataSourceResult.error);
    }
    const existingDataSource = existingDataSourceResult.value[0];

    // Get latest cursor if resuming
    let latestCursor: Record<string, number> | null = null;
    if (existingDataSource) {
      const latestCursorResult = await this.rawDataRepository.getLatestCursor(existingDataSource.id);
      if (latestCursorResult.isOk() && latestCursorResult.value) {
        latestCursor = latestCursorResult.value;
      }
    }

    // Use pure function to prepare import session config
    const sessionConfig = prepareImportSession(sourceId, params, existingDataSource || null, latestCursor);

    const startTime = Date.now();
    let dataSourceCreated = false;
    let dataSourceId: number;

    if (sessionConfig.shouldResume && sessionConfig.existingDataSourceId) {
      dataSourceId = sessionConfig.existingDataSourceId;
      this.logger.info(`Resuming existing data source: ${dataSourceId}`);
      if (latestCursor) {
        this.logger.info(`Resuming from cursor: ${JSON.stringify(latestCursor)}`);
      }
    } else {
      const dataSourceCreateResult = await this.dataSourceRepository.create(sourceId, sourceType, sessionConfig.params);

      if (dataSourceCreateResult.isErr()) {
        return err(dataSourceCreateResult.error);
      }

      dataSourceId = dataSourceCreateResult.value;
      dataSourceCreated = true;
      this.logger.info(`Created new data source: ${dataSourceId}`);
    }

    try {
      const importerResult = await createExchangeImporter(sourceId, sessionConfig.params);

      if (importerResult.isErr()) {
        return err(importerResult.error);
      }

      const importer = importerResult.value;
      this.logger.info(`Importer for ${sourceId} created successfully`);

      this.logger.info('Starting raw data import...');
      const importResultOrError = await importer.import(sessionConfig.params);

      if (importResultOrError.isErr()) {
        const error = importResultOrError.error;

        if (error instanceof PartialImportError) {
          this.logger.warn(
            `Validation failed after ${error.successfulItems.length} successful items: ${error.message}`
          );

          let savedCount = 0;
          if (error.successfulItems.length > 0) {
            const saveResult = await this.rawDataRepository.saveBatch(dataSourceId, error.successfulItems);

            if (saveResult.isErr()) {
              this.logger.error(`Failed to save successful items: ${saveResult.error.message}`);
            } else {
              savedCount = saveResult.value;
              this.logger.info(`Saved ${savedCount} successful items before validation error`);
            }
          }

          const finalizeResult = await this.dataSourceRepository.finalize(
            dataSourceId,
            'failed',
            startTime,
            error.message,
            {
              failedItem: error.failedItem,
              lastSuccessfulCursor: error.lastSuccessfulCursor,
            }
          );

          if (finalizeResult.isErr()) {
            this.logger.error(`Failed to finalize session: ${finalizeResult.error.message}`);
          }

          return err(
            new Error(
              `Validation failed after ${savedCount} successful items: ${error.message}. ` +
                `Please fix the code to handle this data format, then re-import to resume from the last successful transaction.`
            )
          );
        }

        return err(error);
      }

      const importResult = importResultOrError.value;
      const rawData = importResult.rawTransactions;

      const savedCountResult = await this.rawDataRepository.saveBatch(dataSourceId, rawData);

      if (savedCountResult.isErr()) {
        return err(savedCountResult.error);
      }
      const savedCount = savedCountResult.value;

      const finalizeResult = await this.dataSourceRepository.finalize(
        dataSourceId,
        'completed',
        startTime,
        undefined,
        undefined,
        importResult.metadata
      );

      if (finalizeResult.isErr()) {
        return err(finalizeResult.error);
      }

      this.logger.info(`Import completed for ${sourceId}: ${savedCount} items saved`);

      return ok({
        imported: savedCount,
        dataSourceId,
      });
    } catch (error) {
      const originalError = error instanceof Error ? error : new Error(String(error));

      if (dataSourceCreated && typeof dataSourceId === 'number' && dataSourceId > 0) {
        const finalizeResult = await this.dataSourceRepository.finalize(
          dataSourceId,
          'failed',
          startTime,
          originalError.message,
          error instanceof Error ? { stack: error.stack } : { error: String(error) }
        );

        if (finalizeResult.isErr()) {
          this.logger.error(`Failed to update session on error: ${finalizeResult.error.message}`);
          return err(
            new Error(
              `Import failed: ${originalError.message}. Additionally, failed to update session: ${finalizeResult.error.message}`
            )
          );
        }
      }

      this.logger.error(`Import failed for ${sourceId}: ${originalError.message}`);
      return err(originalError);
    }
  }
}
