import { isErrorWithMessage } from '@exitbook/core';
import type { SourceMetadata } from '@exitbook/core';
import { type Result, err, ok } from 'neverthrow';

import { BaseRawDataMapper } from '../../../shared/blockchain/base/mapper.ts';
import type { NormalizationError } from '../../../shared/blockchain/index.ts';
import { determinePrimaryTransfer, extractAccountChanges, extractTokenChanges } from '../mapper-utils.js';
import { SolanaTransactionSchema } from '../schemas.js';
import type { SolanaTransaction } from '../types.js';
import { lamportsToSol } from '../utils.js';

import { SolanaRPCRawTransactionDataSchema, type SolanaRPCTransaction } from './solana-rpc.schemas.js';

export class SolanaRPCTransactionMapper extends BaseRawDataMapper<SolanaRPCTransaction, SolanaTransaction> {
  protected readonly inputSchema = SolanaRPCRawTransactionDataSchema;
  protected readonly outputSchema = SolanaTransactionSchema;

  protected mapInternal(
    rawData: SolanaRPCTransaction,
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

  private transformTransaction(tx: SolanaRPCTransaction): SolanaTransaction {
    const accountKeys = tx.transaction.message.accountKeys;
    const signature = tx.transaction.signatures?.[0] || '';
    const fee = lamportsToSol(tx.meta.fee);

    // Extract account balance changes for accurate fund flow analysis
    const accountChanges = extractAccountChanges(tx.meta.preBalances, tx.meta.postBalances, accountKeys);

    // Extract token balance changes for SPL token analysis
    const tokenChanges = extractTokenChanges(tx.meta.preTokenBalances, tx.meta.postTokenBalances, false);

    // Determine primary currency and amount from balance changes
    const { primaryAmount, primaryCurrency } = determinePrimaryTransfer(accountChanges, tokenChanges);

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
}
