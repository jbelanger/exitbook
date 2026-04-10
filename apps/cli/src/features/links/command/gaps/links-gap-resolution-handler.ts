import type { CreateOverrideEventOptions } from '@exitbook/core';
import { readExcludedAssetIds, readResolvedLinkGapTxFingerprints, type OverrideStore } from '@exitbook/data/overrides';
import type { DataSession } from '@exitbook/data/session';
import { err, ok, resultDoAsync, type Result } from '@exitbook/foundation';

import {
  formatTransactionFingerprintRef,
  resolveOwnedTransactionSelector,
  type ResolvedTransactionSelector,
} from '../../../transactions/transaction-selector.js';
import { loadLinksGapAnalysis } from '../links-gap-analysis-support.js';

type LinksGapResolutionStore = Pick<OverrideStore, 'append' | 'exists' | 'readByScopes'>;
type LinksGapResolutionDatabase = Pick<DataSession, 'accounts' | 'transactionLinks' | 'transactions'>;

export type LinksGapResolutionAction = 'reopen' | 'resolve';

export interface LinksGapResolutionParams {
  reason?: string | undefined;
  selector: string;
}

export interface LinksGapResolutionResult {
  action: LinksGapResolutionAction;
  affectedGapCount: number;
  changed: boolean;
  platformKey: string;
  reason?: string | undefined;
  transactionId: number;
  transactionRef: string;
  txFingerprint: string;
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
      const resolvedTransaction = yield* await self.resolveTransaction(params.selector);
      const excludedAssetIds = yield* await readExcludedAssetIds(self.overrideStore, self.profileKey);
      const resolvedTransactionFingerprints = yield* await readResolvedLinkGapTxFingerprints(
        self.overrideStore,
        self.profileKey
      );
      const gapAnalysis = yield* await loadLinksGapAnalysis(self.db, self.profileId, {
        excludedAssetIds,
      });

      const transaction = resolvedTransaction.transaction;
      const affectedGapCount = gapAnalysis.issues.filter(
        (issue) => issue.txFingerprint === transaction.txFingerprint
      ).length;
      const isCurrentlyResolved = resolvedTransactionFingerprints.has(transaction.txFingerprint);

      if (action === 'resolve') {
        if (isCurrentlyResolved) {
          return self.buildResult(resolvedTransaction, action, false, affectedGapCount, params.reason);
        }

        if (affectedGapCount === 0) {
          return yield* err(
            new Error(`Transaction ref '${resolvedTransaction.value}' does not currently have unresolved link gaps`)
          );
        }

        yield* await self.appendOverride({
          profileKey: self.profileKey,
          scope: 'link-gap-resolve',
          payload: {
            type: 'link_gap_resolve',
            tx_fingerprint: transaction.txFingerprint,
          },
          reason: params.reason,
        });

        return self.buildResult(resolvedTransaction, action, true, affectedGapCount, params.reason);
      }

      if (!isCurrentlyResolved) {
        return self.buildResult(resolvedTransaction, action, false, affectedGapCount, params.reason);
      }

      yield* await self.appendOverride({
        profileKey: self.profileKey,
        scope: 'link-gap-reopen',
        payload: {
          type: 'link_gap_reopen',
          tx_fingerprint: transaction.txFingerprint,
        },
        reason: params.reason,
      });

      return self.buildResult(resolvedTransaction, action, true, affectedGapCount, params.reason);
    }, this);
  }

  private buildResult(
    resolvedTransaction: ResolvedTransactionSelector,
    action: LinksGapResolutionAction,
    changed: boolean,
    affectedGapCount: number,
    reason?: string
  ): LinksGapResolutionResult {
    return {
      action,
      affectedGapCount,
      changed,
      platformKey: resolvedTransaction.transaction.platformKey,
      reason,
      transactionId: resolvedTransaction.transaction.id,
      transactionRef: formatTransactionFingerprintRef(resolvedTransaction.transaction.txFingerprint),
      txFingerprint: resolvedTransaction.transaction.txFingerprint,
    };
  }

  private async resolveTransaction(selector: string): Promise<Result<ResolvedTransactionSelector, Error>> {
    return resolveOwnedTransactionSelector(
      {
        getByFingerprintRef: async (profileId, fingerprintRef) =>
          this.db.transactions.findByFingerprintRef(profileId, fingerprintRef),
      },
      this.profileId,
      selector
    );
  }

  private async appendOverride(options: CreateOverrideEventOptions): Promise<Result<void, Error>> {
    const appendResult = await this.overrideStore.append(options);
    if (appendResult.isErr()) {
      return err(new Error(`Failed to write link gap resolution override event: ${appendResult.error.message}`));
    }

    return ok(undefined);
  }
}
