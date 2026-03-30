import type { Account, ImportSession } from '@exitbook/core';
import { buildImportPorts } from '@exitbook/data/ingestion';
import { EventBus, type EventBus as EventBusType } from '@exitbook/events';
import { err, ok, wrapError, type Result } from '@exitbook/foundation';
import type { AdapterRegistry } from '@exitbook/ingestion/adapters';
import { isUtxoAdapter } from '@exitbook/ingestion/adapters';
import type { IngestionEvent } from '@exitbook/ingestion/events';
import { ImportWorkflow, type ImportParams } from '@exitbook/ingestion/import';
import { getLogger } from '@exitbook/logger';
import type { InstrumentationCollector, MetricsSummary } from '@exitbook/observability';

import { type CliEvent, type IngestionRuntime, withIngestionRuntime } from '../../../runtime/ingestion-runtime.js';
import { createEventDrivenController, type EventDrivenController } from '../../../ui/shared/index.js';
import { buildCliAccountLifecycleService } from '../../accounts/account-service.js';
import type { CliOutputFormat } from '../../shared/cli-output-format.js';
import type { ConfirmationPromptDecision } from '../../shared/prompts.js';
import {
  BatchImportMonitor,
  type BatchImportDescriptor,
  type BatchImportMonitorEvent,
  type BatchImportSyncMode,
} from '../view/index.js';

import type { ImportCommandScope } from './import-command-scope.js';

export interface ImportExecuteResult {
  sessions: ImportSession[];
  runStats: MetricsSummary;
}

export type ImportRunOutcome =
  | {
      kind: 'cancelled';
    }
  | {
      kind: 'completed';
      result: ImportExecuteResult;
    };

export interface BatchImportAccountResult {
  account: {
    accountType: Account['accountType'];
    id: number;
    name: string;
    platformKey: string;
  };
  counts: {
    imported: number;
    skipped: number;
  };
  errorMessage?: string | undefined;
  status: 'completed' | 'failed';
  syncMode: BatchImportSyncMode;
}

export interface BatchImportExecuteResult {
  accounts: BatchImportAccountResult[];
  failedCount: number;
  profileDisplayName: string;
  runStats: MetricsSummary;
  totalCount: number;
}

export interface ImportAccountSelection {
  account?: string | undefined;
  accountId?: number | undefined;
}

export interface ImportExecutionRuntime {
  findAccountById: (accountId: number) => Promise<Result<Account | undefined, Error>>;
  importWorkflow: ImportWorkflow;
  registry: AdapterRegistry;
  ingestionMonitor?: ImportMonitorController | undefined;
  instrumentation: InstrumentationCollector;
}

interface ImportMonitorController {
  abort(): void;
  fail(errorMessage: string): void;
  stop(): Promise<void>;
}

interface BatchImportAccountPlan {
  account: Account;
  syncMode: BatchImportSyncMode;
}

type SingleAddressWarningStatus = 'cancelled' | 'continue';

const logger = getLogger('ImportRunner');

