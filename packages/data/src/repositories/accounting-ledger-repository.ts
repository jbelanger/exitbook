/* eslint-disable unicorn/no-null -- repository contracts preserve nullable persistence semantics */
import {
  canonicalizeLedgerLinkingAssetIdentityPair,
  LedgerLinkingAssetIdentityAssertionSchema,
  LedgerLinkingRelationshipDraftSchema,
  type LedgerLinkingAssetIdentityAssertion,
  type LedgerLinkingAssetIdentityAssertionReplacementResult,
  type LedgerLinkingAssetIdentityAssertionSaveResult,
  type LedgerLinkingPersistedRelationship,
  type LedgerLinkingPostingInput,
  type LedgerLinkingRelationshipDraft,
  type LedgerLinkingRelationshipMaterializationResult,
} from '@exitbook/accounting/ledger-linking';
import { err, ok, parseCurrency, parseDecimal, type Result } from '@exitbook/foundation';
import {
  computeAccountingJournalFingerprint,
  computeAccountingPostingFingerprint,
  computeSourceComponentFingerprint,
  SourceActivityDraftSchema,
  validateAccountingJournalDraft,
  type AccountingBalanceCategory,
  type AccountingJournalDraft,
  type AccountingJournalKind,
  type AccountingPostingRole,
  type AccountingSettlement,
  type SourceActivityDraft,
} from '@exitbook/ledger';
import { sql } from '@exitbook/sqlite';
import type { Insertable, Updateable } from '@exitbook/sqlite';
import { Decimal } from 'decimal.js';

import type {
  AccountingJournalDiagnosticsTable,
  AccountingJournalRelationshipAllocationsTable,
  AccountingJournalRelationshipsTable,
  AccountingPostingsTable,
  AccountingPostingSourceComponentsTable,
  LedgerLinkingAssetIdentityAssertionsTable,
  SourceActivitiesTable,
} from '../database-schema.js';
import type { KyselyDB } from '../database.js';
import { withControlledTransaction } from '../utils/controlled-transaction.js';
import { parseJson, serializeToJson } from '../utils/json-column-codec.js';
import { chunkItems, SQLITE_SAFE_IN_BATCH_SIZE, SQLITE_SAFE_INSERT_BATCH_SIZE } from '../utils/sqlite-batching.js';

import { BaseRepository } from './base-repository.js';

export interface ReplaceAccountingLedgerParams {
  sourceActivity: SourceActivityDraft;
  journals: readonly AccountingJournalDraft[];
  rawTransactionIds?: readonly number[] | undefined;
}

export interface ReplaceAccountingLedgerSummary {
  sourceActivityId: number;
  diagnosticCount: number;
  journalCount: number;
  postingCount: number;
  sourceComponentCount: number;
  rawAssignmentCount: number;
}

export interface AccountingLedgerPostingRecord {
  ownerAccountId: number;
  sourceActivityId: number;
  sourceActivityFingerprint: string;
  journalId: number;
  journalFingerprint: string;
  journalStableKey: string;
  journalKind: AccountingJournalKind;
  postingId: number;
  postingFingerprint: string;
  postingStableKey: string;
  assetId: string;
  assetSymbol: string;
  quantity: Decimal;
  role: AccountingPostingRole;
  balanceCategory: AccountingBalanceCategory;
  settlement: AccountingSettlement | undefined;
}

export interface AccountingLedgerRepositoryOptions {
  transactionScoped?: boolean | undefined;
}

interface PersistedJournalRef {
  id: number;
  fingerprint: string;
}

interface PersistedPostingRef {
  assetId: string;
  assetSymbol: string;
  id: number;
  fingerprint: string;
  quantity: Decimal;
}

interface RawTransactionAssignmentScope {
  rawAccountId: number;
  rawTransactionId: number;
}

interface ResolvedLedgerLinkingAllocationEndpoint {
  assetId: string;
  assetSymbol: string;
  sourceActivityFingerprint: string;
  journalId: number;
  journalFingerprint: string;
  postingId: number;
  postingFingerprint: string;
  postingQuantity: Decimal;
}

export class AccountingLedgerRepository extends BaseRepository {
  private readonly transactionScoped: boolean;

  constructor(db: KyselyDB, options: AccountingLedgerRepositoryOptions = {}) {
    super(db, 'accounting-ledger-repository');
    this.transactionScoped = options.transactionScoped ?? false;
  }

  async replaceForSourceActivity(
    params: ReplaceAccountingLedgerParams
  ): Promise<Result<ReplaceAccountingLedgerSummary, Error>> {
    if (this.transactionScoped) {
      return this.replaceForSourceActivityInTransaction(this.db, params);
    }

    return withControlledTransaction(
      this.db,
      this.logger,
      async (trx) => this.replaceForSourceActivityInTransaction(trx as KyselyDB, params),
      'Failed to replace accounting ledger for source activity'
    );
  }

  async findPostingsByOwnerAccountId(ownerAccountId: number): Promise<Result<AccountingLedgerPostingRecord[], Error>> {
    return this.findPostingsByOwnerAccountIds([ownerAccountId]);
  }

  async countSourceActivities(ownerAccountIds?: readonly number[]): Promise<Result<number, Error>> {
    try {
      if (ownerAccountIds !== undefined && ownerAccountIds.length === 0) {
        return ok(0);
      }

      let totalCount = 0;
      const ownerAccountIdBatches =
        ownerAccountIds === undefined ? [undefined] : chunkItems([...ownerAccountIds], SQLITE_SAFE_IN_BATCH_SIZE);

      for (const ownerAccountIdBatch of ownerAccountIdBatches) {
        let query = this.db.selectFrom('source_activities').select(({ fn }) => [fn.count<number>('id').as('count')]);

        if (ownerAccountIdBatch !== undefined) {
          query = query.where('owner_account_id', 'in', ownerAccountIdBatch);
        }

        const result = await query.executeTakeFirst();
        totalCount += result?.count ?? 0;
      }

      return ok(totalCount);
    } catch (error) {
      return err(error instanceof Error ? error : new Error(String(error)));
    }
  }

  async deleteSourceActivitiesByOwnerAccountIds(ownerAccountIds: readonly number[]): Promise<Result<number, Error>> {
    if (this.transactionScoped) {
      return this.deleteSourceActivitiesByOwnerAccountIdsInTransaction(this.db, ownerAccountIds);
    }

    return withControlledTransaction(
      this.db,
      this.logger,
      async (trx) => this.deleteSourceActivitiesByOwnerAccountIdsInTransaction(trx as KyselyDB, ownerAccountIds),
      'Failed to delete source activities by owner account ids'
    );
  }

  async deleteAllSourceActivities(): Promise<Result<number, Error>> {
    if (this.transactionScoped) {
      return this.deleteAllSourceActivitiesInTransaction(this.db);
    }

    return withControlledTransaction(
      this.db,
      this.logger,
      async (trx) => this.deleteAllSourceActivitiesInTransaction(trx as KyselyDB),
      'Failed to delete all source activities'
    );
  }

  async replaceLedgerLinkingRelationships(
    profileId: number,
    relationships: readonly LedgerLinkingRelationshipDraft[]
  ): Promise<Result<LedgerLinkingRelationshipMaterializationResult, Error>> {
    if (this.transactionScoped) {
      return this.replaceLedgerLinkingRelationshipsInTransaction(this.db, profileId, relationships);
    }

    return withControlledTransaction(
      this.db,
      this.logger,
      async (trx) => this.replaceLedgerLinkingRelationshipsInTransaction(trx as KyselyDB, profileId, relationships),
      'Failed to replace ledger-linking relationships'
    );
  }

  async findLedgerLinkingRelationshipsByProfileId(
    profileId: number
  ): Promise<Result<LedgerLinkingPersistedRelationship[], Error>> {
    if (!Number.isInteger(profileId) || profileId <= 0) {
      return err(new Error(`Profile id must be a positive integer, received ${profileId}`));
    }

    try {
      const relationshipRows = await this.db
        .selectFrom('accounting_journal_relationships')
        .select([
          'id',
          'relationship_stable_key',
          'relationship_kind',
          'recognition_strategy',
          'recognition_evidence_json',
          'confidence_score',
          'created_at',
          'updated_at',
        ])
        .where('profile_id', '=', profileId)
        .where('relationship_origin', '=', 'ledger_linking')
        .orderBy('created_at', 'asc')
        .orderBy('id', 'asc')
        .execute();

      const allocationsResult = await loadRelationshipAllocationsByRelationshipIds(
        this.db,
        relationshipRows.map((row) => row.id)
      );
      if (allocationsResult.isErr()) {
        return err(allocationsResult.error);
      }

      const relationships: LedgerLinkingPersistedRelationship[] = [];
      for (const row of relationshipRows) {
        const allocations = allocationsResult.value.get(row.id) ?? [];
        if (allocations.length === 0) {
          return err(
            new Error(`Ledger-linking relationship ${row.relationship_stable_key} has no persisted allocations`)
          );
        }

        const relationship = toLedgerLinkingPersistedRelationship(row, allocations);
        if (relationship.isErr()) {
          return err(relationship.error);
        }

        relationships.push(relationship.value);
      }

      return ok(relationships);
    } catch (error) {
      return err(error instanceof Error ? error : new Error(String(error)));
    }
  }

