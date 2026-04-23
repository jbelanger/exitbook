import { type CardanoTransaction, CardanoTransactionSchema } from '@exitbook/blockchain-providers/cardano';
import { err, ok, type Result } from '@exitbook/foundation';

import {
  assembleCardanoLedgerDraft,
  type CardanoLedgerDraft,
  type CardanoProcessorV2Context,
} from './journal-assembler.js';

export class CardanoProcessorV2 {
  async process(
    normalizedData: unknown[],
    context: CardanoProcessorV2Context
  ): Promise<Result<CardanoLedgerDraft[], Error>> {
    const validated: CardanoTransaction[] = [];

    for (let i = 0; i < normalizedData.length; i++) {
      const result = CardanoTransactionSchema.safeParse(normalizedData[i]);
      if (!result.success) {
        const errorDetail = result.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; ');
        return err(new Error(`Input validation failed for cardano v2 item at index ${i}: ${errorDetail}`));
      }

      validated.push(result.data);
    }

    const drafts: CardanoLedgerDraft[] = [];

    for (const transaction of validated) {
      const draftResult = assembleCardanoLedgerDraft(transaction, context);
      if (draftResult.isErr()) {
        return err(new Error(`Cardano v2 assembly failed for ${transaction.id}: ${draftResult.error.message}`));
      }

      drafts.push(draftResult.value);
    }

    return ok(drafts);
  }
}
