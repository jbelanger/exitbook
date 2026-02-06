import {
  createTransactionLink,
  DEFAULT_MATCHING_CONFIG,
  TransactionLinkingService,
  type TransactionLink,
  type TransactionLinkRepository,
} from '@exitbook/accounting';
import { applyLinkOverrides, type OverrideStore } from '@exitbook/data';
import type { TransactionRepository } from '@exitbook/data';
import { getLogger } from '@exitbook/logger';
import { err, ok, type Result } from 'neverthrow';
import { v4 as uuidv4 } from 'uuid';

/**
 * Links run handler parameters.
 */
export interface LinksRunHandlerParams {
  /** Whether to run in dry-run mode (no database writes) */
  dryRun: boolean;

  /** Minimum confidence score to suggest a match (0-1) */
  minConfidenceScore: import('decimal.js').Decimal;

  /** Auto-confirm matches above this confidence (0-1) */
  autoConfirmThreshold: import('decimal.js').Decimal;
}

const logger = getLogger('LinksRunHandler');

/**
 * Result of the links run operation.
 */
export interface LinksRunResult {
  /** Number of confirmed links (auto-confirmed) */
  confirmedLinksCount: number;

  /** Number of suggested links (needs manual review) */
  suggestedLinksCount: number;

  /** Total source transactions analyzed */
  totalSourceTransactions: number;

  /** Total target transactions analyzed */
  totalTargetTransactions: number;

  /** Number of unmatched source transactions */
  unmatchedSourceCount: number;

  /** Number of unmatched target transactions */
  unmatchedTargetCount: number;

  /** Whether this was a dry run */
  dryRun: boolean;
}

/**
 * Links run handler - encapsulates all transaction linking business logic.
 * Reusable by both CLI command and other contexts.
 */
export class LinksRunHandler {
  constructor(
    private transactionRepository: TransactionRepository,
    private linkRepository: TransactionLinkRepository,
    private overrideStore?: OverrideStore | undefined
  ) {}

  /**
   * Execute the links run operation.
   * Params are already validated at CLI boundary via Zod.
   */
  async execute(params: LinksRunHandlerParams): Promise<Result<LinksRunResult, Error>> {
    try {
      // Fetch all transactions
      const transactionsResult = await this.transactionRepository.getTransactions();
      if (transactionsResult.isErr()) {
        return err(transactionsResult.error);
      }

      const transactions = transactionsResult.value;
      logger.info({ transactionCount: transactions.length }, 'Fetched transactions for linking');

      if (transactions.length === 0) {
        logger.warn('No transactions found to link');
        return ok({
          confirmedLinksCount: 0,
          suggestedLinksCount: 0,
          totalSourceTransactions: 0,
          totalTargetTransactions: 0,
          unmatchedSourceCount: 0,
          unmatchedTargetCount: 0,
          dryRun: params.dryRun,
        });
      }

      // Create linking service with custom config
      const linkingService = new TransactionLinkingService(logger, {
        maxTimingWindowHours: 48, // Default 2 days
        minAmountSimilarity: DEFAULT_MATCHING_CONFIG.minAmountSimilarity,
        minConfidenceScore: params.minConfidenceScore,
        autoConfirmThreshold: params.autoConfirmThreshold,
      });

      // Run linking algorithm
      const linkingResult = linkingService.linkTransactions(transactions);
      if (linkingResult.isErr()) {
        return err(linkingResult.error);
      }

      const {
        confirmedLinks,
        suggestedLinks,
        totalSourceTransactions,
        totalTargetTransactions,
        unmatchedSourceCount,
        unmatchedTargetCount,
      } = linkingResult.value;

      logger.info(
        {
          confirmed: confirmedLinks.length,
          suggested: suggestedLinks.length,
          unmatchedSources: unmatchedSourceCount,
          unmatchedTargets: unmatchedTargetCount,
        },
        'Transaction linking completed'
      );

      // Build all link entities before applying overrides
      const now = new Date();
      const allLinks: TransactionLink[] = [...confirmedLinks];

      if (suggestedLinks.length > 0) {
        for (const match of suggestedLinks) {
          const linkResult = createTransactionLink(match, 'suggested', uuidv4(), now);
          if (linkResult.isErr()) {
            logger.warn({ error: linkResult.error.message, match }, 'Failed to create suggested link - skipping');
            continue;
          }
          allLinks.push(linkResult.value);
        }
      }

      // Apply override events (confirm/reject) on top of algorithm results
      const overrideAdjustedLinks = await this.applyOverrides(allLinks, transactions);

      // Count adjusted results
      const adjustedConfirmed = overrideAdjustedLinks.filter((l) => l.status === 'confirmed');
      const adjustedSuggested = overrideAdjustedLinks.filter((l) => l.status === 'suggested');
      // Rejected links are excluded from saving

      // Save links to database (unless dry-run)
      if (!params.dryRun) {
        const linksToSave = overrideAdjustedLinks.filter((l) => l.status !== 'rejected');

        if (linksToSave.length > 0) {
          const saveResult = await this.linkRepository.createBulk(linksToSave);
          if (saveResult.isErr()) {
            return err(saveResult.error);
          }
          logger.info({ count: saveResult.value }, 'Saved links to database');
        }
      } else {
        logger.info('Dry run mode - no links saved to database');
      }

      return ok({
        confirmedLinksCount: adjustedConfirmed.length,
        suggestedLinksCount: adjustedSuggested.length,
        totalSourceTransactions,
        totalTargetTransactions,
        unmatchedSourceCount,
        unmatchedTargetCount,
        dryRun: params.dryRun,
      });
    } catch (error) {
      return err(error instanceof Error ? error : new Error(String(error)));
    }
  }

  /**
   * Apply link/unlink override events on top of algorithm-generated links.
   * If no override store is configured, returns the links unchanged.
   */
  private async applyOverrides(
    links: TransactionLink[],
    transactions: { externalId: string; id: number; source: string }[]
  ): Promise<TransactionLink[]> {
    if (!this.overrideStore) return links;

    try {
      const overridesResult = await this.overrideStore.readAll();
      if (overridesResult.isErr()) {
        logger.warn({ error: overridesResult.error }, 'Failed to read override events, skipping replay');
        return links;
      }

      const overrides = overridesResult.value;
      const linkOverrides = overrides.filter((o) => o.scope === 'link' || o.scope === 'unlink');

      if (linkOverrides.length === 0) return links;

      logger.info({ count: linkOverrides.length }, 'Applying link override events');

      const result = applyLinkOverrides(links, linkOverrides, transactions);
      if (result.isErr()) {
        logger.warn({ error: result.error }, 'Failed to apply link overrides, using algorithm results');
        return links;
      }

      const { links: adjustedLinks, unresolved } = result.value;

      if (unresolved.length > 0) {
        logger.warn(
          { unresolvedCount: unresolved.length },
          'Some override events could not be matched to current links'
        );
      }

      return adjustedLinks;
    } catch (error) {
      logger.warn({ error }, 'Unexpected error applying overrides, using algorithm results');
      return links;
    }
  }
}
