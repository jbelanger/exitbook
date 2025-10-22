import type { SourceType } from '@exitbook/core';
import { PartialImportError } from '@exitbook/exchanges';
import type { Logger } from '@exitbook/shared-logger';
import { getLogger } from '@exitbook/shared-logger';
import type { Result } from 'neverthrow';
import { err, ok } from 'neverthrow';

import type { IImporterFactory } from '../types/factories.ts';
import type { ImportParams, ImportResult } from '../types/importers.ts';
import type { IDataSourceRepository, IRawDataRepository } from '../types/repositories.ts';

export class TransactionImportService {
  private logger: Logger;

  constructor(
    private rawDataRepository: IRawDataRepository,
    private sessionRepository: IDataSourceRepository,
    private importerFactory: IImporterFactory
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

    const existingSessionResult = await this.sessionRepository.findCompletedWithMatchingParams(
      sourceId,
      sourceType,
      params
    );

    if (existingSessionResult.isErr()) {
      return err(existingSessionResult.error);
    }

    const existingSession = existingSessionResult.value;

    if (existingSession) {
      this.logger.info(
        `Found existing completed data source  ${existingSession.id} with matching parameters - reusing data`
      );

      const rawDataResult = await this.rawDataRepository.load({
        dataSourceId: existingSession.id,
      });

      if (rawDataResult.isErr()) {
        return err(rawDataResult.error);
      }

      const rawDataCount = rawDataResult.value.length;

      return ok({
        imported: rawDataCount,
        dataSourceId: existingSession.id,
      });
    }

    const startTime = Date.now();
    let sessionCreated = false;
    let dataSourceId = 0;
    try {
      const sessionIdResult = await this.sessionRepository.create(sourceId, sourceType, params);

      if (sessionIdResult.isErr()) {
        return err(sessionIdResult.error);
      }

      dataSourceId = sessionIdResult.value;
      sessionCreated = true;
      this.logger.info(`Created data source : ${dataSourceId}`);

      const importer = await this.importerFactory.create(sourceId, sourceType, params);

      if (!importer) {
        return err(new Error(`No importer found for blockchain ${sourceId}`));
      }
      this.logger.info(`Importer for ${sourceId} created successfully`);

      this.logger.info('Starting raw data import...');
      const importResultOrError = await importer.import(params);

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

      if (sessionCreated && typeof dataSourceId === 'number') {
        this.logger.debug(`Finalizing session ${dataSourceId} with ${savedCount} transactions`);
        const finalizeResult = await this.sessionRepository.finalize(
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

        this.logger.debug(`Successfully finalized session ${dataSourceId}`);
      }

      this.logger.info(`Import completed for ${sourceId}: ${savedCount} items saved`);

      return ok({
        imported: savedCount,
        dataSourceId,
      });
    } catch (error) {
      const originalError = error instanceof Error ? error : new Error(String(error));

      if (sessionCreated && typeof dataSourceId === 'number' && dataSourceId > 0) {
        const finalizeResult = await this.sessionRepository.finalize(
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

    const existingSessionsResult = await this.sessionRepository.findBySource(sourceId);

    if (existingSessionsResult.isErr()) {
      return err(existingSessionsResult.error);
    }

    const existingSession = existingSessionsResult.value[0];

    const startTime = Date.now();
    let sessionCreated = false;
    let dataSourceId: number;

    if (existingSession) {
      dataSourceId = existingSession.id;
      this.logger.info(`Resuming existing data source : ${dataSourceId}`);

      const latestCursorResult = await this.rawDataRepository.getLatestCursor(dataSourceId);
      if (latestCursorResult.isOk() && latestCursorResult.value) {
        const latestCursor = latestCursorResult.value;
        params.cursor = latestCursor;
        this.logger.info(`Resuming from cursor: ${JSON.stringify(latestCursor)}`);
      }
    } else {
      const sessionIdResult = await this.sessionRepository.create(sourceId, sourceType, params);

      if (sessionIdResult.isErr()) {
        return err(sessionIdResult.error);
      }

      dataSourceId = sessionIdResult.value;
      sessionCreated = true;
      this.logger.info(`Created new data source : ${dataSourceId}`);
    }

    try {
      const importer = await this.importerFactory.create(sourceId, sourceType, params);

      if (!importer) {
        return err(new Error(`No importer found for exchange ${sourceId}`));
      }
      this.logger.info(`Importer for ${sourceId} created successfully`);

      this.logger.info('Starting raw data import...');
      const importResultOrError = await importer.import(params);

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

          const finalizeResult = await this.sessionRepository.finalize(
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

      const finalizeResult = await this.sessionRepository.finalize(
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

      if (sessionCreated && typeof dataSourceId === 'number' && dataSourceId > 0) {
        const finalizeResult = await this.sessionRepository.finalize(
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
