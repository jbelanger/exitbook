import type { Result } from '@exitbook/core';

/**
 * Minimal account info needed during processing.
 * Avoids exposing full Account domain object to the processing pipeline.
 */
export interface ProcessingAccountInfo {
  accountType: string;
  identifier: string;
  sourceName: string;
  userId?: number | undefined;
}

/**
 * Port for loading account context during processing.
 */
export interface IAccountLookup {
  /** Load account metadata needed for processing decisions. */
  getAccountInfo(accountId: number): Promise<Result<ProcessingAccountInfo, Error>>;

  /**
   * Load all addresses the user owns on a given blockchain.
   * Used to build address context for fund-flow analysis (detecting internal transfers).
   */
  getUserAddresses(userId: number, blockchain: string): Promise<Result<string[], Error>>;
}
