import { DEFAULT_MATCHING_CONFIG, TransactionLinkingService } from '@exitbook/accounting';
import { TransactionLinkRepository } from '@exitbook/accounting';
import type { KyselyDB } from '@exitbook/data';
import { TransactionRepository } from '@exitbook/data';
import { getLogger } from '@exitbook/shared-logger';
import { err, ok, type Result } from 'neverthrow';

import type { LinkHandlerParams } from './link-utils.ts';
import { validateLinkParams } from './link-utils.ts';

// Re-export for convenience
export type { LinkHandlerParams };

const logger = getLogger('LinkHandler');

/**
 * Result of the link operation.
 */
export interface LinkResult {
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
 * Link handler - encapsulates all transaction linking business logic.
 * Reusable by both CLI command and other contexts.
 */
export class LinkHandler {
  private transactionRepository: TransactionRepository;
  private linkRepository: TransactionLinkRepository;

  constructor(private database: KyselyDB) {
    this.transactionRepository = new TransactionRepository(this.database);
    this.linkRepository = new TransactionLinkRepository(this.database);
  }

  /**
   * Execute the link operation.
   */
  async execute(params: LinkHandlerParams): Promise<Result<LinkResult, Error>> {
    try {
      // Validate parameters
      const validation = validateLinkParams(params);
      if (validation.isErr()) {
        return err(validation.error);
      }

      logger.info({ dryRun: params.dryRun }, 'Starting transaction linking process');

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

      // Save confirmed links to database (unless dry-run)
      if (!params.dryRun && confirmedLinks.length > 0) {
        const saveResult = await this.linkRepository.createBulk(confirmedLinks);
        if (saveResult.isErr()) {
          return err(saveResult.error);
        }
        logger.info({ count: saveResult.value }, 'Saved confirmed links to database');
      } else if (params.dryRun) {
        logger.info('Dry run mode - no links saved to database');
      }

      return ok({
        confirmedLinksCount: confirmedLinks.length,
        suggestedLinksCount: suggestedLinks.length,
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
   * Cleanup resources (none needed for LinkHandler, but included for consistency).
   */
  destroy(): void {
    // No resources to cleanup
  }
}