  async replaceLedgerLinkingAssetIdentityAssertions(
    profileId: number,
    assertions: readonly LedgerLinkingAssetIdentityAssertion[]
  ): Promise<Result<LedgerLinkingAssetIdentityAssertionReplacementResult, Error>> {
    if (this.transactionScoped) {
      return this.replaceLedgerLinkingAssetIdentityAssertionsInTransaction(this.db, profileId, assertions);
    }

    return withControlledTransaction(
      this.db,
      this.logger,
      async (trx) =>
        this.replaceLedgerLinkingAssetIdentityAssertionsInTransaction(trx as KyselyDB, profileId, assertions),
      'Failed to replace ledger-linking asset identity assertions'
    );
  }

  async saveLedgerLinkingAssetIdentityAssertion(
    profileId: number,
    assertion: LedgerLinkingAssetIdentityAssertion
  ): Promise<Result<LedgerLinkingAssetIdentityAssertionSaveResult, Error>> {
    if (this.transactionScoped) {
      return this.saveLedgerLinkingAssetIdentityAssertionInTransaction(this.db, profileId, assertion);
    }

    return withControlledTransaction(
      this.db,
      this.logger,
      async (trx) => this.saveLedgerLinkingAssetIdentityAssertionInTransaction(trx as KyselyDB, profileId, assertion),
      'Failed to save ledger-linking asset identity assertion'
    );
  }

  async findLedgerLinkingAssetIdentityAssertionsByProfileId(
    profileId: number
  ): Promise<Result<LedgerLinkingAssetIdentityAssertion[], Error>> {
    if (!Number.isInteger(profileId) || profileId <= 0) {
      return err(new Error(`Profile id must be a positive integer, received ${profileId}`));
    }

    try {
      const rows = await this.db
        .selectFrom('ledger_linking_asset_identity_assertions')
        .select(['asset_id_a', 'asset_id_b', 'evidence_kind', 'relationship_kind'])
        .where('profile_id', '=', profileId)
        .orderBy('relationship_kind', 'asc')
        .orderBy('asset_id_a', 'asc')
        .orderBy('asset_id_b', 'asc')
        .execute();

      const assertions: LedgerLinkingAssetIdentityAssertion[] = [];
      for (const row of rows) {
        const assertion = LedgerLinkingAssetIdentityAssertionSchema.safeParse({
          assetIdA: row.asset_id_a,
          assetIdB: row.asset_id_b,
          evidenceKind: row.evidence_kind,
          relationshipKind: row.relationship_kind,
        });
        if (!assertion.success) {
          return err(
            new Error(
              `Invalid ledger-linking asset identity assertion row for profile ${profileId}: ${assertion.error.message}`
            )
          );
        }

        assertions.push(assertion.data);
      }

      return ok(assertions);
    } catch (error) {
      return err(error instanceof Error ? error : new Error(String(error)));
    }
  }

  async findPostingsByOwnerAccountIds(
    ownerAccountIds: readonly number[]
  ): Promise<Result<AccountingLedgerPostingRecord[], Error>> {
    const normalizedOwnerAccountIdsResult = normalizeOwnerAccountIds(ownerAccountIds);
    if (normalizedOwnerAccountIdsResult.isErr()) {
      return err(normalizedOwnerAccountIdsResult.error);
    }

    const normalizedOwnerAccountIds = normalizedOwnerAccountIdsResult.value;
    if (normalizedOwnerAccountIds.length === 0) {
      return ok([]);
    }

    try {
      const rows = await this.db
        .selectFrom('accounting_postings')
        .innerJoin('accounting_journals', 'accounting_journals.id', 'accounting_postings.journal_id')
        .innerJoin('source_activities', 'source_activities.id', 'accounting_journals.source_activity_id')
        .select([
          'source_activities.owner_account_id as owner_account_id',
          'source_activities.id as source_activity_id',
          'source_activities.source_activity_fingerprint as source_activity_fingerprint',
          'accounting_journals.id as journal_id',
          'accounting_journals.journal_fingerprint as journal_fingerprint',
          'accounting_journals.journal_stable_key as journal_stable_key',
          'accounting_journals.journal_kind as journal_kind',
          'accounting_postings.id as posting_id',
          'accounting_postings.posting_fingerprint as posting_fingerprint',
          'accounting_postings.posting_stable_key as posting_stable_key',
          'accounting_postings.asset_id as asset_id',
          'accounting_postings.asset_symbol as asset_symbol',
          'accounting_postings.quantity as quantity',
          'accounting_postings.posting_role as posting_role',
          'accounting_postings.balance_category as balance_category',
          'accounting_postings.settlement as settlement',
        ])
        .where('source_activities.owner_account_id', 'in', normalizedOwnerAccountIds)
        .orderBy('source_activities.owner_account_id', 'asc')
        .orderBy('source_activities.activity_datetime', 'asc')
        .orderBy('accounting_journals.journal_stable_key', 'asc')
        .orderBy('accounting_postings.posting_stable_key', 'asc')
        .execute();

      return ok(
        rows.map((row) => ({
          ownerAccountId: row.owner_account_id,
          sourceActivityId: row.source_activity_id,
          sourceActivityFingerprint: row.source_activity_fingerprint,
          journalId: row.journal_id,
          journalFingerprint: row.journal_fingerprint,
          journalStableKey: row.journal_stable_key,
          journalKind: row.journal_kind,
          postingId: row.posting_id,
          postingFingerprint: row.posting_fingerprint,
          postingStableKey: row.posting_stable_key,
          assetId: row.asset_id,
          assetSymbol: row.asset_symbol,
          quantity: parseDecimal(row.quantity),
          role: row.posting_role,
          balanceCategory: row.balance_category,
          settlement: row.settlement ?? undefined,
        }))
      );
    } catch (error) {
      return err(error instanceof Error ? error : new Error(String(error)));
    }
  }

  async findLedgerLinkingPostingInputsByProfileId(
    profileId: number
  ): Promise<Result<LedgerLinkingPostingInput[], Error>> {
    if (!Number.isInteger(profileId) || profileId <= 0) {
      return err(new Error(`Profile id must be a positive integer, received ${profileId}`));
    }

    try {
      const rows = await this.db
        .selectFrom('accounting_postings')
        .innerJoin('accounting_journals', 'accounting_journals.id', 'accounting_postings.journal_id')
        .innerJoin('source_activities', 'source_activities.id', 'accounting_journals.source_activity_id')
        .innerJoin('accounts', 'accounts.id', 'source_activities.owner_account_id')
        .select([
          'source_activities.owner_account_id as owner_account_id',
          'source_activities.source_activity_fingerprint as source_activity_fingerprint',
          'source_activities.platform_key as platform_key',
          'source_activities.platform_kind as platform_kind',
          'source_activities.activity_datetime as activity_datetime',
          'source_activities.blockchain_transaction_hash as blockchain_transaction_hash',
          'source_activities.from_address as from_address',
          'source_activities.to_address as to_address',
          'accounting_journals.id as journal_id',
          'accounting_journals.journal_fingerprint as journal_fingerprint',
          'accounting_journals.journal_kind as journal_kind',
          'accounting_postings.posting_fingerprint as posting_fingerprint',
          'accounting_postings.asset_id as asset_id',
          'accounting_postings.asset_symbol as asset_symbol',
          'accounting_postings.quantity as quantity',
          'accounting_postings.posting_role as posting_role',
          'accounting_postings.balance_category as balance_category',
        ])
        .where('accounts.profile_id', '=', profileId)
        .orderBy('source_activities.activity_datetime', 'asc')
        .orderBy('source_activities.source_activity_fingerprint', 'asc')
        .orderBy('accounting_journals.journal_fingerprint', 'asc')
        .orderBy('accounting_postings.posting_fingerprint', 'asc')
        .execute();

      const diagnosticCodesByJournalId = await this.findDiagnosticCodesByJournalId(rows.map((row) => row.journal_id));

      const postingInputs: LedgerLinkingPostingInput[] = [];
      for (const row of rows) {
        const assetSymbolResult = parseCurrency(row.asset_symbol);
        if (assetSymbolResult.isErr()) {
          return err(assetSymbolResult.error);
        }
        const journalDiagnosticCodes = diagnosticCodesByJournalId.get(row.journal_id);

        postingInputs.push({
          ownerAccountId: row.owner_account_id,
          sourceActivityFingerprint: row.source_activity_fingerprint,
          journalFingerprint: row.journal_fingerprint,
          journalKind: row.journal_kind,
          ...(journalDiagnosticCodes !== undefined && journalDiagnosticCodes.length > 0
            ? { journalDiagnosticCodes }
            : {}),
          postingFingerprint: row.posting_fingerprint,
          platformKey: row.platform_key,
          platformKind: row.platform_kind,
          activityDatetime: new Date(row.activity_datetime),
          blockchainTransactionHash: row.blockchain_transaction_hash ?? undefined,
          fromAddress: row.from_address ?? undefined,
          toAddress: row.to_address ?? undefined,
          assetId: row.asset_id,
          assetSymbol: assetSymbolResult.value,
          quantity: parseDecimal(row.quantity),
          role: row.posting_role,
          balanceCategory: row.balance_category,
        });
      }

      return ok(postingInputs);
    } catch (error) {
      return err(error instanceof Error ? error : new Error(String(error)));
    }
  }

