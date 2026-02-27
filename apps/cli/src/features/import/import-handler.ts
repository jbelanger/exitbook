import type { ImportSession } from '@exitbook/core';
// eslint-disable-next-line no-restricted-imports -- ok here since this is the CLI boundary
import type { KyselyDB } from '@exitbook/data';
import { EventBus } from '@exitbook/events';
import type { InstrumentationCollector, MetricsSummary } from '@exitbook/http';
import {
  type AdapterRegistry,
  type ImportEvent,
  ImportCoordinator,
  type ImportParams,
  type RawDataProcessingService,
} from '@exitbook/ingestion';
import { isUtxoAdapter } from '@exitbook/ingestion';
import { getLogger } from '@exitbook/logger';
import { err, ok, type Result } from 'neverthrow';

import type { EventDrivenController } from '../../ui/shared/index.js';
import type { CommandContext } from '../shared/command-runtime.js';
import { createIngestionInfrastructure, type CliEvent } from '../shared/ingestion-infrastructure.js';

interface ImportResult {
  sessions: ImportSession[];
}

interface BatchProcessSummary {
  processed: number;
  processingErrors: string[];
}

export interface ImportExecuteResult {
  sessions: ImportSession[];
  processed: number;
  processingErrors: string[];
  runStats: MetricsSummary;
}

/**
 * Import handler - encapsulates all import business logic.
 * Reusable by both CLI command and other contexts.
 */
export class ImportHandler {
  private readonly logger = getLogger('ImportHandler');

  constructor(
    private importCoordinator: ImportCoordinator,
    private rawDataProcessingService: RawDataProcessingService,
    private registry: AdapterRegistry,
    private ingestionMonitor: EventDrivenController<CliEvent>,
    private instrumentation: InstrumentationCollector
  ) {}

  /**
   * Execute the full import pipeline (import + process).
   * Manages ingestion monitor lifecycle.
   */
  async execute(params: ImportParams): Promise<Result<ImportExecuteResult, Error>> {
    const importResult = await this.executeImport(params);
    if (importResult.isErr()) {
      this.ingestionMonitor.fail(importResult.error.message);
      await this.ingestionMonitor.stop();
      return err(importResult.error);
    }

    const processResult = await this.processImportedSessions(importResult.value.sessions);
    if (processResult.isErr()) {
      this.ingestionMonitor.fail(processResult.error.message);
      await this.ingestionMonitor.stop();
      return err(processResult.error);
    }

    await this.ingestionMonitor.stop();
    return ok({
      sessions: importResult.value.sessions,
      processed: processResult.value.processed,
      processingErrors: processResult.value.processingErrors,
      runStats: this.instrumentation.getSummary(),
    });
  }

  abort(): void {
    this.ingestionMonitor.abort();
    void this.ingestionMonitor.stop().catch((e) => {
      this.logger.warn({ e }, 'Failed to stop ingestion monitor on abort');
    });
  }

  private async executeImport(params: ImportParams): Promise<Result<ImportResult, Error>> {
    try {
      let importResult: Result<ImportSession | ImportSession[], Error>;

      if (params.sourceType === 'exchange-csv') {
        if (!params.csvDirectory) {
          return err(new Error('CSV directory is required for CSV imports'));
        }
        importResult = await this.importCoordinator.importExchangeCsv(params.sourceName, params.csvDirectory);
      } else if (params.sourceType === 'exchange-api') {
        if (!params.credentials) {
          return err(new Error('Credentials are required for API imports'));
        }
        importResult = await this.importCoordinator.importExchangeApi(params.sourceName, params.credentials);
      } else {
        if (!params.address) {
          return err(new Error('Address is required for blockchain imports'));
        }

        // Check if this is a single address (not xpub) and warn user
        const adapterResult = this.registry.getBlockchain(params.sourceName.toLowerCase());
        if (adapterResult.isOk() && isUtxoAdapter(adapterResult.value)) {
          const blockchainAdapter = adapterResult.value;
          const isXpub = blockchainAdapter.isExtendedPublicKey(params.address);
          if (!isXpub && params.onSingleAddressWarning) {
            const shouldContinue = await params.onSingleAddressWarning();
            if (!shouldContinue) {
              return err(new Error('Import cancelled by user'));
            }
          }
        }

        importResult = await this.importCoordinator.importBlockchain(
          params.sourceName,
          params.address,
          params.providerName,
          params.xpubGap
        );
      }

      if (importResult.isErr()) {
        return err(importResult.error);
      }

      const sessions = Array.isArray(importResult.value) ? importResult.value : [importResult.value];

      const result: ImportResult = {
        sessions,
      };

      const incompleteSessions = sessions.filter((session) => session.status !== 'completed');
      if (incompleteSessions.length > 0) {
        const accountStatuses = incompleteSessions.map((session) => `${session.accountId}(${session.status})`);
        return err(
          new Error(
            `Import did not complete for account(s): ${accountStatuses.join(', ')}. ` +
              `Processing is blocked until all imports complete successfully.`
          )
        );
      }

      return ok(result);
    } catch (error) {
      return err(error instanceof Error ? error : new Error(String(error)));
    }
  }

  private async processImportedSessions(sessions: ImportSession[]): Promise<Result<BatchProcessSummary, Error>> {
    try {
      const uniqueAccountIds = [...new Set(sessions.map((s) => s.accountId))];
      const processResult = await this.rawDataProcessingService.processImportedSessions(uniqueAccountIds);

      if (processResult.isErr()) {
        return err(processResult.error);
      }

      return ok({
        processed: processResult.value.processed,
        processingErrors: processResult.value.errors,
      });
    } catch (error) {
      return err(error instanceof Error ? error : new Error(String(error)));
    }
  }
}

export async function createImportHandler(
  ctx: CommandContext,
  database: KyselyDB,
  registry: AdapterRegistry
): Promise<Result<ImportHandler, Error>> {
  try {
    const infra = await createIngestionInfrastructure(ctx, database, registry);

    const importCoordinator = new ImportCoordinator(
      database,
      infra.providerManager,
      registry,
      infra.eventBus as EventBus<ImportEvent>
    );

    return ok(
      new ImportHandler(
        importCoordinator,
        infra.rawDataProcessingService,
        registry,
        infra.ingestionMonitor,
        infra.instrumentation
      )
    );
  } catch (error) {
    return err(error instanceof Error ? error : new Error(String(error)));
  }
}
