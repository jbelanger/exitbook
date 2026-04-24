import {
  type BitcoinChainConfig,
  type BitcoinTransaction,
  BitcoinTransactionSchema,
} from '@exitbook/blockchain-providers/bitcoin';
import { err, ok, resultDo, type Result } from '@exitbook/foundation';
import { validateAccountingJournalDraft } from '@exitbook/ledger';

import {
  assembleBitcoinLedgerDraft,
  type BitcoinLedgerDraft,
  type BitcoinProcessorV2Context,
} from './journal-assembler.js';

function parseBitcoinTransactions(normalizedData: unknown[]): Result<BitcoinTransaction[], Error> {
  const transactions: BitcoinTransaction[] = [];

  for (let i = 0; i < normalizedData.length; i++) {
    const result = BitcoinTransactionSchema.safeParse(normalizedData[i]);
    if (!result.success) {
      const errorDetail = result.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; ');
      return err(new Error(`Input validation failed for bitcoin v2 item at index ${i}: ${errorDetail}`));
    }

    transactions.push(result.data);
  }

  return ok(transactions);
}

function buildBitcoinTransactionComparisonMaterial(transaction: BitcoinTransaction): string {
  return JSON.stringify({
    blockHeight: transaction.blockHeight,
    blockId: transaction.blockId,
    currency: transaction.currency,
    feeAmount: transaction.feeAmount,
    feeCurrency: transaction.feeCurrency,
    id: transaction.id,
    inputs: transaction.inputs,
    outputs: transaction.outputs,
    status: transaction.status,
    timestamp: transaction.timestamp,
  });
}

function dedupeBitcoinTransactionsById(
  transactions: readonly BitcoinTransaction[]
): Result<BitcoinTransaction[], Error> {
  const transactionsById = new Map<string, { material: string; transaction: BitcoinTransaction }>();

  for (const transaction of transactions) {
    const material = buildBitcoinTransactionComparisonMaterial(transaction);
    const existing = transactionsById.get(transaction.id);
    if (!existing) {
      transactionsById.set(transaction.id, { material, transaction });
      continue;
    }

    if (existing.material !== material) {
      return err(new Error(`Bitcoin v2 received conflicting normalized payloads for transaction ${transaction.id}`));
    }
  }

  return ok([...transactionsById.values()].map((entry) => entry.transaction));
}

function assembleBitcoinLedgerDraftWithContext(
  transaction: BitcoinTransaction,
  chainConfig: BitcoinChainConfig,
  context: BitcoinProcessorV2Context
): Result<BitcoinLedgerDraft, Error> {
  const draftResult = assembleBitcoinLedgerDraft(transaction, chainConfig, context);
  if (draftResult.isErr()) {
    return err(new Error(`Bitcoin v2 assembly failed for ${transaction.id}: ${draftResult.error.message}`));
  }

  return ok(draftResult.value);
}

function validateBitcoinLedgerDraftJournals(
  transaction: BitcoinTransaction,
  draft: BitcoinLedgerDraft
): Result<void, Error> {
  for (const journal of draft.journals) {
    const validationResult = validateAccountingJournalDraft(journal);
    if (validationResult.isErr()) {
      return err(
        new Error(
          `Bitcoin v2 journal validation failed for ${transaction.id} journal ${journal.journalStableKey}: ${validationResult.error.message}`
        )
      );
    }
  }

  return ok(undefined);
}

export class BitcoinProcessorV2 {
  private readonly chainConfig: BitcoinChainConfig;

  constructor(chainConfig: BitcoinChainConfig) {
    this.chainConfig = chainConfig;
  }

  async process(
    normalizedData: unknown[],
    context: BitcoinProcessorV2Context
  ): Promise<Result<BitcoinLedgerDraft[], Error>> {
    const chainConfig = this.chainConfig;

    return resultDo(function* () {
      const transactions = yield* parseBitcoinTransactions(normalizedData);
      const uniqueTransactions = yield* dedupeBitcoinTransactionsById(transactions);
      const drafts: BitcoinLedgerDraft[] = [];

      for (const transaction of uniqueTransactions) {
        const draft = yield* assembleBitcoinLedgerDraftWithContext(transaction, chainConfig, context);
        yield* validateBitcoinLedgerDraftJournals(transaction, draft);
        drafts.push(draft);
      }

      return drafts;
    });
  }
}
