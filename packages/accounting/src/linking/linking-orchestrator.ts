import type { UniversalTransactionData } from '@exitbook/core';
import { applyLinkOverrides, type LinkableMovementRepository, type OverrideStore } from '@exitbook/data';
import type { TransactionLinkRepository, TransactionRepository } from '@exitbook/data';
import type { EventBus } from '@exitbook/events';
import { getLogger } from '@exitbook/logger';
import type { Decimal } from 'decimal.js';
import { err, ok, type Result } from 'neverthrow';

import type { LinkingEvent } from './linking-events.js';
import { buildLinkFromOrphanedOverride, categorizeFinalLinks } from './linking-orchestrator-utils.js';
import { buildMatchingConfig } from './matching-config.js';
import { materializeLinkableMovements } from './pre-linking/materializer.js';
import type { LinkableMovement, NewLinkableMovement } from './pre-linking/types.js';
import { defaultStrategies } from './strategies/index.js';
import { StrategyRunner } from './strategy-runner.js';
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
    private transactionRepository: TransactionRepository,
    private linkRepository: TransactionLinkRepository,
    private overrideStore?: OverrideStore | undefined,
    private eventBus?: EventBus<LinkingEvent> | undefined,
    private linkableMovementRepository?: LinkableMovementRepository | undefined
  ) {}

  /**
   * Execute the full linking pipeline:
   * load → clear → materialize → match → apply overrides → save
   */
  async execute(params: LinkingRunParams): Promise<Result<LinkingRunResult, Error>> {
    try {
      // 1. Load transactions
      const loadResult = await this.loadTransactions();
      if (loadResult.isErr()) return err(loadResult.error);

      const { transactions, txById } = loadResult.value;
      if (transactions.length === 0) {
        return ok(emptyResult(params.dryRun));
      }

      // 2. Clear existing links and linkable_movements (unless dry run)
      let existingLinksCleared: number | undefined;
      if (!params.dryRun) {
        const clearResult = await this.clearExistingLinks();
        if (clearResult.isErr()) return err(clearResult.error);
        existingLinksCleared = clearResult.value;

        await this.clearLinkableMovements();
      }

      // 3. Materialize linkable movements
      this.eventBus?.emit({ type: 'materialize.started' });
      const materializeResult = materializeLinkableMovements(transactions, logger);
      if (materializeResult.isErr()) return err(materializeResult.error);

      const { movements, internalLinks } = materializeResult.value;
      this.eventBus?.emit({
        type: 'materialize.completed',
        movementCount: movements.length,
        internalLinkCount: internalLinks.length,
      });

      // 4. Persist linkable movements and get back rows with real IDs
      let movementsWithIds: LinkableMovement[];
      if (!params.dryRun && this.linkableMovementRepository) {
        const persistResult = await this.persistLinkableMovements(movements);
        if (persistResult.isErr()) return err(persistResult.error);

        const readBackResult = await this.linkableMovementRepository.findAll();
        if (readBackResult.isErr()) return err(readBackResult.error);
        movementsWithIds = readBackResult.value;
      } else {
        movementsWithIds = this.assignInMemoryIds(movements);
      }

      // 5. Run strategy-based matching
      this.eventBus?.emit({ type: 'match.started' });

      const config = buildMatchingConfig({
        minConfidenceScore: params.minConfidenceScore,
        autoConfirmThreshold: params.autoConfirmThreshold,
      });

      const runner = new StrategyRunner(defaultStrategies(), logger, config);
      const runResult = runner.run(movementsWithIds);
      if (runResult.isErr()) return err(runResult.error);

      const strategyResult = runResult.value;

      // Combine internal links with strategy links
      const allLinks = [...internalLinks, ...strategyResult.links];

      // 6. Apply user overrides
      const overrideResult = await this.replayOverrides(allLinks, transactions, txById);
      if (overrideResult.isErr()) return err(overrideResult.error);

      const finalLinks = overrideResult.value;

      // 7. Emit match results
      const { internalCount, confirmedCount, suggestedCount } = categorizeFinalLinks(finalLinks);
      this.eventBus?.emit({
        type: 'match.completed',
        sourceCount: strategyResult.totalSourceMovements,
        targetCount: strategyResult.totalTargetMovements,
        internalCount,
        confirmedCount,
        suggestedCount,
      });

      // 8. Persist (unless dry run)
      let totalSaved: number | undefined;
      if (!params.dryRun) {
        const saveResult = await this.saveLinks(finalLinks);
        if (saveResult.isErr()) return err(saveResult.error);
        totalSaved = saveResult.value;
      }

      return ok({
        existingLinksCleared,
        internalLinksCount: internalCount,
        confirmedLinksCount: confirmedCount,
        suggestedLinksCount: suggestedCount,
        totalSourceTransactions: strategyResult.totalSourceMovements,
        totalTargetTransactions: strategyResult.totalTargetMovements,
        unmatchedSourceCount: strategyResult.unmatchedSourceCount,
        unmatchedTargetCount: strategyResult.unmatchedTargetCount,
        totalSaved,
        dryRun: params.dryRun,
      });
    } catch (error) {
      return err(error instanceof Error ? error : new Error(String(error)));
    }
  }

  /** Assign sequential IDs to NewLinkableMovements for dry-run mode (no DB) */
  private assignInMemoryIds(movements: NewLinkableMovement[]): LinkableMovement[] {
    return movements.map((m, i) => ({ ...m, id: i + 1 }));
  }

  private async loadTransactions(): Promise<
    Result<{ transactions: UniversalTransactionData[]; txById: Map<number, UniversalTransactionData> }, Error>
  > {
    this.eventBus?.emit({ type: 'load.started' });

    const result = await this.transactionRepository.findAll();
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

  private async clearExistingLinks(): Promise<Result<number | undefined, Error>> {
    const countResult = await this.linkRepository.count();
    if (countResult.isErr()) {
      logger.warn({ error: countResult.error }, 'Failed to count existing links');
      return err(countResult.error);
    }

    const count = countResult.value;
    if (count === 0) return ok(undefined);

    const deleteResult = await this.linkRepository.deleteAll();
    if (deleteResult.isErr()) {
      logger.warn({ error: deleteResult.error, count }, 'Failed to clear existing links before relinking');
      return err(deleteResult.error);
    }

    logger.info({ count }, 'Cleared existing links');
    this.eventBus?.emit({ type: 'existing.cleared', count });
    return ok(count);
  }

  private async clearLinkableMovements(): Promise<void> {
    if (!this.linkableMovementRepository) return;
    const result = await this.linkableMovementRepository.deleteAll();
    if (result.isErr()) {
      logger.warn({ error: result.error }, 'Failed to clear linkable movements');
    }
  }

  private async persistLinkableMovements(movements: NewLinkableMovement[]): Promise<Result<number, Error>> {
    if (!this.linkableMovementRepository) return ok(0);

    const result = await this.linkableMovementRepository.createBatch(movements);
    if (result.isErr()) return err(result.error);

    logger.info({ count: result.value }, 'Persisted linkable movements');
    return ok(result.value);
  }

  /**
   * Replay user overrides (confirm/reject) on top of algorithm-generated links.
   * Returns original links unchanged if no override store is configured.
   */
  private async replayOverrides(
    links: NewTransactionLink[],
    transactions: UniversalTransactionData[],
    txById: Map<number, UniversalTransactionData>
  ): Promise<Result<NewTransactionLink[], Error>> {
    if (!this.overrideStore) return ok(links);

    const overridesResult = await this.overrideStore.readAll();
    if (overridesResult.isErr()) return err(overridesResult.error);

    const linkOverrides = overridesResult.value.filter((o) => o.scope === 'link' || o.scope === 'unlink');
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

  private async saveLinks(links: NewTransactionLink[]): Promise<Result<number | undefined, Error>> {
    const linksToSave = links.filter((l) => l.status !== 'rejected');
    if (linksToSave.length === 0) return ok(undefined);

    this.eventBus?.emit({ type: 'save.started' });

    const saveResult = await this.linkRepository.createBatch(linksToSave);
    if (saveResult.isErr()) return err(saveResult.error);

    logger.info({ count: saveResult.value }, 'Saved links to database');
    this.eventBus?.emit({ type: 'save.completed', totalSaved: saveResult.value });
    return ok(saveResult.value);
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
