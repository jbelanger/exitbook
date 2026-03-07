import type { OverrideEvent, UniversalTransactionData } from '@exitbook/core';
import { err, ok, type Result } from '@exitbook/core';
import type { EventBus } from '@exitbook/events';
import { getLogger } from '@exitbook/logger';
import type { Decimal } from 'decimal.js';

import type { ILinkingPersistence } from '../ports/linking-persistence.js';

import type { LinkCandidate } from './link-candidate.js';
import type { LinkingEvent } from './linking-events.js';
import { buildLinkFromOrphanedOverride, categorizeFinalLinks } from './linking-orchestrator-utils.js';
import { buildMatchingConfig } from './matching-config.js';
import { applyLinkOverrides } from './override-replay.js';
import { buildLinkCandidates } from './pre-linking/build-link-candidates.js';
import { defaultStrategies } from './strategies/index.js';
import { StrategyRunner, type StrategyRunnerResult } from './strategy-runner.js';
import type { NewTransactionLink } from './types.js';

/**
 * Links run handler parameters.
 */
export interface LinkingRunParams {
  /** Whether to run in dry-run mode (no database writes) */
  dryRun: boolean;

  /** Minimum confidence score to suggest a match (0-1) */
  minConfidenceScore: Decimal;

  /** Auto-confirm matches above this confidence (0-1) */
  autoConfirmThreshold: Decimal;
}

const logger = getLogger('LinkingOrchestrator');

/**
 * Result of the links run operation.
 */
export interface LinkingRunResult {
  /** Number of existing links cleared before running (undefined if none or dry run) */
  existingLinksCleared?: number | undefined;

  /** Number of internal links (same tx hash) */
  internalLinksCount: number;

  /** Number of confirmed links (auto-confirmed, >=95%) */
  confirmedLinksCount: number;

  /** Number of suggested links (needs manual review, 70-95%) */
  suggestedLinksCount: number;

  /** Total source candidates analyzed */
  totalSourceCandidates: number;

  /** Total target candidates analyzed */
  totalTargetCandidates: number;

  /** Number of unmatched source candidates */
  unmatchedSourceCandidateCount: number;

  /** Number of unmatched target candidates */
  unmatchedTargetCandidateCount: number;

  /** Total links saved to database (undefined if dry run) */
  totalSaved?: number | undefined;

  /** Whether this was a dry run */
  dryRun: boolean;
}

/**
 * Orchestrates transaction linking — builds link candidates,
 * runs strategy-based matching, applies user overrides, and persists results.
 */
export class LinkingOrchestrator {
  constructor(
    private store: ILinkingPersistence,
    private eventBus?: EventBus<LinkingEvent> | undefined
  ) {}

