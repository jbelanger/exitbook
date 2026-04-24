import type {
  CardanoTransaction,
  CardanoTransactionInput,
  CardanoTransactionOutput,
} from '@exitbook/blockchain-providers/cardano';
import type { Currency } from '@exitbook/foundation';
import type {
  AccountingDiagnosticDraft,
  AccountingJournalDraft,
  AccountingPostingDraft,
  SourceActivityDraft,
} from '@exitbook/ledger';
import type { Decimal } from 'decimal.js';

export interface CardanoProcessorV2AccountContext {
  fingerprint: string;
  id: number;
}

export interface CardanoProcessorV2Context {
  account: CardanoProcessorV2AccountContext;
  stakeAddresses?: readonly string[] | undefined;
  walletAddresses: readonly string[];
}

export interface CardanoLedgerDraft {
  journals: AccountingJournalDraft[];
  sourceActivity: SourceActivityDraft;
}

export interface CardanoAssetRef {
  assetId: string;
  assetSymbol: Currency;
}

export interface WalletAssetAmount {
  amount: Decimal;
  symbol?: string | undefined;
  unit: string;
}

export interface WalletAssetTotals {
  inputsByUnit: Map<string, WalletAssetAmount>;
  outputsByUnit: Map<string, WalletAssetAmount>;
  walletInputs: CardanoTransactionInput[];
  walletOutputs: CardanoTransactionOutput[];
}

export interface CardanoWalletScope {
  stakeAddresses?: ReadonlySet<string> | undefined;
  walletAddresses: ReadonlySet<string>;
}

export type CardanoWalletDeltaJournalKind = 'protocol_event' | 'transfer';

export interface CardanoJournalAssemblyParts {
  diagnostics: readonly AccountingDiagnosticDraft[];
  feePosting: AccountingPostingDraft | undefined;
  hasProtocolEvidence: boolean;
  protocolEventPostings: readonly AccountingPostingDraft[];
  protocolEventStableKey: string;
  rewardPosting: AccountingPostingDraft | undefined;
  sourceActivityFingerprint: string;
  walletDeltaJournalKind: CardanoWalletDeltaJournalKind;
  walletDeltaPostings: readonly AccountingPostingDraft[];
}

export interface ValidatedCardanoAmounts {
  protocolDepositDeltaAmount: Decimal;
  feeAmount: Decimal;
  treasuryDonationAmount: Decimal;
  withdrawalAmounts: readonly Decimal[];
}

export type CardanoLedgerWithdrawal = NonNullable<CardanoTransaction['withdrawals']>[number];
export type CardanoLedgerStakeCertificate = NonNullable<CardanoTransaction['stakeCertificates']>[number];
