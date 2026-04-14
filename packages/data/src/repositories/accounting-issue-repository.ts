/* eslint-disable unicorn/no-null -- null required for db */
import {
  AccountingIssueDetailItemSchema,
  AccountingIssueEvidenceRefSchema,
  AccountingIssueNextActionSchema,
  AccountingIssueScopeSummarySchema,
  AccountingIssueSummaryItemSchema,
  AccountingIssueStoredDetailPayloadSchema,
  buildAccountingIssueRef,
  type AccountingIssueReviewState,
  type AccountingIssueDetailItem,
  type AccountingIssueScopeSnapshot,
  type AccountingIssueScopeSummary,
  type AccountingIssueSummaryItem,
} from '@exitbook/accounting/issues';
import { randomUUID, err, ok, wrapError, type Result } from '@exitbook/foundation';
import type { Selectable } from '@exitbook/sqlite';
import { z } from 'zod';

import type { AccountingIssueRowsTable, AccountingIssueScopesTable } from '../database-schema.js';
import type { KyselyDB } from '../database.js';

import { BaseRepository } from './base-repository.js';

const AccountingIssueMetadataSchema = z.record(z.string(), z.unknown());
const AccountingIssueEvidenceRefsSchema = z.array(AccountingIssueEvidenceRefSchema);
const AccountingIssueNextActionsSchema = z.array(AccountingIssueNextActionSchema);

export interface AccountingIssueSummaryRecord {
  issueKey: string;
  issue: AccountingIssueSummaryItem;
}

export interface AccountingIssueDetailRecord {
  issueKey: string;
  issue: AccountingIssueDetailItem;
}

export interface AccountingIssueScopedSummaryRecord {
  issueKey: string;
  issue: AccountingIssueSummaryItem;
  scopeKey: string;
}

type AccountingIssueScopeRecord = Selectable<AccountingIssueScopesTable>;
type AccountingIssueRowRecord = Selectable<AccountingIssueRowsTable>;

interface AccountingIssueScopeInsertRow {
  scope_key: string;
  scope_kind: AccountingIssueScopesTable['scope_kind'];
  profile_id: number;
  title: string;
  status: AccountingIssueScopesTable['status'];
  open_issue_count: number;
  blocking_issue_count: number;
  updated_at: string;
  metadata_json: string | null;
}

interface AccountingIssueRowInsertValues {
  scope_key: string;
  issue_key: string;
  family: AccountingIssueRowsTable['family'];
  code: AccountingIssueRowsTable['code'];
  severity: AccountingIssueRowsTable['severity'];
  status: 'open';
  summary: string;
  acknowledged_at: null;
  first_seen_at: string;
  last_seen_at: string;
  closed_at: null;
  closed_reason: null;
  detail_json: string;
  evidence_json: string;
  next_actions_json: string;
}

export class AccountingIssueRepository extends BaseRepository {
  constructor(db: KyselyDB) {
    super(db, 'accounting-issue-repository');
  }