  private async findDiagnosticCodesByJournalId(journalIds: readonly number[]): Promise<Map<number, string[]>> {
    const uniqueJournalIds = [...new Set(journalIds)];
    if (uniqueJournalIds.length === 0) {
      return new Map();
    }

    const rows = await this.db
      .selectFrom('accounting_journal_diagnostics')
      .select(['journal_id', 'diagnostic_code'])
      .where('journal_id', 'in', uniqueJournalIds)
      .orderBy('journal_id', 'asc')
      .orderBy('diagnostic_order', 'asc')
      .execute();

    const codesByJournalId = new Map<number, string[]>();
    for (const row of rows) {
      const codes = codesByJournalId.get(row.journal_id) ?? [];
      codes.push(row.diagnostic_code);
      codesByJournalId.set(row.journal_id, codes);
    }

    return codesByJournalId;
  }

  private async replaceLedgerLinkingRelationshipsInTransaction(
    db: KyselyDB,
    profileId: number,
    relationships: readonly LedgerLinkingRelationshipDraft[]
  ): Promise<Result<LedgerLinkingRelationshipMaterializationResult, Error>> {
    try {
      const validationResult = await validateLedgerLinkingRelationshipReplacement(db, profileId, relationships);
      if (validationResult.isErr()) {
        return err(validationResult.error);
      }

      const endpointLookup = await loadLedgerLinkingAllocationEndpoints(db, profileId, relationships);
      if (endpointLookup.isErr()) {
        return err(endpointLookup.error);
      }

      const previousCount = await countLedgerLinkingRelationshipsByProfileId(db, profileId);
      const unresolvedAllocationCount = await countUnresolvedLedgerLinkingAllocationRefsByProfileId(db, profileId);
      await db
        .deleteFrom('accounting_journal_relationships')
        .where('profile_id', '=', profileId)
        .where('relationship_origin', '=', 'ledger_linking')
        .execute();

      let resolvedAllocationCount = 0;
      const now = new Date().toISOString();
      for (const relationship of relationships) {
        const resolvedAllocations: {
          allocation: LedgerLinkingRelationshipDraft['allocations'][number];
          endpoint: ResolvedLedgerLinkingAllocationEndpoint;
        }[] = [];

        for (const allocation of relationship.allocations) {
          const endpoint = resolveLedgerLinkingAllocationEndpoint(profileId, endpointLookup.value, allocation);
          if (endpoint.isErr()) {
            return err(endpoint.error);
          }

          const maxQuantity = endpoint.value.postingQuantity.abs();
          if (allocation.quantity.gt(maxQuantity)) {
            return err(
              new Error(
                `Cannot materialize ledger-linking relationship ${relationship.relationshipStableKey}: ${allocation.allocationSide} allocation ${allocation.postingFingerprint} quantity ${allocation.quantity.toFixed()} exceeds posting quantity ${maxQuantity.toFixed()}`
              )
            );
          }

          resolvedAllocations.push({ allocation, endpoint: endpoint.value });
        }

        const relationshipRow = toLedgerLinkingRelationshipRow(profileId, relationship, now);
        if (relationshipRow.isErr()) {
          return err(relationshipRow.error);
        }

        const insertedRelationship = await db
          .insertInto('accounting_journal_relationships')
          .values(relationshipRow.value)
          .returning('id')
          .executeTakeFirstOrThrow();

        const allocationRows = resolvedAllocations.map(({ allocation, endpoint }) =>
          toLedgerLinkingRelationshipAllocationRow(insertedRelationship.id, allocation, endpoint, now)
        );

        for (const rowBatch of chunkItems(allocationRows, SQLITE_SAFE_INSERT_BATCH_SIZE)) {
          await db.insertInto('accounting_journal_relationship_allocations').values(rowBatch).execute();
        }
        resolvedAllocationCount += allocationRows.length;
      }

      return ok({
        previousCount,
        resolvedAllocationCount,
        savedCount: relationships.length,
        unresolvedAllocationCount,
      });
    } catch (error) {
      return err(error instanceof Error ? error : new Error(String(error)));
    }
  }

  private async deleteSourceActivitiesByOwnerAccountIdsInTransaction(
    db: KyselyDB,
    ownerAccountIds: readonly number[]
  ): Promise<Result<number, Error>> {
    try {
      if (ownerAccountIds.length === 0) {
        return ok(0);
      }

      const sourceActivityFingerprints = await loadSourceActivityFingerprintsByOwnerAccountIds(db, ownerAccountIds);
      await deleteProcessorRelationshipsForSourceActivityFingerprints(db, sourceActivityFingerprints);

      let deletedCount = 0;
      for (const ownerAccountIdBatch of chunkItems([...ownerAccountIds], SQLITE_SAFE_IN_BATCH_SIZE)) {
        const result = await db
          .deleteFrom('source_activities')
          .where('owner_account_id', 'in', ownerAccountIdBatch)
          .executeTakeFirst();
        deletedCount += Number(result.numDeletedRows);
      }

      return ok(deletedCount);
    } catch (error) {
      return err(error instanceof Error ? error : new Error(String(error)));
    }
  }

  private async deleteAllSourceActivitiesInTransaction(db: KyselyDB): Promise<Result<number, Error>> {
    try {
      await deleteAllProcessorRelationships(db);
      const result = await db.deleteFrom('source_activities').executeTakeFirst();
      return ok(Number(result.numDeletedRows));
    } catch (error) {
      return err(error instanceof Error ? error : new Error(String(error)));
    }
  }

  private async saveLedgerLinkingAssetIdentityAssertionInTransaction(
    db: KyselyDB,
    profileId: number,
    assertion: LedgerLinkingAssetIdentityAssertion
  ): Promise<Result<LedgerLinkingAssetIdentityAssertionSaveResult, Error>> {
    const validationResult = await validateLedgerLinkingAssetIdentityAssertionReplacement(db, profileId, [assertion]);
    if (validationResult.isErr()) {
      return err(validationResult.error);
    }

    const canonicalAssertion = validationResult.value[0];
    if (canonicalAssertion === undefined) {
      return err(new Error('Cannot save missing ledger-linking asset identity assertion'));
    }

    try {
      const existing = await db
        .selectFrom('ledger_linking_asset_identity_assertions')
        .select(['evidence_kind'])
        .where('profile_id', '=', profileId)
        .where('relationship_kind', '=', canonicalAssertion.relationshipKind)
        .where('asset_id_a', '=', canonicalAssertion.assetIdA)
        .where('asset_id_b', '=', canonicalAssertion.assetIdB)
        .executeTakeFirst();

      if (existing === undefined) {
        await db
          .insertInto('ledger_linking_asset_identity_assertions')
          .values(toLedgerLinkingAssetIdentityAssertionRow(profileId, canonicalAssertion, new Date().toISOString()))
          .execute();

        return ok({
          action: 'created',
          assertion: canonicalAssertion,
        });
      }

      if (existing.evidence_kind === canonicalAssertion.evidenceKind) {
        return ok({
          action: 'unchanged',
          assertion: canonicalAssertion,
        });
      }

      await db
        .updateTable('ledger_linking_asset_identity_assertions')
        .set({
          evidence_kind: canonicalAssertion.evidenceKind,
          updated_at: new Date().toISOString(),
        })
        .where('profile_id', '=', profileId)
        .where('relationship_kind', '=', canonicalAssertion.relationshipKind)
        .where('asset_id_a', '=', canonicalAssertion.assetIdA)
        .where('asset_id_b', '=', canonicalAssertion.assetIdB)
        .execute();

      return ok({
        action: 'updated',
        assertion: canonicalAssertion,
      });
    } catch (error) {
      return err(error instanceof Error ? error : new Error(String(error)));
    }
  }

  private async replaceLedgerLinkingAssetIdentityAssertionsInTransaction(
    db: KyselyDB,
    profileId: number,
    assertions: readonly LedgerLinkingAssetIdentityAssertion[]
  ): Promise<Result<LedgerLinkingAssetIdentityAssertionReplacementResult, Error>> {
    const validationResult = await validateLedgerLinkingAssetIdentityAssertionReplacement(db, profileId, assertions);
    if (validationResult.isErr()) {
      return err(validationResult.error);
    }

    try {
      const previous = await db
        .selectFrom('ledger_linking_asset_identity_assertions')
        .select(({ fn }) => [fn.count<number>('id').as('count')])
        .where('profile_id', '=', profileId)
        .executeTakeFirst();
      const previousCount = previous?.count ?? 0;

      await db.deleteFrom('ledger_linking_asset_identity_assertions').where('profile_id', '=', profileId).execute();

      if (validationResult.value.length > 0) {
        const now = new Date().toISOString();
        await db
          .insertInto('ledger_linking_asset_identity_assertions')
          .values(
            validationResult.value.map((assertion) =>
              toLedgerLinkingAssetIdentityAssertionRow(profileId, assertion, now)
            )
          )
          .execute();
      }

      return ok({
        previousCount,
        savedCount: validationResult.value.length,
      });
    } catch (error) {
      return err(error instanceof Error ? error : new Error(String(error)));
    }
  }

