import type { CardanoTransaction } from '@exitbook/blockchain-providers/cardano';
import type { AccountingDiagnosticDraft, AccountingJournalDraft, AccountingPostingRole } from '@exitbook/ledger';

import type {
  CardanoJournalAssemblyParts,
  CardanoWalletDeltaJournalKind,
  ValidatedCardanoAmounts,
  WalletAssetTotals,
} from './journal-assembler-types.js';

interface CardanoFeeOnlyJournalDescriptor {
  journalKind: 'expense_only' | 'protocol_event';
  journalStableKey: string;
}

function resolveFeeOnlyJournalDescriptor(parts: CardanoJournalAssemblyParts): CardanoFeeOnlyJournalDescriptor {
  if (parts.walletDeltaJournalKind === 'protocol_event' || parts.hasProtocolEvidence) {
    return {
      journalKind: 'protocol_event',
      journalStableKey: parts.protocolEventStableKey,
    };
  }

  return {
    journalKind: 'expense_only',
    journalStableKey: 'network_fee',
  };
}

export function buildCardanoJournals(parts: CardanoJournalAssemblyParts): AccountingJournalDraft[] {
  const journals: AccountingJournalDraft[] = [];
  let pendingFeePosting = parts.feePosting;
  let pendingDiagnostics = parts.diagnostics.length > 0 ? [...parts.diagnostics] : undefined;

  function attachDiagnostics(journal: AccountingJournalDraft): AccountingJournalDraft {
    if (!pendingDiagnostics) {
      return journal;
    }

    const diagnosticsToAttach = pendingDiagnostics;
    pendingDiagnostics = undefined;
    return {
      ...journal,
      diagnostics: diagnosticsToAttach,
    };
  }

  if (parts.walletDeltaPostings.length > 0) {
    const postings = pendingFeePosting
      ? [...parts.walletDeltaPostings, pendingFeePosting]
      : [...parts.walletDeltaPostings];
    pendingFeePosting = undefined;

    journals.push(
      attachDiagnostics({
        sourceActivityFingerprint: parts.sourceActivityFingerprint,
        journalStableKey: parts.walletDeltaJournalKind,
        journalKind: parts.walletDeltaJournalKind,
        postings,
      })
    );
  }

  if (parts.rewardPosting) {
    const postings = pendingFeePosting ? [parts.rewardPosting, pendingFeePosting] : [parts.rewardPosting];
    pendingFeePosting = undefined;

    journals.push(
      attachDiagnostics({
        sourceActivityFingerprint: parts.sourceActivityFingerprint,
        journalStableKey: 'staking_reward',
        journalKind: 'staking_reward',
        postings,
      })
    );
  }

  if (parts.protocolEventPostings.length > 0) {
    const postings = pendingFeePosting
      ? [...parts.protocolEventPostings, pendingFeePosting]
      : [...parts.protocolEventPostings];
    pendingFeePosting = undefined;

    journals.push(
      attachDiagnostics({
        sourceActivityFingerprint: parts.sourceActivityFingerprint,
        journalStableKey: parts.protocolEventStableKey,
        journalKind: 'protocol_event',
        postings,
      })
    );
  }

  if (pendingFeePosting) {
    const feeOnlyJournal = resolveFeeOnlyJournalDescriptor(parts);
    journals.push(
      attachDiagnostics({
        sourceActivityFingerprint: parts.sourceActivityFingerprint,
        journalStableKey: feeOnlyJournal.journalStableKey,
        journalKind: feeOnlyJournal.journalKind,
        postings: [pendingFeePosting],
      })
    );
  }

  return journals;
}

function hasCollateralWalletEffect(walletAssetTotals: WalletAssetTotals): boolean {
  return (
    walletAssetTotals.walletInputs.some((input) => input.isCollateral === true) ||
    walletAssetTotals.walletOutputs.some((output) => output.isCollateral === true)
  );
}

export function resolveCardanoWalletDeltaJournalKind(
  transaction: CardanoTransaction,
  walletAssetTotals: WalletAssetTotals
): CardanoWalletDeltaJournalKind {
  return transaction.status === 'failed' && hasCollateralWalletEffect(walletAssetTotals)
    ? 'protocol_event'
    : 'transfer';
}

export function resolveCardanoWalletDeltaRole(
  transaction: CardanoTransaction,
  walletAssetTotals: WalletAssetTotals
): AccountingPostingRole {
  return transaction.status === 'failed' && hasCollateralWalletEffect(walletAssetTotals)
    ? 'protocol_overhead'
    : 'principal';
}

