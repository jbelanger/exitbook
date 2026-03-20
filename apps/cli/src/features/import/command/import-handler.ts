import type { ImportSession } from '@exitbook/core';
import { err, ok, wrapError, type Result } from '@exitbook/core';
import type { DataContext } from '@exitbook/data';
import { buildImportPorts } from '@exitbook/data';
import type { EventBus } from '@exitbook/events';
import type { AdapterRegistry, ImportParams, IngestionEvent } from '@exitbook/ingestion';
import { ImportWorkflow, isUtxoAdapter } from '@exitbook/ingestion';
import { getLogger } from '@exitbook/logger';
import type { InstrumentationCollector, MetricsSummary } from '@exitbook/observability';

import type { EventDrivenController } from '../../../ui/shared/index.js';
import type { CommandContext } from '../../shared/command-runtime.js';
import type { InfrastructureHandler } from '../../shared/handler-contracts.js';
import { createIngestionInfrastructure, type CliEvent } from '../../shared/ingestion-infrastructure.js';

export interface ImportExecuteResult {
  sessions: ImportSession[];
  runStats: MetricsSummary;
}

/**
 * CLI import handler — thin shell over ImportWorkflow.
 * Adds CLI-specific concerns: xpub single-address warning, TUI monitor lifecycle, instrumentation.
 */
export class ImportHandler implements InfrastructureHandler<
  ImportParams & { onSingleAddressWarning?: (() => Promise<boolean>) | undefined },
  ImportExecuteResult
> {
  private readonly logger = getLogger('ImportHandler');

  constructor(
    private importWorkflow: ImportWorkflow,
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

    const importResult = await this.importWorkflow.execute(params);
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
    this.importWorkflow.abort();
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
    if (adapterResult.isErr()) return ok(undefined); // let ImportWorkflow handle the error

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

    const importPorts = buildImportPorts(database);
    const importWorkflow = new ImportWorkflow(
      importPorts,
      infra.providerManager,
      registry,
      infra.eventBus as EventBus<IngestionEvent>
    );

    return ok(new ImportHandler(importWorkflow, registry, infra.ingestionMonitor, infra.instrumentation));
  } catch (error) {
    return wrapError(error, 'Failed to create import handler');
  }
}
