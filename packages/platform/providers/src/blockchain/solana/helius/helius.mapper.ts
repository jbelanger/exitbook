import { isErrorWithMessage, parseDecimal } from '@exitbook/core';
import type { ImportSessionMetadata } from '@exitbook/core';
import { type Result, err, ok } from 'neverthrow';

import { BaseRawDataMapper } from '../../../shared/blockchain/base/mapper.ts';
import type { NormalizationError } from '../../../shared/blockchain/index.ts';
import { SolanaTransactionSchema } from '../schemas.js';
import type { SolanaAccountChange, SolanaTokenBalance, SolanaTokenChange, SolanaTransaction } from '../types.js';
import { lamportsToSol } from '../utils.js';

import { SolanaRawTransactionDataSchema, type HeliusTransaction } from './helius.schemas.js';

export class HeliusTransactionMapper extends BaseRawDataMapper<HeliusTransaction, SolanaTransaction> {
  protected readonly inputSchema = SolanaRawTransactionDataSchema;
  protected readonly outputSchema = SolanaTransactionSchema;

  protected mapInternal(
    rawData: HeliusTransaction,
    sessionContext: ImportSessionMetadata
  ): Result<SolanaTransaction, NormalizationError> {
    // Validate required signature field
    const signature = rawData.transaction.signatures?.[0] ?? rawData.signature;
    if (!signature) {
      return err({ message: 'Transaction signature is required for normalization', type: 'error' });
    }

    try {
      const solanaTransaction = this.transformTransaction(rawData, signature, sessionContext);
      return ok(solanaTransaction);
    } catch (error) {
      const errorMessage = isErrorWithMessage(error) ? error.message : String(error);
      return err({ message: `Failed to transform transaction: ${errorMessage}`, type: 'error' });
    }
  }

  private transformTransaction(
    tx: HeliusTransaction,
    signature: string,
    _sessionContext: ImportSessionMetadata
  ): SolanaTransaction {
    const accountKeys = tx.transaction.message.accountKeys;
    const fee = lamportsToSol(tx.meta.fee);

    // Extract account balance changes for accurate fund flow analysis
    const accountChanges = this.extractAccountChanges(tx, accountKeys);

    // Extract token balance changes for SPL token analysis with mint addresses
    const tokenChanges = this.extractTokenChanges(tx);

    // Determine primary currency and amount from balance changes
    const { primaryAmount, primaryCurrency } = this.determinePrimaryTransfer(accountChanges, tokenChanges);

    // Extract basic transaction data (pure data extraction, no business logic)
    return {
      // Balance change data for accurate fund flow analysis
      accountChanges,

      // Core transaction data
      amount: primaryAmount ?? '0', // Calculated from balance changes (zero is valid for fee-only transactions)
      blockHeight: tx.slot,
      blockId: signature, // Use signature as block ID for Helius
      currency: primaryCurrency ?? 'SOL', // Default to SOL for native transactions without token changes

      // Fee information
      feeAmount: fee.toString(),
      feeCurrency: 'SOL',

      // Transaction flow (extract raw addresses, processor will determine direction)
      from: accountKeys?.[0] || '', // First account is fee payer
      id: signature,

      // Instruction data (raw extraction)
      instructions: (tx.transaction.message.instructions || []).map((instruction) => ({
        accounts: [], // Will be extracted by processor if needed
        data: JSON.stringify(instruction), // Serialize instruction as data
        programId: '', // Will be extracted by processor if needed
      })),

      // Log messages
      logMessages: tx.meta.logMessages || [],

      providerId: 'helius',
      signature,
      slot: tx.slot,
      status: tx.meta.err ? 'failed' : 'success',
      timestamp:
        typeof tx.blockTime === 'number'
          ? tx.blockTime * 1000 // Convert seconds to milliseconds
          : (tx.blockTime?.getTime() ?? 0),

      // Basic recipient (will be refined by processor)
      to: accountKeys?.[1] || '', // Second account is often recipient

      // Token balance changes for SPL token analysis
      tokenChanges,
    };
  }

  /**
   * Extract SOL balance changes for all accounts
   */
  private extractAccountChanges(tx: HeliusTransaction, accountKeys: string[]): SolanaAccountChange[] {
    const changes: SolanaAccountChange[] = [];

    if (tx.meta.preBalances && tx.meta.postBalances && accountKeys) {
      for (let i = 0; i < Math.min(accountKeys.length, tx.meta.preBalances.length, tx.meta.postBalances.length); i++) {
        const preBalance = tx.meta.preBalances[i];
        const postBalance = tx.meta.postBalances[i];

        // Only include accounts with balance changes
        if (preBalance !== postBalance) {
          const account = accountKeys[i];
          if (account && preBalance !== undefined && postBalance !== undefined) {
            changes.push({
              account,
              postBalance: postBalance.toString(),
              preBalance: preBalance.toString(),
            });
          }
        }
      }
    }

    return changes;
  }

