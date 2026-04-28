import { type EvmTransaction, EvmTransactionSchema } from '@exitbook/blockchain-providers/evm';
import { err, ok, type Result } from '@exitbook/foundation';

import { processGroupedLedgerProcessorItems } from '../shared/ledger-processor-v2-utils.js';

import type { AccountBasedLedgerChainConfig } from './journal-assembler-types.js';
import {
  assembleEvmLedgerDraft,
  type EvmLedgerDraft,
  type EvmProcessorV2Context,
  groupEvmLedgerTransactionsByHash,
} from './journal-assembler.js';

export interface EvmProcessorV2TokenMetadata {
  decimals?: number | undefined;
  symbol?: string | undefined;
}

export interface EvmProcessorV2TokenMetadataResolver {
  getTokenMetadata(
    chainName: string,
    contractAddresses: readonly string[]
  ): Promise<Result<Map<string, EvmProcessorV2TokenMetadata | undefined>, Error>>;
}

export interface EvmProcessorV2Options {
  tokenMetadataResolver?: EvmProcessorV2TokenMetadataResolver | undefined;
}

function buildEvmEventComparisonMaterial(transaction: EvmTransaction): string {
  return JSON.stringify({
    amount: transaction.amount,
    blockHeight: transaction.blockHeight,
    blockId: transaction.blockId,
    currency: transaction.currency,
    eventId: transaction.eventId,
    feeAmount: transaction.feeAmount,
    feeCurrency: transaction.feeCurrency,
    from: transaction.from,
    functionName: transaction.functionName,
    gasPrice: transaction.gasPrice,
    gasUsed: transaction.gasUsed,
    id: transaction.id,
    inputData: transaction.inputData,
    logIndex: transaction.logIndex,
    methodId: transaction.methodId,
    providerName: transaction.providerName,
    status: transaction.status,
    timestamp: transaction.timestamp,
    to: transaction.to,
    tokenAddress: transaction.tokenAddress,
    tokenDecimals: transaction.tokenDecimals,
    tokenSymbol: transaction.tokenSymbol,
    tokenType: transaction.tokenType,
    traceId: transaction.traceId,
    type: transaction.type,
    validatorIndex: transaction.validatorIndex,
    withdrawalIndex: transaction.withdrawalIndex,
  });
}

async function enrichEvmTokenMetadata(
  transactions: readonly EvmTransaction[],
  chainConfig: AccountBasedLedgerChainConfig,
  resolver: EvmProcessorV2TokenMetadataResolver | undefined
): Promise<Result<EvmTransaction[], Error>> {
  if (!resolver) {
    return ok([...transactions]);
  }

  const tokenAddresses = [
    ...new Set(
      transactions
        .map((transaction) => transaction.tokenAddress?.toLowerCase())
        .filter((tokenAddress): tokenAddress is string => tokenAddress !== undefined && tokenAddress.length > 0)
    ),
  ];
  if (tokenAddresses.length === 0) {
    return ok([...transactions]);
  }

  const metadataResult = await resolver.getTokenMetadata(chainConfig.chainName, tokenAddresses);
  if (metadataResult.isErr()) {
    return err(new Error(`EVM v2 token metadata enrichment failed: ${metadataResult.error.message}`));
  }

  return ok(
    transactions.map((transaction) => {
      const tokenAddress = transaction.tokenAddress?.toLowerCase();
      const metadata = tokenAddress ? metadataResult.value.get(tokenAddress) : undefined;
      if (!metadata) {
        return transaction;
      }

      return {
        ...transaction,
        ...(metadata.symbol ? { currency: metadata.symbol, tokenSymbol: metadata.symbol } : {}),
        ...(metadata.decimals !== undefined && transaction.tokenDecimals === undefined
          ? { tokenDecimals: metadata.decimals }
          : {}),
      };
    })
  );
}

function assembleEvmLedgerDraftWithContext(
  transactions: readonly EvmTransaction[],
  chainConfig: AccountBasedLedgerChainConfig,
  context: EvmProcessorV2Context
): Result<EvmLedgerDraft, Error> {
  const hash = transactions[0]?.id ?? '<empty>';
  const draftResult = assembleEvmLedgerDraft(transactions, chainConfig, context);
  if (draftResult.isErr()) {
    return err(new Error(`EVM v2 assembly failed for ${hash}: ${draftResult.error.message}`));
  }

  return ok(draftResult.value);
}

export class EvmProcessorV2 {
  private readonly chainConfig: AccountBasedLedgerChainConfig;
  private readonly tokenMetadataResolver: EvmProcessorV2TokenMetadataResolver | undefined;

  constructor(chainConfig: AccountBasedLedgerChainConfig, options: EvmProcessorV2Options = {}) {
    this.chainConfig = chainConfig;
    this.tokenMetadataResolver = options.tokenMetadataResolver;
  }

  async process(normalizedData: unknown[], context: EvmProcessorV2Context): Promise<Result<EvmLedgerDraft[], Error>> {
    const chainConfig = this.chainConfig;
    const tokenMetadataResolver = this.tokenMetadataResolver;

    return processGroupedLedgerProcessorItems({
      assemble: (transactions) => assembleEvmLedgerDraftWithContext(transactions, chainConfig, context),
      buildComparisonMaterial: buildEvmEventComparisonMaterial,
      conflictItemLabel: 'event',
      conflictLabel: 'EVM v2',
      getDeduplicationKey: (transaction) => transaction.eventId,
      groupItems: groupEvmLedgerTransactionsByHash,
      inputLabel: 'evm v2',
      normalizedData,
      prepareItems: (transactions) => enrichEvmTokenMetadata(transactions, chainConfig, tokenMetadataResolver),
      processorLabel: 'EVM v2',
      schema: EvmTransactionSchema,
    });
  }
}
