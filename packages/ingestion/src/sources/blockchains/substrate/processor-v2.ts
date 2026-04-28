import {
  type SubstrateChainConfig,
  type SubstrateTransaction,
  SubstrateTransactionSchema,
} from '@exitbook/blockchain-providers/substrate';
import { err, ok, type Result } from '@exitbook/foundation';

import { processGroupedLedgerProcessorItems } from '../shared/ledger-processor-v2-utils.js';

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

    return processGroupedLedgerProcessorItems({
      assemble: (transactions) => assembleSubstrateLedgerDraftWithContext(transactions, chainConfig, context),
      buildComparisonMaterial: buildSubstrateEventComparisonMaterial,
      conflictItemLabel: 'event',
      conflictLabel: 'Substrate v2',
      getDeduplicationKey: (transaction) => transaction.eventId,
      groupItems: groupSubstrateLedgerTransactionsByHash,
      inputLabel: 'substrate v2',
      normalizedData,
      processorLabel: 'Substrate v2',
      schema: SubstrateTransactionSchema,
    });
  }
}