  /**
   * Extract SPL token balance changes with mint addresses
   * Processors will handle symbol resolution using TokenMetadataRepository
   */
  private extractTokenChanges(tx: HeliusTransaction): SolanaTokenChange[] {
    const changes: SolanaTokenChange[] = [];

    // Create maps for easier lookup
    const preTokenMap = new Map<string, SolanaTokenBalance>();
    const postTokenMap = new Map<string, SolanaTokenBalance>();

    // Build pre-token balance map
    if (tx.meta.preTokenBalances) {
      for (const balance of tx.meta.preTokenBalances) {
        const key = `${balance.accountIndex}-${balance.mint}`;
        preTokenMap.set(key, balance);
      }
    }

    // Build post-token balance map and detect changes
    if (tx.meta.postTokenBalances) {
      for (const balance of tx.meta.postTokenBalances) {
        const key = `${balance.accountIndex}-${balance.mint}`;
        postTokenMap.set(key, balance);

        const preBalance = preTokenMap.get(key);
        const preAmount = preBalance?.uiTokenAmount.amount || '0';
        const postAmount = balance.uiTokenAmount.amount;

        // Only include tokens with balance changes
        if (preAmount !== postAmount) {
          changes.push({
            account: balance.owner || '', // Token account owner
            decimals: balance.uiTokenAmount.decimals,
            mint: balance.mint,
            owner: balance.owner,
            postAmount,
            preAmount,
            symbol: balance.mint, // Use mint address - processor will resolve to symbol
          });
        }
      }
    }

    // Check for tokens that existed in pre but not in post (fully spent)
    for (const [key, preBalance] of preTokenMap.entries()) {
      if (!postTokenMap.has(key)) {
        changes.push({
          account: preBalance.owner || '',
          decimals: preBalance.uiTokenAmount.decimals,
          mint: preBalance.mint,
          owner: preBalance.owner,
          postAmount: '0',
          preAmount: preBalance.uiTokenAmount.amount,
          symbol: preBalance.mint, // Use mint address - processor will resolve to symbol
        });
      }
    }

    return changes;
  }

  /**
   * Determine the primary transfer amount and currency from balance changes
   */
  private determinePrimaryTransfer(
    accountChanges: SolanaAccountChange[],
    tokenChanges: SolanaTokenChange[]
  ): { primaryAmount: string; primaryCurrency: string } {
    // If there are token changes, prioritize the largest token transfer
    if (tokenChanges.length > 0) {
      const largestTokenChange = tokenChanges.reduce((largest, change) => {
        const changeAmount = parseDecimal(change.postAmount).minus(change.preAmount).abs();
        const largestAmount = parseDecimal(largest.postAmount).minus(largest.preAmount).abs();
        return changeAmount.greaterThan(largestAmount) ? change : largest;
      });

      const tokenAmount = parseDecimal(largestTokenChange.postAmount).minus(largestTokenChange.preAmount).abs();
      return {
        primaryAmount: tokenAmount.toFixed(),
        primaryCurrency: largestTokenChange.symbol || largestTokenChange.mint,
      };
    }

    // Otherwise, find the largest SOL change (excluding fee payer)
    if (accountChanges.length > 1) {
      // Skip first account (fee payer) and find largest balance change
      const largestSolChange = accountChanges.slice(1).reduce((largest, change) => {
        // If largest is undefined, use current change as initial value
        if (!largest) return change;
        const changeAmount = parseDecimal(change.postBalance).minus(change.preBalance).abs();
        const largestAmount = parseDecimal(largest.postBalance).minus(largest.preBalance).abs();
        return changeAmount.greaterThan(largestAmount) ? change : largest;
      }, accountChanges[1]);

      if (largestSolChange) {
        const solAmount = parseDecimal(largestSolChange.postBalance).minus(largestSolChange.preBalance).abs();
        return {
          primaryAmount: solAmount.toFixed(),
          primaryCurrency: 'SOL',
        };
      }
    }

    // Default fallback
    return {
      primaryAmount: '0',
      primaryCurrency: 'SOL',
    };
  }
}
