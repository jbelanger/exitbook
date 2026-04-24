import { type EvmTransaction, EvmTransactionSchema } from '@exitbook/blockchain-providers/evm';
import { err, ok, resultDoAsync, type Result } from '@exitbook/foundation';

import {
  parseLedgerProcessorItems,
  validateLedgerProcessorDraftJournals,
} from '../shared/ledger-processor-v2-utils.js';

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

function dedupeEvmTransactionsByEventId(transactions: readonly EvmTransaction[]): Result<EvmTransaction[], Error> {
  const transactionsByEventId = new Map<string, { material: string; transaction: EvmTransaction }>();

  for (const transaction of transactions) {
    const material = buildEvmEventComparisonMaterial(transaction);
    const existing = transactionsByEventId.get(transaction.eventId);
    if (!existing) {
      transactionsByEventId.set(transaction.eventId, { material, transaction });
      continue;
    }

    if (existing.material !== material) {
      return err(new Error(`EVM v2 received conflicting normalized payloads for event ${transaction.eventId}`));
    }
  }

  return ok([...transactionsByEventId.values()].map((entry) => entry.transaction));
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

    return resultDoAsync(async function* () {
      const parsedTransactions = yield* parseLedgerProcessorItems({
        inputLabel: 'evm v2',
        normalizedData,
        schema: EvmTransactionSchema,
      });
      const enrichedTransactions = yield* await enrichEvmTokenMetadata(
        parsedTransactions,
        chainConfig,
        tokenMetadataResolver
      );
      const uniqueTransactions = yield* dedupeEvmTransactionsByEventId(enrichedTransactions);
      const transactionGroups = groupEvmLedgerTransactionsByHash(uniqueTransactions);
      const drafts: EvmLedgerDraft[] = [];

      for (const [hash, transactions] of transactionGroups) {
        const draft = yield* assembleEvmLedgerDraftWithContext(transactions, chainConfig, context);
        if (draft.journals.length === 0) {
          continue;
        }

        yield* validateLedgerProcessorDraftJournals({
          draft,
          processorLabel: 'EVM v2',
          transaction: { id: hash },
        });
        drafts.push(draft);
      }

      return drafts;
    });
  }
}