  async reconcileScope(snapshot: AccountingIssueScopeSnapshot): Promise<Result<void, Error>> {
    try {
      await this.db.transaction().execute(async (trx) => {
        const scopeRow = this.toScopeRow(snapshot.scope);

        await trx
          .insertInto('accounting_issue_scopes')
          .values(scopeRow)
          .onConflict((oc) =>
            oc.column('scope_key').doUpdateSet({
              scope_kind: scopeRow.scope_kind,
              profile_id: scopeRow.profile_id,
              title: scopeRow.title,
              status: scopeRow.status,
              open_issue_count: scopeRow.open_issue_count,
              blocking_issue_count: scopeRow.blocking_issue_count,
              updated_at: scopeRow.updated_at,
              metadata_json: scopeRow.metadata_json,
            })
          )
          .execute();

        const existingOpenRows = await trx
          .selectFrom('accounting_issue_rows')
          .selectAll()
          .where('scope_key', '=', snapshot.scope.scopeKey)
          .where('status', '=', 'open')
          .execute();
        const existingByIssueKey = new Map(existingOpenRows.map((row) => [row.issue_key, row]));
        const seenIssueKeys = new Set<string>();

        for (const materializedIssue of snapshot.issues) {
          const existing = existingByIssueKey.get(materializedIssue.issueKey);
          const rowValues = this.toIssueRowValues(snapshot.scope.scopeKey, materializedIssue, snapshot.scope.updatedAt);
          seenIssueKeys.add(materializedIssue.issueKey);

          if (existing) {
            await trx
              .updateTable('accounting_issue_rows')
              .set({
                family: rowValues.family,
                code: rowValues.code,
                severity: rowValues.severity,
                summary: rowValues.summary,
                last_seen_at: rowValues.last_seen_at,
                detail_json: rowValues.detail_json,
                evidence_json: rowValues.evidence_json,
                next_actions_json: rowValues.next_actions_json,
                status: 'open',
                closed_at: null,
                closed_reason: null,
              })
              .where('id', '=', existing.id)
              .execute();
            continue;
          }

          await trx
            .insertInto('accounting_issue_rows')
            .values({
              id: randomUUID(),
              ...rowValues,
            })
            .execute();
        }

        for (const existing of existingOpenRows) {
          if (seenIssueKeys.has(existing.issue_key)) {
            continue;
          }

          await trx
            .updateTable('accounting_issue_rows')
            .set({
              status: 'closed',
              closed_at: snapshot.scope.updatedAt.toISOString(),
              closed_reason: 'disappeared',
            })
            .where('id', '=', existing.id)
            .execute();
        }
      });

      return ok(undefined);
    } catch (error) {
      this.logger.error({ error, scopeKey: snapshot.scope.scopeKey }, 'Failed to reconcile accounting issue scope');
      return wrapError(error, `Failed to reconcile accounting issue scope ${snapshot.scope.scopeKey}`);
    }
  }

  async listScopeSummaries(profileId: number): Promise<Result<AccountingIssueScopeSummary[], Error>> {
    try {
      const rows = await this.db
        .selectFrom('accounting_issue_scopes')
        .selectAll()
        .where('profile_id', '=', profileId)
        .orderBy('updated_at', 'desc')
        .orderBy('scope_key', 'asc')
        .execute();

      const summaries: AccountingIssueScopeSummary[] = [];
      for (const row of rows) {
        const parsed = this.parseScopeRow(row);
        if (parsed.isErr()) {
          return err(parsed.error);
        }
        summaries.push(parsed.value);
      }

      return ok(summaries);
    } catch (error) {
      this.logger.error({ error, profileId }, 'Failed to list accounting issue scopes');
      return wrapError(error, `Failed to list accounting issue scopes for profile ${profileId}`);
    }
  }

  async findScope(scopeKey: string): Promise<Result<AccountingIssueScopeSummary | undefined, Error>> {
    try {
      const row = await this.db
        .selectFrom('accounting_issue_scopes')
        .selectAll()
        .where('scope_key', '=', scopeKey)
        .executeTakeFirst();

      if (!row) {
        return ok(undefined);
      }

      return this.parseScopeRow(row);
    } catch (error) {
      this.logger.error({ error, scopeKey }, 'Failed to find accounting issue scope');
      return wrapError(error, `Failed to find accounting issue scope ${scopeKey}`);
    }
  }

  async listCurrentIssueSummaries(scopeKey: string): Promise<Result<AccountingIssueSummaryRecord[], Error>> {
    try {
      const rows = await this.db
        .selectFrom('accounting_issue_rows')
        .selectAll()
        .where('scope_key', '=', scopeKey)
        .where('status', '=', 'open')
        .orderBy('severity', 'asc')
        .orderBy('family', 'asc')
        .orderBy('summary', 'asc')
        .orderBy('issue_key', 'asc')
        .execute();

      const summaries: AccountingIssueSummaryRecord[] = [];
      for (const row of rows) {
        const parsed = this.parseSummaryRow(row);
        if (parsed.isErr()) {
          return err(parsed.error);
        }
        summaries.push(parsed.value);
      }

      summaries.sort(compareAccountingIssueSummaryRecords);
      return ok(summaries);
    } catch (error) {
      this.logger.error({ error, scopeKey }, 'Failed to list current accounting issues');
      return wrapError(error, `Failed to list current accounting issues for ${scopeKey}`);
    }
  }

