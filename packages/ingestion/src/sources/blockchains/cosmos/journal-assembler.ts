import { type CosmosChainConfig, type CosmosTransaction } from '@exitbook/blockchain-providers/cosmos';
import { err, resultDo, type Result } from '@exitbook/foundation';
import { computeSourceActivityFingerprint, type SourceActivityDraft } from '@exitbook/ledger';

import { validateLedgerProcessorAccountContext } from '../shared/ledger-assembler-utils.js';

import { validateCosmosChainConfig, validateCosmosTransactionAmounts } from './journal-assembler-amounts.js';
import { buildCosmosJournals } from './journal-assembler-journals.js';
import { buildCosmosValuePostings, buildOptionalCosmosNetworkFeePosting } from './journal-assembler-postings.js';
import type {
  CosmosLedgerDraft,
  CosmosProcessorV2Context,
  CosmosProcessorV2ValidatedContext,
  CosmosTransactionGroup,
} from './journal-assembler-types.js';

export type { CosmosLedgerDraft, CosmosProcessorV2Context } from './journal-assembler-types.js';

function validateCosmosProcessorV2Context(
  context: CosmosProcessorV2Context
): Result<CosmosProcessorV2ValidatedContext, Error> {
  return resultDo(function* () {
    yield* validateLedgerProcessorAccountContext(context.account, 'Cosmos v2');
    const primaryAddress = context.primaryAddress.trim().toLowerCase();
    if (primaryAddress === '') {
      return yield* err(new Error('Cosmos v2 primary address must not be empty'));
    }

    const userAddresses = [...new Set(context.userAddresses.map((address) => address.trim().toLowerCase()))].filter(
      (address) => address.length > 0
    );
    if (userAddresses.length === 0) {
      return yield* err(new Error('Cosmos v2 user address scope must contain at least one address'));
    }

    if (!userAddresses.includes(primaryAddress)) {
      userAddresses.push(primaryAddress);
    }

    return {
      primaryAddress,
      userAddresses,
    };
  });
}

function computeCosmosSourceActivityFingerprint(params: {
  chainConfig: CosmosChainConfig;
  context: CosmosProcessorV2Context;
  transactionHash: string;
}): Result<string, Error> {
  return computeSourceActivityFingerprint({
    accountFingerprint: params.context.account.fingerprint,
    platformKey: params.chainConfig.chainName,
    platformKind: 'blockchain',
    sourceActivityOrigin: 'provider_event',
    sourceActivityStableKey: params.transactionHash,
  });
}

function buildCosmosSourceActivityDraft(params: {
  chainConfig: CosmosChainConfig;
  context: CosmosProcessorV2Context;
  primaryTransaction: CosmosTransaction;
  sourceActivityFingerprint: string;
}): SourceActivityDraft {
  const activityAddresses = resolveCosmosSourceActivityAddresses(params.primaryTransaction, params.context);

  return {
    ownerAccountId: params.context.account.id,
    sourceActivityOrigin: 'provider_event',
    sourceActivityStableKey: params.primaryTransaction.id,
    sourceActivityFingerprint: params.sourceActivityFingerprint,
    platformKey: params.chainConfig.chainName,
    platformKind: 'blockchain',
    activityStatus: params.primaryTransaction.status,
    activityDatetime: new Date(params.primaryTransaction.timestamp).toISOString(),
    activityTimestampMs: params.primaryTransaction.timestamp,
    fromAddress: activityAddresses.fromAddress,
    toAddress: activityAddresses.toAddress,
    blockchainName: params.chainConfig.chainName,
    ...(params.primaryTransaction.blockHeight === undefined
      ? {}
      : { blockchainBlockHeight: params.primaryTransaction.blockHeight }),
    blockchainTransactionHash: params.primaryTransaction.id,
    blockchainIsConfirmed: params.primaryTransaction.status === 'success',
  };
}

function resolveCosmosSourceActivityAddresses(
  transaction: CosmosTransaction,
  context: CosmosProcessorV2Context
): { fromAddress: string; toAddress: string } {
  switch (transaction.txType) {
    case 'staking_delegate':
      return {
        fromAddress: context.primaryAddress,
        toAddress: transaction.stakingValidatorAddress ?? transaction.to,
      };
    case 'staking_redelegate':
      return {
        fromAddress: transaction.stakingValidatorAddress ?? transaction.from,
        toAddress: transaction.stakingDestinationValidatorAddress ?? transaction.to,
      };
    case 'staking_undelegate':
    case 'staking_reward':
      return {
        fromAddress: transaction.stakingValidatorAddress ?? transaction.from,
        toAddress: context.primaryAddress,
      };
    default:
      return {
        fromAddress: transaction.from,
        toAddress: transaction.to,
      };
  }
}

export function groupCosmosLedgerTransactionsByHash(
  transactions: readonly CosmosTransaction[]
): Map<string, CosmosTransaction[]> {
  const groups = new Map<string, CosmosTransaction[]>();

  for (const transaction of transactions) {
    const existing = groups.get(transaction.id);
    if (existing) {
      existing.push(transaction);
    } else {
      groups.set(transaction.id, [transaction]);
    }
  }

  return groups;
}

export function assembleCosmosLedgerDraft(
  transactions: CosmosTransactionGroup,
  chainConfig: CosmosChainConfig,
  context: CosmosProcessorV2Context
): Result<CosmosLedgerDraft, Error> {
  return resultDo(function* () {
    if (transactions.length === 0) {
      return yield* err(new Error('Cosmos v2 cannot assemble an empty transaction group'));
    }

    yield* validateCosmosChainConfig(chainConfig);
    yield* validateCosmosTransactionAmounts(transactions);
    const validatedContext = yield* validateCosmosProcessorV2Context(context);
    const primaryTransaction = transactions[0]!;
    const sourceActivityFingerprint = yield* computeCosmosSourceActivityFingerprint({
      chainConfig,
      context,
      transactionHash: primaryTransaction.id,
    });
    const valuePostings = yield* buildCosmosValuePostings({
      chainConfig,
      context: validatedContext,
      sourceActivityFingerprint,
      transactions,
    });
    const feePosting = yield* buildOptionalCosmosNetworkFeePosting({
      chainConfig,
      context: validatedContext,
      sourceActivityFingerprint,
      transactions,
    });
    const journals = buildCosmosJournals({
      feePosting,
      sourceActivityFingerprint,
      valuePostings,
    });
    const sourceActivity = buildCosmosSourceActivityDraft({
      chainConfig,
      context,
      primaryTransaction,
      sourceActivityFingerprint,
    });

    return {
      sourceActivity,
      journals,
    };
  });
}