  private async replaceForSourceActivityInTransaction(
    db: KyselyDB,
    params: ReplaceAccountingLedgerParams
  ): Promise<Result<ReplaceAccountingLedgerSummary, Error>> {
    const validationResult = validateSourceActivityLedgerDraft(params);
    if (validationResult.isErr()) {
      return err(validationResult.error);
    }

    const rawTransactionIdsResult = normalizeRawTransactionIds(params.rawTransactionIds);
    if (rawTransactionIdsResult.isErr()) {
      return err(rawTransactionIdsResult.error);
    }

    const rawTransactionIds = rawTransactionIdsResult.value;
    const rawAssignmentValidation = await validateRawTransactionAssignments(
      db,
      params.sourceActivity,
      rawTransactionIds
    );
    if (rawAssignmentValidation.isErr()) {
      return err(rawAssignmentValidation.error);
    }

    const profileIdResult = await loadOwnerAccountProfileId(db, params.sourceActivity.ownerAccountId);
    if (profileIdResult.isErr()) {
      return err(profileIdResult.error);
    }

    const sourceActivityIdResult = await upsertSourceActivity(db, params.sourceActivity);
    if (sourceActivityIdResult.isErr()) {
      return err(sourceActivityIdResult.error);
    }

    const sourceActivityId = sourceActivityIdResult.value;
    await deleteProcessorRelationshipsForSourceActivityFingerprint(db, params.sourceActivity.sourceActivityFingerprint);
    await db.deleteFrom('accounting_journals').where('source_activity_id', '=', sourceActivityId).execute();
    await db
      .deleteFrom('raw_transaction_source_activity_assignments')
      .where('source_activity_id', '=', sourceActivityId)
      .execute();

    const rawAssignmentCount = await persistRawTransactionAssignments(db, sourceActivityId, rawTransactionIds);
    const journalRefs = new Map<string, PersistedJournalRef>();
    const postingRefs = new Map<string, PersistedPostingRef>();
    let diagnosticCount = 0;
    let postingCount = 0;
    let sourceComponentCount = 0;

    for (const journal of params.journals) {
      const journalRefResult = await persistJournal(db, sourceActivityId, journal);
      if (journalRefResult.isErr()) {
        return err(journalRefResult.error);
      }

      const journalRef = journalRefResult.value;
      journalRefs.set(buildJournalRefKey(journal.sourceActivityFingerprint, journal.journalStableKey), journalRef);

      const diagnosticsResult = await persistJournalDiagnostics(db, journalRef.id, journal);
      if (diagnosticsResult.isErr()) {
        return err(diagnosticsResult.error);
      }
      diagnosticCount += diagnosticsResult.value;

      for (const posting of journal.postings) {
        const postingRefResult = await persistPosting(db, journalRef.id, journalRef.fingerprint, posting);
        if (postingRefResult.isErr()) {
          return err(postingRefResult.error);
        }

        const postingRef = postingRefResult.value;
        postingRefs.set(
          buildPostingRefKey(journal.sourceActivityFingerprint, journal.journalStableKey, posting.postingStableKey),
          postingRef
        );
        postingCount++;

        for (const sourceComponentRef of posting.sourceComponentRefs) {
          const componentResult = await persistPostingSourceComponent(db, postingRef.id, sourceComponentRef);
          if (componentResult.isErr()) {
            return err(componentResult.error);
          }

          sourceComponentCount++;
        }
      }
    }

    for (const journal of params.journals) {
      for (const relationship of journal.relationships ?? []) {
        const relationshipResult = await persistProcessorRelationship(
          db,
          profileIdResult.value,
          relationship,
          journal,
          journalRefs,
          postingRefs
        );
        if (relationshipResult.isErr()) {
          return err(relationshipResult.error);
        }
      }
    }

    await refreshLedgerLinkingRelationshipEndpointsForSourceActivity(
      db,
      params.sourceActivity.sourceActivityFingerprint,
      journalRefs,
      postingRefs
    );

    return ok({
      sourceActivityId,
      diagnosticCount,
      journalCount: params.journals.length,
      postingCount,
      sourceComponentCount,
      rawAssignmentCount,
    });
  }
}

function normalizeOwnerAccountIds(accountIds: readonly number[]): Result<number[], Error> {
  for (const accountId of accountIds) {
    if (!Number.isInteger(accountId) || accountId <= 0) {
      return err(new Error(`Owner account id must be a positive integer, received ${accountId}`));
    }
  }

  return ok([...new Set(accountIds)].sort((left, right) => left - right));
}

function normalizeRawTransactionIds(rawTransactionIds: readonly number[] | undefined): Result<number[], Error> {
  const ids = rawTransactionIds ?? [];
  for (const rawTransactionId of ids) {
    if (!Number.isInteger(rawTransactionId) || rawTransactionId <= 0) {
      return err(new Error(`Raw transaction id must be a positive integer, received ${rawTransactionId}`));
    }
  }

  return ok([...new Set(ids)].sort((left, right) => left - right));
}

async function validateLedgerLinkingRelationshipReplacement(
  db: KyselyDB,
  profileId: number,
  relationships: readonly LedgerLinkingRelationshipDraft[]
): Promise<Result<void, Error>> {
  if (!Number.isInteger(profileId) || profileId <= 0) {
    return err(new Error(`Profile id must be a positive integer, received ${profileId}`));
  }

  const profileExists = await doesProfileExist(db, profileId);
  if (!profileExists) {
    return err(new Error(`Cannot replace ledger-linking relationships for missing profile ${profileId}`));
  }

  const relationshipKeys = new Set<string>();
  for (const relationship of relationships) {
    const validation = LedgerLinkingRelationshipDraftSchema.safeParse(relationship);
    if (!validation.success) {
      return err(new Error(`Invalid ledger-linking relationship draft: ${validation.error.message}`));
    }

    const relationshipKey = relationship.relationshipStableKey;
    if (relationshipKeys.has(relationshipKey)) {
      return err(new Error(`Duplicate ledger-linking relationship stable key ${relationship.relationshipStableKey}`));
    }

    const allocationKeys = new Set<string>();
    for (const allocation of relationship.allocations) {
      const allocationKey = `${allocation.allocationSide}\u0000${allocation.postingFingerprint}`;
      if (allocationKeys.has(allocationKey)) {
        return err(
          new Error(
            `Duplicate ${allocation.allocationSide} allocation for posting ${allocation.postingFingerprint} in relationship ${relationship.relationshipStableKey}`
          )
        );
      }

      allocationKeys.add(allocationKey);
    }

    relationshipKeys.add(relationshipKey);
  }

  return ok(undefined);
}

async function validateLedgerLinkingAssetIdentityAssertionReplacement(
  db: KyselyDB,
  profileId: number,
  assertions: readonly LedgerLinkingAssetIdentityAssertion[]
): Promise<Result<LedgerLinkingAssetIdentityAssertion[], Error>> {
  if (!Number.isInteger(profileId) || profileId <= 0) {
    return err(new Error(`Profile id must be a positive integer, received ${profileId}`));
  }

  const profileExists = await doesProfileExist(db, profileId);
  if (!profileExists) {
    return err(new Error(`Cannot replace ledger-linking asset identity assertions for missing profile ${profileId}`));
  }

  const canonicalAssertions: LedgerLinkingAssetIdentityAssertion[] = [];
  const assertionKeys = new Set<string>();
  for (const assertion of assertions) {
    const validation = LedgerLinkingAssetIdentityAssertionSchema.safeParse(assertion);
    if (!validation.success) {
      return err(new Error(`Invalid ledger-linking asset identity assertion: ${validation.error.message}`));
    }

    const canonicalPair = canonicalizeLedgerLinkingAssetIdentityPair(
      validation.data.assetIdA,
      validation.data.assetIdB
    );
    if (canonicalPair.isErr()) {
      return err(canonicalPair.error);
    }

    const canonicalAssertion: LedgerLinkingAssetIdentityAssertion = {
      ...validation.data,
      ...canonicalPair.value,
    };
    const assertionKey = [
      canonicalAssertion.relationshipKind,
      canonicalAssertion.assetIdA,
      canonicalAssertion.assetIdB,
    ].join('\0');
    if (assertionKeys.has(assertionKey)) {
      return err(
        new Error(
          `Duplicate ledger-linking asset identity assertion for ${canonicalAssertion.relationshipKind}: ${canonicalAssertion.assetIdA} <-> ${canonicalAssertion.assetIdB}`
        )
      );
    }

    assertionKeys.add(assertionKey);
    canonicalAssertions.push(canonicalAssertion);
  }

  return ok(canonicalAssertions);
}

async function doesProfileExist(db: KyselyDB, profileId: number): Promise<boolean> {
  const row = await db.selectFrom('profiles').select('id').where('id', '=', profileId).executeTakeFirst();
  return row !== undefined;
}

function validateSourceActivityLedgerDraft(params: ReplaceAccountingLedgerParams): Result<void, Error> {
  const sourceActivityValidation = SourceActivityDraftSchema.safeParse(params.sourceActivity);
  if (!sourceActivityValidation.success) {
    return err(new Error(`Invalid source activity draft: ${sourceActivityValidation.error.message}`));
  }

  for (const journal of params.journals) {
    if (journal.sourceActivityFingerprint !== params.sourceActivity.sourceActivityFingerprint) {
      return err(
        new Error(
          `Journal ${journal.journalStableKey} belongs to ${journal.sourceActivityFingerprint}, expected ${params.sourceActivity.sourceActivityFingerprint}`
        )
      );
    }

    const journalValidation = validateAccountingJournalDraft(journal);
    if (journalValidation.isErr()) {
      return err(journalValidation.error);
    }
  }

  return ok(undefined);
}

