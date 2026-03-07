import type { OverrideEvent, UniversalTransactionData } from '@exitbook/core';
import { err, ok, type Result } from '@exitbook/core';
import type { EventBus } from '@exitbook/events';
import { getLogger } from '@exitbook/logger';
import type { Decimal } from 'decimal.js';

import type { ILinkingPersistence } from '../ports/linking-persistence.js';

import type { LinkingEvent } from './linking-events.js';
import { buildLinkFromOrphanedOverride, categorizeFinalLinks } from './linking-orchestrator-utils.js';
import { buildMatchingConfig } from './matching-config.js';
import { applyLinkOverrides } from './override-replay.js';
import { materializeLinkableMovements } from './pre-linking/materializer.js';
import type { LinkableMovement, NewLinkableMovement } from './pre-linking/types.js';
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

  /** Total source transactions analyzed */
  totalSourceTransactions: number;

  /** Total target transactions analyzed */
  totalTargetTransactions: number;

  /** Number of unmatched source transactions */
  unmatchedSourceCount: number;

  /** Number of unmatched target transactions */
  unmatchedTargetCount: number;

  /** Total links saved to database (undefined if dry run) */
  totalSaved?: number | undefined;

  /** Whether this was a dry run */
  dryRun: boolean;
}

/**
 * Orchestrates transaction linking — materializes linkable movements,
 * runs strategy-based matching, applies user overrides, and persists results.
 */
export class LinkingOrchestrator {
  constructor(
    private store: ILinkingPersistence,
    private eventBus?: EventBus<LinkingEvent> | undefined
  ) {}

  /**
   * Execute the full linking pipeline:
   * load → materialize → match → apply overrides → save
   *
   * @param params - Linking configuration
   * @param overrides - Pre-loaded override events (link/unlink scope). Pass empty array if none.
   */
  async execute(params: LinkingRunParams, overrides: OverrideEvent[] = []): Promise<Result<LinkingRunResult, Error>> {
    try {
      // 1. Load transactions
      const loadResult = await this.loadTransactions();
      if (loadResult.isErr()) return err(loadResult.error);

      const { transactions, txById } = loadResult.value;
      if (transactions.length === 0) {
        return ok(emptyResult(params.dryRun));
      }

      // 2. Materialize linkable movements
      this.eventBus?.emit({ type: 'materialize.started' });
      const materializeResult = materializeLinkableMovements(transactions, logger);
      if (materializeResult.isErr()) return err(materializeResult.error);

      const { movements, internalLinks } = materializeResult.value;
      this.eventBus?.emit({
        type: 'materialize.completed',
        movementCount: movements.length,
        internalLinkCount: internalLinks.length,
      });

      // 3–7. Persist movements, run matching, persist links — all in one transaction for atomicity.
      //       Matching (steps 4–6) is pure CPU work, so holding the transaction open is fine.
      //       Dry-run skips persistence entirely.
      let movementsWithIds: LinkableMovement[];
      let existingLinksCleared: number | undefined;
      let totalSaved: number | undefined;

      let internalCount: number;
      let confirmedCount: number;
      let suggestedCount: number;
      let totalSourceTransactions: number;
      let totalTargetTransactions: number;
      let unmatchedSourceCount: number;
      let unmatchedTargetCount: number;

      if (params.dryRun) {
        // Dry run: assign in-memory IDs, run matching, skip persistence
        movementsWithIds = this.assignInMemoryIds(movements);

        const matchResult = this.runMatching(movementsWithIds, internalLinks, params, overrides, transactions, txById);
        if (matchResult.isErr()) return err(matchResult.error);

        ({ internalCount, confirmedCount, suggestedCount } = matchResult.value);
        totalSourceTransactions = matchResult.value.strategyResult.totalSourceMovements;
        totalTargetTransactions = matchResult.value.strategyResult.totalTargetMovements;
        unmatchedSourceCount = matchResult.value.strategyResult.unmatchedSourceCount;
        unmatchedTargetCount = matchResult.value.strategyResult.unmatchedTargetCount;
      } else {
        const persistResult = await this.store.withTransaction(async (txStore) => {
          // 3. Persist linkable movements
          const movementsResult = await txStore.replaceMovements(movements);
          if (movementsResult.isErr()) return err(movementsResult.error);

          // 4–6. Match + overrides (pure computation, no I/O)
          const matchResult = this.runMatching(
            movementsResult.value,
            internalLinks,
            params,
            overrides,
            transactions,
            txById
          );
          if (matchResult.isErr()) return err(matchResult.error);
          const { finalLinks, internalCount, confirmedCount, suggestedCount, strategyResult } = matchResult.value;

          // 7. Persist links
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

          return ok({
            movementsWithIds: movementsResult.value,
            existingLinksCleared: cleared,
            totalSaved: saved,
            internalCount,
            confirmedCount,
            suggestedCount,
            strategyResult,
          });
        });

        if (persistResult.isErr()) return err(persistResult.error);

        movementsWithIds = persistResult.value.movementsWithIds;
        existingLinksCleared = persistResult.value.existingLinksCleared;
        totalSaved = persistResult.value.totalSaved;
        ({ internalCount, confirmedCount, suggestedCount } = persistResult.value);
        totalSourceTransactions = persistResult.value.strategyResult.totalSourceMovements;
        totalTargetTransactions = persistResult.value.strategyResult.totalTargetMovements;
        unmatchedSourceCount = persistResult.value.strategyResult.unmatchedSourceCount;
        unmatchedTargetCount = persistResult.value.strategyResult.unmatchedTargetCount;
      }

      return ok({
        existingLinksCleared,
        internalLinksCount: internalCount,
        confirmedLinksCount: confirmedCount,
        suggestedLinksCount: suggestedCount,
        totalSourceTransactions,
        totalTargetTransactions,
        unmatchedSourceCount,
        unmatchedTargetCount,
        totalSaved,
        dryRun: params.dryRun,
      });
    } catch (error) {
      return err(error instanceof Error ? error : new Error(String(error)));
    }
  }

  /** Run matching pipeline: strategy matching → overrides → emit events. Pure computation, no I/O. */
  private runMatching(
    movementsWithIds: LinkableMovement[],
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
    const runResult = runner.run(movementsWithIds);
    if (runResult.isErr()) return err(runResult.error);

    const strategyResult = runResult.value;
    const allLinks = [...internalLinks, ...strategyResult.links];

    const overrideResult = this.replayOverrides(allLinks, overrides, transactions, txById);
    if (overrideResult.isErr()) return err(overrideResult.error);

    const finalLinks = overrideResult.value;
    const { internalCount, confirmedCount, suggestedCount } = categorizeFinalLinks(finalLinks);

    this.eventBus?.emit({
      type: 'match.completed',
      sourceCount: strategyResult.totalSourceMovements,
      targetCount: strategyResult.totalTargetMovements,
      internalCount,
      confirmedCount,
      suggestedCount,
    });

    return ok({ finalLinks, internalCount, confirmedCount, suggestedCount, strategyResult });
  }

  /** Assign sequential IDs to NewLinkableMovements for dry-run mode (no DB) */
  private assignInMemoryIds(movements: NewLinkableMovement[]): LinkableMovement[] {
    return movements.map((m, i) => ({ ...m, id: i + 1 }));
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
    totalSourceTransactions: 0,
    totalTargetTransactions: 0,
    unmatchedSourceCount: 0,
    unmatchedTargetCount: 0,
    dryRun,
  };
}
