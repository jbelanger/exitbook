import { isErrorWithMessage, type RawTransactionMetadata } from '@exitbook/core';
import type { ImportSessionMetadata } from '@exitbook/data';
import { Decimal } from 'decimal.js';
import { type Result, err, ok } from 'neverthrow';

import { BaseRawDataMapper } from '../../../core/blockchain/base/mapper.ts';
import type { NormalizationError } from '../../../core/blockchain/index.ts';
import { SolanaTransactionSchema } from '../schemas.js';
import type { SolanaAccountChange, SolanaTokenBalance, SolanaTokenChange, SolanaTransaction } from '../types.js';
import { lamportsToSol } from '../utils.js';

import { SolanaRPCRawTransactionDataSchema } from './solana-rpc.schemas.js';
import type { SolanaRPCTransaction } from './solana-rpc.types.js';

export class SolanaRPCTransactionMapper extends BaseRawDataMapper<SolanaRPCTransaction, SolanaTransaction> {
  protected readonly inputSchema = SolanaRPCRawTransactionDataSchema;
  protected readonly outputSchema = SolanaTransactionSchema;
  protected mapInternal(
    rawData: SolanaRPCTransaction,
    _metadata: RawTransactionMetadata,
    _sessionContext: ImportSessionMetadata
  ): Result<SolanaTransaction, NormalizationError> {
    try {
      const solanaTransaction = this.transformTransaction(rawData);
      return ok(solanaTransaction);
    } catch (error) {
      const errorMessage = isErrorWithMessage(error) ? error.message : String(error);
      return err({ message: `Failed to transform transaction: ${errorMessage}`, type: 'error' });
    }
  }

  private transformTransaction(tx: SolanaRPCTransaction): SolanaTransaction {
    const accountKeys = tx.transaction.message.accountKeys;
    const signature = tx.transaction.signatures?.[0] || '';
    const fee = lamportsToSol(tx.meta.fee);

    // Extract account balance changes for accurate fund flow analysis
    const accountChanges = this.extractAccountChanges(tx, accountKeys);

    // Extract token balance changes for SPL token analysis
    const tokenChanges = this.extractTokenChanges(tx);

    // Determine primary currency and amount from balance changes
    const { primaryAmount, primaryCurrency } = this.determinePrimaryTransfer(accountChanges, tokenChanges);

    // Extract basic transaction data (pure data extraction, no business logic)
    return {
      // Balance change data for accurate fund flow analysis
      accountChanges,

      // Core transaction data
      amount: primaryAmount, // Calculated from balance changes
      blockHeight: tx.slot,
      blockId: signature, // Use signature as block ID for Solana
      currency: primaryCurrency,

      // Fee information
      feeAmount: fee.toString(),
      feeCurrency: 'SOL',

      // Transaction flow (extract raw addresses, processor will determine direction)
      from: accountKeys?.[0] || '', // First account is fee payer
      id: signature,

      // Instruction data (raw extraction)
      instructions: tx.transaction.message.instructions.map((instruction) => ({
        accounts: instruction.accounts.map((accountIndex) => accountKeys[accountIndex] || ''),
        data: instruction.data,
        programId: accountKeys[instruction.programIdIndex] || '',
      })),

      // Log messages
      logMessages: tx.meta.logMessages || [],
      providerId: 'solana-rpc',
      signature,
      slot: tx.slot,
      status: tx.meta.err ? 'failed' : 'success',
      timestamp: tx.blockTime?.getTime() ?? 0,

      // Basic recipient (will be refined by processor)
      to: accountKeys?.[1] || '', // Second account is often recipient

      // Token balance changes for SPL token analysis
      tokenChanges,
    };
  }

  /**
   * Extract SOL balance changes for all accounts
   */
  private extractAccountChanges(tx: SolanaRPCTransaction, accountKeys: string[]): SolanaAccountChange[] {
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
   * Extract SPL token balance changes
   */
  private extractTokenChanges(tx: SolanaRPCTransaction): SolanaTokenChange[] {
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
        const changeAmount = new Decimal(change.postAmount).minus(change.preAmount).abs();
        const largestAmount = new Decimal(largest.postAmount).minus(largest.preAmount).abs();
        return changeAmount.greaterThan(largestAmount) ? change : largest;
      });

      const tokenAmount = new Decimal(largestTokenChange.postAmount).minus(largestTokenChange.preAmount).abs();
      return {
        primaryAmount: tokenAmount.toFixed(),
        primaryCurrency: largestTokenChange.symbol || largestTokenChange.mint,
      };
    }

    // Otherwise, find the largest SOL change (excluding fee payer)
    if (accountChanges.length > 1) {
      // Skip first account (fee payer) and find largest balance change
      const remainingChanges = accountChanges.slice(1);
      if (remainingChanges.length > 0) {
        const largestSolChange = remainingChanges.reduce((largest, change) => {
          const changeAmount = new Decimal(change.postBalance).minus(change.preBalance).abs();
          const largestAmount = new Decimal(largest.postBalance).minus(largest.preBalance).abs();
          return changeAmount.greaterThan(largestAmount) ? change : largest;
        });

        if (largestSolChange) {
          const solAmount = new Decimal(largestSolChange.postBalance).minus(largestSolChange.preBalance).abs();
          return {
            primaryAmount: solAmount.toFixed(),
            primaryCurrency: 'SOL',
          };
        }
      }
    }

    // Default fallback
    return {
      primaryAmount: '0',
      primaryCurrency: 'SOL',
    };
  }
}