export async function executeImportWithRuntime(
  runtime: ImportExecutionRuntime,
  params: ImportParams & { onSingleAddressWarning?: (() => Promise<ConfirmationPromptDecision>) | undefined }
): Promise<Result<ImportRunOutcome, Error>> {
  const warningResult = await checkSingleAddressWarning(runtime, params);
  if (warningResult.isErr()) {
    runtime.ingestionMonitor?.fail(warningResult.error.message);
    await runtime.ingestionMonitor?.stop();
    return err(warningResult.error);
  }
  if (warningResult.value === 'cancelled') {
    await runtime.ingestionMonitor?.stop();
    return ok({
      kind: 'cancelled',
    });
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
    kind: 'completed',
    result: {
      sessions,
      runStats: runtime.instrumentation.getSummary(),
    },
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
  scope: ImportCommandScope,
  options: { format: CliOutputFormat },
  params: ImportParams & { onSingleAddressWarning?: (() => Promise<ConfirmationPromptDecision>) | undefined }
): Promise<Result<ImportRunOutcome, Error>> {
  try {
    const database = scope.database;
    const registry = scope.registry;
    return withIngestionRuntime(
      scope.runtime,
      database,
      {
        presentation: options.format === 'json' ? 'headless' : 'monitor',
        onAbortRegistered: (infra) => {
          const runtime = buildImportExecutionRuntime(database, registry, infra, infra.ingestionMonitor);
          scope.runtime.onAbort(() => {
            abortImportRuntime(runtime);
          });
        },
      },
      async (infra) => {
        const runtime = buildImportExecutionRuntime(database, registry, infra, infra.ingestionMonitor);
        return executeImportWithRuntime(runtime, params);
      }
    );
  } catch (error) {
    return wrapError(error, 'Failed to run import');
  }
}

export async function runImportAll(
  scope: ImportCommandScope,
  options: { format: CliOutputFormat }
): Promise<Result<BatchImportExecuteResult, Error>> {
  let batchController: EventDrivenController<BatchImportMonitorEvent> | undefined;
  let unsubscribeCliEvents: (() => void) | undefined;

  try {
    const database = scope.database;
    const registry = scope.registry;
    const batchAccountsResult = await loadBatchImportAccounts(database, scope.profile.id);
    if (batchAccountsResult.isErr()) {
      return err(batchAccountsResult.error);
    }

    const batchAccounts = batchAccountsResult.value;
    if (batchAccounts.length === 0) {
      return err(new Error(`No accounts found for profile '${scope.profile.displayName}'`));
    }

    const batchEventBus = new EventBus<BatchImportMonitorEvent>({
      onError: (error) => {
        logger.error({ error }, 'Batch import event bus error');
      },
    });
    return withIngestionRuntime(scope.runtime, database, { presentation: 'headless' }, async (infra) => {
      const runtime = buildImportExecutionRuntime(database, registry, infra);

      if (options.format !== 'json') {
        batchController = createEventDrivenController(batchEventBus, BatchImportMonitor, {
          instrumentation: infra.instrumentation,
          providerRuntime: infra.blockchainProviderRuntime,
        });
        await batchController.start();
        unsubscribeCliEvents = infra.eventBus.subscribe((event: CliEvent) => {
          batchEventBus.emit(event);
        });
      }

      scope.runtime.onAbort(() => {
        runtime.importWorkflow.abort();
        if (!batchController) {
          return;
        }

        batchController.abort();
        void batchController.stop().catch((error) => {
          logger.warn({ error }, 'Failed to stop batch import monitor on abort');
        });
      });

      batchEventBus.emit({
        type: 'batch.started',
        profileDisplayName: scope.profile.displayName,
        rows: batchAccounts.map<BatchImportDescriptor>((batchAccount) => ({
          accountId: batchAccount.account.id,
          accountType: batchAccount.account.accountType,
          name: batchAccount.account.name ?? `account-${batchAccount.account.id}`,
          platformKey: batchAccount.account.platformKey,
          syncMode: batchAccount.syncMode,
        })),
      });

      const accountResults: BatchImportAccountResult[] = [];
      let failedCount = 0;

      for (const [index, batchAccount] of batchAccounts.entries()) {
        batchEventBus.emit({
          type: 'batch.account.started',
          accountId: batchAccount.account.id,
          index,
        });

        const importResult = await executeImportWithRuntime(runtime, {
          accountId: batchAccount.account.id,
        });

        if (importResult.isErr()) {
          failedCount += 1;
          const countsResult = await loadFailedImportCounts(database, batchAccount.account.id);
          if (countsResult.isErr()) {
            return err(countsResult.error);
          }

          batchEventBus.emit({
            type: 'batch.account.failed',
            accountId: batchAccount.account.id,
            error: importResult.error.message,
            imported: countsResult.value.imported,
            skipped: countsResult.value.skipped,
          });

          accountResults.push({
            account: toBatchImportAccount(batchAccount.account),
            counts: countsResult.value,
            errorMessage: importResult.error.message,
            status: 'failed',
            syncMode: batchAccount.syncMode,
          });
          continue;
        }
        if (importResult.value.kind === 'cancelled') {
          logger.warn(
            { accountId: batchAccount.account.id },
            'Batch import returned a cancelled outcome even though batch mode should not prompt'
          );
          failedCount += 1;
          batchEventBus.emit({
            type: 'batch.account.failed',
            accountId: batchAccount.account.id,
            error: 'Import cancelled by user',
            imported: 0,
            skipped: 0,
          });

          accountResults.push({
            account: toBatchImportAccount(batchAccount.account),
            counts: {
              imported: 0,
              skipped: 0,
            },
            errorMessage: 'Import cancelled by user',
            status: 'failed',
            syncMode: batchAccount.syncMode,
          });
          continue;
        }

        const counts = summarizeImportSessions(importResult.value.result.sessions);
        batchEventBus.emit({
          type: 'batch.account.completed',
          accountId: batchAccount.account.id,
          imported: counts.imported,
          skipped: counts.skipped,
        });

        accountResults.push({
          account: toBatchImportAccount(batchAccount.account),
          counts,
          status: 'completed',
          syncMode: batchAccount.syncMode,
        });
      }

      batchEventBus.emit({
        type: 'batch.completed',
        completedCount: accountResults.length - failedCount,
        failedCount,
        totalCount: accountResults.length,
      });

      await batchController?.stop();

      return ok({
        accounts: accountResults,
        failedCount,
        profileDisplayName: scope.profile.displayName,
        runStats: runtime.instrumentation.getSummary(),
        totalCount: accountResults.length,
      });
    });
  } catch (error) {
    const batchError = error instanceof Error ? error : new Error(String(error));
    batchController?.fail(batchError.message);
    await batchController?.stop().catch((stopError) => {
      logger.warn({ stopError }, 'Failed to stop batch import monitor after batch failure');
    });
    return wrapError(batchError, 'Failed to run batch import');
  } finally {
    unsubscribeCliEvents?.();
  }
}

async function checkSingleAddressWarning(
  runtime: ImportExecutionRuntime,
  params: ImportParams & { onSingleAddressWarning?: (() => Promise<ConfirmationPromptDecision>) | undefined }
): Promise<Result<SingleAddressWarningStatus, Error>> {
  if (!params.onSingleAddressWarning) {
    return ok('continue');
  }

  const accountResult = await runtime.findAccountById(params.accountId);
  if (accountResult.isErr()) {
    return err(accountResult.error);
  }
  if (!accountResult.value) {
    return err(new Error(`Account ${params.accountId} not found`));
  }

  const account = accountResult.value;
  if (account.accountType !== 'blockchain' || account.parentAccountId !== undefined) {
    return ok('continue');
  }

  const adapterResult = runtime.registry.getBlockchain(account.platformKey.toLowerCase());
  if (adapterResult.isErr()) {
    return ok('continue');
  }

  if (isUtxoAdapter(adapterResult.value)) {
    const isXpub = adapterResult.value.isExtendedPublicKey(account.identifier);
    if (!isXpub) {
      const decision = await params.onSingleAddressWarning();
      if (decision !== 'confirmed') {
        return ok('cancelled');
      }
    }
  }

  return ok('continue');
}

function buildImportExecutionRuntime(
  database: ImportCommandScope['database'],
  registry: AdapterRegistry,
  infra: {
    blockchainProviderRuntime: IngestionRuntime['blockchainProviderRuntime'];
    eventBus: EventBusType<CliEvent>;
    instrumentation: InstrumentationCollector;
  },
  ingestionMonitor?: ImportMonitorController
): ImportExecutionRuntime {
  const importPorts = buildImportPorts(database);

  return {
    findAccountById: (accountId) => database.accounts.findById(accountId),
    importWorkflow: new ImportWorkflow(
      importPorts,
      infra.blockchainProviderRuntime,
      registry,
      infra.eventBus as EventBusType<IngestionEvent>
    ),
    registry,
    ingestionMonitor,
    instrumentation: infra.instrumentation,
  };
}

async function loadBatchImportAccounts(
  database: ImportCommandScope['database'],
  profileId: number
): Promise<Result<BatchImportAccountPlan[], Error>> {
  const accountService = buildCliAccountLifecycleService(database);
  const accountsResult = await accountService.listTopLevel(profileId);
  if (accountsResult.isErr()) {
    return err(accountsResult.error);
  }

  const plans: BatchImportAccountPlan[] = [];
  for (const account of accountsResult.value) {
    const incompleteResult = await database.importSessions.findLatestIncomplete(account.id);
    if (incompleteResult.isErr()) {
      return err(incompleteResult.error);
    }

    plans.push({
      account,
      syncMode: classifyBatchImportSyncMode(account, incompleteResult.value),
    });
  }

  return ok(plans);
}

function classifyBatchImportSyncMode(account: Account, incompleteSession?: ImportSession): BatchImportSyncMode {
  if (incompleteSession) {
    return 'resuming';
  }

  if (!account.lastCursor || Object.keys(account.lastCursor).length === 0) {
    return 'first-sync';
  }

  return 'incremental';
}

async function loadFailedImportCounts(
  database: ImportCommandScope['database'],
  accountId: number
): Promise<Result<{ imported: number; skipped: number }, Error>> {
  const sessionResult = await database.importSessions.findLatestIncomplete(accountId);
  if (sessionResult.isErr()) {
    return err(sessionResult.error);
  }

  return ok({
    imported: sessionResult.value?.transactionsImported ?? 0,
    skipped: sessionResult.value?.transactionsSkipped ?? 0,
  });
}

function summarizeImportSessions(sessions: ImportSession[]): { imported: number; skipped: number } {
  return {
    imported: sessions.reduce((sum, session) => sum + session.transactionsImported, 0),
    skipped: sessions.reduce((sum, session) => sum + session.transactionsSkipped, 0),
  };
}

function toBatchImportAccount(account: Account): BatchImportAccountResult['account'] {
  return {
    accountType: account.accountType,
    id: account.id,
    name: account.name ?? `account-${account.id}`,
    platformKey: account.platformKey,
  };
}

export async function resolveImportAccount(
  scope: ImportCommandScope,
  options: ImportAccountSelection
): Promise<Result<Account, Error>> {
  const accountService = buildCliAccountLifecycleService(scope.database);

  if (options.accountId !== undefined) {
    const accountResult = await accountService.requireOwned(scope.profile.id, options.accountId);
    if (accountResult.isErr()) {
      return err(accountResult.error);
    }

    return ok(accountResult.value);
  }

  const requestedAccountName = options.account?.trim() ?? '';
  const accountResult = await accountService.getByName(scope.profile.id, requestedAccountName);
  if (accountResult.isErr()) {
    return err(accountResult.error);
  }
  if (!accountResult.value) {
    return err(new Error(`Account '${requestedAccountName.toLowerCase()}' not found`));
  }

  return ok(accountResult.value);
}
