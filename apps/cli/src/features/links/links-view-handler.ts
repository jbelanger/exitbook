// Handler for links view command

import type { TransactionLinkRepository } from '@exitbook/accounting';
import type { TransactionRepository } from '@exitbook/data';
import type { Result } from 'neverthrow';
import { err, ok } from 'neverthrow';

import {
  filterLinksByConfidence,
  formatLinkInfo,
  type LinkInfo,
  type LinksViewParams,
  type LinksViewResult,
} from './links-view-utils.js';

/**
 * Handler for viewing transaction links.
 */
export class LinksViewHandler {
  constructor(
    private readonly linkRepo: TransactionLinkRepository,
    private readonly txRepo?: TransactionRepository
  ) {}

  /**
   * Execute the links view command.
   */
  async execute(params: LinksViewParams): Promise<Result<LinksViewResult, Error>> {
    // Fetch links from repository
    const linksResult = await this.linkRepo.findAll(params.status);

    if (linksResult.isErr()) {
      return err(linksResult.error);
    }

    let links = linksResult.value;

    // Apply confidence filters if provided (functional core)
    if (params.minConfidence !== undefined || params.maxConfidence !== undefined) {
      links = filterLinksByConfidence(links, params.minConfidence, params.maxConfidence);
    }

    // Apply limit
    if (params.limit !== undefined && params.limit > 0) {
      links = links.slice(0, params.limit);
    }

    // Format links with transaction details if verbose mode
    const linkInfos: LinkInfo[] = [];
    for (const link of links) {
      // Fetch transactions if verbose mode and txRepo is available (imperative shell)
      let sourceTx;
      let targetTx;

      if (params.verbose && this.txRepo) {
        const sourceTxResult = await this.txRepo.findById(link.sourceTransactionId);
        if (sourceTxResult.isOk() && sourceTxResult.value) {
          sourceTx = sourceTxResult.value;
        }

        const targetTxResult = await this.txRepo.findById(link.targetTransactionId);
        if (targetTxResult.isOk() && targetTxResult.value) {
          targetTx = targetTxResult.value;
        }
      }

      // Format link info (functional core)
      const linkInfo = formatLinkInfo(link, sourceTx, targetTx);
      linkInfos.push(linkInfo);
    }

    // Build result
    const result: LinksViewResult = {
      links: linkInfos,
      count: linkInfos.length,
    };

    return ok(result);
  }

  destroy(): void {
    // No cleanup needed
  }
}