  /**
   * Execute the full linking pipeline:
   * load → build candidates → match → apply overrides → save
   *
   * @param params - Linking configuration
   * @param overrides - Pre-loaded override events (link/unlink scope). Pass empty array if none.
   */
  async execute(params: LinkingRunParams, overrides: OverrideEvent[] = []): Promise<Result<LinkingRunResult, Error>> {
    try {
      // Mark building before transaction — externally visible in-progress state
      if (!params.dryRun) {
        const buildingResult = await this.store.markLinksBuilding();
        if (buildingResult.isErr()) return err(buildingResult.error);
      }

      // 1. Load transactions
      const loadResult = await this.loadTransactions();
      if (loadResult.isErr()) return err(loadResult.error);

      const { transactions, txById } = loadResult.value;
      if (transactions.length === 0) {
        if (!params.dryRun) {
          const freshResult = await this.store.markLinksFresh();
          if (freshResult.isErr()) return err(freshResult.error);
        }
        return ok(emptyResult(params.dryRun));
      }

      // 2. Build link candidates (in-memory for both dry-run and live mode)
      this.eventBus?.emit({ type: 'candidates.started' });
      const candidateBuildResult = buildLinkCandidates(transactions, logger);
      if (candidateBuildResult.isErr()) return err(candidateBuildResult.error);

      const { candidates, internalLinks } = candidateBuildResult.value;
      this.eventBus?.emit({
        type: 'candidates.completed',
        candidateCount: candidates.length,
        internalLinkCount: internalLinks.length,
      });

      // 3–5. Match + overrides (pure computation, no I/O)
      const matchResult = this.runMatching(candidates, internalLinks, params, overrides, transactions, txById);
      if (matchResult.isErr()) return err(matchResult.error);

      const { finalLinks, internalCount, confirmedCount, suggestedCount, strategyResult } = matchResult.value;

      let existingLinksCleared: number | undefined;
      let totalSaved: number | undefined;

      // 7. Persist links (live mode only)
      if (!params.dryRun) {
        const persistResult = await this.store.withTransaction(async (txStore) => {
          const linksToSave = finalLinks.filter((l) => l.status !== 'rejected');
          let cleared: number | undefined;
          let saved: number | undefined;

          if (linksToSave.length > 0) {
            this.eventBus?.emit({ type: 'save.started' });
            const saveResult = await txStore.replaceLinks(linksToSave);
            if (saveResult.isErr()) return err(saveResult.error);

            cleared = saveResult.value.previousCount > 0 ? saveResult.value.previousCount : undefined;
            saved = saveResult.value.savedCount;

            logger.info({ count: saved }, 'Saved links to database');
            this.eventBus?.emit({ type: 'save.completed', totalSaved: saved });
          }

          // 8. Mark links fresh — atomic with link persistence
          const freshResult = await txStore.markLinksFresh();
          if (freshResult.isErr()) return err(freshResult.error);

          return ok({ existingLinksCleared: cleared, totalSaved: saved });
        });

        if (persistResult.isErr()) {
          const failedResult = await this.store.markLinksFailed();
          if (failedResult.isErr()) {
            logger.warn({ error: failedResult.error }, 'Failed to mark links as failed');
          }
          return err(persistResult.error);
        }

        existingLinksCleared = persistResult.value.existingLinksCleared;
        totalSaved = persistResult.value.totalSaved;
      }

      return ok({
        existingLinksCleared,
        internalLinksCount: internalCount,
        confirmedLinksCount: confirmedCount,
        suggestedLinksCount: suggestedCount,
        totalSourceCandidates: strategyResult.totalSourceCandidates,
        totalTargetCandidates: strategyResult.totalTargetCandidates,
        unmatchedSourceCandidateCount: strategyResult.unmatchedSourceCandidateCount,
        unmatchedTargetCandidateCount: strategyResult.unmatchedTargetCandidateCount,
        totalSaved,
        dryRun: params.dryRun,
      });
    } catch (error) {
      if (!params.dryRun) {
        const failedResult = await this.store.markLinksFailed();
        if (failedResult.isErr()) {
          logger.warn({ error: failedResult.error }, 'Failed to mark links as failed');
        }
      }
      return err(error instanceof Error ? error : new Error(String(error)));
    }
  }