async function validateRawTransactionAssignments(
  db: KyselyDB,
  sourceActivity: SourceActivityDraft,
  rawTransactionIds: readonly number[]
): Promise<Result<void, Error>> {
  if (rawTransactionIds.length === 0) {
    return ok(undefined);
  }

  const rawTransactionScopes = await loadRawTransactionAssignmentScopes(db, rawTransactionIds);
  const missingRawTransactionIds = findMissingRawTransactionIds(rawTransactionIds, rawTransactionScopes);
  if (missingRawTransactionIds.length > 0) {
    return err(
      new Error(
        `Source activity ${sourceActivity.sourceActivityFingerprint} references missing raw transaction ids: ${missingRawTransactionIds.join(', ')}`
      )
    );
  }

  const ownerAccountScopeIds = await loadOwnerAccountScopeIds(db, sourceActivity.ownerAccountId);
  if (!ownerAccountScopeIds.has(sourceActivity.ownerAccountId)) {
    return err(
      new Error(
        `Source activity ${sourceActivity.sourceActivityFingerprint} references missing owner account ${sourceActivity.ownerAccountId}`
      )
    );
  }

  const outOfScopeRawTransactions = rawTransactionScopes.filter(
    (scope) => !ownerAccountScopeIds.has(scope.rawAccountId)
  );
  if (outOfScopeRawTransactions.length > 0) {
    const rawTransactionIdsText = outOfScopeRawTransactions.map((scope) => scope.rawTransactionId).join(', ');
    return err(
      new Error(
        `Source activity ${sourceActivity.sourceActivityFingerprint} for owner account ${sourceActivity.ownerAccountId} cannot assign raw transaction ids outside that account scope: ${rawTransactionIdsText}`
      )
    );
  }

  const conflictingAssignments = await db
    .selectFrom('raw_transaction_source_activity_assignments')
    .innerJoin(
      'source_activities',
      'source_activities.id',
      'raw_transaction_source_activity_assignments.source_activity_id'
    )
    .select([
      'raw_transaction_source_activity_assignments.raw_transaction_id as raw_transaction_id',
      'source_activities.source_activity_fingerprint as source_activity_fingerprint',
    ])
    .where('raw_transaction_source_activity_assignments.raw_transaction_id', 'in', rawTransactionIds)
    .where('source_activities.source_activity_fingerprint', '!=', sourceActivity.sourceActivityFingerprint)
    .orderBy('raw_transaction_source_activity_assignments.raw_transaction_id', 'asc')
    .execute();

  if (conflictingAssignments.length > 0) {
    const conflicts = conflictingAssignments
      .map((row) => `${row.raw_transaction_id}->${row.source_activity_fingerprint}`)
      .join(', ');
    return err(
      new Error(
        `Source activity ${sourceActivity.sourceActivityFingerprint} cannot assign raw transactions already assigned to another source activity: ${conflicts}`
      )
    );
  }

  return ok(undefined);
}

async function loadRawTransactionAssignmentScopes(
  db: KyselyDB,
  rawTransactionIds: readonly number[]
): Promise<RawTransactionAssignmentScope[]> {
  const rows = await db
    .selectFrom('raw_transactions')
    .innerJoin('accounts', 'accounts.id', 'raw_transactions.account_id')
    .select(['raw_transactions.id as raw_transaction_id', 'raw_transactions.account_id as raw_account_id'])
    .where('raw_transactions.id', 'in', rawTransactionIds)
    .orderBy('raw_transactions.id', 'asc')
    .execute();

  return rows.map((row) => ({
    rawAccountId: row.raw_account_id,
    rawTransactionId: row.raw_transaction_id,
  }));
}

async function loadOwnerAccountScopeIds(db: KyselyDB, ownerAccountId: number): Promise<ReadonlySet<number>> {
  const rows = await sql<{ id: number }>`
    WITH RECURSIVE account_scope(id, path) AS (
      SELECT id, ',' || id || ',' FROM accounts WHERE id = ${ownerAccountId}
      UNION ALL
      SELECT accounts.id, account_scope.path || accounts.id || ','
      FROM accounts
      INNER JOIN account_scope ON accounts.parent_account_id = account_scope.id
      WHERE instr(account_scope.path, ',' || accounts.id || ',') = 0
    )
    SELECT id FROM account_scope
  `.execute(db);

  return new Set(rows.rows.map((row) => row.id));
}

async function loadOwnerAccountProfileId(db: KyselyDB, ownerAccountId: number): Promise<Result<number, Error>> {
  try {
    const row = await db
      .selectFrom('accounts')
      .select('profile_id')
      .where('id', '=', ownerAccountId)
      .executeTakeFirst();

    if (!row) {
      return err(new Error(`Source activity references missing owner account ${ownerAccountId}`));
    }

    return ok(row.profile_id);
  } catch (error) {
    return err(error instanceof Error ? error : new Error(String(error)));
  }
}

async function loadSourceActivityFingerprintsByOwnerAccountIds(
  db: KyselyDB,
  ownerAccountIds: readonly number[]
): Promise<string[]> {
  const sourceActivityFingerprints: string[] = [];

  for (const ownerAccountIdBatch of chunkItems([...ownerAccountIds], SQLITE_SAFE_IN_BATCH_SIZE)) {
    const rows = await db
      .selectFrom('source_activities')
      .select('source_activity_fingerprint')
      .where('owner_account_id', 'in', ownerAccountIdBatch)
      .execute();

    sourceActivityFingerprints.push(...rows.map((row) => row.source_activity_fingerprint));
  }

  return sourceActivityFingerprints;
}

async function deleteAllProcessorRelationships(db: KyselyDB): Promise<void> {
  await db.deleteFrom('accounting_journal_relationships').where('relationship_origin', '=', 'processor').execute();
}

async function countLedgerLinkingRelationshipsByProfileId(db: KyselyDB, profileId: number): Promise<number> {
  const row = await db
    .selectFrom('accounting_journal_relationships')
    .select(({ fn }) => fn.countAll<number>().as('count'))
    .where('profile_id', '=', profileId)
    .where('relationship_origin', '=', 'ledger_linking')
    .executeTakeFirst();

  return Number(row?.count ?? 0);
}

async function countUnresolvedLedgerLinkingAllocationRefsByProfileId(db: KyselyDB, profileId: number): Promise<number> {
  const row = await db
    .selectFrom('accounting_journal_relationship_allocations')
    .innerJoin(
      'accounting_journal_relationships',
      'accounting_journal_relationships.id',
      'accounting_journal_relationship_allocations.relationship_id'
    )
    .select(({ fn }) => fn.countAll<number>().as('count'))
    .where('accounting_journal_relationships.profile_id', '=', profileId)
    .where('accounting_journal_relationships.relationship_origin', '=', 'ledger_linking')
    .where((eb) =>
      eb.or([
        eb('accounting_journal_relationship_allocations.journal_id', 'is', null),
        eb('accounting_journal_relationship_allocations.posting_id', 'is', null),
      ])
    )
    .executeTakeFirst();

  return Number(row?.count ?? 0);
}

async function loadRelationshipAllocationsByRelationshipIds(
  db: KyselyDB,
  relationshipIds: readonly number[]
): Promise<Result<Map<number, LedgerLinkingPersistedRelationship['allocations'][number][]>, Error>> {
  const allocationsByRelationshipId = new Map<number, LedgerLinkingPersistedRelationship['allocations'][number][]>();
  if (relationshipIds.length === 0) {
    return ok(allocationsByRelationshipId);
  }

  try {
    for (const relationshipIdBatch of chunkItems([...relationshipIds], SQLITE_SAFE_IN_BATCH_SIZE)) {
      const rows = await db
        .selectFrom('accounting_journal_relationship_allocations')
        .select([
          'relationship_id',
          'id',
          'allocation_side',
          'allocation_quantity',
          'source_activity_fingerprint',
          'journal_id',
          'posting_id',
          'journal_fingerprint',
          'posting_fingerprint',
          'asset_id',
          'asset_symbol',
        ])
        .where('relationship_id', 'in', relationshipIdBatch)
        .orderBy('relationship_id', 'asc')
        .orderBy('allocation_side', 'asc')
        .orderBy('id', 'asc')
        .execute();

      for (const row of rows) {
        const allocations = allocationsByRelationshipId.get(row.relationship_id) ?? [];
        allocations.push({
          allocationSide: row.allocation_side,
          assetId: row.asset_id,
          assetSymbol: row.asset_symbol,
          id: row.id,
          quantity: row.allocation_quantity,
          sourceActivityFingerprint: row.source_activity_fingerprint,
          journalFingerprint: row.journal_fingerprint,
          postingFingerprint: row.posting_fingerprint,
          currentJournalId: row.journal_id ?? undefined,
          currentPostingId: row.posting_id ?? undefined,
        });
        allocationsByRelationshipId.set(row.relationship_id, allocations);
      }
    }

    return ok(allocationsByRelationshipId);
  } catch (error) {
    return err(error instanceof Error ? error : new Error(String(error)));
  }
}

