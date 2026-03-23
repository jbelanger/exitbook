import type { NewTransactionLink, OverrideEvent, Transaction } from '@exitbook/core';
import type { EventBus } from '@exitbook/events';
import { err, ok, resultDo, resultDoAsync, resultTryAsync, type Result } from '@exitbook/foundation';
import { getLogger } from '@exitbook/logger';
import type { Decimal } from 'decimal.js';

import {
  buildCostBasisScopedTransactions,
  type AccountingScopedTransaction,
} from '../../cost-basis/standard/matching/build-cost-basis-scoped-transactions.js';
import type { ILinkingPersistence } from '../../ports/linking-persistence.js';
import type { LinkableMovement } from '../matching/linkable-movement.js';
import { buildMatchingConfig } from '../matching/matching-config.js';
import { StrategyRunner, type StrategyRunnerResult } from '../matching/strategy-runner.js';
import { buildLinkableMovements } from '../pre-linking/build-linkable-movements.js';
import { defaultStrategies } from '../strategies/index.js';

import type { LinkingEvent } from './linking-events.js';
import { buildLinkFromOrphanedOverride, categorizeFinalLinks } from './linking-orchestrator-utils.js';
import { applyLinkOverrides } from './override-replay.js';

/**
 * Links run handler parameters.
 */
export interface LinkingRunParams {
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
  /** Number of existing links cleared before running (undefined if none) */
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

  /** Total links saved to database */
  totalSaved?: number | undefined;
}

/**
 * Orchestrates transaction linking — builds linkable movements,
 * runs strategy-based matching, applies user overrides, and persists results.
 */
export class LinkingOrchestrator {
  constructor(
    private store: ILinkingPersistence,
    private eventBus?: EventBus<LinkingEvent> | undefined
  ) {}

  /**
   * Execute the full linking pipeline:
   * load → build linkable movements → match → apply overrides → save
   *
   * @param params - Linking configuration
   * @param overrides - Pre-loaded override events (link/unlink scope). Pass empty array if none.
   */
  async execute(params: LinkingRunParams, overrides: OverrideEvent[] = []): Promise<Result<LinkingRunResult, Error>> {
    const result = await resultTryAsync(
      async function* (self) {
        // Mark building before transaction — externally visible in-progress state
        yield* await self.store.markLinksBuilding();

        // 1. Load transactions
        const { transactions, txById } = yield* await self.loadTransactions();
        if (transactions.length === 0) {
          yield* await self.store.markLinksFresh();
          return emptyResult();
        }

        // 2. Build linkable movements
        self.eventBus?.emit({ type: 'candidates.started' });
        const { linkableMovements, internalLinks } = yield* buildLinkableMovements(transactions, logger);
        self.eventBus?.emit({
          type: 'candidates.completed',
          candidateCount: linkableMovements.length,
          internalLinkCount: internalLinks.length,
        });

        // 3–5. Match + overrides (pure computation, no I/O)
        const scopedTransactions = (yield* buildCostBasisScopedTransactions(transactions, logger)).transactions;

        const { finalLinks, internalCount, confirmedCount, suggestedCount, strategyResult } = yield* self.runMatching(
          linkableMovements,
          internalLinks,
          params,
          overrides,
          transactions,
          txById,
          scopedTransactions
        );

        // 7. Persist links
        const { existingLinksCleared, totalSaved } = yield* await self.store.withTransaction(async (txStore) =>
          resultDoAsync(async function* () {
            const linksToSave = finalLinks.filter((l) => l.status !== 'rejected');
            let cleared: number | undefined;
            let saved: number | undefined;

            if (linksToSave.length > 0) {
              self.eventBus?.emit({ type: 'save.started' });
              const { previousCount, savedCount } = yield* await txStore.replaceLinks(linksToSave);
              cleared = previousCount > 0 ? previousCount : undefined;
              saved = savedCount;
              logger.info({ count: saved }, 'Saved links to database');
              self.eventBus?.emit({ type: 'save.completed', totalSaved: saved });
            }

            // 8. Mark links fresh — atomic with link persistence
            yield* await txStore.markLinksFresh();
            return { existingLinksCleared: cleared, totalSaved: saved };
          })
        );

        return {
          existingLinksCleared,
          internalLinksCount: internalCount,
          confirmedLinksCount: confirmedCount,
          suggestedLinksCount: suggestedCount,
          totalSourceCandidates: strategyResult.totalSourceCandidates,
          totalTargetCandidates: strategyResult.totalTargetCandidates,
          unmatchedSourceCandidateCount: strategyResult.unmatchedSourceCandidateCount,
          unmatchedTargetCandidateCount: strategyResult.unmatchedTargetCandidateCount,
          totalSaved,
        };
      },
      this,
      'Linking pipeline failed'
    );

    if (result.isErr()) {
      const failedResult = await this.store.markLinksFailed();
      if (failedResult.isErr()) {
        logger.warn({ error: failedResult.error }, 'Failed to mark links as failed');
      }
      return err(result.error);
    }

    return result;
  }

