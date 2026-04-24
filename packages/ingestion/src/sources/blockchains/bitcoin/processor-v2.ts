import {
  type BitcoinChainConfig,
  type BitcoinTransaction,
  BitcoinTransactionSchema,
} from '@exitbook/blockchain-providers/bitcoin';
import { err, ok, type Result } from '@exitbook/foundation';

import { processLedgerProcessorItems } from '../shared/ledger-processor-v2-utils.js';

import {
  assembleBitcoinLedgerDraft,
  type BitcoinLedgerDraft,
  type BitcoinProcessorV2Context,
} from './journal-assembler.js';

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

    return processLedgerProcessorItems({
      assemble: (transaction) => assembleBitcoinLedgerDraftWithContext(transaction, chainConfig, context),
      buildComparisonMaterial: buildBitcoinTransactionComparisonMaterial,
      conflictLabel: 'Bitcoin v2',
      inputLabel: 'bitcoin v2',
      normalizedData,
      processorLabel: 'Bitcoin v2',
      schema: BitcoinTransactionSchema,
    });
  }
}
