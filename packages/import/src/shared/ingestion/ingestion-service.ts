import type { UniversalTransaction } from '@crypto/core';
import { ImportSessionRepository } from '@crypto/data';
import type { Logger } from '@crypto/shared-logger';
import { getLogger } from '@crypto/shared-logger';

import type { IDependencyContainer } from '../common/interfaces.ts';
import { ImporterFactory } from '../importers/importer-factory.ts';
import type { ImportParams, ImportResult } from '../importers/interfaces.ts';
import type { ProcessResult } from '../processors/interfaces.ts';
import { ProcessorFactory } from '../processors/processor-factory.ts';
import type { LoadRawDataFilters } from '../storage/interfaces.ts';

/**
 * Manages the ETL pipeline for cryptocurrency transaction data.
 * Handles the Import → Process → Load workflow with proper error handling
 * and dependency injection.
 */
export class TransactionIngestionService {
  private logger: Logger;
  private sessionRepository: ImportSessionRepository;

  constructor(private dependencies: IDependencyContainer) {
    this.logger = getLogger('TransactionIngestionService');
    this.sessionRepository = new ImportSessionRepository(dependencies.database);
  }

  /**
   * Extract transaction ID from raw data for storage.
   */
  private extractTransactionId(rawData: Record<string, unknown>, fallbackIndex: number): string {
    // Try common transaction ID fields
    if (rawData.txid && typeof rawData.txid === 'string') return rawData.txid;
    if (rawData.id && typeof rawData.id === 'string') return rawData.id;
    if (rawData.hash && typeof rawData.hash === 'string') return rawData.hash;
    if (rawData.transactionId && typeof rawData.transactionId === 'string') return rawData.transactionId;

    // Fallback to index-based ID
    return `item-${fallbackIndex}`;
  }

  /**
   * Generate a unique session ID for tracking import operations.
   */
  private generateSessionId(sourceId: string): string {
    const timestamp = Date.now();
    const random = Math.random().toString(36).substring(2, 8);
    return `${sourceId}-${timestamp}-${random}`;
  }

  /**
   * Get processing status summary for a source.
   */
  async getProcessingStatus(sourceId: string) {
    try {
      const [pending, processedItems, failedItems] = await Promise.all([
        this.dependencies.externalDataStore.load({
          processingStatus: 'pending',
          sourceId: sourceId,
        }),
        this.dependencies.externalDataStore.load({
          processingStatus: 'processed',
          sourceId: sourceId,
        }),
        this.dependencies.externalDataStore.load({
          processingStatus: 'failed',
          sourceId: sourceId,
        }),
      ]);

      return {
        failed: failedItems.length,
        pending: pending.length,
        processed: processedItems.length,
        total: pending.length + processedItems.length + failedItems.length,
      };
    } catch (error) {
      this.logger.error(`Failed to get processing status: ${error}`);
      throw error;
    }
  }

  /**
   * Execute the full ETL pipeline: Import → Store Raw Data → Process → Load.
   */
  async importAndProcess(
    sourceId: string,
    sourceType: 'exchange' | 'blockchain',
    params: ImportParams
  ): Promise<{ imported: number; processed: number }> {
    this.logger.info(`Starting full ETL pipeline for ${sourceId} (${sourceType})`);

    try {
      // Step 1: Import raw data
      const importResult = await this.importFromSource(sourceId, sourceType, params);

      // Step 2: Process and load
      const processResult = await this.processAndStore(sourceId, sourceType, {
        importSessionId: importResult.importSessionId,
      });

      this.logger.info(
        `Completed full ETL pipeline for ${sourceId}: ${importResult.imported} imported, ${processResult.processed} processed`
      );

      return {
        imported: importResult.imported,
        processed: processResult.processed,
      };
    } catch (error) {
      this.logger.error(`ETL pipeline failed for ${sourceId}: ${error}`);
      throw error;
    }
  }