  /** Run matching pipeline: strategy matching → overrides → emit events. Pure computation, no I/O. */
  private runMatching(
    linkableMovements: LinkableMovement[],
    internalLinks: NewTransactionLink[],
    params: LinkingRunParams,
    overrides: OverrideEvent[],
    transactions: Transaction[],
    txById: Map<number, Transaction>,
    scopedTransactions: AccountingScopedTransaction[]
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
    const { eventBus } = this;
    return resultDo(function* (self) {
      eventBus?.emit({ type: 'match.started' });

      const config = buildMatchingConfig({
        minConfidenceScore: params.minConfidenceScore,
        autoConfirmThreshold: params.autoConfirmThreshold,
      });

      const runner = new StrategyRunner(defaultStrategies(), logger, config, scopedTransactions);
      const strategyResult = yield* runner.run(linkableMovements);
      const allLinks = [...internalLinks, ...strategyResult.links];

      const finalLinks = yield* self.replayOverrides(linkableMovements, allLinks, overrides, transactions, txById);
      const { internalCount, confirmedCount, suggestedCount } = categorizeFinalLinks(finalLinks);

      eventBus?.emit({
        type: 'match.completed',
        sourceCandidateCount: strategyResult.totalSourceCandidates,
        targetCandidateCount: strategyResult.totalTargetCandidates,
        internalCount,
        confirmedCount,
        suggestedCount,
      });

      return { finalLinks, internalCount, confirmedCount, suggestedCount, strategyResult };
    }, this);
  }

  private async loadTransactions(): Promise<
    Result<{ transactions: Transaction[]; txById: Map<number, Transaction> }, Error>
  > {
    return resultDoAsync(async function* (self) {
      self.eventBus?.emit({ type: 'load.started' });

      const transactions = yield* await self.store.loadTransactions();
      const txById = new Map(transactions.map((tx) => [tx.id, tx]));

      logger.info({ transactionCount: transactions.length }, 'Fetched transactions for linking');
      self.eventBus?.emit({ type: 'load.completed', totalTransactions: transactions.length });

      return { transactions, txById };
    }, this);
  }

  /**
   * Replay user overrides (confirm/reject) on top of algorithm-generated links.
   * Returns original links unchanged if no overrides provided.
   */
  private replayOverrides(
    linkableMovements: LinkableMovement[],
    links: NewTransactionLink[],
    overrides: OverrideEvent[],
    transactions: Transaction[],
    txById: Map<number, Transaction>
  ): Result<NewTransactionLink[], Error> {
    const linkOverrides = overrides.filter((o) => o.scope === 'link' || o.scope === 'unlink');
    if (linkOverrides.length === 0) return ok(links);

    logger.info({ count: linkOverrides.length }, 'Applying link override events');

    return resultDo(function* () {
      const {
        links: adjustedLinks,
        orphaned,
        unresolved,
      } = yield* applyLinkOverrides(links, linkOverrides, transactions);
      const finalLinks = adjustedLinks as NewTransactionLink[];

      for (const entry of orphaned) {
        const linkResult = buildLinkFromOrphanedOverride(entry, linkableMovements, txById);
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

      return finalLinks;
    });
  }
}

function emptyResult(): LinkingRunResult {
  return {
    internalLinksCount: 0,
    confirmedLinksCount: 0,
    suggestedLinksCount: 0,
    totalSourceCandidates: 0,
    totalTargetCandidates: 0,
    unmatchedSourceCandidateCount: 0,
    unmatchedTargetCandidateCount: 0,
  };
}
