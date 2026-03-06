import { ImportOperation, type ImportParams } from '@exitbook/app';
import type { ImportSession } from '@exitbook/core';
import { err, ok, type Result } from '@exitbook/core';
import type { DataContext } from '@exitbook/data';
import type { AdapterRegistry } from '@exitbook/ingestion';
import { isUtxoAdapter } from '@exitbook/ingestion';
import { getLogger } from '@exitbook/logger';
import type { InstrumentationCollector, MetricsSummary } from '@exitbook/observability';

import type { EventDrivenController } from '../../ui/shared/index.js';
import type { CommandContext } from '../shared/command-runtime.js';
import { createIngestionInfrastructure, type CliEvent } from '../shared/ingestion-infrastructure.js';

export interface ImportExecuteResult {
  sessions: ImportSession[];
  runStats: MetricsSummary;
}

/**
 * CLI import handler — thin shell over ImportOperation.
 * Adds CLI-specific concerns: xpub single-address warning, TUI monitor lifecycle, instrumentation.
 */
export class ImportHandler {
  private readonly logger = getLogger('ImportHandler');

  constructor(
    private importOperation: ImportOperation,
    private registry: AdapterRegistry,
    private ingestionMonitor: EventDrivenController<CliEvent>,
    private instrumentation: InstrumentationCollector
  ) {}

  async execute(
    params: ImportParams & { onSingleAddressWarning?: (() => Promise<boolean>) | undefined }
  ): Promise<Result<ImportExecuteResult, Error>> {
    // CLI-specific: warn about single-address UTXO imports before delegating
    if ('blockchain' in params && params.address) {
      const warningResult = await this.checkSingleAddressWarning(params);
      if (warningResult.isErr()) {
        this.ingestionMonitor.fail(warningResult.error.message);
        await this.ingestionMonitor.stop();
        return err(warningResult.error);
      }
    }

    const importResult = await this.importOperation.execute(params);
    if (importResult.isErr()) {
      this.ingestionMonitor.fail(importResult.error.message);
      await this.ingestionMonitor.stop();
      return err(importResult.error);
    }

    const { sessions } = importResult.value;

    // Validate all sessions completed
    const incompleteSessions = sessions.filter((session) => session.status !== 'completed');
    if (incompleteSessions.length > 0) {
      const accountStatuses = incompleteSessions.map((session) => `${session.accountId}(${session.status})`);
      const error = new Error(
        `Import did not complete for account(s): ${accountStatuses.join(', ')}. ` +
          `Processing is blocked until all imports complete successfully.`
      );
      this.ingestionMonitor.fail(error.message);
      await this.ingestionMonitor.stop();
      return err(error);
    }

    await this.ingestionMonitor.stop();
    return ok({
      sessions,
      runStats: this.instrumentation.getSummary(),
    });
  }

  abort(): void {
    this.importOperation.abort();
    this.ingestionMonitor.abort();
    void this.ingestionMonitor.stop().catch((e) => {
      this.logger.warn({ e }, 'Failed to stop ingestion monitor on abort');
    });
  }

  private async checkSingleAddressWarning(
    params: ImportParams & { onSingleAddressWarning?: (() => Promise<boolean>) | undefined }
  ): Promise<Result<void, Error>> {
    if (!('blockchain' in params) || !params.onSingleAddressWarning) return ok(undefined);

    const adapterResult = this.registry.getBlockchain(params.blockchain.toLowerCase());
    if (adapterResult.isErr()) return ok(undefined); // let ImportOperation handle the error

    if (isUtxoAdapter(adapterResult.value)) {
      const isXpub = adapterResult.value.isExtendedPublicKey(params.address);
      if (!isXpub) {
        const shouldContinue = await params.onSingleAddressWarning();
        if (!shouldContinue) {
          return err(new Error('Import cancelled by user'));
        }
      }
    }

    return ok(undefined);
  }
}

export async function createImportHandler(
  ctx: CommandContext,
  database: DataContext,
  registry: AdapterRegistry
): Promise<Result<ImportHandler, Error>> {
  try {
    const infra = await createIngestionInfrastructure(ctx, database, registry);

    const importOperation = new ImportOperation(database, infra.providerManager, registry, infra.eventBus);

    return ok(new ImportHandler(importOperation, registry, infra.ingestionMonitor, infra.instrumentation));
  } catch (error) {
    return err(error instanceof Error ? error : new Error(String(error)));
  }
}
