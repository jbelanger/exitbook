import { isErrorWithMessage } from '@exitbook/core';
import type { SourceMetadata } from '@exitbook/core';
import { type Result, err, ok } from 'neverthrow';

import { BaseRawDataMapper } from '../../../shared/blockchain/base/mapper.js';
import type { NormalizationError } from '../../../shared/blockchain/index.js';
import { determinePrimaryTransfer, determineRecipient, extractAccountChangesFromSolscan } from '../mapper-utils.js';
import { SolanaTransactionSchema } from '../schemas.js';
import type { SolanaTokenChange, SolanaTransaction } from '../types.js';
import { lamportsToSol } from '../utils.js';

import { SolscanRawTransactionDataSchema, type SolscanTransaction } from './solscan.schemas.js';

export class SolscanTransactionMapper extends BaseRawDataMapper<SolscanTransaction, SolanaTransaction> {
  protected readonly inputSchema = SolscanRawTransactionDataSchema;
  protected readonly outputSchema = SolanaTransactionSchema;

  protected mapInternal(
    rawData: SolscanTransaction,
    _sourceContext: SourceMetadata
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
    const accountChanges = tx.inputAccount ? extractAccountChangesFromSolscan(tx.inputAccount) : [];

    // Solscan doesn't provide detailed token balance changes, so we'll create minimal token changes
    // The processor will handle more sophisticated token transfer detection
    const tokenChanges: SolanaTokenChange[] = [];

    // Determine primary currency and amount from balance changes
    const { primaryAmount, primaryCurrency } = determinePrimaryTransfer(accountChanges, tokenChanges);

    // Determine basic recipient from account changes
    const feePayerAccount = tx.signer?.[0] || '';
    const recipient = tx.inputAccount ? determineRecipient(tx.inputAccount, feePayerAccount) : '';

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
      from: feePayerAccount,
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
      providerName: 'solscan',
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
}
