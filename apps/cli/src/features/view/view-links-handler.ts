// Handler for view links command

import type { TransactionLink, TransactionLinkRepository } from '@exitbook/accounting';
import type { UniversalTransaction } from '@exitbook/core';
import type { TransactionRepository } from '@exitbook/data';
import type { Result } from 'neverthrow';
import { err, ok } from 'neverthrow';

import type { LinkInfo, TransactionDetails, ViewLinksParams, ViewLinksResult } from './view-links-utils.ts';

/**
 * Handler for viewing transaction links.
 */
export class ViewLinksHandler {
  constructor(
    private readonly linkRepo: TransactionLinkRepository,
    private readonly txRepo?: TransactionRepository
  ) {}

  /**
   * Execute the view links command.
   */
  async execute(params: ViewLinksParams): Promise<Result<ViewLinksResult, Error>> {
    // Fetch links from repository
    const linksResult = await this.linkRepo.findAll(params.status);

    if (linksResult.isErr()) {
      return err(linksResult.error);
    }

    let links = linksResult.value;

    // Apply confidence filters if provided
    if (params.minConfidence !== undefined || params.maxConfidence !== undefined) {
      links = this.filterByConfidence(links, params.minConfidence, params.maxConfidence);
    }

    // Apply limit
    if (params.limit !== undefined && params.limit > 0) {
      links = links.slice(0, params.limit);
    }

    // Fetch transaction details if verbose mode and txRepo is available
    const linkInfos: LinkInfo[] = [];
    for (const link of links) {
      const linkInfo = await this.formatLink(link, params.verbose);
      linkInfos.push(linkInfo);
    }

    // Build result
    const result: ViewLinksResult = {
      links: linkInfos,
      count: linkInfos.length,
    };

    return ok(result);
  }

  destroy(): void {
    // No cleanup needed
  }

  /**
   * Filter links by confidence score range.
   */
  private filterByConfidence(
    links: TransactionLink[],
    minConfidence?: number,
    maxConfidence?: number
  ): TransactionLink[] {
    return links.filter((link) => {
      const score = link.confidenceScore.toNumber();

      if (minConfidence !== undefined && score < minConfidence) {
        return false;
      }

      if (maxConfidence !== undefined && score > maxConfidence) {
        return false;
      }

      return true;
    });
  }

  /**
   * Format link for display.
   */
  private async formatLink(link: TransactionLink, verbose?: boolean): Promise<LinkInfo> {
    const linkInfo: LinkInfo = {
      id: link.id,
      source_transaction_id: link.sourceTransactionId,
      target_transaction_id: link.targetTransactionId,
      link_type: link.linkType,
      confidence_score: link.confidenceScore.toString(),
      match_criteria: link.matchCriteria,
      status: link.status,
      reviewed_by: link.reviewedBy,
      reviewed_at: link.reviewedAt?.toISOString(),
      created_at: link.createdAt.toISOString(),
      updated_at: link.updatedAt.toISOString(),
    };

    // Fetch transaction details if verbose mode and txRepo is available
    if (verbose && this.txRepo) {
      const sourceTxResult = await this.txRepo.findById(link.sourceTransactionId);
      if (sourceTxResult.isOk() && sourceTxResult.value) {
        linkInfo.source_transaction = this.formatTransactionDetails(sourceTxResult.value);
      }

      const targetTxResult = await this.txRepo.findById(link.targetTransactionId);
      if (targetTxResult.isOk() && targetTxResult.value) {
        linkInfo.target_transaction = this.formatTransactionDetails(targetTxResult.value);
      }
    }

    return linkInfo;
  }

  /**
   * Format transaction for display.
   */
  private formatTransactionDetails(tx: UniversalTransaction): TransactionDetails {
    return {
      external_id: tx.externalId ?? undefined,
      from_address: tx.from ?? undefined,
      id: tx.id ?? 0,
      movements_inflows: tx.movements?.inflows ?? [],
      movements_outflows: tx.movements?.outflows ?? [],
      source_id: tx.source,
      timestamp: tx.datetime,
      to_address: tx.to ?? undefined,
    };
  }
}
