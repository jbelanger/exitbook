import { isErrorWithMessage, type RawTransactionMetadata } from '@exitbook/core';
import type { ImportSessionMetadata } from '@exitbook/data';
import { type Result, err, ok } from 'neverthrow';

import { BaseRawDataMapper } from '../../../core/blockchain/base/mapper.ts';
import { RegisterTransactionMapper } from '../../../core/blockchain/index.ts';
import type { NormalizationError } from '../../../core/blockchain/index.ts';
import { SolanaTransactionSchema } from '../schemas.js';
import type { SolanaAccountChange, SolanaTokenChange, SolanaTransaction } from '../types.js';
import { lamportsToSol } from '../utils.js';

import { SolscanRawTransactionDataSchema } from './solscan.schemas.js';
import type { SolscanTransaction } from './solscan.types.js';

@RegisterTransactionMapper('solscan')
export class SolscanTransactionMapper extends BaseRawDataMapper<SolscanTransaction, SolanaTransaction> {
  protected readonly inputSchema = SolscanRawTransactionDataSchema;
  protected readonly outputSchema = SolanaTransactionSchema;

  protected mapInternal(
    rawData: SolscanTransaction,
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

  private transformTransaction(tx: SolscanTransaction): SolanaTransaction {
    const fee = lamportsToSol(tx.fee);

    // Extract account balance changes for accurate fund flow analysis
    const accountChanges = this.extractAccountChanges(tx);

    // Solscan doesn't provide detailed token balance changes, so we'll create minimal token changes
    // The processor will handle more sophisticated token transfer detection
    const tokenChanges: SolanaTokenChange[] = [];

    // Determine primary currency and amount from balance changes
    const { primaryAmount, primaryCurrency } = this.determinePrimaryTransfer(accountChanges, tokenChanges);

    // Determine basic recipient from account changes
    const recipient = this.determineRecipient(tx);

    // Extract basic transaction data (pure data extraction, no business logic)
    return {
      // Balance change data for accurate fund flow analysis
      accountChanges,

      // Core transaction data
      amount: primaryAmount, // Calculated from balance changes
      blockHeight: tx.slot,
      blockId: tx.txHash, // Use txHash as block ID for Solscan
      currency: primaryCurrency,

      // Fee information
      feeAmount: fee.toString(),
      feeCurrency: 'SOL',

      // Transaction flow (extract raw addresses, processor will determine direction)
      from: tx.signer?.[0] || '', // First signer is fee payer
      id: tx.txHash,

      // Instruction data (raw extraction from parsedInstruction)
      instructions:
        tx.parsedInstruction?.map((instruction) => ({
          data: JSON.stringify(instruction.params || {}), // Serialize params as data
          instructionType: instruction.type,
          programId: instruction.programId,
          programName: instruction.program,
        })) || [],

      // Log messages
      logMessages: tx.logMessage || [],
      providerId: 'solscan',
      signature: tx.txHash,
      slot: tx.slot,
      status: tx.status === 'Success' ? 'success' : 'failed',
      timestamp: tx.blockTime?.getTime() ?? 0,

      // Basic recipient (determined from account changes)
      to: recipient,

      // Token balance changes (minimal for Solscan)
      tokenChanges,
    };
  }

  /**
   * Extract SOL balance changes from Solscan inputAccount data
   */
  private extractAccountChanges(tx: SolscanTransaction): SolanaAccountChange[] {
    const changes: SolanaAccountChange[] = [];

    if (tx.inputAccount) {
      for (const accountData of tx.inputAccount) {
        // Only include accounts with balance changes
        if (accountData.preBalance !== accountData.postBalance) {
          changes.push({
            account: accountData.account,
            postBalance: accountData.postBalance.toString(),
            preBalance: accountData.preBalance.toString(),
          });
        }
      }
    }

    return changes;
  }

  /**
   * Determine the primary transfer amount and currency from balance changes
   * Solscan structure is simpler, so this focuses on SOL transfers
   */
  private determinePrimaryTransfer(
    accountChanges: SolanaAccountChange[],
    _tokenChanges: SolanaTokenChange[]
  ): { primaryAmount: string; primaryCurrency: string } {
    // Find the largest SOL change (excluding fee payer which is usually first signer)
    if (accountChanges.length > 1) {
      // Skip first account (fee payer) and find largest balance change
      const largestSolChange = accountChanges.slice(1).reduce((largest, change) => {
        if (!largest) return change;
        const changeAmount = Math.abs(parseFloat(change.postBalance) - parseFloat(change.preBalance));
        const largestAmount = Math.abs(parseFloat(largest.postBalance) - parseFloat(largest.preBalance));
        return changeAmount > largestAmount ? change : largest;
      }, accountChanges[1] ?? accountChanges[0]);

      if (largestSolChange) {
        const solAmount = Math.abs(parseFloat(largestSolChange.postBalance) - parseFloat(largestSolChange.preBalance));
        return {
          primaryAmount: solAmount.toString(),
          primaryCurrency: 'SOL',
        };
      }
    } else if (accountChanges.length === 1 && accountChanges[0]) {
      // Only one account change (probably fee-only transaction)
      const solAmount = Math.abs(parseFloat(accountChanges[0].postBalance) - parseFloat(accountChanges[0].preBalance));
      return {
        primaryAmount: solAmount.toString(),
        primaryCurrency: 'SOL',
      };
    }

    // Default fallback
    return {
      primaryAmount: '0',
      primaryCurrency: 'SOL',
    };
  }

  /**
   * Determine basic recipient from account changes
   */
  private determineRecipient(tx: SolscanTransaction): string {
    // Try to find the account that received funds (positive balance change, not the fee payer)
    const feePayerAccount = tx.signer?.[0] || '';

    if (tx.inputAccount) {
      const recipient = tx.inputAccount.find((account) => {
        const balanceChange = account.postBalance - account.preBalance;
        return balanceChange > 0 && account.account !== feePayerAccount;
      });

      if (recipient) {
        return recipient.account;
      }
    }

    // Fallback: return empty string, processor will determine
    return '';
  }
}