  async listCurrentIssueSummariesForProfile(
    profileId: number
  ): Promise<Result<AccountingIssueScopedSummaryRecord[], Error>> {
    try {
      const rows = await this.db
        .selectFrom('accounting_issue_rows as issue_rows')
        .innerJoin('accounting_issue_scopes as issue_scopes', 'issue_scopes.scope_key', 'issue_rows.scope_key')
        .select([
          'issue_rows.id',
          'issue_rows.scope_key',
          'issue_rows.issue_key',
          'issue_rows.family',
          'issue_rows.code',
          'issue_rows.severity',
          'issue_rows.status',
          'issue_rows.summary',
          'issue_rows.acknowledged_at',
          'issue_rows.first_seen_at',
          'issue_rows.last_seen_at',
          'issue_rows.closed_at',
          'issue_rows.closed_reason',
          'issue_rows.detail_json',
          'issue_rows.evidence_json',
          'issue_rows.next_actions_json',
        ])
        .where('issue_scopes.profile_id', '=', profileId)
        .where('issue_rows.status', '=', 'open')
        .orderBy('issue_rows.severity', 'asc')
        .orderBy('issue_rows.family', 'asc')
        .orderBy('issue_rows.summary', 'asc')
        .orderBy('issue_rows.issue_key', 'asc')
        .execute();

      const summaries: AccountingIssueScopedSummaryRecord[] = [];
      for (const row of rows) {
        const parsed = this.parseSummaryRow(row);
        if (parsed.isErr()) {
          return err(parsed.error);
        }
        summaries.push({
          ...parsed.value,
          scopeKey: row.scope_key,
        });
      }

      summaries.sort(compareScopedAccountingIssueSummaryRecords);
      return ok(summaries);
    } catch (error) {
      this.logger.error({ error, profileId }, 'Failed to list current accounting issues for profile');
      return wrapError(error, `Failed to list current accounting issues for profile ${profileId}`);
    }
  }

  async findCurrentIssueDetail(
    scopeKey: string,
    issueKey: string
  ): Promise<Result<AccountingIssueDetailRecord | undefined, Error>> {
    try {
      const scopeResult = await this.findScope(scopeKey);
      if (scopeResult.isErr()) {
        return err(scopeResult.error);
      }
      if (!scopeResult.value) {
        return ok(undefined);
      }

      const row = await this.db
        .selectFrom('accounting_issue_rows')
        .selectAll()
        .where('scope_key', '=', scopeKey)
        .where('issue_key', '=', issueKey)
        .where('status', '=', 'open')
        .executeTakeFirst();

      if (!row) {
        return ok(undefined);
      }

      return this.parseDetailRow(row, scopeResult.value);
    } catch (error) {
      this.logger.error({ error, scopeKey, issueKey }, 'Failed to read current accounting issue detail');
      return wrapError(error, `Failed to read current accounting issue ${scopeKey}:${issueKey}`);
    }
  }

  async acknowledgeCurrentIssue(
    scopeKey: string,
    issueKey: string,
    acknowledgedAt: Date
  ): Promise<Result<{ changed: boolean; found: boolean }, Error>> {
    try {
      const currentRow = await this.db
        .selectFrom('accounting_issue_rows')
        .select(['id', 'acknowledged_at'])
        .where('scope_key', '=', scopeKey)
        .where('issue_key', '=', issueKey)
        .where('status', '=', 'open')
        .executeTakeFirst();

      if (!currentRow) {
        return ok({ changed: false, found: false });
      }

      if (currentRow.acknowledged_at !== null) {
        return ok({ changed: false, found: true });
      }

      await this.db
        .updateTable('accounting_issue_rows')
        .set({
          acknowledged_at: acknowledgedAt.toISOString(),
        })
        .where('id', '=', currentRow.id)
        .execute();

      return ok({ changed: true, found: true });
    } catch (error) {
      this.logger.error({ error, scopeKey, issueKey }, 'Failed to acknowledge accounting issue');
      return wrapError(error, `Failed to acknowledge accounting issue ${scopeKey}:${issueKey}`);
    }
  }

  async reopenCurrentIssue(
    scopeKey: string,
    issueKey: string
  ): Promise<Result<{ changed: boolean; found: boolean }, Error>> {
    try {
      const currentRow = await this.db
        .selectFrom('accounting_issue_rows')
        .select(['id', 'acknowledged_at'])
        .where('scope_key', '=', scopeKey)
        .where('issue_key', '=', issueKey)
        .where('status', '=', 'open')
        .executeTakeFirst();

      if (!currentRow) {
        return ok({ changed: false, found: false });
      }

      if (currentRow.acknowledged_at === null) {
        return ok({ changed: false, found: true });
      }

      await this.db
        .updateTable('accounting_issue_rows')
        .set({
          acknowledged_at: null,
        })
        .where('id', '=', currentRow.id)
        .execute();

      return ok({ changed: true, found: true });
    } catch (error) {
      this.logger.error({ error, scopeKey, issueKey }, 'Failed to reopen accounting issue acknowledgement');
      return wrapError(error, `Failed to reopen accounting issue acknowledgement ${scopeKey}:${issueKey}`);
    }
  }

