import type { SolanaTransaction } from '@exitbook/blockchain-providers/solana';
import type { Currency } from '@exitbook/foundation';
import type {
  AccountingDiagnosticDraft,
  AccountingJournalDraft,
  AccountingPostingDraft,
  AccountingPostingRole,
  SourceActivityDraft,
} from '@exitbook/ledger';

import type { SolanaFundFlow, SolanaMovement, SolanaStakingWithdrawalAllocation } from './types.js';

export interface SolanaProcessorV2AccountContext {
  fingerprint: string;
  id: number;
}

export interface SolanaProcessorV2Context {
  account: SolanaProcessorV2AccountContext;
  primaryAddress: string;
  userAddresses: readonly string[];
}

export interface SolanaProcessorV2ValidatedContext {
  primaryAddress: string;
  userAddresses: string[];
}

export interface SolanaLedgerDraft {
  journals: AccountingJournalDraft[];
  sourceActivity: SourceActivityDraft;
}

export interface SolanaAssetRef {
  assetId: string;
  assetSymbol: Currency;
}

export type SolanaMovementDirection = 'in' | 'out';

export interface SolanaMovementPostingInput {
  direction: SolanaMovementDirection;
  movement: SolanaMovement;
}

export interface SolanaJournalAssemblyParts {
  diagnostics: readonly AccountingDiagnosticDraft[];
  feePosting: AccountingPostingDraft | undefined;
  sourceActivityFingerprint: string;
  valuePostings: readonly AccountingPostingDraft[];
}

export interface SolanaPostingBuildContext {
  fundFlow: SolanaFundFlow;
  sourceActivityFingerprint: string;
  stakingWithdrawalAllocation?: SolanaStakingWithdrawalAllocation | undefined;
  transaction: SolanaTransaction;
}

export interface SolanaResolvedPostingRole {
  componentKind: 'account_delta' | 'message' | 'staking_reward';
  role: AccountingPostingRole;
}

export type SolanaTransactionGroup = readonly SolanaTransaction[];
