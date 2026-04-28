import {
  type CosmosChainConfig,
  type CosmosTransaction,
  CosmosTransactionSchema,
} from '@exitbook/blockchain-providers/cosmos';
import { err, ok, type Result } from '@exitbook/foundation';

import { processGroupedLedgerProcessorItems } from '../shared/ledger-processor-v2-utils.js';

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

    return processGroupedLedgerProcessorItems({
      assemble: (transactions) => assembleCosmosLedgerDraftWithContext(transactions, chainConfig, context),
      buildComparisonMaterial: buildCosmosEventComparisonMaterial,
      conflictItemLabel: 'event',
      conflictLabel: 'Cosmos v2',
      getDeduplicationKey: (transaction) => transaction.eventId,
      groupItems: groupCosmosLedgerTransactionsByHash,
      inputLabel: 'cosmos v2',
      normalizedData,
      processorLabel: 'Cosmos v2',
      schema: CosmosTransactionSchema,
    });
  }
}