export function hasCardanoProtocolEvidence(
  transaction: CardanoTransaction,
  validatedAmounts: ValidatedCardanoAmounts
): boolean {
  return (
    (transaction.stakeCertificates?.length ?? 0) > 0 ||
    (transaction.delegationCertificates?.length ?? 0) > 0 ||
    (transaction.mirCertificates?.length ?? 0) > 0 ||
    !validatedAmounts.protocolDepositDeltaAmount.isZero() ||
    !validatedAmounts.treasuryDonationAmount.isZero()
  );
}

export function resolveCardanoProtocolEventStableKey(
  transaction: CardanoTransaction,
  validatedAmounts: ValidatedCardanoAmounts
): string {
  if (
    (transaction.stakeCertificates?.length ?? 0) > 0 ||
    (transaction.delegationCertificates?.length ?? 0) > 0 ||
    !validatedAmounts.protocolDepositDeltaAmount.isZero()
  ) {
    return 'staking_lifecycle';
  }

  if ((transaction.mirCertificates?.length ?? 0) > 0) {
    return 'mir_certificates';
  }

  if (!validatedAmounts.treasuryDonationAmount.isZero()) {
    return 'treasury_donation';
  }

  return 'protocol_event';
}

export function buildCardanoDiagnostics(
  transaction: CardanoTransaction,
  walletAssetTotals: WalletAssetTotals,
  validatedAmounts: ValidatedCardanoAmounts
): AccountingDiagnosticDraft[] {
  const diagnostics: AccountingDiagnosticDraft[] = [];
  const referenceInputCount = transaction.inputs.filter((input) => input.isReference === true).length;
  const ignoredSuccessfulCollateralInputCount = transaction.inputs.filter(
    (input) => transaction.status !== 'failed' && input.isCollateral === true
  ).length;
  const collateralWalletInputCount = walletAssetTotals.walletInputs.filter(
    (input) => input.isCollateral === true
  ).length;
  const collateralWalletOutputCount = walletAssetTotals.walletOutputs.filter(
    (output) => output.isCollateral === true
  ).length;
  const stakeCertificateCount = transaction.stakeCertificates?.length ?? 0;
  const delegationCertificateCount = transaction.delegationCertificates?.length ?? 0;
  const mirCertificateCount = transaction.mirCertificates?.length ?? 0;

  if (referenceInputCount > 0) {
    diagnostics.push({
      code: 'cardano_reference_inputs_ignored',
      message: `Cardano transaction ${transaction.id} contains ${referenceInputCount} reference input(s); reference inputs are read-only and excluded from wallet balance accounting.`,
      severity: 'info',
    });
  }

  if (ignoredSuccessfulCollateralInputCount > 0) {
    diagnostics.push({
      code: 'cardano_collateral_inputs_ignored',
      message: `Cardano transaction ${transaction.id} contains ${ignoredSuccessfulCollateralInputCount} collateral input(s) on a successful script transaction; collateral inputs are excluded because they were not consumed.`,
      severity: 'info',
    });
  }

  if (transaction.status === 'failed' && (collateralWalletInputCount > 0 || collateralWalletOutputCount > 0)) {
    diagnostics.push({
      code: 'cardano_failed_script_collateral',
      message: `Cardano transaction ${transaction.id} failed script validation; wallet accounting uses collateral inputs and collateral return outputs.`,
      severity: 'warning',
    });
  }

  if (stakeCertificateCount > 0) {
    diagnostics.push({
      code: 'cardano_stake_certificates',
      message: `Cardano transaction ${transaction.id} contains ${stakeCertificateCount} stake address registration certificate(s).`,
      severity: 'info',
    });
  }

  if (delegationCertificateCount > 0) {
    diagnostics.push({
      code: 'cardano_delegation_certificates',
      message: `Cardano transaction ${transaction.id} contains ${delegationCertificateCount} delegation certificate(s).`,
      severity: 'info',
    });
  }

  if (mirCertificateCount > 0) {
    diagnostics.push({
      code: 'cardano_mir_certificates',
      message: `Cardano transaction ${transaction.id} contains ${mirCertificateCount} MIR certificate(s). MIR rewards are preserved as chain evidence and are not spendable UTXO balance until withdrawn.`,
      severity: 'info',
    });
  }

  if (!validatedAmounts.protocolDepositDeltaAmount.isZero() && stakeCertificateCount === 0) {
    diagnostics.push({
      code: 'cardano_unattributed_protocol_deposit',
      message: `Cardano transaction ${transaction.id} has a protocol deposit delta of ${validatedAmounts.protocolDepositDeltaAmount.toFixed()} ADA without a stake address certificate in normalized data.`,
      severity: 'warning',
    });
  }

  return diagnostics;
}
