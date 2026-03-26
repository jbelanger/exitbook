/* eslint-disable unicorn/no-null -- null required for db */
import type { AssetReviewEvidence, AssetReviewSummary } from '@exitbook/core';
import { err, ok, wrapError, type Result } from '@exitbook/foundation';

import type { AssetReviewEvidenceTable, AssetReviewStateTable } from '../database-schema.js';
import type { KyselyDB } from '../database.js';
import { chunkItems, SQLITE_SAFE_INSERT_BATCH_SIZE, SQLITE_SAFE_IN_BATCH_SIZE } from '../utils/sqlite-batching.js';

import { BaseRepository } from './base-repository.js';

interface AssetReviewStateRecord {
  profile_id: number;
  accounting_blocked: number | boolean;
  asset_id: string;
  computed_at: string;
  confirmation_is_stale: number | boolean;
  confirmed_evidence_fingerprint: string | null;
  evidence_fingerprint: string;
  reference_status: string;
  review_status: string;
  warning_summary: string | null;
}

interface AssetReviewEvidenceRecord {
  profile_id: number;
  asset_id: string;
  kind: string;
  message: string;
  metadata_json: unknown;
  position: number;
  severity: string;
}

export class AssetReviewRepository extends BaseRepository {
  constructor(db: KyselyDB) {
    super(db, 'asset-review-repository');
  }

  async replaceAll(profileId: number, summaries: Iterable<AssetReviewSummary>): Promise<Result<void, Error>> {
    const items = [...summaries];
    const computedAt = new Date().toISOString();

    try {
      await this.db.deleteFrom('asset_review_evidence').where('profile_id', '=', profileId).execute();
      await this.db.deleteFrom('asset_review_state').where('profile_id', '=', profileId).execute();

      if (items.length === 0) {
        return ok(undefined);
      }

      const stateRows = items.map((summary) => this.toStateRow(profileId, summary, computedAt));
      for (const stateRowBatch of chunkItems(stateRows, SQLITE_SAFE_INSERT_BATCH_SIZE)) {
        await this.db.insertInto('asset_review_state').values(stateRowBatch).execute();
      }

      const evidenceRows = items.flatMap((summary) =>
        summary.evidence.map((evidence, position) => this.toEvidenceRow(profileId, summary.assetId, position, evidence))
      );

      for (const evidenceRowBatch of chunkItems(evidenceRows, SQLITE_SAFE_INSERT_BATCH_SIZE)) {
        await this.db.insertInto('asset_review_evidence').values(evidenceRowBatch).execute();
      }

      return ok(undefined);
    } catch (error) {
      this.logger.error({ error }, 'Failed to replace asset review projection');
      return wrapError(error, 'Failed to replace asset review projection');
    }
  }

  async listAll(profileId: number): Promise<Result<AssetReviewSummary[], Error>> {
    try {
      const stateRows = await this.db
        .selectFrom('asset_review_state')
        .selectAll()
        .where('profile_id', '=', profileId)
        .orderBy('asset_id', 'asc')
        .execute();

      const evidenceRows = await this.db
        .selectFrom('asset_review_evidence')
        .selectAll()
        .where('profile_id', '=', profileId)
        .orderBy('asset_id', 'asc')
        .orderBy('position', 'asc')
        .execute();

      return ok(this.buildSummaries(stateRows, evidenceRows));
    } catch (error) {
      this.logger.error({ error }, 'Failed to list asset review projection');
      return wrapError(error, 'Failed to list asset review projection');
    }
  }

  async getByAssetIds(profileId: number, assetIds: string[]): Promise<Result<Map<string, AssetReviewSummary>, Error>> {
    if (assetIds.length === 0) {
      return ok(new Map());
    }

    try {
      const stateRows: AssetReviewStateRecord[] = [];
      const evidenceRows: AssetReviewEvidenceRecord[] = [];

      for (const assetIdBatch of chunkItems(assetIds, SQLITE_SAFE_IN_BATCH_SIZE)) {
        stateRows.push(
          ...(await this.db
            .selectFrom('asset_review_state')
            .selectAll()
            .where('profile_id', '=', profileId)
            .where('asset_id', 'in', assetIdBatch)
            .orderBy('asset_id', 'asc')
            .execute())
        );

        evidenceRows.push(
          ...(await this.db
            .selectFrom('asset_review_evidence')
            .selectAll()
            .where('profile_id', '=', profileId)
            .where('asset_id', 'in', assetIdBatch)
            .orderBy('asset_id', 'asc')
            .orderBy('position', 'asc')
            .execute())
        );
      }

      stateRows.sort((left, right) => left.asset_id.localeCompare(right.asset_id));
      evidenceRows.sort((left, right) => left.asset_id.localeCompare(right.asset_id) || left.position - right.position);

      return ok(new Map(this.buildSummaries(stateRows, evidenceRows).map((summary) => [summary.assetId, summary])));
    } catch (error) {
      this.logger.error({ error, assetIds, profileId }, 'Failed to load asset review projection by asset IDs');
      return wrapError(error, 'Failed to load asset review projection by asset IDs');
    }
  }

