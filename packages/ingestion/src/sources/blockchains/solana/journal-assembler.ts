import { type SolanaChainConfig, type SolanaTransaction } from '@exitbook/blockchain-providers/solana';
import { err, ok, resultDo, type Result } from '@exitbook/foundation';
import { computeSourceActivityFingerprint, type SourceActivityDraft } from '@exitbook/ledger';

import { validateLedgerProcessorAccountContext } from '../shared/ledger-assembler-utils.js';

import { buildSolanaDiagnostics, buildSolanaJournals } from './journal-assembler-journals.js';
import { buildOptionalSolanaNetworkFeePosting, buildSolanaValuePostings } from './journal-assembler-postings.js';
import type {
  SolanaLedgerDraft,
  SolanaPostingBuildContext,
  SolanaProcessorV2Context,
  SolanaProcessorV2ValidatedContext,
  SolanaTransactionGroup,
} from './journal-assembler-types.js';
import {
  analyzeSolanaFundFlow,
  buildSolanaUnsolicitedDustFanoutDiagnostic,
  classifySolanaOperationFromFundFlow,
} from './processor-utils.js';
import type { SolanaFundFlow } from './types.js';

export type {
  SolanaLedgerDraft,
  SolanaProcessorV2AccountContext,
  SolanaProcessorV2Context,
} from './journal-assembler-types.js';

function validateSolanaChainConfig(chainConfig: SolanaChainConfig): Result<void, Error> {
  if (chainConfig.chainName.trim() === '') {
    return err(new Error('Solana v2 chain name must not be empty'));
  }

  if (chainConfig.nativeCurrency.trim() === '') {
    return err(new Error(`Solana v2 chain ${chainConfig.chainName} native currency must not be empty`));
  }

  if (!Number.isInteger(chainConfig.nativeDecimals) || chainConfig.nativeDecimals < 0) {
    return err(
      new Error(
        `Solana v2 chain ${chainConfig.chainName} native decimals must be a non-negative integer, got ${chainConfig.nativeDecimals}`
      )
    );
  }

  return validateSolanaChainName(chainConfig.chainName);
}

function validateSolanaChainName(chainName: string): Result<void, Error> {
  return chainName === 'solana' ? ok(undefined) : err(new Error(`Unsupported Solana v2 chain ${chainName}`));
}

function validateSolanaProcessorV2Context(
  context: SolanaProcessorV2Context
): Result<SolanaProcessorV2ValidatedContext, Error> {
  return resultDo(function* () {
    yield* validateLedgerProcessorAccountContext(context.account, 'Solana v2');
    const primaryAddress = context.primaryAddress.trim();
    if (primaryAddress === '') {
      return yield* err(new Error('Solana v2 primary address must not be empty'));
    }

    const userAddresses = [...new Set(context.userAddresses.map((address) => address.trim()))].filter(
      (address) => address.length > 0
    );
    if (!userAddresses.includes(primaryAddress)) {
      userAddresses.push(primaryAddress);
    }
    if (userAddresses.length === 0) {
      return yield* err(new Error('Solana v2 user address scope must contain at least one address'));
    }

    return {
      primaryAddress,
      userAddresses,
    };
  });
}

function computeSolanaSourceActivityFingerprint(params: {
  chainConfig: SolanaChainConfig;
  context: SolanaProcessorV2Context;
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

function buildSolanaSourceActivityDraft(params: {
  chainConfig: SolanaChainConfig;
  context: SolanaProcessorV2Context;
  fundFlow: SolanaFundFlow;
  sourceActivityFingerprint: string;
  transaction: SolanaTransaction;
}): SourceActivityDraft {
  const blockHeight = params.transaction.blockHeight ?? params.transaction.slot;
  const fromAddress = params.fundFlow.fromAddress ?? params.transaction.feePayer;
  const toAddress = params.fundFlow.toAddress;

  return {
    ownerAccountId: params.context.account.id,
    sourceActivityOrigin: 'provider_event',
    sourceActivityStableKey: params.transaction.id,
    sourceActivityFingerprint: params.sourceActivityFingerprint,
    platformKey: params.chainConfig.chainName,
    platformKind: 'blockchain',
    activityStatus: params.transaction.status,
    activityDatetime: new Date(params.transaction.timestamp).toISOString(),
    activityTimestampMs: params.transaction.timestamp,
    ...(fromAddress === undefined ? {} : { fromAddress }),
    ...(toAddress === undefined ? {} : { toAddress }),
    blockchainName: params.chainConfig.chainName,
    ...(blockHeight === undefined ? {} : { blockchainBlockHeight: blockHeight }),
    blockchainTransactionHash: params.transaction.id,
    blockchainIsConfirmed: params.transaction.status === 'success',
  };
}

export function groupSolanaLedgerTransactionsByHash(
  transactions: SolanaTransactionGroup
): Map<string, SolanaTransaction[]> {
  const groups = new Map<string, SolanaTransaction[]>();

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

export function assembleSolanaLedgerDraft(
  transactions: SolanaTransactionGroup,
  chainConfig: SolanaChainConfig,
  context: SolanaProcessorV2Context
): Result<SolanaLedgerDraft, Error> {
  return resultDo(function* () {
    if (transactions.length === 0) {
      return yield* err(new Error('Solana v2 cannot assemble an empty transaction group'));
    }

    yield* validateSolanaChainConfig(chainConfig);
    const transaction = transactions[0]!;
    if (transactions.some((candidate) => candidate.id !== transaction.id)) {
      return yield* err(new Error(`Solana v2 received mixed transaction hashes in group ${transaction.id}`));
    }

    const validatedContext = yield* validateSolanaProcessorV2Context(context);
    const fundFlow = yield* analyzeSolanaFundFlow(transaction, {
      primaryAddress: validatedContext.primaryAddress,
      userAddresses: validatedContext.userAddresses,
    });
    const classification = classifySolanaOperationFromFundFlow(fundFlow, transaction.instructions);
    const unsolicitedDustFanoutDiagnostic = buildSolanaUnsolicitedDustFanoutDiagnostic(transaction, fundFlow);
    const diagnostics = buildSolanaDiagnostics(
      unsolicitedDustFanoutDiagnostic === undefined
        ? classification.diagnostics
        : [...(classification.diagnostics ?? []), unsolicitedDustFanoutDiagnostic]
    );
    const sourceActivityFingerprint = yield* computeSolanaSourceActivityFingerprint({
      chainConfig,
      context,
      transactionHash: transaction.id,
    });
    const postingContext: SolanaPostingBuildContext = {
      fundFlow,
      sourceActivityFingerprint,
      transaction,
    };
    const valuePostings = yield* buildSolanaValuePostings({
      chainConfig,
      classification,
      context: postingContext,
    });
    const feePosting = yield* buildOptionalSolanaNetworkFeePosting({
      chainConfig,
      context: postingContext,
    });
    const journals = buildSolanaJournals({
      diagnostics,
      feePosting,
      sourceActivityFingerprint,
      valuePostings,
    });
    const sourceActivity = buildSolanaSourceActivityDraft({
      chainConfig,
      context,
      fundFlow,
      sourceActivityFingerprint,
      transaction,
    });

    return {
      sourceActivity,
      journals,
    };
  });
}