async function loadRelationshipIdsByAllocationSourceActivityFingerprints(
  db: KyselyDB,
  relationshipOrigin: AccountingJournalRelationshipsTable['relationship_origin'],
  sourceActivityFingerprints: readonly string[]
): Promise<number[]> {
  const relationshipIds = new Set<number>();
  const uniqueFingerprints = [...new Set(sourceActivityFingerprints)].sort();
  if (uniqueFingerprints.length === 0) {
    return [];
  }

  for (const sourceActivityFingerprintBatch of chunkItems(uniqueFingerprints, SQLITE_SAFE_IN_BATCH_SIZE)) {
    const rows = await db
      .selectFrom('accounting_journal_relationships')
      .innerJoin(
        'accounting_journal_relationship_allocations',
        'accounting_journal_relationship_allocations.relationship_id',
        'accounting_journal_relationships.id'
      )
      .select('accounting_journal_relationships.id as relationship_id')
      .where('accounting_journal_relationships.relationship_origin', '=', relationshipOrigin)
      .where(
        'accounting_journal_relationship_allocations.source_activity_fingerprint',
        'in',
        sourceActivityFingerprintBatch
      )
      .execute();

    for (const row of rows) {
      relationshipIds.add(row.relationship_id);
    }
  }

  return [...relationshipIds].sort((left, right) => left - right);
}

async function deleteRelationshipsByIds(db: KyselyDB, relationshipIds: readonly number[]): Promise<void> {
  for (const relationshipIdBatch of chunkItems([...relationshipIds], SQLITE_SAFE_IN_BATCH_SIZE)) {
    await db.deleteFrom('accounting_journal_relationships').where('id', 'in', relationshipIdBatch).execute();
  }
}

async function touchRelationshipsByIds(db: KyselyDB, relationshipIds: readonly number[], now: string): Promise<void> {
  for (const relationshipIdBatch of chunkItems([...relationshipIds], SQLITE_SAFE_IN_BATCH_SIZE)) {
    await db
      .updateTable('accounting_journal_relationships')
      .set({ updated_at: now })
      .where('id', 'in', relationshipIdBatch)
      .execute();
  }
}

async function deleteProcessorRelationshipsForSourceActivityFingerprint(
  db: KyselyDB,
  sourceActivityFingerprint: string
): Promise<void> {
  const relationshipIds = await loadRelationshipIdsByAllocationSourceActivityFingerprints(db, 'processor', [
    sourceActivityFingerprint,
  ]);
  await deleteRelationshipsByIds(db, relationshipIds);
}

async function deleteProcessorRelationshipsForSourceActivityFingerprints(
  db: KyselyDB,
  sourceActivityFingerprints: readonly string[]
): Promise<void> {
  if (sourceActivityFingerprints.length === 0) {
    return;
  }

  const relationshipIds = await loadRelationshipIdsByAllocationSourceActivityFingerprints(
    db,
    'processor',
    sourceActivityFingerprints
  );
  await deleteRelationshipsByIds(db, relationshipIds);
}

async function refreshLedgerLinkingRelationshipEndpointsForSourceActivity(
  db: KyselyDB,
  sourceActivityFingerprint: string,
  journalRefs: ReadonlyMap<string, PersistedJournalRef>,
  postingRefs: ReadonlyMap<string, PersistedPostingRef>
): Promise<void> {
  const relationshipIds = await loadRelationshipIdsByAllocationSourceActivityFingerprints(db, 'ledger_linking', [
    sourceActivityFingerprint,
  ]);
  if (relationshipIds.length === 0) {
    return;
  }

  const now = new Date().toISOString();

  for (const journalRef of journalRefs.values()) {
    for (const relationshipIdBatch of chunkItems(relationshipIds, SQLITE_SAFE_IN_BATCH_SIZE)) {
      await db
        .updateTable('accounting_journal_relationship_allocations')
        .set({ journal_id: journalRef.id, updated_at: now })
        .where('relationship_id', 'in', relationshipIdBatch)
        .where('source_activity_fingerprint', '=', sourceActivityFingerprint)
        .where('journal_fingerprint', '=', journalRef.fingerprint)
        .execute();
    }
  }

  for (const postingRef of postingRefs.values()) {
    for (const relationshipIdBatch of chunkItems(relationshipIds, SQLITE_SAFE_IN_BATCH_SIZE)) {
      await db
        .updateTable('accounting_journal_relationship_allocations')
        .set({ posting_id: postingRef.id, updated_at: now })
        .where('relationship_id', 'in', relationshipIdBatch)
        .where('source_activity_fingerprint', '=', sourceActivityFingerprint)
        .where('posting_fingerprint', '=', postingRef.fingerprint)
        .execute();
    }
  }

  await touchRelationshipsByIds(db, relationshipIds, now);
}

async function loadLedgerLinkingAllocationEndpoints(
  db: KyselyDB,
  profileId: number,
  relationships: readonly LedgerLinkingRelationshipDraft[]
): Promise<Result<ReadonlyMap<string, ResolvedLedgerLinkingAllocationEndpoint>, Error>> {
  const postingFingerprints = new Set<string>();
  for (const relationship of relationships) {
    for (const allocation of relationship.allocations) {
      postingFingerprints.add(allocation.postingFingerprint);
    }
  }

  const endpoints = new Map<string, ResolvedLedgerLinkingAllocationEndpoint>();
  for (const postingFingerprintBatch of chunkItems([...postingFingerprints], SQLITE_SAFE_IN_BATCH_SIZE)) {
    const rows = await db
      .selectFrom('accounting_postings')
      .innerJoin('accounting_journals', 'accounting_journals.id', 'accounting_postings.journal_id')
      .innerJoin('source_activities', 'source_activities.id', 'accounting_journals.source_activity_id')
      .innerJoin('accounts', 'accounts.id', 'source_activities.owner_account_id')
      .select([
        'source_activities.source_activity_fingerprint as source_activity_fingerprint',
        'accounting_journals.id as journal_id',
        'accounting_journals.journal_fingerprint as journal_fingerprint',
        'accounting_postings.id as posting_id',
        'accounting_postings.posting_fingerprint as posting_fingerprint',
        'accounting_postings.asset_id as asset_id',
        'accounting_postings.asset_symbol as asset_symbol',
        'accounting_postings.quantity as quantity',
      ])
      .where('accounts.profile_id', '=', profileId)
      .where('accounting_postings.posting_fingerprint', 'in', postingFingerprintBatch)
      .execute();

    for (const row of rows) {
      const lookupKey = buildLedgerLinkingAllocationEndpointLookupKey({
        journalFingerprint: row.journal_fingerprint,
        postingFingerprint: row.posting_fingerprint,
        sourceActivityFingerprint: row.source_activity_fingerprint,
      });
      if (endpoints.has(lookupKey)) {
        return err(
          new Error(
            `Cannot materialize ledger-linking relationship: duplicate allocation endpoint ${row.source_activity_fingerprint} / ${row.journal_fingerprint} / ${row.posting_fingerprint} for profile ${profileId}`
          )
        );
      }

      endpoints.set(lookupKey, {
        assetId: row.asset_id,
        assetSymbol: row.asset_symbol,
        sourceActivityFingerprint: row.source_activity_fingerprint,
        journalId: row.journal_id,
        journalFingerprint: row.journal_fingerprint,
        postingId: row.posting_id,
        postingFingerprint: row.posting_fingerprint,
        postingQuantity: parseDecimal(row.quantity),
      });
    }
  }

  return ok(endpoints);
}

function resolveLedgerLinkingAllocationEndpoint(
  profileId: number,
  endpointLookup: ReadonlyMap<string, ResolvedLedgerLinkingAllocationEndpoint>,
  allocation: LedgerLinkingRelationshipDraft['allocations'][number]
): Result<ResolvedLedgerLinkingAllocationEndpoint, Error> {
  const endpoint = endpointLookup.get(buildLedgerLinkingAllocationEndpointLookupKey(allocation));
  if (endpoint === undefined) {
    return err(
      new Error(
        `Cannot materialize ledger-linking relationship: ${allocation.allocationSide} allocation endpoint ${allocation.sourceActivityFingerprint} / ${allocation.journalFingerprint} / ${allocation.postingFingerprint} was not found for profile ${profileId}`
      )
    );
  }

  return ok(endpoint);
}

function buildLedgerLinkingAllocationEndpointLookupKey(input: {
  journalFingerprint: string;
  postingFingerprint: string;
  sourceActivityFingerprint: string;
}): string {
  return [input.sourceActivityFingerprint, input.journalFingerprint, input.postingFingerprint].join('\0');
}

function findMissingRawTransactionIds(
  expectedRawTransactionIds: readonly number[],
  rawTransactionScopes: readonly RawTransactionAssignmentScope[]
): number[] {
  const foundRawTransactionIds = new Set(rawTransactionScopes.map((scope) => scope.rawTransactionId));
  return expectedRawTransactionIds.filter((rawTransactionId) => !foundRawTransactionIds.has(rawTransactionId));
}

async function upsertSourceActivity(db: KyselyDB, draft: SourceActivityDraft): Promise<Result<number, Error>> {
  const now = new Date().toISOString();
  const row = toSourceActivityRow(draft, now);
  const existing = await db
    .selectFrom('source_activities')
    .select(['id', 'owner_account_id'])
    .where('source_activity_fingerprint', '=', draft.sourceActivityFingerprint)
    .executeTakeFirst();

  if (existing) {
    if (existing.owner_account_id !== draft.ownerAccountId) {
      return err(
        new Error(
          `Source activity ${draft.sourceActivityFingerprint} already belongs to owner account ${existing.owner_account_id}, not ${draft.ownerAccountId}`
        )
      );
    }

    await db
      .updateTable('source_activities')
      .set(toSourceActivityUpdateRow(draft, now))
      .where('id', '=', existing.id)
      .execute();

    return ok(existing.id);
  }

  const inserted = await db.insertInto('source_activities').values(row).returning('id').executeTakeFirstOrThrow();
  return ok(inserted.id);
}