  async findLatestComputedAt(profileId: number): Promise<Result<Date | null, Error>> {
    try {
      const row = await this.db
        .selectFrom('asset_review_state')
        .select(({ fn }) => [fn.max<string>('computed_at').as('latest')])
        .where('profile_id', '=', profileId)
        .executeTakeFirst();

      if (!row?.latest) {
        return ok(null);
      }

      return ok(new Date(row.latest));
    } catch (error) {
      this.logger.error({ error }, 'Failed to load latest asset review projection timestamp');
      return wrapError(error, 'Failed to load latest asset review projection timestamp');
    }
  }

  async countStates(profileId: number): Promise<Result<number, Error>> {
    try {
      const row = await this.db
        .selectFrom('asset_review_state')
        .select(({ fn }) => [fn.count<number>('asset_id').as('count')])
        .where('profile_id', '=', profileId)
        .executeTakeFirst();

      return ok(Number(row?.count ?? 0));
    } catch (error) {
      this.logger.error({ error }, 'Failed to count asset review state rows');
      return wrapError(error, 'Failed to count asset review state rows');
    }
  }

  async deleteAll(profileId: number): Promise<Result<number, Error>> {
    try {
      const countResult = await this.countStates(profileId);
      if (countResult.isErr()) {
        return err(countResult.error);
      }

      await this.db.deleteFrom('asset_review_evidence').where('profile_id', '=', profileId).execute();
      await this.db.deleteFrom('asset_review_state').where('profile_id', '=', profileId).execute();

      return ok(countResult.value);
    } catch (error) {
      this.logger.error({ error }, 'Failed to delete asset review projection');
      return wrapError(error, 'Failed to delete asset review projection');
    }
  }

  private buildSummaries(
    stateRows: AssetReviewStateRecord[],
    evidenceRows: AssetReviewEvidenceRecord[]
  ): AssetReviewSummary[] {
    const evidenceByAssetId = new Map<string, AssetReviewEvidence[]>();

    for (const row of evidenceRows) {
      const evidence = evidenceByAssetId.get(row.asset_id) ?? [];
      const metadata = this.parseEvidenceMetadata(row.metadata_json, row.asset_id, row.position);
      evidence.push(
        metadata
          ? {
              kind: row.kind as AssetReviewEvidence['kind'],
              severity: row.severity as AssetReviewEvidence['severity'],
              message: row.message,
              metadata,
            }
          : {
              kind: row.kind as AssetReviewEvidence['kind'],
              severity: row.severity as AssetReviewEvidence['severity'],
              message: row.message,
            }
      );
      evidenceByAssetId.set(row.asset_id, evidence);
    }

    return stateRows.map((row) => {
      const summary: AssetReviewSummary = {
        assetId: row.asset_id,
        reviewStatus: row.review_status as AssetReviewSummary['reviewStatus'],
        referenceStatus: row.reference_status as AssetReviewSummary['referenceStatus'],
        evidenceFingerprint: row.evidence_fingerprint,
        confirmationIsStale: Boolean(row.confirmation_is_stale),
        accountingBlocked: Boolean(row.accounting_blocked),
        evidence: evidenceByAssetId.get(row.asset_id) ?? [],
      };

      if (row.confirmed_evidence_fingerprint) {
        summary.confirmedEvidenceFingerprint = row.confirmed_evidence_fingerprint;
      }

      if (row.warning_summary) {
        summary.warningSummary = row.warning_summary;
      }

      return summary;
    });
  }

  private toStateRow(
    profileId: number,
    summary: AssetReviewSummary,
    computedAt: string
  ): Omit<AssetReviewStateTable, 'computed_at'> & {
    computed_at: string;
  } {
    return {
      profile_id: profileId,
      asset_id: summary.assetId,
      review_status: summary.reviewStatus,
      reference_status: summary.referenceStatus,
      warning_summary: summary.warningSummary ?? null,
      evidence_fingerprint: summary.evidenceFingerprint,
      confirmed_evidence_fingerprint: summary.confirmedEvidenceFingerprint ?? null,
      confirmation_is_stale: summary.confirmationIsStale,
      accounting_blocked: summary.accountingBlocked,
      computed_at: computedAt,
    };
  }

  private toEvidenceRow(
    profileId: number,
    assetId: string,
    position: number,
    evidence: AssetReviewEvidence
  ): Omit<AssetReviewEvidenceTable, 'id' | 'metadata_json'> & { metadata_json: string | null } {
    return {
      profile_id: profileId,
      asset_id: assetId,
      position,
      kind: evidence.kind,
      severity: evidence.severity,
      message: evidence.message,
      metadata_json: evidence.metadata ? JSON.stringify(evidence.metadata) : null,
    };
  }

  private parseEvidenceMetadata(
    value: unknown,
    assetId: string,
    position: number
  ): Record<string, unknown> | undefined {
    if (typeof value !== 'string' || value.trim() === '') {
      return undefined;
    }

    try {
      const parsed = JSON.parse(value) as unknown;
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        this.logger.warn({ assetId, position, value }, 'Asset review evidence metadata was not an object');
        return undefined;
      }

      return parsed as Record<string, unknown>;
    } catch (error) {
      this.logger.warn({ assetId, position, error }, 'Failed to parse asset review evidence metadata JSON');
      return undefined;
    }
  }
}