  private parseScopeRow(row: AccountingIssueScopeRecord): Result<AccountingIssueScopeSummary, Error> {
    const metadataResult = this.parseOptionalJson(
      row.metadata_json,
      AccountingIssueMetadataSchema,
      `accounting issue scope ${row.scope_key} metadata`
    );
    if (metadataResult.isErr()) {
      return err(metadataResult.error);
    }

    const parsed = AccountingIssueScopeSummarySchema.safeParse({
      scopeKind: row.scope_kind,
      scopeKey: row.scope_key,
      profileId: row.profile_id,
      title: row.title,
      status: row.status,
      openIssueCount: row.open_issue_count,
      blockingIssueCount: row.blocking_issue_count,
      updatedAt: new Date(row.updated_at),
      metadata: metadataResult.value,
    });

    if (!parsed.success) {
      return err(
        new Error(
          `Failed to parse accounting issue scope ${row.scope_key}: ${parsed.error.issues[0]?.message ?? 'invalid row'}`
        )
      );
    }

    return ok(parsed.data);
  }

  private parseSummaryRow(row: AccountingIssueRowRecord): Result<AccountingIssueSummaryRecord, Error> {
    const nextActionsResult = this.parseJson(
      row.next_actions_json,
      AccountingIssueNextActionsSchema,
      `accounting issue ${row.scope_key}:${row.issue_key} next actions`
    );
    if (nextActionsResult.isErr()) {
      return err(nextActionsResult.error);
    }
    const reviewState = toAccountingIssueReviewState(row);
    const nextActions = buildCurrentIssueNextActions(nextActionsResult.value, reviewState);

    const parsed = AccountingIssueSummaryItemSchema.safeParse({
      issueRef: buildAccountingIssueRef(row.scope_key, row.issue_key),
      family: row.family,
      code: row.code,
      severity: row.severity,
      reviewState,
      summary: row.summary,
      nextActions,
    });

    if (!parsed.success) {
      return err(
        new Error(
          `Failed to parse accounting issue summary ${row.scope_key}:${row.issue_key}: ${parsed.error.issues[0]?.message ?? 'invalid row'}`
        )
      );
    }

    return ok({
      issueKey: row.issue_key,
      issue: parsed.data,
    });
  }

  private parseDetailRow(
    row: AccountingIssueRowRecord,
    scope: AccountingIssueScopeSummary
  ): Result<AccountingIssueDetailRecord, Error> {
    const summaryResult = this.parseSummaryRow(row);
    if (summaryResult.isErr()) {
      return err(summaryResult.error);
    }

    const detailPayloadResult = this.parseJson(
      row.detail_json,
      AccountingIssueStoredDetailPayloadSchema,
      `accounting issue ${row.scope_key}:${row.issue_key} detail`
    );
    if (detailPayloadResult.isErr()) {
      return err(detailPayloadResult.error);
    }

    const evidenceRefsResult = this.parseJson(
      row.evidence_json,
      AccountingIssueEvidenceRefsSchema,
      `accounting issue ${row.scope_key}:${row.issue_key} evidence`
    );
    if (evidenceRefsResult.isErr()) {
      return err(evidenceRefsResult.error);
    }

    const parsed = AccountingIssueDetailItemSchema.safeParse({
      ...summaryResult.value.issue,
      scope: {
        kind: scope.scopeKind,
        key: scope.scopeKey,
      },
      details: detailPayloadResult.value.details,
      whyThisMatters: detailPayloadResult.value.whyThisMatters,
      evidenceRefs: evidenceRefsResult.value,
    });

    if (!parsed.success) {
      return err(
        new Error(
          `Failed to parse accounting issue detail ${row.scope_key}:${row.issue_key}: ${parsed.error.issues[0]?.message ?? 'invalid row'}`
        )
      );
    }

    return ok({
      issueKey: row.issue_key,
      issue: parsed.data,
    });
  }