function toSourceActivityRow(draft: SourceActivityDraft, now: string): Insertable<SourceActivitiesTable> {
  return {
    owner_account_id: draft.ownerAccountId,
    source_activity_origin: draft.sourceActivityOrigin,
    source_activity_stable_key: draft.sourceActivityStableKey,
    platform_key: draft.platformKey,
    platform_kind: draft.platformKind,
    source_activity_fingerprint: draft.sourceActivityFingerprint,
    activity_status: draft.activityStatus,
    activity_datetime: draft.activityDatetime,
    activity_timestamp_ms: draft.activityTimestampMs ?? null,
    from_address: draft.fromAddress ?? null,
    to_address: draft.toAddress ?? null,
    blockchain_name: draft.blockchainName ?? null,
    blockchain_block_height: draft.blockchainBlockHeight ?? null,
    blockchain_transaction_hash: draft.blockchainTransactionHash ?? null,
    blockchain_is_confirmed: draft.blockchainIsConfirmed ?? null,
    created_at: now,
    updated_at: null,
  };
}

function toSourceActivityUpdateRow(draft: SourceActivityDraft, now: string): Updateable<SourceActivitiesTable> {
  return {
    owner_account_id: draft.ownerAccountId,
    source_activity_origin: draft.sourceActivityOrigin,
    source_activity_stable_key: draft.sourceActivityStableKey,
    platform_key: draft.platformKey,
    platform_kind: draft.platformKind,
    source_activity_fingerprint: draft.sourceActivityFingerprint,
    activity_status: draft.activityStatus,
    activity_datetime: draft.activityDatetime,
    activity_timestamp_ms: draft.activityTimestampMs ?? null,
    from_address: draft.fromAddress ?? null,
    to_address: draft.toAddress ?? null,
    blockchain_name: draft.blockchainName ?? null,
    blockchain_block_height: draft.blockchainBlockHeight ?? null,
    blockchain_transaction_hash: draft.blockchainTransactionHash ?? null,
    blockchain_is_confirmed: draft.blockchainIsConfirmed ?? null,
    updated_at: now,
  };
}

async function persistRawTransactionAssignments(
  db: KyselyDB,
  sourceActivityId: number,
  rawTransactionIds: readonly number[]
): Promise<number> {
  if (rawTransactionIds.length === 0) {
    return 0;
  }

  await db
    .insertInto('raw_transaction_source_activity_assignments')
    .values(
      rawTransactionIds.map((rawTransactionId) => ({
        source_activity_id: sourceActivityId,
        raw_transaction_id: rawTransactionId,
      }))
    )
    .execute();

  return rawTransactionIds.length;
}

async function persistJournal(
  db: KyselyDB,
  sourceActivityId: number,
  journal: AccountingJournalDraft
): Promise<Result<PersistedJournalRef, Error>> {
  const journalFingerprintResult = computeAccountingJournalFingerprint(journal);
  if (journalFingerprintResult.isErr()) {
    return err(journalFingerprintResult.error);
  }

  const now = new Date().toISOString();
  const inserted = await db
    .insertInto('accounting_journals')
    .values({
      source_activity_id: sourceActivityId,
      journal_fingerprint: journalFingerprintResult.value,
      journal_stable_key: journal.journalStableKey,
      journal_kind: journal.journalKind,
      created_at: now,
      updated_at: null,
    })
    .returning('id')
    .executeTakeFirstOrThrow();

  return ok({
    id: inserted.id,
    fingerprint: journalFingerprintResult.value,
  });
}

async function persistJournalDiagnostics(
  db: KyselyDB,
  journalId: number,
  journal: AccountingJournalDraft
): Promise<Result<number, Error>> {
  const diagnostics = journal.diagnostics ?? [];
  if (diagnostics.length === 0) {
    return ok(0);
  }

  const now = new Date().toISOString();
  const rows: Insertable<AccountingJournalDiagnosticsTable>[] = [];
  for (let index = 0; index < diagnostics.length; index++) {
    const diagnostic = diagnostics[index]!;
    const metadataJsonResult = serializeToJson(diagnostic.metadata);
    if (metadataJsonResult.isErr()) {
      return err(
        new Error(`Failed to serialize diagnostic ${diagnostic.code} metadata: ${metadataJsonResult.error.message}`)
      );
    }

    rows.push({
      journal_id: journalId,
      diagnostic_order: index + 1,
      diagnostic_code: diagnostic.code,
      diagnostic_message: diagnostic.message,
      severity: diagnostic.severity ?? null,
      metadata_json: metadataJsonResult.value ?? null,
      created_at: now,
    });
  }

  await db.insertInto('accounting_journal_diagnostics').values(rows).execute();
  return ok(rows.length);
}

async function persistPosting(
  db: KyselyDB,
  journalId: number,
  journalFingerprint: string,
  posting: AccountingJournalDraft['postings'][number]
): Promise<Result<PersistedPostingRef, Error>> {
  const postingFingerprintResult = computeAccountingPostingFingerprint(journalFingerprint, posting);
  if (postingFingerprintResult.isErr()) {
    return err(postingFingerprintResult.error);
  }

  const now = new Date().toISOString();
  const inserted = await db
    .insertInto('accounting_postings')
    .values(toPostingRow(journalId, postingFingerprintResult.value, posting, now))
    .returning('id')
    .executeTakeFirstOrThrow();

  return ok({
    assetId: posting.assetId,
    assetSymbol: posting.assetSymbol,
    id: inserted.id,
    fingerprint: postingFingerprintResult.value,
    quantity: posting.quantity,
  });
}

function toPostingRow(
  journalId: number,
  postingFingerprint: string,
  posting: AccountingJournalDraft['postings'][number],
  now: string
): Insertable<AccountingPostingsTable> {
  return {
    journal_id: journalId,
    posting_fingerprint: postingFingerprint,
    posting_stable_key: posting.postingStableKey,
    asset_id: posting.assetId,
    asset_symbol: posting.assetSymbol,
    quantity: posting.quantity.toFixed(),
    posting_role: posting.role,
    balance_category: posting.balanceCategory,
    settlement: posting.settlement ?? null,
    price_amount: posting.priceAtTxTime?.price.amount.toFixed() ?? null,
    price_currency: posting.priceAtTxTime?.price.currency ?? null,
    price_source: posting.priceAtTxTime?.source ?? null,
    price_fetched_at: posting.priceAtTxTime?.fetchedAt ? new Date(posting.priceAtTxTime.fetchedAt).toISOString() : null,
    price_granularity: posting.priceAtTxTime?.granularity ?? null,
    fx_rate_to_usd: posting.priceAtTxTime?.fxRateToUSD?.toFixed() ?? null,
    fx_source: posting.priceAtTxTime?.fxSource ?? null,
    fx_timestamp: posting.priceAtTxTime?.fxTimestamp ? new Date(posting.priceAtTxTime.fxTimestamp).toISOString() : null,
    created_at: now,
    updated_at: null,
  };
}

async function persistPostingSourceComponent(
  db: KyselyDB,
  postingId: number,
  sourceComponentRef: AccountingJournalDraft['postings'][number]['sourceComponentRefs'][number]
): Promise<Result<void, Error>> {
  const fingerprintResult = computeSourceComponentFingerprint(sourceComponentRef.component);
  if (fingerprintResult.isErr()) {
    return err(fingerprintResult.error);
  }

  const row: Insertable<AccountingPostingSourceComponentsTable> = {
    posting_id: postingId,
    source_component_fingerprint: fingerprintResult.value,
    source_activity_fingerprint: sourceComponentRef.component.sourceActivityFingerprint,
    component_kind: sourceComponentRef.component.componentKind,
    component_id: sourceComponentRef.component.componentId,
    occurrence: sourceComponentRef.component.occurrence ?? null,
    asset_id: sourceComponentRef.component.assetId ?? null,
    quantity: sourceComponentRef.quantity.toFixed(),
  };

  await db.insertInto('accounting_posting_source_components').values(row).execute();
  return ok(undefined);
}

function toLedgerLinkingRelationshipRow(
  profileId: number,
  relationship: LedgerLinkingRelationshipDraft,
  now: string
): Result<Insertable<AccountingJournalRelationshipsTable>, Error> {
  const recognitionStrategy = parseLedgerLinkingRelationshipRecognitionStrategy(relationship.recognitionStrategy);
  if (recognitionStrategy.isErr()) {
    return err(recognitionStrategy.error);
  }

  const evidenceJson = serializeToJson(relationship.evidence);
  if (evidenceJson.isErr()) {
    return err(
      new Error(
        `Failed to serialize ledger-linking relationship ${relationship.relationshipStableKey} evidence: ${evidenceJson.error.message}`
      )
    );
  }

  return ok({
    profile_id: profileId,
    relationship_origin: 'ledger_linking',
    relationship_stable_key: relationship.relationshipStableKey,
    relationship_kind: relationship.relationshipKind,
    recognition_strategy: recognitionStrategy.value,
    recognition_evidence_json: evidenceJson.value ?? '{}',
    confidence_score: relationship.confidenceScore?.toFixed() ?? null,
    created_at: now,
    updated_at: null,
  });
}

