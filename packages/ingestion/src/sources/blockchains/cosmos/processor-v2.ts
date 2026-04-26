import {
  type CosmosChainConfig,
  type CosmosTransaction,
  CosmosTransactionSchema,
} from '@exitbook/blockchain-providers/cosmos';
import { err, ok, resultDoAsync, type Result } from '@exitbook/foundation';

import {
  parseLedgerProcessorItems,
  validateLedgerProcessorDraftJournals,
} from '../shared/ledger-processor-v2-utils.js';

import {
  assembleCosmosLedgerDraft,
  type CosmosLedgerDraft,
  type CosmosProcessorV2Context,
  groupCosmosLedgerTransactionsByHash,
} from './journal-assembler.js';

export type { CosmosLedgerDraft, CosmosProcessorV2Context } from './journal-assembler.js';

function buildCosmosEventComparisonMaterial(transaction: CosmosTransaction): string {
  return JSON.stringify({
    amount: transaction.amount,
    blockHeight: transaction.blockHeight,
    blockId: transaction.blockId,
    bridgeType: transaction.bridgeType,
    currency: transaction.currency,
    eventId: transaction.eventId,
    feeAmount: transaction.feeAmount,
    feeCurrency: transaction.feeCurrency,
    from: transaction.from,
    gasPrice: transaction.gasPrice,
    gasUsed: transaction.gasUsed,
    gasWanted: transaction.gasWanted,
    id: transaction.id,
    messageType: transaction.messageType,
    providerName: transaction.providerName,
    sourceChannel: transaction.sourceChannel,
    sourcePort: transaction.sourcePort,
    stakingDestinationValidatorAddress: transaction.stakingDestinationValidatorAddress,
    stakingPrincipalAmount: transaction.stakingPrincipalAmount,
    stakingPrincipalCurrency: transaction.stakingPrincipalCurrency,
    stakingPrincipalDenom: transaction.stakingPrincipalDenom,
    stakingValidatorAddress: transaction.stakingValidatorAddress,
    status: transaction.status,
    timestamp: transaction.timestamp,
    to: transaction.to,
    tokenAddress: transaction.tokenAddress,
    tokenDecimals: transaction.tokenDecimals,
    tokenSymbol: transaction.tokenSymbol,
    tokenType: transaction.tokenType,
    txType: transaction.txType,
  });
}

function dedupeCosmosTransactionsByEventId(
  transactions: readonly CosmosTransaction[]
): Result<CosmosTransaction[], Error> {
  const transactionsByEventId = new Map<string, { material: string; transaction: CosmosTransaction }>();

  for (const transaction of transactions) {
    const material = buildCosmosEventComparisonMaterial(transaction);
    const existing = transactionsByEventId.get(transaction.eventId);
    if (!existing) {
      transactionsByEventId.set(transaction.eventId, { material, transaction });
      continue;
    }

    if (existing.material !== material) {
      return err(new Error(`Cosmos v2 received conflicting normalized payloads for event ${transaction.eventId}`));
    }
  }

  return ok([...transactionsByEventId.values()].map((entry) => entry.transaction));
}

function assembleCosmosLedgerDraftWithContext(
  transactions: readonly CosmosTransaction[],
  chainConfig: CosmosChainConfig,
  context: CosmosProcessorV2Context
): Result<CosmosLedgerDraft, Error> {
  const hash = transactions[0]?.id ?? '<empty>';
  const draftResult = assembleCosmosLedgerDraft(transactions, chainConfig, context);
  if (draftResult.isErr()) {
    return err(new Error(`Cosmos v2 assembly failed for ${hash}: ${draftResult.error.message}`));
  }

  return ok(draftResult.value);
}

export class CosmosProcessorV2 {
  private readonly chainConfig: CosmosChainConfig;

  constructor(chainConfig: CosmosChainConfig) {
    this.chainConfig = chainConfig;
  }

  async process(
    normalizedData: unknown[],
    context: CosmosProcessorV2Context
  ): Promise<Result<CosmosLedgerDraft[], Error>> {
    const chainConfig = this.chainConfig;

    return resultDoAsync(async function* () {
      const parsedTransactions = yield* parseLedgerProcessorItems({
        inputLabel: 'cosmos v2',
        normalizedData,
        schema: CosmosTransactionSchema,
      });
      const uniqueTransactions = yield* dedupeCosmosTransactionsByEventId(parsedTransactions);
      const transactionGroups = groupCosmosLedgerTransactionsByHash(uniqueTransactions);
      const drafts: CosmosLedgerDraft[] = [];

      for (const [hash, transactions] of transactionGroups) {
        const draft = yield* assembleCosmosLedgerDraftWithContext(transactions, chainConfig, context);
        if (draft.journals.length === 0) {
          continue;
        }

        yield* validateLedgerProcessorDraftJournals({
          draft,
          processorLabel: 'Cosmos v2',
          transaction: { id: hash },
        });
        drafts.push(draft);
      }

      return drafts;
    });
  }
}
