import { normalizeEvmAddress, type EvmTransaction } from '@exitbook/blockchain-providers/evm';
import { err, resultDo, type Result } from '@exitbook/foundation';
import { computeSourceActivityFingerprint, type SourceActivityDraft } from '@exitbook/ledger';

import { validateLedgerProcessorAccountContext } from '../shared/ledger-assembler-utils.js';

import {
  validateEvmChainConfig,
  validateEvmTransactionAmounts,
  zeroFailedValueTransfers,
} from './journal-assembler-amounts.js';
import { buildEvmJournals, mapTransactionDiagnostics } from './journal-assembler-journals.js';
import { buildEvmValuePostings, buildOptionalEvmNetworkFeePosting } from './journal-assembler-postings.js';
import { expandEvmWrappedNativeProtocolTransactions } from './journal-assembler-protocol-events.js';
import type {
  AccountBasedLedgerChainConfig,
  EvmLedgerDraft,
  EvmProcessorV2Context,
  EvmProcessorV2ValidatedContext,
  EvmTransactionGroup,
} from './journal-assembler-types.js';
import {
  analyzeEvmFundFlow,
  determineEvmOperationFromFundFlow,
  groupEvmTransactionsByHash,
  selectPrimaryEvmTransaction,
} from './processor-utils.js';
import type { EvmFundFlow } from './types.js';

export type { EvmLedgerDraft, EvmProcessorV2AccountContext, EvmProcessorV2Context } from './journal-assembler-types.js';

function validateEvmProcessorV2Context(context: EvmProcessorV2Context): Result<EvmProcessorV2ValidatedContext, Error> {
  return resultDo(function* () {
    yield* validateLedgerProcessorAccountContext(context.account, 'EVM v2');
    const primaryAddress = normalizeEvmAddress(context.primaryAddress.trim());
    if (!primaryAddress) {
      return yield* err(new Error('EVM v2 primary address must not be empty'));
    }

    const userAddresses = [
      ...new Set(context.userAddresses.map((address) => normalizeEvmAddress(address.trim()))),
    ].filter((address): address is string => address !== undefined && address.length > 0);
    if (userAddresses.length === 0) {
      return yield* err(new Error('EVM v2 user address scope must contain at least one address'));
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

function computeEvmSourceActivityFingerprint(params: {
  chainConfig: AccountBasedLedgerChainConfig;
  context: EvmProcessorV2Context;
  transactionHash: string;
}): Result<string, Error> {
  return computeSourceActivityFingerprint({
    accountFingerprint: params.context.account.fingerprint,
    platformKey: params.chainConfig.chainName,
    platformKind: 'blockchain',
    blockchainTransactionHash: params.transactionHash,
  });
}

function buildEvmSourceActivityDraft(params: {
  chainConfig: AccountBasedLedgerChainConfig;
  context: EvmProcessorV2Context;
  fundFlow: EvmFundFlow;
  primaryTransaction: EvmTransaction;
  sourceActivityFingerprint: string;
}): SourceActivityDraft {
  return {
    ownerAccountId: params.context.account.id,
    sourceActivityFingerprint: params.sourceActivityFingerprint,
    platformKey: params.chainConfig.chainName,
    platformKind: 'blockchain',
    activityStatus: params.primaryTransaction.status,
    activityDatetime: new Date(params.primaryTransaction.timestamp).toISOString(),
    activityTimestampMs: params.primaryTransaction.timestamp,
    fromAddress: params.fundFlow.fromAddress || params.primaryTransaction.from,
    toAddress: params.fundFlow.toAddress ?? params.primaryTransaction.to,
    blockchainName: params.chainConfig.chainName,
    ...(params.primaryTransaction.blockHeight === undefined
      ? {}
      : { blockchainBlockHeight: params.primaryTransaction.blockHeight }),
    blockchainTransactionHash: params.primaryTransaction.id,
    blockchainIsConfirmed: params.primaryTransaction.status === 'success',
  };
}

export function groupEvmLedgerTransactionsByHash(transactions: EvmTransactionGroup): Map<string, EvmTransaction[]> {
  return groupEvmTransactionsByHash([...transactions]);
}

export function assembleEvmLedgerDraft(
  transactions: EvmTransactionGroup,
  chainConfig: AccountBasedLedgerChainConfig,
  context: EvmProcessorV2Context
): Result<EvmLedgerDraft, Error> {
  return resultDo(function* () {
    if (transactions.length === 0) {
      return yield* err(new Error('EVM v2 cannot assemble an empty transaction group'));
    }

    yield* validateEvmChainConfig(chainConfig);
    yield* validateEvmTransactionAmounts(transactions, chainConfig);
    const validatedContext = yield* validateEvmProcessorV2Context(context);
    const effectiveTransactions = zeroFailedValueTransfers(transactions);
    const transactionHash = transactions[0]!.id;
    const protocolExpanded = yield* expandEvmWrappedNativeProtocolTransactions({
      chainConfig,
      transactions: effectiveTransactions,
      userAddresses: validatedContext.userAddresses,
    });
    const fundFlow = {
      ...(yield* analyzeEvmFundFlow(protocolExpanded.transactions, validatedContext, chainConfig)),
      protocolEvents: protocolExpanded.protocolEvents,
    };
    const primaryTransaction = selectPrimaryEvmTransaction([...transactions], fundFlow);
    if (!primaryTransaction) {
      return yield* err(new Error(`EVM v2 found no primary transaction for group ${transactionHash}`));
    }

    const classification = determineEvmOperationFromFundFlow(fundFlow, effectiveTransactions);
    const sourceActivityFingerprint = yield* computeEvmSourceActivityFingerprint({
      chainConfig,
      context,
      transactionHash,
    });
    const valuePostings = yield* buildEvmValuePostings({
      chainConfig,
      fundFlow,
      primaryAddress: validatedContext.primaryAddress,
      sourceActivityFingerprint,
      transactionHash,
      transactions: protocolExpanded.transactions,
    });
    const feePosting = yield* buildOptionalEvmNetworkFeePosting({
      chainConfig,
      fundFlow,
      primaryAddress: validatedContext.primaryAddress,
      sourceActivityFingerprint,
      transactions,
    });
    const diagnostics = mapTransactionDiagnostics(classification.diagnostics);
    const journals = yield* buildEvmJournals({
      diagnostics,
      feePosting,
      protocolEvents: protocolExpanded.protocolEvents,
      sourceActivityFingerprint,
      valuePostings,
    });
    const sourceActivity = buildEvmSourceActivityDraft({
      chainConfig,
      context,
      fundFlow,
      primaryTransaction,
      sourceActivityFingerprint,
    });

    return {
      sourceActivity,
      journals,
    };
  });
}
