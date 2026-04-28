import { type XrpChainConfig, type XrpTransaction } from '@exitbook/blockchain-providers/xrp';
import {
  buildBlockchainNativeAssetId,
  parseCurrency,
  resultDo,
  type Currency,
  type Result,
} from '@exitbook/foundation';
import { err, ok, parseDecimal } from '@exitbook/foundation';
import {
  computeSourceActivityFingerprint,
  type AccountingJournalDraft,
  type AccountingPostingDraft,
  type SourceActivityDraft,
  type SourceComponentQuantityRef,
} from '@exitbook/ledger';
import { Decimal } from 'decimal.js';

import {
  buildSourceComponentQuantityRef,
  parseLedgerDecimalAmount,
  validateLedgerProcessorAccountContext,
} from '../shared/ledger-assembler-utils.js';
import {
  resolveDefaultJournalStableKey,
  resolvePostingDrivenJournalKind,
} from '../shared/ledger-journal-kind-utils.js';

import type {
  XrpJournalAssemblyParts,
  XrpLedgerDraft,
  XrpProcessorV2Context,
  XrpProcessorV2ValidatedContext,
  XrpTransactionGroup,
} from './journal-assembler-types.js';
import { analyzeXrpFundFlow } from './processor-utils.js';
import type { XrpFundFlow } from './types.js';

export type { XrpLedgerDraft, XrpProcessorV2Context } from './journal-assembler-types.js';

interface XrpPostingBuildContext {
  feeAmount: Decimal;
  fundFlow: XrpFundFlow;
  netAmount: Decimal;
  sourceActivityFingerprint: string;
  transaction: XrpTransaction;
}

function validateXrpChainConfig(chainConfig: XrpChainConfig): Result<void, Error> {
  if (chainConfig.chainName.trim() === '') {
    return err(new Error('XRP v2 chain name must not be empty'));
  }

  if (chainConfig.nativeCurrency !== 'XRP') {
    return err(
      new Error(`XRP v2 chain ${chainConfig.chainName} native currency must be XRP, got ${chainConfig.nativeCurrency}`)
    );
  }

  if (chainConfig.nativeDecimals !== 6) {
    return err(
      new Error(`XRP v2 chain ${chainConfig.chainName} native decimals must be 6, got ${chainConfig.nativeDecimals}`)
    );
  }

  return ok(undefined);
}

function validateXrpProcessorV2Context(context: XrpProcessorV2Context): Result<XrpProcessorV2ValidatedContext, Error> {
  return resultDo(function* () {
    yield* validateLedgerProcessorAccountContext(context.account, 'XRP v2');

    const primaryAddress = context.primaryAddress.trim();
    if (primaryAddress === '') {
      return yield* err(new Error('XRP v2 primary address must not be empty'));
    }

    const userAddresses = [...new Set(context.userAddresses.map((address) => address.trim()))].filter(
      (address) => address.length > 0
    );
    if (!userAddresses.includes(primaryAddress)) {
      userAddresses.push(primaryAddress);
    }
    if (userAddresses.length === 0) {
      return yield* err(new Error('XRP v2 user address scope must contain at least one address'));
    }

    return {
      primaryAddress,
      userAddresses,
    };
  });
}

