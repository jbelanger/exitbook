import type { TransactionDraft } from '@exitbook/core';
import type { Result } from '@exitbook/foundation';
import type { AccountingJournalDraft, SourceActivityDraft } from '@exitbook/ledger';

export interface BatchProcessSummary {
  errors: string[];
  failed: number;
  processed: number;
}

/**
 * Processing context for fund flow analysis in blockchain processors.
 * Provides address information needed to determine transaction direction.
 *
 * Note: All addresses are already normalized (lowercased for case-insensitive blockchains)
 * by blockchain-specific schemas before reaching the processor.
 */
export interface AddressContext {
  /** Primary address being analyzed (the account's address) - already normalized */
  primaryAddress: string;
  /** All user addresses on this blockchain (for detecting internal transfers) - already normalized */
  userAddresses: string[];
  /** Database account identity for source-specific historical lookups. */
  accountId?: number | undefined;
}

/**
 * Interface for processing raw data into TransactionDraft format.
 * Each processor is responsible for converting source-specific raw data
 * into the standardized TransactionDraft format.
 */
export interface ITransactionProcessor {
  /**
   * Process normalized data with explicit typed context into TransactionDraft objects.
   */
  process(normalizedData: unknown[], context: AddressContext): Promise<Result<TransactionDraft[], Error>>;
}

export interface BlockchainLedgerProcessorAccountContext {
  fingerprint: string;
  id: number;
}

export interface BlockchainLedgerProcessorContext {
  account: BlockchainLedgerProcessorAccountContext;
  primaryAddress: string;
  stakeAddresses?: readonly string[] | undefined;
  userAddresses: readonly string[];
  walletAddresses: readonly string[];
}

export interface AccountingLedgerDraft {
  journals: readonly AccountingJournalDraft[];
  sourceActivity: SourceActivityDraft;
}

/**
 * Shadow processor contract for the accounting-ledger model. Consumers keep
 * reading the legacy projection until their v2 ports are ready.
 */
export interface IAccountingLedgerProcessor {
  process(
    normalizedData: unknown[],
    context: BlockchainLedgerProcessorContext
  ): Promise<Result<AccountingLedgerDraft[], Error>>;
}