function parseLedgerLinkingRelationshipRecognitionStrategy(
  recognitionStrategy: string
): Result<AccountingJournalRelationshipsTable['recognition_strategy'], Error> {
  switch (recognitionStrategy) {
    case 'reviewed_relationship':
    case 'exact_hash_transfer':
    case 'fee_adjusted_exact_hash_transfer':
    case 'same_hash_grouped_transfer':
    case 'counterparty_roundtrip':
    case 'strict_exchange_amount_time_transfer':
      return ok(recognitionStrategy);
    case 'processor_supplied':
      return err(new Error('Ledger-linking relationships cannot use processor_supplied recognition strategy'));
    default:
      return err(new Error(`Unknown ledger-linking relationship recognition strategy '${recognitionStrategy}'`));
  }
}

function toLedgerLinkingRelationshipAllocationRow(
  relationshipId: number,
  allocation: LedgerLinkingRelationshipDraft['allocations'][number],
  endpoint: ResolvedLedgerLinkingAllocationEndpoint,
  now: string
): Insertable<AccountingJournalRelationshipAllocationsTable> {
  return {
    relationship_id: relationshipId,
    allocation_side: allocation.allocationSide,
    allocation_quantity: allocation.quantity.toFixed(),
    source_activity_fingerprint: endpoint.sourceActivityFingerprint,
    journal_id: endpoint.journalId,
    posting_id: endpoint.postingId,
    journal_fingerprint: endpoint.journalFingerprint,
    posting_fingerprint: endpoint.postingFingerprint,
    asset_id: endpoint.assetId,
    asset_symbol: endpoint.assetSymbol,
    created_at: now,
    updated_at: null,
  };
}

function toLedgerLinkingPersistedRelationship(
  row: {
    confidence_score: string | null;
    created_at: string;
    id: number;
    recognition_evidence_json: unknown;
    recognition_strategy: string;
    relationship_kind: LedgerLinkingPersistedRelationship['relationshipKind'];
    relationship_stable_key: string;
    updated_at: string | null;
  },
  allocations: readonly LedgerLinkingPersistedRelationship['allocations'][number][]
): Result<LedgerLinkingPersistedRelationship, Error> {
  const evidence = parseRelationshipEvidenceJson(row.relationship_stable_key, row.recognition_evidence_json);
  if (evidence.isErr()) {
    return err(evidence.error);
  }

  return ok({
    allocations,
    confidenceScore: row.confidence_score ?? undefined,
    evidence: evidence.value,
    id: row.id,
    recognitionStrategy: row.recognition_strategy,
    relationshipStableKey: row.relationship_stable_key,
    relationshipKind: row.relationship_kind,
    createdAt: row.created_at,
    updatedAt: row.updated_at ?? undefined,
  });
}

function parseRelationshipEvidenceJson(
  relationshipStableKey: string,
  rawEvidence: unknown
): Result<LedgerLinkingPersistedRelationship['evidence'], Error> {
  const evidence = parseJson(rawEvidence);
  if (evidence.isErr()) {
    return err(
      new Error(
        `Failed to parse ledger-linking relationship ${relationshipStableKey} evidence: ${evidence.error.message}`
      )
    );
  }

  if (!isJsonObject(evidence.value)) {
    return err(new Error(`Ledger-linking relationship ${relationshipStableKey} evidence must be a JSON object`));
  }

  return ok(evidence.value);
}

function isJsonObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function toLedgerLinkingAssetIdentityAssertionRow(
  profileId: number,
  assertion: LedgerLinkingAssetIdentityAssertion,
  now: string
): Insertable<LedgerLinkingAssetIdentityAssertionsTable> {
  return {
    profile_id: profileId,
    relationship_kind: assertion.relationshipKind,
    asset_id_a: assertion.assetIdA,
    asset_id_b: assertion.assetIdB,
    evidence_kind: assertion.evidenceKind,
    created_at: now,
    updated_at: null,
  };
}

async function persistProcessorRelationship(
  db: KyselyDB,
  profileId: number,
  relationship: NonNullable<AccountingJournalDraft['relationships']>[number],
  declaringJournal: AccountingJournalDraft,
  journalRefs: Map<string, PersistedJournalRef>,
  postingRefs: Map<string, PersistedPostingRef>
): Promise<Result<void, Error>> {
  const declaringJournalRef = journalRefs.get(
    buildJournalRefKey(declaringJournal.sourceActivityFingerprint, declaringJournal.journalStableKey)
  );
  if (!declaringJournalRef) {
    return err(
      new Error(
        `Relationship ${relationship.relationshipStableKey} is declared on unknown journal ${declaringJournal.journalStableKey}`
      )
    );
  }

  const resolvedAllocations: {
    allocation: NonNullable<AccountingJournalDraft['relationships']>[number]['allocations'][number];
    journalRef: PersistedJournalRef;
    postingRef: PersistedPostingRef;
  }[] = [];

  for (const allocation of relationship.allocations) {
    const journalRef = journalRefs.get(
      buildJournalRefKey(allocation.sourceActivityFingerprint, allocation.journalStableKey)
    );
    if (!journalRef) {
      return err(
        new Error(
          `Relationship ${relationship.relationshipStableKey} allocation references unknown journal ${allocation.sourceActivityFingerprint}/${allocation.journalStableKey}`
        )
      );
    }

    const postingRef = resolveRelationshipAllocationPosting(allocation, postingRefs);
    if (postingRef.isErr()) {
      return err(postingRef.error);
    }

    if (allocation.quantity.gt(postingRef.value.quantity.abs())) {
      return err(
        new Error(
          `Relationship ${relationship.relationshipStableKey} allocation ${allocation.journalStableKey}/${allocation.postingStableKey} quantity ${allocation.quantity.toFixed()} exceeds posting quantity ${postingRef.value.quantity.abs().toFixed()}`
        )
      );
    }

    resolvedAllocations.push({ allocation, journalRef, postingRef: postingRef.value });
  }

  const now = new Date().toISOString();
  const relationshipRow: Insertable<AccountingJournalRelationshipsTable> = {
    profile_id: profileId,
    relationship_origin: 'processor',
    relationship_stable_key: buildProcessorRelationshipStableKey(
      declaringJournalRef.fingerprint,
      relationship.relationshipStableKey
    ),
    relationship_kind: relationship.relationshipKind,
    recognition_strategy: 'processor_supplied',
    recognition_evidence_json: '{}',
    confidence_score: null,
    created_at: now,
    updated_at: null,
  };

  const insertedRelationship = await db
    .insertInto('accounting_journal_relationships')
    .values(relationshipRow)
    .returning('id')
    .executeTakeFirstOrThrow();

  const allocationRows = resolvedAllocations.map(({ allocation, journalRef, postingRef }) =>
    toProcessorRelationshipAllocationRow({
      allocation,
      journalRef,
      postingRef,
      relationshipId: insertedRelationship.id,
      now,
    })
  );

  await db.insertInto('accounting_journal_relationship_allocations').values(allocationRows).execute();

  return ok(undefined);
}

function toProcessorRelationshipAllocationRow(params: {
  allocation: NonNullable<AccountingJournalDraft['relationships']>[number]['allocations'][number];
  journalRef: PersistedJournalRef;
  now: string;
  postingRef: PersistedPostingRef;
  relationshipId: number;
}): Insertable<AccountingJournalRelationshipAllocationsTable> {
  return {
    relationship_id: params.relationshipId,
    allocation_side: params.allocation.allocationSide,
    allocation_quantity: params.allocation.quantity.toFixed(),
    source_activity_fingerprint: params.allocation.sourceActivityFingerprint,
    journal_id: params.journalRef.id,
    posting_id: params.postingRef.id,
    journal_fingerprint: params.journalRef.fingerprint,
    posting_fingerprint: params.postingRef.fingerprint,
    asset_id: params.postingRef.assetId,
    asset_symbol: params.postingRef.assetSymbol,
    created_at: params.now,
    updated_at: null,
  };
}

function buildProcessorRelationshipStableKey(
  declaringJournalFingerprint: string,
  relationshipStableKey: string
): string {
  return ['processor', declaringJournalFingerprint, relationshipStableKey].join(':');
}

function resolveRelationshipAllocationPosting(
  allocation: NonNullable<AccountingJournalDraft['relationships']>[number]['allocations'][number],
  postingRefs: Map<string, PersistedPostingRef>
): Result<PersistedPostingRef, Error> {
  const posting = postingRefs.get(
    buildPostingRefKey(allocation.sourceActivityFingerprint, allocation.journalStableKey, allocation.postingStableKey)
  );
  if (!posting) {
    return err(
      new Error(
        `Relationship allocation references unknown posting ${allocation.sourceActivityFingerprint}/${allocation.journalStableKey}/${allocation.postingStableKey}`
      )
    );
  }

  return ok(posting);
}

function buildJournalRefKey(sourceActivityFingerprint: string, journalStableKey: string): string {
  return `${sourceActivityFingerprint}\u0000${journalStableKey}`;
}

function buildPostingRefKey(
  sourceActivityFingerprint: string,
  journalStableKey: string,
  postingStableKey: string
): string {
  return `${buildJournalRefKey(sourceActivityFingerprint, journalStableKey)}\u0000${postingStableKey}`;
}
