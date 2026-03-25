import type { ImportSession } from '@exitbook/core';
import { buildImportPorts } from '@exitbook/data/ingestion';
import type { EventBus } from '@exitbook/events';
import { err, ok, wrapError, type Result } from '@exitbook/foundation';
import type { AdapterRegistry, ImportParams, IngestionEvent } from '@exitbook/ingestion';
import { ImportWorkflow, isUtxoAdapter } from '@exitbook/ingestion';
import { getLogger } from '@exitbook/logger';
import type { InstrumentationCollector, MetricsSummary } from '@exitbook/observability';

import type { CommandRuntime } from '../../../runtime/command-runtime.js';
import { createIngestionRuntime, type CliEvent } from '../../../runtime/ingestion-runtime.js';
import type { EventDrivenController } from '../../../ui/shared/index.js';

export interface ImportExecuteResult {
  sessions: ImportSession[];
  runStats: MetricsSummary;
}

export interface ImportExecutionRuntime {
  importWorkflow: ImportWorkflow;
  registry: AdapterRegistry;
  ingestionMonitor?: EventDrivenController<CliEvent> | undefined;
  instrumentation: InstrumentationCollector;
}

const logger = getLogger('ImportRunner');

export async function executeImportWithRuntime(
  runtime: ImportExecutionRuntime,
  params: ImportParams & { onSingleAddressWarning?: (() => Promise<boolean>) | undefined }
): Promise<Result<ImportExecuteResult, Error>> {
  if ('blockchain' in params && params.address) {
    const warningResult = await checkSingleAddressWarning(runtime, params);
    if (warningResult.isErr()) {
      runtime.ingestionMonitor?.fail(warningResult.error.message);
      await runtime.ingestionMonitor?.stop();
      return err(warningResult.error);
    }
  }

  const importResult = await runtime.importWorkflow.execute(params);
  if (importResult.isErr()) {
    runtime.ingestionMonitor?.fail(importResult.error.message);
    await runtime.ingestionMonitor?.stop();
    return err(importResult.error);
  }

  const { sessions } = importResult.value;
  const incompleteSessions = sessions.filter((session) => session.status !== 'completed');
  if (incompleteSessions.length > 0) {
    const accountStatuses = incompleteSessions.map((session) => `${session.accountId}(${session.status})`);
    const error = new Error(
      `Import did not complete for account(s): ${accountStatuses.join(', ')}. ` +
        `Processing is blocked until all imports complete successfully.`
    );
    runtime.ingestionMonitor?.fail(error.message);
    await runtime.ingestionMonitor?.stop();
    return err(error);
  }

  await runtime.ingestionMonitor?.stop();
  return ok({
    sessions,
    runStats: runtime.instrumentation.getSummary(),
  });
}

export function abortImportRuntime(runtime: ImportExecutionRuntime): void {
  runtime.importWorkflow.abort();
  if (!runtime.ingestionMonitor) {
    return;
  }

  runtime.ingestionMonitor.abort();
  void runtime.ingestionMonitor.stop().catch((error) => {
    logger.warn({ error }, 'Failed to stop ingestion monitor on abort');
  });
}

export async function runImport(
  ctx: CommandRuntime,
  options: { isJsonMode: boolean },
  params: ImportParams & { onSingleAddressWarning?: (() => Promise<boolean>) | undefined }
): Promise<Result<ImportExecuteResult, Error>> {
  try {
    const database = await ctx.database();
    const registry = ctx.requireAppRuntime().adapterRegistry;
    const infra = await createIngestionRuntime(ctx, database, {
      presentation: options.isJsonMode ? 'headless' : 'monitor',
    });
    const importPorts = buildImportPorts(database);
    const runtime: ImportExecutionRuntime = {
      importWorkflow: new ImportWorkflow(
        importPorts,
        infra.blockchainProviderRuntime,
        registry,
        infra.eventBus as EventBus<IngestionEvent>
      ),
      registry,
      ingestionMonitor: infra.ingestionMonitor,
      instrumentation: infra.instrumentation,
    };

    ctx.onAbort(() => {
      abortImportRuntime(runtime);
    });
    return executeImportWithRuntime(runtime, params);
  } catch (error) {
    return wrapError(error, 'Failed to run import');
  }
}

async function checkSingleAddressWarning(
  runtime: ImportExecutionRuntime,
  params: ImportParams & { onSingleAddressWarning?: (() => Promise<boolean>) | undefined }
): Promise<Result<void, Error>> {
  if (!('blockchain' in params) || !params.onSingleAddressWarning) {
    return ok(undefined);
  }

  const adapterResult = runtime.registry.getBlockchain(params.blockchain.toLowerCase());
  if (adapterResult.isErr()) {
    return ok(undefined);
  }

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
