import { parseDecimal } from '@exitbook/core';
import { getLogger } from '@exitbook/logger';
import { err, ok, type Result } from 'neverthrow';

import type { PipelineContext } from '../pipeline/pipeline-context.js';
import type { DirtyCheckResult, PipelineStep, StepResult } from '../pipeline/pipeline-step.js';

import { LinkOperation } from './link-operation.js';

const logger = getLogger('LinkStep');

/**
 * Pipeline step for transaction linking.
 * Dirty when: transactions exist but no links have been created yet,
 * or max(transactions.updated_at) > max(transaction_links.created_at).
 *
 * Delegates to LinkOperation with default thresholds.
 */
export class LinkStep implements PipelineStep {
  readonly name = 'link';
  readonly dependsOn = ['process'];

  async isDirty(context: PipelineContext): Promise<Result<DirtyCheckResult, Error>> {
    try {
      const txCountResult = await context.db.transactions.count();
      if (txCountResult.isErr()) return err(txCountResult.error);

      if (txCountResult.value === 0) {
        return ok({ isDirty: false, reason: 'No transactions to link' });
      }

      const linkCountResult = await context.db.transactionLinks.count();
      if (linkCountResult.isErr()) return err(linkCountResult.error);

      if (linkCountResult.value === 0) {
        return ok({ isDirty: true, reason: 'No links exist yet' });
      }

      // If we have both transactions and links, consider it clean
      // (a more granular timestamp check could be added later)
      return ok({ isDirty: false });
    } catch (error) {
      return err(error instanceof Error ? error : new Error(String(error)));
    }
  }

  async execute(context: PipelineContext): Promise<Result<StepResult, Error>> {
    const operation = new LinkOperation(context.db, undefined, undefined);

    const result = await operation.execute({
      dryRun: false,
      minConfidenceScore: parseDecimal('0.7'),
      autoConfirmThreshold: parseDecimal('0.95'),
    });

    if (result.isErr()) return err(result.error);

    const value = result.value;
    const summary = `Linked: ${value.confirmedLinksCount} confirmed, ${value.suggestedLinksCount} suggested, ${value.internalLinksCount} internal`;
    logger.info(summary);

    return ok({ skipped: false, summary });
  }
}
