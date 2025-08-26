import type { Logger } from '@crypto/shared-logger';
import { getLogger } from '@crypto/shared-logger';

import type { IDependencyContainer, SessionInfo } from '../common/interfaces.ts';
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

  constructor(private dependencies: IDependencyContainer) {
    this.logger = getLogger('TransactionIngestionService');
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
  private generateSessionId(adapterId: string): string {
    const timestamp = Date.now();
    const random = Math.random().toString(36).substring(2, 8);
    return `${adapterId}-${timestamp}-${random}`;
  }

  /**
   * Get processing status summary for an adapter.
   */
  async getProcessingStatus(adapterId: string) {
    try {
      const [pending, processedItems, failedItems] = await Promise.all([
        this.dependencies.externalDataStore.load({
          adapterId,
          processingStatus: 'pending',
        }),
        this.dependencies.externalDataStore.load({
          adapterId,
          processingStatus: 'processed',
        }),
        this.dependencies.externalDataStore.load({
          adapterId,
          processingStatus: 'failed',
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
   * Get session information for tracking operations.
   */
  async getSessionInfo(adapterId: string, importSessionId: string): Promise<SessionInfo | null> {
    try {
      const rawData = await this.dependencies.externalDataStore.load({
        adapterId,
        importSessionId,
      });

      if (rawData.length === 0) {
        return null;
      }

      const firstItem = rawData[0];
      return {
        adapterId,
        adapterType: firstItem.adapterType,
        id: importSessionId,
        metadata: firstItem.metadata,
        providerId: firstItem.providerId,
        startedAt: firstItem.createdAt * 1000, // Convert to milliseconds
      };
    } catch (error) {
      this.logger.error(`Failed to get session info: ${error}`);
      return null;
    }
  }

  /**
   * Execute the full ETL pipeline: Import → Store Raw Data → Process → Load.
   */
  async importAndProcess(
    adapterId: string,
    adapterType: 'exchange' | 'blockchain',
    params: ImportParams
  ): Promise<{ imported: number; processed: number }> {
    this.logger.info(`Starting full ETL pipeline for ${adapterId} (${adapterType})`);

    try {
      // Step 1: Import raw data
      const importResult = await this.importFromSource(adapterId, adapterType, params);

      // Step 2: Process and load
      const processResult = await this.processAndStore(adapterId, adapterType, {
        importSessionId: importResult.importSessionId,
      });

      this.logger.info(
        `Completed full ETL pipeline for ${adapterId}: ${importResult.imported} imported, ${processResult.processed} processed`
      );

      return {
        imported: importResult.imported,
        processed: processResult.processed,
      };
    } catch (error) {
      this.logger.error(`ETL pipeline failed for ${adapterId}: ${error}`);
      throw error;
    }
  }

  /**
   * Import raw data from source and store it in external_transaction_data table.
   */
  async importFromSource(
    adapterId: string,
    adapterType: 'exchange' | 'blockchain',
    params: ImportParams
  ): Promise<ImportResult> {
    this.logger.info(`Starting import for ${adapterId} (${adapterType})`);

    try {
      // Create importer
      const importer = await ImporterFactory.create({
        adapterId,
        adapterType,
        dependencies: this.dependencies,
      });

      // Validate source before import
      const isValidSource = await importer.canImport(params);
      if (!isValidSource) {
        throw new Error(`Source validation failed for ${adapterId}`);
      }

      // Import raw data
      const rawData = await importer.import(params);

      // Generate session ID if not provided
      const importSessionId = params.importSessionId || this.generateSessionId(adapterId);

      // Save raw data to storage
      const savedCount = await this.dependencies.externalDataStore.save(
        adapterId,
        adapterType,
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

      this.logger.info(`Import completed for ${adapterId}: ${savedCount} items saved`);

      return {
        imported: savedCount,
        importSessionId,
        providerId: params.providerId ?? undefined,
      };
    } catch (error) {
      this.logger.error(`Import failed for ${adapterId}: ${error}`);
      throw error;
    }
  }

  /**
   * Process raw data from storage into UniversalTransaction format and save to database.
   */
  async processAndStore(
    adapterId: string,
    adapterType: 'exchange' | 'blockchain',
    filters?: LoadRawDataFilters
  ): Promise<ProcessResult> {
    this.logger.info(`Starting processing for ${adapterId} (${adapterType})`);

    try {
      // Load raw data from storage
      const loadFilters: LoadRawDataFilters = {
        adapterId,
        processingStatus: 'pending',
        ...filters,
      };

      const rawDataItems = await this.dependencies.externalDataStore.load(loadFilters);

      if (rawDataItems.length === 0) {
        this.logger.warn(`No pending raw data found for processing: ${adapterId}`);
        return { errors: [], failed: 0, processed: 0 };
      }

      this.logger.info(`Found ${rawDataItems.length} raw data items to process for ${adapterId}`);

      // Create processor
      const processor = await ProcessorFactory.create({
        adapterId,
        adapterType,
        dependencies: this.dependencies,
      });

      // Process raw data to UniversalTransaction
      const transactions = await processor.process(rawDataItems);

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

      // Mark raw data as processed
      const processedIds = rawDataItems.slice(0, transactions.length).map(item => item.sourceTransactionId);
      await this.dependencies.externalDataStore.markAsProcessed(adapterId, processedIds, filters?.providerId);

      // Mark failed items
      if (failed > 0) {
        const failedIds = rawDataItems.slice(transactions.length).map(item => item.sourceTransactionId);
        for (const failedId of failedIds) {
          await this.dependencies.externalDataStore.updateProcessingStatus(
            adapterId,
            failedId,
            'failed',
            'Processing or save failed',
            filters?.providerId
          );
        }
      }

      this.logger.info(`Processing completed for ${adapterId}: ${savedCount} processed, ${failed} failed`);

      return {
        errors,
        failed,
        processed: savedCount,
      };
    } catch (error) {
      this.logger.error(`Processing failed for ${adapterId}: ${error}`);
      throw error;
    }
  }
}
