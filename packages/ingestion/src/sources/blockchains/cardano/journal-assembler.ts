import type { CardanoTransaction } from '@exitbook/blockchain-providers/cardano';
import { resultDo, type Result } from '@exitbook/foundation';
import { computeSourceActivityFingerprint, type SourceActivityDraft } from '@exitbook/ledger';

import { validateCardanoTransactionAmounts } from './journal-assembler-amounts.js';
import {
  buildCardanoDiagnostics,
  buildCardanoJournals,
  hasCardanoProtocolEvidence,
  resolveCardanoProtocolEventStableKey,
  resolveCardanoWalletDeltaJournalKind,
  resolveCardanoWalletDeltaRole,
} from './journal-assembler-journals.js';
import {
  buildOptionalNetworkFeePosting,
  buildProtocolEventPostings,
  buildStakingRewardPosting,
  buildWalletDeltaPostings,
  sumWalletWithdrawalAmount,
} from './journal-assembler-postings.js';
import type { CardanoLedgerDraft, CardanoProcessorV2Context, WalletAssetTotals } from './journal-assembler-types.js';
import {
  collectWalletAssetTotals,
  resolveCardanoSourceActivityFromAddress,
  resolveCardanoSourceActivityToAddress,
  validateCardanoProcessorV2Context,
  validateWalletScopeEffect,
} from './journal-assembler-wallet.js';

export type {
  CardanoLedgerDraft,
  CardanoProcessorV2AccountContext,
  CardanoProcessorV2Context,
} from './journal-assembler-types.js';

function computeCardanoSourceActivityFingerprint(
  transaction: CardanoTransaction,
  context: CardanoProcessorV2Context
): Result<string, Error> {
  return computeSourceActivityFingerprint({
    accountFingerprint: context.account.fingerprint,
    platformKey: 'cardano',
    platformKind: 'blockchain',
    blockchainTransactionHash: transaction.id,
  });
}

function buildCardanoSourceActivityDraft(
  transaction: CardanoTransaction,
  context: CardanoProcessorV2Context,
  sourceActivityFingerprint: string,
  walletAssetTotals: WalletAssetTotals,
  walletAddresses: ReadonlySet<string>
): SourceActivityDraft {
  return {
    accountId: context.account.id,
    sourceActivityFingerprint,
    platformKey: 'cardano',
    platformKind: 'blockchain',
    activityStatus: transaction.status,
    activityDatetime: new Date(transaction.timestamp).toISOString(),
    activityTimestampMs: transaction.timestamp,
    fromAddress: resolveCardanoSourceActivityFromAddress(transaction, walletAssetTotals, walletAddresses),
    toAddress: resolveCardanoSourceActivityToAddress(transaction, walletAssetTotals, walletAddresses),
    blockchainName: 'cardano',
    ...(transaction.blockHeight === undefined ? {} : { blockchainBlockHeight: transaction.blockHeight }),
    blockchainTransactionHash: transaction.id,
    blockchainIsConfirmed: transaction.status === 'success',
  };
}

export function assembleCardanoLedgerDraft(
  transaction: CardanoTransaction,
  context: CardanoProcessorV2Context
): Result<CardanoLedgerDraft, Error> {
  return resultDo(function* () {
    const validatedAmounts = yield* validateCardanoTransactionAmounts(transaction);
    const walletScope = yield* validateCardanoProcessorV2Context(context);
    const sourceActivityFingerprint = yield* computeCardanoSourceActivityFingerprint(transaction, context);
    const walletAssetTotals = yield* collectWalletAssetTotals(transaction, walletScope.walletAddresses);
    yield* validateWalletScopeEffect(transaction, walletAssetTotals);
    const walletPaysNetworkFee = walletAssetTotals.walletInputs.length > 0;
    const walletWithdrawalAmount = yield* sumWalletWithdrawalAmount(
      transaction.withdrawals ?? [],
      validatedAmounts.withdrawalAmounts,
      walletPaysNetworkFee,
      walletScope
    );
    const walletDeltaJournalKind = resolveCardanoWalletDeltaJournalKind(transaction, walletAssetTotals);
    const walletDeltaRole = resolveCardanoWalletDeltaRole(transaction, walletAssetTotals);
    const diagnostics = buildCardanoDiagnostics(transaction, walletAssetTotals, validatedAmounts);
    const feePosting = yield* buildOptionalNetworkFeePosting(
      sourceActivityFingerprint,
      transaction,
      walletPaysNetworkFee,
      validatedAmounts.feeAmount
    );
    const walletDeltaPostings = yield* buildWalletDeltaPostings(
      transaction,
      sourceActivityFingerprint,
      walletAssetTotals,
      walletPaysNetworkFee,
      validatedAmounts.feeAmount,
      validatedAmounts.protocolDepositDeltaAmount,
      validatedAmounts.treasuryDonationAmount,
      walletWithdrawalAmount,
      walletDeltaRole
    );
    const rewardPosting = yield* buildStakingRewardPosting(
      transaction,
      sourceActivityFingerprint,
      walletPaysNetworkFee,
      walletScope,
      validatedAmounts.withdrawalAmounts,
      walletWithdrawalAmount
    );
    const protocolEventPostings = yield* buildProtocolEventPostings(
      transaction,
      sourceActivityFingerprint,
      walletPaysNetworkFee,
      validatedAmounts.protocolDepositDeltaAmount,
      validatedAmounts.treasuryDonationAmount
    );
    const hasProtocolEvidence = hasCardanoProtocolEvidence(transaction, validatedAmounts);
    const protocolEventStableKey = resolveCardanoProtocolEventStableKey(transaction, validatedAmounts);
    const journals = buildCardanoJournals({
      sourceActivityFingerprint,
      walletDeltaPostings,
      rewardPosting,
      protocolEventPostings,
      feePosting,
      walletDeltaJournalKind,
      hasProtocolEvidence,
      protocolEventStableKey,
      diagnostics,
    });
    const sourceActivity = buildCardanoSourceActivityDraft(
      transaction,
      context,
      sourceActivityFingerprint,
      walletAssetTotals,
      walletScope.walletAddresses
    );

    return {
      sourceActivity,
      journals,
    };
  });
}
