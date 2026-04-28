import { type SubstrateChainConfig, type SubstrateTransaction } from '@exitbook/blockchain-providers/substrate';
import { err, resultDo, type Result } from '@exitbook/foundation';
import {
  computeSourceActivityFingerprint,
  type AccountingDiagnosticDraft,
  type SourceActivityDraft,
} from '@exitbook/ledger';

import { validateLedgerProcessorAccountContext } from '../shared/ledger-assembler-utils.js';

import { validateSubstrateChainConfig, validateSubstrateTransactionAmounts } from './journal-assembler-amounts.js';
import { buildSubstrateJournals } from './journal-assembler-journals.js';
import {
  buildOptionalSubstrateNetworkFeePosting,
  buildSubstrateValuePostings,
  hasSubstrateProtocolEvent,
} from './journal-assembler-postings.js';
import type {
  SubstrateLedgerDraft,
  SubstrateProcessorV2Context,
  SubstrateProcessorV2ValidatedContext,
  SubstrateTransactionGroup,
} from './journal-assembler-types.js';

export type {
  SubstrateLedgerDraft,
  SubstrateProcessorV2AccountContext,
  SubstrateProcessorV2Context,
} from './journal-assembler-types.js';

function validateSubstrateProcessorV2Context(
  context: SubstrateProcessorV2Context
): Result<SubstrateProcessorV2ValidatedContext, Error> {
  return resultDo(function* () {
    yield* validateLedgerProcessorAccountContext(context.account, 'Substrate v2');
    const primaryAddress = context.primaryAddress.trim();
    if (primaryAddress === '') {
      return yield* err(new Error('Substrate v2 primary address must not be empty'));
    }

    const userAddresses = [...new Set(context.userAddresses.map((address) => address.trim()))].filter(
      (address) => address.length > 0
    );
    if (userAddresses.length === 0) {
      return yield* err(new Error('Substrate v2 user address scope must contain at least one address'));
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

function computeSubstrateSourceActivityFingerprint(params: {
  chainConfig: SubstrateChainConfig;
  context: SubstrateProcessorV2Context;
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

function buildSubstrateSourceActivityDraft(params: {
  chainConfig: SubstrateChainConfig;
  context: SubstrateProcessorV2Context;
  primaryTransaction: SubstrateTransaction;
  sourceActivityFingerprint: string;
}): SourceActivityDraft {
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
    fromAddress: params.primaryTransaction.from,
    toAddress: params.primaryTransaction.to,
    blockchainName: params.chainConfig.chainName,
    ...(params.primaryTransaction.blockHeight === undefined
      ? {}
      : { blockchainBlockHeight: params.primaryTransaction.blockHeight }),
    blockchainTransactionHash: params.primaryTransaction.id,
    blockchainIsConfirmed: params.primaryTransaction.status === 'success',
  };
}

function buildSubstrateDiagnostics(transactions: readonly SubstrateTransaction[]): AccountingDiagnosticDraft[] {
  const diagnostics: AccountingDiagnosticDraft[] = [];

  if (transactions.some((transaction) => transaction.module === 'utility' && transaction.call?.includes('batch'))) {
    diagnostics.push({
      code: 'substrate_utility_batch',
      message: 'Substrate utility batch transaction may contain multiple protocol or balance operations.',
      severity: 'warning',
    });
  }

  if (transactions.some((transaction) => transaction.module === 'proxy')) {
    diagnostics.push({
      code: 'substrate_proxy',
      message: 'Substrate proxy transaction executed through delegated authority.',
      severity: 'info',
    });
  }

  if (transactions.some((transaction) => transaction.module === 'multisig')) {
    diagnostics.push({
      code: 'substrate_multisig',
      message: 'Substrate multisig transaction required multiple approvals.',
      severity: 'info',
    });
  }

  return diagnostics;
}

export function groupSubstrateLedgerTransactionsByHash(
  transactions: SubstrateTransactionGroup
): Map<string, SubstrateTransaction[]> {
  const groups = new Map<string, SubstrateTransaction[]>();

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

export function assembleSubstrateLedgerDraft(
  transactions: SubstrateTransactionGroup,
  chainConfig: SubstrateChainConfig,
  context: SubstrateProcessorV2Context
): Result<SubstrateLedgerDraft, Error> {
  return resultDo(function* () {
    if (transactions.length === 0) {
      return yield* err(new Error('Substrate v2 cannot assemble an empty transaction group'));
    }

    yield* validateSubstrateChainConfig(chainConfig);
    yield* validateSubstrateTransactionAmounts(transactions, chainConfig);
    const validatedContext = yield* validateSubstrateProcessorV2Context(context);
    const transactionHash = transactions[0]!.id;
    const primaryTransaction = transactions[0]!;
    const sourceActivityFingerprint = yield* computeSubstrateSourceActivityFingerprint({
      chainConfig,
      context,
      transactionHash,
    });
    const valuePostings = yield* buildSubstrateValuePostings({
      chainConfig,
      context: validatedContext,
      sourceActivityFingerprint,
      transactions,
    });
    const feePosting = yield* buildOptionalSubstrateNetworkFeePosting({
      chainConfig,
      context: validatedContext,
      sourceActivityFingerprint,
      transactions,
    });
    const journals = buildSubstrateJournals({
      diagnostics: buildSubstrateDiagnostics(transactions),
      feePosting,
      isProtocolEvent: hasSubstrateProtocolEvent(transactions),
      sourceActivityFingerprint,
      valuePostings,
    });
    const sourceActivity = buildSubstrateSourceActivityDraft({
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
