import { buildLinkGapIssueKey, type LinkGapDirection, type LinkGapIssue } from '@exitbook/accounting/linking';
import type { CreateOverrideEventOptions } from '@exitbook/core';
import { readExcludedAssetIds, readResolvedLinkGapIssueKeys, type OverrideStore } from '@exitbook/data/overrides';
import type { DataSession } from '@exitbook/data/session';
import { err, ok, resultDoAsync, type Result } from '@exitbook/foundation';

import { formatTransactionFingerprintRef } from '../../../transactions/transaction-selector.js';
import { buildLinkGapRef, buildLinkGapSelector, resolveLinkGapSelector } from '../../link-selector.js';

import { loadLinksGapAnalysis } from './load-links-gap-analysis.js';

type LinksGapResolutionStore = Pick<OverrideStore, 'append' | 'exists' | 'readByScopes'>;
type LinksGapResolutionDatabase = Pick<DataSession, 'accounts' | 'transactionLinks' | 'transactions'>;

export type LinksGapResolutionAction = 'reopen' | 'resolve';

export interface LinksGapResolutionParams {
  reason?: string | undefined;
  selector: string;
}

export interface LinksGapResolutionResult {
  action: LinksGapResolutionAction;
  assetId: string;
  assetSymbol: string;
  changed: boolean;
  direction: LinkGapDirection;
  gapRef: string;
  platformKey: string;
  reason?: string | undefined;
  transactionGapCount: number;
  transactionId: number;
  transactionRef: string;
  txFingerprint: string;
}

interface ResolvedLinkGapSelection {
  gapIssue: LinkGapIssue;
  gapRef: string;
  transactionGapCount: number;
  transactionRef: string;
}

export class LinksGapResolutionHandler {
  constructor(
    private readonly db: LinksGapResolutionDatabase,
    private readonly profileId: number,
    private readonly profileKey: string,
    private readonly overrideStore: LinksGapResolutionStore
  ) {}

  async resolve(params: LinksGapResolutionParams): Promise<Result<LinksGapResolutionResult, Error>> {
    return this.execute(params, 'resolve');
  }

  async reopen(params: LinksGapResolutionParams): Promise<Result<LinksGapResolutionResult, Error>> {
    return this.execute(params, 'reopen');
  }

  private async execute(
    params: LinksGapResolutionParams,
    action: LinksGapResolutionAction
  ): Promise<Result<LinksGapResolutionResult, Error>> {
    return resultDoAsync(async function* (self) {
      const excludedAssetIds = yield* await readExcludedAssetIds(self.overrideStore, self.profileKey);
      const resolvedIssueKeys = yield* await readResolvedLinkGapIssueKeys(self.overrideStore, self.profileKey);
      const gapAnalysis = yield* await loadLinksGapAnalysis(self.db, self.profileId, {
        excludedAssetIds,
      });
      const selectedGap = yield* self.resolveGap(gapAnalysis.analysis.issues, params.selector);
      const issueKey = buildLinkGapIssueKey({
        txFingerprint: selectedGap.gapIssue.txFingerprint,
        assetId: selectedGap.gapIssue.assetId,
        direction: selectedGap.gapIssue.direction,
      });
      const isCurrentlyResolved = resolvedIssueKeys.has(issueKey);

      if (action === 'resolve') {
        if (isCurrentlyResolved) {
          return self.buildResult(selectedGap, action, false, params.reason);
        }

        yield* await self.appendOverride({
          profileKey: self.profileKey,
          scope: 'link-gap-resolve',
          payload: {
            type: 'link_gap_resolve',
            tx_fingerprint: selectedGap.gapIssue.txFingerprint,
            asset_id: selectedGap.gapIssue.assetId,
            direction: selectedGap.gapIssue.direction,
          },
          reason: params.reason,
        });

        return self.buildResult(selectedGap, action, true, params.reason);
      }

      if (!isCurrentlyResolved) {
        return self.buildResult(selectedGap, action, false, params.reason);
      }

      yield* await self.appendOverride({
        profileKey: self.profileKey,
        scope: 'link-gap-reopen',
        payload: {
          type: 'link_gap_reopen',
          tx_fingerprint: selectedGap.gapIssue.txFingerprint,
          asset_id: selectedGap.gapIssue.assetId,
          direction: selectedGap.gapIssue.direction,
        },
        reason: params.reason,
      });

      return self.buildResult(selectedGap, action, true, params.reason);
    }, this);
  }

  private buildResult(
    resolvedGap: ResolvedLinkGapSelection,
    action: LinksGapResolutionAction,
    changed: boolean,
    reason?: string
  ): LinksGapResolutionResult {
    return {
      action,
      assetId: resolvedGap.gapIssue.assetId,
      assetSymbol: resolvedGap.gapIssue.assetSymbol,
      changed,
      direction: resolvedGap.gapIssue.direction,
      gapRef: resolvedGap.gapRef,
      platformKey: resolvedGap.gapIssue.platformKey,
      reason,
      transactionGapCount: resolvedGap.transactionGapCount,
      transactionId: resolvedGap.gapIssue.transactionId,
      transactionRef: resolvedGap.transactionRef,
      txFingerprint: resolvedGap.gapIssue.txFingerprint,
    };
  }

  private resolveGap(issues: readonly LinkGapIssue[], selector: string): Result<ResolvedLinkGapSelection, Error> {
    const gapCountByTransactionFingerprint = new Map<string, number>();
    for (const issue of issues) {
      gapCountByTransactionFingerprint.set(
        issue.txFingerprint,
        (gapCountByTransactionFingerprint.get(issue.txFingerprint) ?? 0) + 1
      );
    }

    const candidates = issues.map((issue) => ({
      gapSelector: buildLinkGapSelector({
        txFingerprint: issue.txFingerprint,
        assetId: issue.assetId,
        direction: issue.direction,
      }),
      item: {
        gapIssue: issue,
        gapRef: buildLinkGapRef({
          txFingerprint: issue.txFingerprint,
          assetId: issue.assetId,
          direction: issue.direction,
        }),
        transactionGapCount: gapCountByTransactionFingerprint.get(issue.txFingerprint) ?? 1,
        transactionRef: formatTransactionFingerprintRef(issue.txFingerprint),
      },
    }));

    const resolvedGap = resolveLinkGapSelector(candidates, selector);
    if (resolvedGap.isErr()) {
      return err(resolvedGap.error);
    }

    return ok(resolvedGap.value.item);
  }

  private async appendOverride(options: CreateOverrideEventOptions): Promise<Result<void, Error>> {
    const appendResult = await this.overrideStore.append(options);
    if (appendResult.isErr()) {
      return err(new Error(`Failed to write link gap resolution override event: ${appendResult.error.message}`));
    }

    return ok(undefined);
  }
}