  /**
   * Import raw data from source and store it in external_transaction_data table.
   */
  async importFromSource(
    sourceId: string,
    sourceType: 'exchange' | 'blockchain',
    params: ImportParams
  ): Promise<ImportResult> {
    this.logger.info(`Starting import for ${sourceId} (${sourceType})`);

    const startTime = Date.now();
    let importSessionId = params.importSessionId;
    let sessionCreated = false;

    try {
      // Create import session if not provided
      if (!importSessionId) {
        importSessionId = this.generateSessionId(sourceId);
        this.logger.debug(`Generated session ID: ${importSessionId}`);
        const actualSessionId = await this.sessionRepository.create(
          importSessionId,
          sourceId,
          sourceType,
          params.providerId,
          {
            addresses: params.addresses,
            csvDirectories: params.csvDirectories,
            importedAt: Date.now(),
            importParams: params,
          }
        );
        this.logger.debug(`Repository returned session ID: ${actualSessionId}`);
        sessionCreated = true;
        this.logger.debug(`Created import session: ${importSessionId}`);
      }

      // Create importer
      const importer = await ImporterFactory.create({
        dependencies: this.dependencies,
        providerId: params.providerId,
        sourceId: sourceId,
        sourceType: sourceType,
      });

      // Validate source before import
      const isValidSource = await importer.canImport(params);
      if (!isValidSource) {
        throw new Error(`Source validation failed for ${sourceId}`);
      }

      // Import raw data
      const importResult = await importer.import(params);
      const rawData = importResult.rawData;

      // Save raw data to storage
      const savedCount = await this.dependencies.externalDataStore.save(
        sourceId,
        sourceType,
        rawData.map((item, index) => ({
          data: item,
          id: this.extractTransactionId(item.rawData as Record<string, unknown>, index),
        })),
        {
          importSessionId: importSessionId ?? undefined,
          metadata: {
            importedAt: Date.now(),
            importParams: params,
          },
          providerId: params.providerId ?? undefined,
        }
      );

      // Update session with success and metadata
      if (sessionCreated) {
        this.logger.debug(`Finalizing session ${importSessionId} with ${savedCount} transactions`);
        await this.sessionRepository.finalize(importSessionId, 'completed', startTime, savedCount, 0);

        // Update session with import metadata if available
        if (importResult.metadata) {
          const sessionMetadata = {
            addresses: params.addresses,
            csvDirectories: params.csvDirectories,
            importedAt: Date.now(),
            importParams: params,
            ...importResult.metadata,
          };

          await this.sessionRepository.update(importSessionId, { sessionMetadata });
          this.logger.debug(
            `Updated session ${importSessionId} with metadata keys: ${Object.keys(importResult.metadata).join(', ')}`
          );
        }

        this.logger.debug(`Successfully finalized session ${importSessionId}`);
      }

      this.logger.info(`Import completed for ${sourceId}: ${savedCount} items saved`);

      return {
        imported: savedCount,
        importSessionId,
        providerId: params.providerId ?? undefined,
      };
    } catch (error) {
      // Update session with error if we created it
      if (sessionCreated && importSessionId) {
        try {
          await this.sessionRepository.finalize(
            importSessionId,
            'failed',
            startTime,
            0,
            0,
            error instanceof Error ? error.message : String(error),
            error instanceof Error ? { stack: error.stack } : { error: String(error) }
          );
        } catch (sessionError) {
          this.logger.error(`Failed to update session on error: ${sessionError}`);
        }
      }

      this.logger.error(`Import failed for ${sourceId}: ${error}`);
      throw error;
    }
  }

  /**
   * Process raw data from storage into UniversalTransaction format and save to database.
   */
  async processAndStore(
    sourceId: string,
    sourceType: 'exchange' | 'blockchain',
    filters?: LoadRawDataFilters
  ): Promise<ProcessResult> {
    this.logger.info(`Starting processing for ${sourceId} (${sourceType})`);

    try {
      // Load raw data from storage
      const loadFilters: LoadRawDataFilters = {
        processingStatus: 'pending',
        sourceId: sourceId,
        ...filters,
      };

      const rawDataItems = await this.dependencies.externalDataStore.load(loadFilters);

      if (rawDataItems.length === 0) {
        this.logger.warn(`No pending raw data found for processing: ${sourceId}`);
        return { errors: [], failed: 0, processed: 0 };
      }

      this.logger.info(`Found ${rawDataItems.length} raw data items to process for ${sourceId}`);

      // Group raw data items by import session ID
      const sessionGroups = new Map<string | undefined, typeof rawDataItems>();
      for (const item of rawDataItems) {
        const sessionId = item.importSessionId;
        if (!sessionGroups.has(sessionId)) {
          sessionGroups.set(sessionId, []);
        }
        sessionGroups.get(sessionId)!.push(item);
      }

      this.logger.info(`Processing ${sessionGroups.size} session groups`);

      const allTransactions: UniversalTransaction[] = [];

      // Process each session group with its own context
      for (const [sessionId, sessionItems] of sessionGroups) {
        // Get session metadata for this group
        let sessionMetadata: unknown = undefined;
        if (sessionId) {
          try {
            const session = await this.sessionRepository.findById(sessionId);
            sessionMetadata = session?.sessionMetadata;
          } catch (error) {
            this.logger.warn(`Failed to fetch session metadata for ${sessionId}: ${error}`);
          }
        }

        // Create processor with session-specific context
        const processor = await ProcessorFactory.create({
          dependencies: this.dependencies,
          sessionMetadata,
          sourceId: sourceId,
          sourceType: sourceType,
        });

        // Process this session's raw data
        const sessionTransactions = await processor.process(sessionItems);
        allTransactions.push(...sessionTransactions);

        this.logger.debug(
          `Processed ${sessionTransactions.length} transactions for session ${sessionId || 'undefined'}`
        );
      }

      const transactions = allTransactions;

      // Save processed transactions to database
      // Note: This would typically use a transaction service, but for now we'll use the database directly
      let savedCount = 0;
      let failed = 0;
      const errors: string[] = [];

      for (const transaction of transactions) {
        try {
          await this.dependencies.database.saveTransaction(
            transaction as unknown as Parameters<typeof this.dependencies.database.saveTransaction>[0]
          ); // Cast needed for enhanced transaction type
          savedCount++;
        } catch (error) {
          failed++;
          const errorMessage = error instanceof Error ? error.message : String(error);
          errors.push(`Failed to save transaction ${transaction.id}: ${errorMessage}`);
          this.logger.error(`Failed to save transaction ${transaction.id}: ${errorMessage}`);
        }
      }

      // Mark all raw data items as processed - both those that generated transactions and those that were skipped
      const allRawDataIds = rawDataItems.map(item => item.sourceTransactionId);
      await this.dependencies.externalDataStore.markAsProcessed(sourceId, allRawDataIds, filters?.providerId);

      // Log the processing results
      const skippedCount = rawDataItems.length - transactions.length;
      if (skippedCount > 0) {
        this.logger.info(`${skippedCount} items were processed but skipped (likely non-standard operation types)`);
      }

      this.logger.info(`Processing completed for ${sourceId}: ${savedCount} processed, ${failed} failed`);

      return {
        errors,
        failed,
        processed: savedCount,
      };
    } catch (error) {
      this.logger.error(`Processing failed for ${sourceId}: ${error}`);
      throw error;
    }
  }
}
