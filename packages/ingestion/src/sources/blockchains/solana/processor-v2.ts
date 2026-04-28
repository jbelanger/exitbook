import {
  type SolanaChainConfig,
  type SolanaTransaction,
  SolanaTransactionSchema,
} from '@exitbook/blockchain-providers/solana';
import { err, ok, type Result } from '@exitbook/foundation';

import { processGroupedLedgerProcessorItems } from '../shared/ledger-processor-v2-utils.js';

import {
  assembleSolanaLedgerDraft,
  groupSolanaLedgerTransactionsByHash,
  type SolanaLedgerDraft,
  type SolanaLedgerAssemblyOptions,
  type SolanaProcessorV2Context,
} from './journal-assembler.js';
import { buildSolanaStakingWithdrawalAllocations } from './staking-withdrawal-allocation.js';
import type { SolanaStakingWithdrawalAllocation } from './types.js';

export interface SolanaProcessorV2TokenMetadata {
  decimals?: number | undefined;
  symbol?: string | undefined;
}

export interface SolanaProcessorV2TokenMetadataResolver {
  getTokenMetadata(
    chainName: string,
    tokenAddresses: readonly string[]
  ): Promise<Result<Map<string, SolanaProcessorV2TokenMetadata | undefined>, Error>>;
}

export interface SolanaProcessorV2Options {
  tokenMetadataResolver?: SolanaProcessorV2TokenMetadataResolver | undefined;
}

function buildSolanaEventComparisonMaterial(transaction: SolanaTransaction): string {
  return JSON.stringify(transaction);
}

async function enrichSolanaTokenMetadata(
  transactions: readonly SolanaTransaction[],
  chainConfig: SolanaChainConfig,
  resolver: SolanaProcessorV2TokenMetadataResolver | undefined
): Promise<Result<SolanaTransaction[], Error>> {
  if (!resolver) {
    return ok([...transactions]);
  }

  const tokenAddresses = [
    ...new Set(
      transactions
        .flatMap((transaction) => transaction.tokenChanges?.map((change) => change.mint) ?? [])
        .filter((tokenAddress) => tokenAddress.trim().length > 0)
    ),
  ];
  if (tokenAddresses.length === 0) {
    return ok([...transactions]);
  }

  const metadataResult = await resolver.getTokenMetadata(chainConfig.chainName, tokenAddresses);
  if (metadataResult.isErr()) {
    return err(new Error(`Solana v2 token metadata enrichment failed: ${metadataResult.error.message}`));
  }

  return ok(
    transactions.map((transaction) => {
      if (transaction.tokenChanges === undefined) {
        return transaction;
      }

      return {
        ...transaction,
        tokenChanges: transaction.tokenChanges.map((change) => {
          const metadata = metadataResult.value.get(change.mint);
          if (!metadata) {
            return change;
          }

          return {
            ...change,
            ...(metadata.symbol ? { symbol: metadata.symbol } : {}),
            ...(metadata.decimals === undefined ? {} : { decimals: metadata.decimals }),
          };
        }),
      };
    })
  );
}

function assembleSolanaLedgerDraftWithContext(
  transactions: readonly SolanaTransaction[],
  chainConfig: SolanaChainConfig,
  context: SolanaProcessorV2Context,
  options: SolanaLedgerAssemblyOptions = {}
): Result<SolanaLedgerDraft, Error> {
  const hash = transactions[0]?.id ?? '<empty>';
  const draftResult = assembleSolanaLedgerDraft(transactions, chainConfig, context, options);
  if (draftResult.isErr()) {
    return err(new Error(`Solana v2 assembly failed for ${hash}: ${draftResult.error.message}`));
  }

  return ok(draftResult.value);
}

export class SolanaProcessorV2 {
  private readonly chainConfig: SolanaChainConfig;
  private readonly tokenMetadataResolver: SolanaProcessorV2TokenMetadataResolver | undefined;

  constructor(chainConfig: SolanaChainConfig, options: SolanaProcessorV2Options = {}) {
    this.chainConfig = chainConfig;
    this.tokenMetadataResolver = options.tokenMetadataResolver;
  }

  async process(
    normalizedData: unknown[],
    context: SolanaProcessorV2Context
  ): Promise<Result<SolanaLedgerDraft[], Error>> {
    const chainConfig = this.chainConfig;
    const tokenMetadataResolver = this.tokenMetadataResolver;
    let stakingWithdrawalAllocations: ReadonlyMap<string, SolanaStakingWithdrawalAllocation> = new Map();

    return processGroupedLedgerProcessorItems({
      assemble: (transactions) =>
        assembleSolanaLedgerDraftWithContext(transactions, chainConfig, context, {
          stakingWithdrawalAllocation: stakingWithdrawalAllocations.get(transactions[0]?.id ?? ''),
        }),
      buildComparisonMaterial: buildSolanaEventComparisonMaterial,
      conflictItemLabel: 'event',
      conflictLabel: 'Solana v2',
      getDeduplicationKey: (transaction) => transaction.eventId,
      groupItems: groupSolanaLedgerTransactionsByHash,
      inputLabel: 'solana v2',
      normalizedData,
      prepareItems: async (transactions) => {
        const enrichedResult = await enrichSolanaTokenMetadata(transactions, chainConfig, tokenMetadataResolver);
        if (enrichedResult.isErr()) {
          return err(enrichedResult.error);
        }

        const allocationResult = buildSolanaStakingWithdrawalAllocations({
          transactions: enrichedResult.value,
          userAddresses: [...context.userAddresses, context.primaryAddress],
        });
        if (allocationResult.isErr()) {
          return err(allocationResult.error);
        }

        stakingWithdrawalAllocations = allocationResult.value;

        return ok(enrichedResult.value);
      },
      processorLabel: 'Solana v2',
      schema: SolanaTransactionSchema,
    });
  }
}