  private toScopeRow(scope: AccountingIssueScopeSummary): AccountingIssueScopeInsertRow {
    return {
      scope_key: scope.scopeKey,
      scope_kind: scope.scopeKind,
      profile_id: scope.profileId,
      title: scope.title,
      status: scope.status,
      open_issue_count: scope.openIssueCount,
      blocking_issue_count: scope.blockingIssueCount,
      updated_at: scope.updatedAt.toISOString(),
      metadata_json: scope.metadata ? JSON.stringify(scope.metadata) : null,
    };
  }

  private toIssueRowValues(
    scopeKey: string,
    materializedIssue: AccountingIssueScopeSnapshot['issues'][number],
    seenAt: Date
  ): AccountingIssueRowInsertValues {
    const seenAtIso = seenAt.toISOString();

    return {
      scope_key: scopeKey,
      issue_key: materializedIssue.issueKey,
      family: materializedIssue.issue.family,
      code: materializedIssue.issue.code,
      severity: materializedIssue.issue.severity,
      status: 'open',
      summary: materializedIssue.issue.summary,
      acknowledged_at: null,
      first_seen_at: seenAtIso,
      last_seen_at: seenAtIso,
      closed_at: null,
      closed_reason: null,
      detail_json: JSON.stringify({
        details: materializedIssue.issue.details,
        whyThisMatters: materializedIssue.issue.whyThisMatters,
      }),
      evidence_json: JSON.stringify(materializedIssue.issue.evidenceRefs),
      next_actions_json: JSON.stringify(materializedIssue.issue.nextActions),
    };
  }

  private parseJson<T>(rawValue: unknown, schema: z.ZodType<T>, context: string): Result<T, Error> {
    let parsedJson: unknown = rawValue;
    if (typeof rawValue === 'string') {
      try {
        parsedJson = JSON.parse(rawValue);
      } catch (error) {
        return err(new Error(`Failed to parse ${context}: ${(error as Error).message}`));
      }
    }

    const parsed = schema.safeParse(parsedJson);
    if (!parsed.success) {
      return err(new Error(`Failed to parse ${context}: ${parsed.error.issues[0]?.message ?? 'invalid json'}`));
    }

    return ok(parsed.data);
  }

  private parseOptionalJson<T>(rawValue: unknown, schema: z.ZodType<T>, context: string): Result<T | undefined, Error> {
    if (rawValue === null || rawValue === undefined) {
      return ok(undefined);
    }

    return this.parseJson(rawValue, schema, context);
  }
}

function toAccountingIssueReviewState(
  row: Pick<AccountingIssueRowRecord, 'acknowledged_at'>
): AccountingIssueReviewState {
  return row.acknowledged_at === null ? 'open' : 'acknowledged';
}

function buildCurrentIssueNextActions(
  baseActions: readonly z.infer<typeof AccountingIssueNextActionSchema>[],
  reviewState: AccountingIssueReviewState
): z.infer<typeof AccountingIssueNextActionSchema>[] {
  if (reviewState === 'acknowledged') {
    return [
      {
        kind: 'reopen_acknowledgement',
        label: 'Reopen acknowledgement',
        mode: 'direct',
      },
      ...baseActions,
    ];
  }

  return [
    ...baseActions,
    {
      kind: 'acknowledge_issue',
      label: 'Acknowledge issue',
      mode: 'direct',
    },
  ];
}

function compareAccountingIssueSummaryRecords(
  left: AccountingIssueSummaryRecord,
  right: AccountingIssueSummaryRecord
): number {
  return compareIssueSummaries(left.issue, right.issue);
}

function compareScopedAccountingIssueSummaryRecords(
  left: AccountingIssueScopedSummaryRecord,
  right: AccountingIssueScopedSummaryRecord
): number {
  const issueComparison = compareIssueSummaries(left.issue, right.issue);
  if (issueComparison !== 0) {
    return issueComparison;
  }

  return left.scopeKey.localeCompare(right.scopeKey);
}

function compareIssueSummaries(left: AccountingIssueSummaryItem, right: AccountingIssueSummaryItem): number {
  if (left.severity !== right.severity) {
    return left.severity === 'blocked' ? -1 : 1;
  }

  if (left.reviewState !== right.reviewState) {
    return left.reviewState === 'open' ? -1 : 1;
  }

  const familyComparison = left.family.localeCompare(right.family);
  if (familyComparison !== 0) {
    return familyComparison;
  }

  const summaryComparison = left.summary.localeCompare(right.summary);
  if (summaryComparison !== 0) {
    return summaryComparison;
  }

  return left.issueRef.localeCompare(right.issueRef);
}
