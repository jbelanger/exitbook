import type { Result } from '@exitbook/foundation';

/**
 * Minimal account info needed during processing.
 * Avoids exposing full Account domain object to the processing pipeline.
 */
export interface ProcessingAccountInfo {
  id: number;
  accountType: string;
  accountFingerprint: string;
  identifier: string;
  name?: string | undefined;
  parentAccountId?: number | undefined;
  platformKey: string;
  profileId: number;
}

/**
 * Port for loading account context during processing.
 */
export interface IAccountLookup {
  /** Load account metadata needed for processing decisions. */
  getAccountInfo(accountId: number): Promise<Result<ProcessingAccountInfo, Error>>;

  /** Load direct child accounts for a hierarchy owner. */
  findChildAccounts(parentAccountId: number): Promise<Result<ProcessingAccountInfo[], Error>>;

  /**
   * Load all addresses the profile owns on a given blockchain.
   * Used to build address context for fund-flow analysis (detecting internal transfers).
   */
  getProfileAddresses(profileId: number, blockchain: string): Promise<Result<string[], Error>>;
}
