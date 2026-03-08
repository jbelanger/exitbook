import type { LinksResetImpact } from '@exitbook/accounting/ports';
import type { Account } from '@exitbook/core';
import { err, ok, resetPlan, wrapError, type Result } from '@exitbook/core';
import type { DataContext } from '@exitbook/data';
import { buildIngestionPurgePorts, buildLinksResetPorts, buildProcessedTransactionsResetPorts } from '@exitbook/data';
import type { IngestionPurgeImpact } from '@exitbook/ingestion';
import type { ProcessedTransactionsResetImpact } from '@exitbook/ingestion/ports';
import { getLogger } from '@exitbook/logger';

const logger = getLogger('ClearHandler');

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ClearParams {
  accountId?: number | undefined;
  source?: string | undefined;
  includeRaw: boolean;
}

export interface DeletionPreview {
  links: LinksResetImpact;
  processedTransactions: ProcessedTransactionsResetImpact;
  purge: IngestionPurgeImpact | undefined;
}

export interface ClearResult {
  deleted: DeletionPreview;
}

/** Flattened counts for display purposes. */
export interface FlatDeletionPreview {
  transactions: number;
  links: number;
  accounts: number;
  sessions: number;
  rawData: number;
}

export function flattenPreview(preview: DeletionPreview): FlatDeletionPreview {
  return {
    transactions: preview.processedTransactions.transactions,
    links: preview.links.links,
    accounts: preview.purge?.accounts ?? 0,
    sessions: preview.purge?.sessions ?? 0,
    rawData: preview.purge?.rawData ?? 0,
  };
}

export function calculateTotalDeletionItems(flat: FlatDeletionPreview): number {
  return flat.transactions + flat.links + flat.accounts + flat.sessions + flat.rawData;
}

// ---------------------------------------------------------------------------
// Params validation (pure)
// ---------------------------------------------------------------------------

export function validateClearParams(params: ClearParams): Result<void, Error> {
  if (params.accountId && params.source) {
    return err(new Error('Cannot specify both accountId and source'));
  }
  if (params.accountId && params.accountId <= 0) {
    return err(new Error('accountId must be positive'));
  }
  return ok(undefined);
}

function describeFilters(params: ClearParams): string {
  const parts: string[] = [];
  if (params.accountId !== undefined) parts.push(`accountId=${params.accountId}`);
  if (params.source !== undefined) parts.push(`source=${params.source}`);
  return parts.join(', ');
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

export interface ClearHandlerDeps {
  db: DataContext;
}

/**
 * Composes projection-native resets → optional purge.
 * CLI-owned orchestration — not a package-level workflow.
 */
export function createClearHandler(deps: ClearHandlerDeps) {
  const { db } = deps;

  async function resolveAccountIds(params: ClearParams): Promise<Result<number[] | undefined, Error>> {
    if (!params.accountId && !params.source) return ok(undefined);

    const userResult = await db.users.findOrCreateDefault();
    if (userResult.isErr()) return err(userResult.error);
    const user = userResult.value;

    if (params.accountId) {
      const result = await db.accounts.findAll({ userId: user.id });
      if (result.isErr()) return err(result.error);
      const account = result.value.find((acc: Account) => acc.id === params.accountId);
      if (!account) {
        return err(new Error(`Account ${params.accountId} not found for user ${user.id}`));
      }
      return ok([account.id]);
    }

    if (params.source) {
      const result = await db.accounts.findAll({ userId: user.id, sourceName: params.source });
      if (result.isErr()) return err(result.error);
      if (result.value.length === 0) {
        return err(
          new Error(`No accounts matched the provided filters (${describeFilters(params)}). No data deleted.`)
        );
      }
      return ok(result.value.map((acc: Account) => acc.id));
    }

    return ok(undefined);
  }

  return {
    async preview(params: ClearParams): Promise<Result<DeletionPreview, Error>> {
      const validation = validateClearParams(params);
      if (validation.isErr()) return wrapError(validation.error, 'Invalid clear parameters');

      const accountIdsResult = await resolveAccountIds(params);
      if (accountIdsResult.isErr()) return wrapError(accountIdsResult.error, 'Failed to resolve accounts');
      const accountIds = accountIdsResult.value;

      const linksReset = buildLinksResetPorts(db);
      const ptReset = buildProcessedTransactionsResetPorts(db);

      const [linksResult, ptResult] = await Promise.all([
        linksReset.countResetImpact(accountIds),
        ptReset.countResetImpact(accountIds),
      ]);
      if (linksResult.isErr()) return wrapError(linksResult.error, 'Failed to count links impact');
      if (ptResult.isErr()) return wrapError(ptResult.error, 'Failed to count processed-transactions impact');

      let purge: IngestionPurgeImpact | undefined;
      if (params.includeRaw) {
        const ingestionPurge = buildIngestionPurgePorts(db);
        const purgeResult = await ingestionPurge.countPurgeImpact(accountIds);
        if (purgeResult.isErr()) return wrapError(purgeResult.error, 'Failed to count purge impact');
        purge = purgeResult.value;
      }

      return ok({
        links: linksResult.value,
        processedTransactions: ptResult.value,
        purge,
      });
    },

    async execute(params: ClearParams): Promise<Result<ClearResult, Error>> {
      const validation = validateClearParams(params);
      if (validation.isErr()) return wrapError(validation.error, 'Invalid clear parameters');

      const accountIdsResult = await resolveAccountIds(params);
      if (accountIdsResult.isErr()) return wrapError(accountIdsResult.error, 'Failed to resolve accounts');
      const accountIds = accountIdsResult.value;

      logger.debug(
        { includeRaw: params.includeRaw, source: params.source, accountId: params.accountId },
        'Starting data clearing'
      );

      // All resets run inside a single DB transaction — ports are built from
      // the transaction-scoped context so their internal executeInTransaction
      // calls become no-ops (isTransactionScoped short-circuit).
      return db.executeInTransaction(async (txDb) => {
        // Reset projections in graph order (downstream first)
        const plan = resetPlan('processed-transactions');
        let linksImpact: LinksResetImpact = { links: 0 };
        let ptImpact: ProcessedTransactionsResetImpact = { transactions: 0 };

        for (const projectionId of plan) {
          if (projectionId === 'links') {
            const result = await buildLinksResetPorts(txDb).reset(accountIds);
            if (result.isErr()) return wrapError(result.error, 'Failed to reset links');
            linksImpact = result.value;
          } else if (projectionId === 'processed-transactions') {
            const result = await buildProcessedTransactionsResetPorts(txDb).reset(accountIds);
            if (result.isErr()) return wrapError(result.error, 'Failed to reset processed-transactions');
            ptImpact = result.value;
          }
        }

        // Optional purge (raw data, sessions, accounts)
        let purge: IngestionPurgeImpact | undefined;
        if (params.includeRaw) {
          const ingestionPurge = buildIngestionPurgePorts(txDb);
          const purgeResult = await ingestionPurge.purgeImportedData(accountIds);
          if (purgeResult.isErr()) return wrapError(purgeResult.error, 'Failed to purge imported data');
          purge = purgeResult.value;
        }

        const deleted: DeletionPreview = {
          links: linksImpact,
          processedTransactions: ptImpact,
          purge,
        };

        logger.debug({ deleted }, 'Data clearing completed');

        return ok({ deleted });
      });
    },
  };
}

export type ClearHandler = ReturnType<typeof createClearHandler>;
