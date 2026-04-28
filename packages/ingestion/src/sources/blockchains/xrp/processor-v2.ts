import { type XrpChainConfig, type XrpTransaction, XrpTransactionSchema } from '@exitbook/blockchain-providers/xrp';
import { err, ok, type Result } from '@exitbook/foundation';

import { processGroupedLedgerProcessorItems } from '../shared/ledger-processor-v2-utils.js';

import {
  assembleXrpLedgerDraft,
  groupXrpLedgerTransactionsByHash,
  type XrpLedgerDraft,
  type XrpProcessorV2Context,
} from './journal-assembler.js';

export type { XrpLedgerDraft, XrpProcessorV2Context } from './journal-assembler.js';

function buildXrpEventComparisonMaterial(transaction: XrpTransaction): string {
  return JSON.stringify(transaction);
}

function assembleXrpLedgerDraftWithContext(
  transactions: readonly XrpTransaction[],
  chainConfig: XrpChainConfig,
  context: XrpProcessorV2Context
): Result<XrpLedgerDraft, Error> {
  const hash = transactions[0]?.id ?? '<empty>';
  const draftResult = assembleXrpLedgerDraft(transactions, chainConfig, context);
  if (draftResult.isErr()) {
    return err(new Error(`XRP v2 assembly failed for ${hash}: ${draftResult.error.message}`));
  }

  return ok(draftResult.value);
}

export class XrpProcessorV2 {
  private readonly chainConfig: XrpChainConfig;

  constructor(chainConfig: XrpChainConfig) {
    this.chainConfig = chainConfig;
  }

  async process(normalizedData: unknown[], context: XrpProcessorV2Context): Promise<Result<XrpLedgerDraft[], Error>> {
    const chainConfig = this.chainConfig;

    return processGroupedLedgerProcessorItems({
      assemble: (transactions) => assembleXrpLedgerDraftWithContext(transactions, chainConfig, context),
      buildComparisonMaterial: buildXrpEventComparisonMaterial,
      conflictItemLabel: 'event',
      conflictLabel: 'XRP v2',
      getDeduplicationKey: (transaction) => transaction.eventId,
      groupItems: groupXrpLedgerTransactionsByHash,
      inputLabel: 'xrp v2',
      normalizedData,
      processorLabel: 'XRP v2',
      schema: XrpTransactionSchema,
    });
  }
}
