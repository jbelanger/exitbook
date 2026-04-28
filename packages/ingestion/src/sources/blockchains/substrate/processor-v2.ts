import {
  type SubstrateChainConfig,
  type SubstrateTransaction,
  SubstrateTransactionSchema,
} from '@exitbook/blockchain-providers/substrate';
import { err, ok, resultDoAsync, type Result } from '@exitbook/foundation';

import {
  parseLedgerProcessorItems,
  validateLedgerProcessorDraftJournals,
} from '../shared/ledger-processor-v2-utils.js';

import {
  assembleSubstrateLedgerDraft,
  groupSubstrateLedgerTransactionsByHash,
  type SubstrateLedgerDraft,
  type SubstrateProcessorV2Context,
} from './journal-assembler.js';

export type { SubstrateLedgerDraft, SubstrateProcessorV2Context } from './journal-assembler.js';

function buildSubstrateEventComparisonMaterial(transaction: SubstrateTransaction): string {
  return JSON.stringify({
    amount: transaction.amount,
    blockHeight: transaction.blockHeight,
    blockId: transaction.blockId,
    call: transaction.call,
    chainName: transaction.chainName,
    currency: transaction.currency,
    eventId: transaction.eventId,
    extrinsicIndex: transaction.extrinsicIndex,
    feeAmount: transaction.feeAmount,
    feeCurrency: transaction.feeCurrency,
    from: transaction.from,
    id: transaction.id,
    module: transaction.module,
    providerName: transaction.providerName,
    status: transaction.status,
    timestamp: transaction.timestamp,
    to: transaction.to,
  });
}

function dedupeSubstrateTransactionsByEventId(
  transactions: readonly SubstrateTransaction[]
): Result<SubstrateTransaction[], Error> {
  const transactionsByEventId = new Map<string, { material: string; transaction: SubstrateTransaction }>();

  for (const transaction of transactions) {
    const material = buildSubstrateEventComparisonMaterial(transaction);
    const existing = transactionsByEventId.get(transaction.eventId);
    if (!existing) {
      transactionsByEventId.set(transaction.eventId, { material, transaction });
      continue;
    }

    if (existing.material !== material) {
      return err(new Error(`Substrate v2 received conflicting normalized payloads for event ${transaction.eventId}`));
    }
  }

  return ok([...transactionsByEventId.values()].map((entry) => entry.transaction));
}

function assembleSubstrateLedgerDraftWithContext(
  transactions: readonly SubstrateTransaction[],
  chainConfig: SubstrateChainConfig,
  context: SubstrateProcessorV2Context
): Result<SubstrateLedgerDraft, Error> {
  const hash = transactions[0]?.id ?? '<empty>';
  const draftResult = assembleSubstrateLedgerDraft(transactions, chainConfig, context);
  if (draftResult.isErr()) {
    return err(new Error(`Substrate v2 assembly failed for ${hash}: ${draftResult.error.message}`));
  }

  return ok(draftResult.value);
}

export class SubstrateProcessorV2 {
  private readonly chainConfig: SubstrateChainConfig;

  constructor(chainConfig: SubstrateChainConfig) {
    this.chainConfig = chainConfig;
  }

  async process(
    normalizedData: unknown[],
    context: SubstrateProcessorV2Context
  ): Promise<Result<SubstrateLedgerDraft[], Error>> {
    const chainConfig = this.chainConfig;

    return resultDoAsync(async function* () {
      const parsedTransactions = yield* parseLedgerProcessorItems({
        inputLabel: 'substrate v2',
        normalizedData,
        schema: SubstrateTransactionSchema,
      });
      const uniqueTransactions = yield* dedupeSubstrateTransactionsByEventId(parsedTransactions);
      const transactionGroups = groupSubstrateLedgerTransactionsByHash(uniqueTransactions);
      const drafts: SubstrateLedgerDraft[] = [];

      for (const [hash, transactions] of transactionGroups) {
        const draft = yield* assembleSubstrateLedgerDraftWithContext(transactions, chainConfig, context);
        if (draft.journals.length === 0) {
          continue;
        }

        yield* validateLedgerProcessorDraftJournals({
          draft,
          processorLabel: 'Substrate v2',
          transaction: { id: hash },
        });
        drafts.push(draft);
      }

      return drafts;
    });
  }
}