  /** Run matching pipeline: strategy matching → overrides → emit events. Pure computation, no I/O. */
  private runMatching(
    candidates: LinkCandidate[],
    internalLinks: NewTransactionLink[],
    params: LinkingRunParams,
    overrides: OverrideEvent[],
    transactions: UniversalTransactionData[],
    txById: Map<number, UniversalTransactionData>
  ): Result<
    {
      confirmedCount: number;
      finalLinks: NewTransactionLink[];
      internalCount: number;
      strategyResult: StrategyRunnerResult;
      suggestedCount: number;
    },
    Error
  > {
    this.eventBus?.emit({ type: 'match.started' });

    const config = buildMatchingConfig({
      minConfidenceScore: params.minConfidenceScore,
      autoConfirmThreshold: params.autoConfirmThreshold,
    });

    const runner = new StrategyRunner(defaultStrategies(), logger, config);
    const runResult = runner.run(candidates);
    if (runResult.isErr()) return err(runResult.error);

    const strategyResult = runResult.value;
    const allLinks = [...internalLinks, ...strategyResult.links];

    const overrideResult = this.replayOverrides(allLinks, overrides, transactions, txById);
    if (overrideResult.isErr()) return err(overrideResult.error);

    const finalLinks = overrideResult.value;
    const { internalCount, confirmedCount, suggestedCount } = categorizeFinalLinks(finalLinks);

    this.eventBus?.emit({
      type: 'match.completed',
      sourceCandidateCount: strategyResult.totalSourceCandidates,
      targetCandidateCount: strategyResult.totalTargetCandidates,
      internalCount,
      confirmedCount,
      suggestedCount,
    });

    return ok({ finalLinks, internalCount, confirmedCount, suggestedCount, strategyResult });
  }

  private async loadTransactions(): Promise<
    Result<{ transactions: UniversalTransactionData[]; txById: Map<number, UniversalTransactionData> }, Error>
  > {
    this.eventBus?.emit({ type: 'load.started' });

    const result = await this.store.loadTransactions();
    if (result.isErr()) return err(result.error);

    const transactions = result.value;
    const txById = new Map<number, UniversalTransactionData>();
    for (const tx of transactions) {
      txById.set(tx.id, tx);
    }

    logger.info({ transactionCount: transactions.length }, 'Fetched transactions for linking');
    this.eventBus?.emit({ type: 'load.completed', totalTransactions: transactions.length });

    return ok({ transactions, txById });
  }

  /**
   * Replay user overrides (confirm/reject) on top of algorithm-generated links.
   * Returns original links unchanged if no overrides provided.
   */
  private replayOverrides(
    links: NewTransactionLink[],
    overrides: OverrideEvent[],
    transactions: UniversalTransactionData[],
    txById: Map<number, UniversalTransactionData>
  ): Result<NewTransactionLink[], Error> {
    const linkOverrides = overrides.filter((o) => o.scope === 'link' || o.scope === 'unlink');
    if (linkOverrides.length === 0) return ok(links);

    logger.info({ count: linkOverrides.length }, 'Applying link override events');

    const applyResult = applyLinkOverrides(links, linkOverrides, transactions);
    if (applyResult.isErr()) return err(applyResult.error);

    const { links: adjustedLinks, orphaned, unresolved } = applyResult.value;
    const finalLinks = adjustedLinks as NewTransactionLink[];

    for (const entry of orphaned) {
      const linkResult = buildLinkFromOrphanedOverride(entry, txById);
      if (linkResult.isErr()) {
        logger.error(
          {
            overrideId: entry.override.id,
            sourceTransactionId: entry.sourceTransactionId,
            targetTransactionId: entry.targetTransactionId,
            asset: entry.assetSymbol,
          },
          `Skipping orphaned override: ${linkResult.error.message}`
        );
        continue;
      }
      finalLinks.push(linkResult.value);
      logger.info(
        {
          overrideId: entry.override.id,
          sourceTransactionId: entry.sourceTransactionId,
          targetTransactionId: entry.targetTransactionId,
          asset: entry.assetSymbol,
        },
        'Created link from override (algorithm did not rediscover this pair)'
      );
    }

    if (unresolved.length > 0) {
      logger.warn(
        { unresolvedCount: unresolved.length },
        'Some override events could not resolve transaction fingerprints'
      );
    }

    return ok(finalLinks);
  }
}

function emptyResult(dryRun: boolean): LinkingRunResult {
  return {
    internalLinksCount: 0,
    confirmedLinksCount: 0,
    suggestedLinksCount: 0,
    totalSourceCandidates: 0,
    totalTargetCandidates: 0,
    unmatchedSourceCandidateCount: 0,
    unmatchedTargetCandidateCount: 0,
    dryRun,
  };
}