function computeXrpSourceActivityFingerprint(params: {
  chainConfig: XrpChainConfig;
  context: XrpProcessorV2Context;
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

function buildXrpSourceActivityDraft(params: {
  chainConfig: XrpChainConfig;
  context: XrpProcessorV2Context;
  fundFlow: XrpFundFlow;
  sourceActivityFingerprint: string;
  transaction: XrpTransaction;
}): SourceActivityDraft {
  const fromAddress = params.fundFlow.fromAddress ?? params.transaction.account;
  const toAddress = params.fundFlow.toAddress ?? params.transaction.destination;

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
    fromAddress,
    ...(toAddress === undefined ? {} : { toAddress }),
    blockchainName: params.chainConfig.chainName,
    blockchainBlockHeight: params.transaction.ledgerIndex,
    blockchainTransactionHash: params.transaction.id,
    blockchainIsConfirmed: params.transaction.status === 'success',
  };
}

function buildPostingComponentRef(params: {
  assetId: string;
  componentId: string;
  componentKind: SourceComponentQuantityRef['component']['componentKind'];
  occurrence?: number | undefined;
  quantity: Decimal;
  sourceActivityFingerprint: string;
}): SourceComponentQuantityRef {
  return buildSourceComponentQuantityRef({
    assetId: params.assetId,
    componentId: params.componentId,
    componentKind: params.componentKind,
    occurrence: params.occurrence,
    quantity: params.quantity,
    sourceActivityFingerprint: params.sourceActivityFingerprint,
  });
}

function buildXrpNativeAssetRef(
  chainConfig: XrpChainConfig
): Result<{ assetId: string; assetSymbol: Currency }, Error> {
  return resultDo(function* () {
    return {
      assetId: yield* buildBlockchainNativeAssetId(chainConfig.chainName),
      assetSymbol: yield* parseCurrency(chainConfig.nativeCurrency),
    };
  });
}

function buildXrpValuePostings(params: {
  chainConfig: XrpChainConfig;
  context: XrpPostingBuildContext;
}): Result<AccountingPostingDraft[], Error> {
  return resultDo(function* () {
    const assetRef = yield* buildXrpNativeAssetRef(params.chainConfig);

    const shouldRecordFeeEntry = params.context.fundFlow.isOutgoing && !params.context.netAmount.isZero();
    let transferAmount = params.context.netAmount;
    if (shouldRecordFeeEntry && !params.context.feeAmount.isZero()) {
      transferAmount = params.context.netAmount.minus(params.context.feeAmount);
      if (transferAmount.isNegative()) {
        transferAmount = parseDecimal('0');
      }
    }

    if ((params.context.fundFlow.isIncoming || params.context.fundFlow.isOutgoing) && transferAmount.isZero()) {
      return [];
    }

    if (!params.context.fundFlow.isIncoming && !params.context.fundFlow.isOutgoing) {
      return [];
    }

    const quantity = params.context.fundFlow.isIncoming ? transferAmount : transferAmount.negated();
    return [
      {
        postingStableKey: `principal:${params.context.fundFlow.isIncoming ? 'in' : 'out'}:${assetRef.assetId}:1`,
        assetId: assetRef.assetId,
        assetSymbol: assetRef.assetSymbol,
        quantity,
        role: 'principal',
        balanceCategory: 'liquid',
        sourceComponentRefs: [
          buildPostingComponentRef({
            assetId: assetRef.assetId,
            componentId: `${params.context.transaction.eventId}:account_delta:principal`,
            componentKind: 'account_delta',
            occurrence: 1,
            quantity: transferAmount,
            sourceActivityFingerprint: params.context.sourceActivityFingerprint,
          }),
        ],
      },
    ];
  });
}

function buildOptionalXrpNetworkFeePosting(params: {
  chainConfig: XrpChainConfig;
  context: XrpPostingBuildContext;
}): Result<AccountingPostingDraft | undefined, Error> {
  return resultDo(function* () {
    if (!params.context.fundFlow.isOutgoing || params.context.netAmount.isZero() || params.context.feeAmount.isZero()) {
      return undefined;
    }

    const assetRef = yield* buildXrpNativeAssetRef(params.chainConfig);
    return {
      postingStableKey: `network_fee:${assetRef.assetId}`,
      assetId: assetRef.assetId,
      assetSymbol: assetRef.assetSymbol,
      quantity: params.context.feeAmount.negated(),
      role: 'fee',
      balanceCategory: 'liquid',
      settlement: 'balance',
      sourceComponentRefs: [
        buildPostingComponentRef({
          assetId: assetRef.assetId,
          componentId: `${params.context.transaction.eventId}:network_fee`,
          componentKind: 'network_fee',
          quantity: params.context.feeAmount,
          sourceActivityFingerprint: params.context.sourceActivityFingerprint,
        }),
      ],
    };
  });
}

function buildXrpJournals(parts: XrpJournalAssemblyParts): AccountingJournalDraft[] {
  const journalKind = resolvePostingDrivenJournalKind({
    valuePostings: parts.valuePostings,
  });
  const postings = parts.feePosting ? [...parts.valuePostings, parts.feePosting] : [...parts.valuePostings];

  if (postings.length === 0) {
    return [];
  }

  return [
    {
      sourceActivityFingerprint: parts.sourceActivityFingerprint,
      journalStableKey: resolveDefaultJournalStableKey(journalKind),
      journalKind,
      postings,
    },
  ];
}

export function groupXrpLedgerTransactionsByHash(transactions: XrpTransactionGroup): Map<string, XrpTransaction[]> {
  const groups = new Map<string, XrpTransaction[]>();

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

export function assembleXrpLedgerDraft(
  transactions: XrpTransactionGroup,
  chainConfig: XrpChainConfig,
  context: XrpProcessorV2Context
): Result<XrpLedgerDraft, Error> {
  return resultDo(function* () {
    if (transactions.length === 0) {
      return yield* err(new Error('XRP v2 cannot assemble an empty transaction group'));
    }

    yield* validateXrpChainConfig(chainConfig);
    const transaction = transactions[0]!;
    if (transactions.some((candidate) => candidate.id !== transaction.id)) {
      return yield* err(new Error(`XRP v2 received mixed transaction hashes in group ${transaction.id}`));
    }

    const validatedContext = yield* validateXrpProcessorV2Context(context);
    const fundFlow = yield* analyzeXrpFundFlow(transaction, {
      primaryAddress: validatedContext.primaryAddress,
      userAddresses: validatedContext.userAddresses,
    });
    const netAmount = yield* parseLedgerDecimalAmount({
      label: 'net balance delta',
      processorLabel: 'XRP v2',
      transactionId: transaction.id,
      value: fundFlow.netAmount,
    });
    const feeAmount = yield* parseLedgerDecimalAmount({
      label: 'fee',
      processorLabel: 'XRP v2',
      transactionId: transaction.id,
      value: transaction.feeAmount,
    });
    const sourceActivityFingerprint = yield* computeXrpSourceActivityFingerprint({
      chainConfig,
      context,
      transactionHash: transaction.id,
    });
    const postingContext: XrpPostingBuildContext = {
      feeAmount,
      fundFlow,
      netAmount,
      sourceActivityFingerprint,
      transaction,
    };
    const valuePostings = yield* buildXrpValuePostings({
      chainConfig,
      context: postingContext,
    });
    const feePosting = yield* buildOptionalXrpNetworkFeePosting({
      chainConfig,
      context: postingContext,
    });
    const journals = buildXrpJournals({
      feePosting,
      sourceActivityFingerprint,
      valuePostings,
    });
    const sourceActivity = buildXrpSourceActivityDraft({
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
