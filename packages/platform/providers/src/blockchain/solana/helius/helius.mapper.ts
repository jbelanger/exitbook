import { isErrorWithMessage } from '@exitbook/core';
import type { SourceMetadata } from '@exitbook/core';
import { type Result, err, ok } from 'neverthrow';

import { BaseRawDataMapper } from '../../../shared/blockchain/base/mapper.ts';
import type { NormalizationError } from '../../../shared/blockchain/index.ts';
import { determinePrimaryTransfer, extractAccountChanges, extractTokenChanges } from '../mapper-utils.js';
import { SolanaTransactionSchema } from '../schemas.js';
import type { SolanaTransaction } from '../types.js';
import { lamportsToSol } from '../utils.js';

import { SolanaRawTransactionDataSchema, type HeliusTransaction } from './helius.schemas.js';

export class HeliusTransactionMapper extends BaseRawDataMapper<HeliusTransaction, SolanaTransaction> {
  protected readonly inputSchema = SolanaRawTransactionDataSchema;
  protected readonly outputSchema = SolanaTransactionSchema;

  protected mapInternal(
    rawData: HeliusTransaction,
    sourceContext: SourceMetadata
  ): Result<SolanaTransaction, NormalizationError> {
    // Validate required signature field
    const signature = rawData.transaction.signatures?.[0] ?? rawData.signature;
    if (!signature) {
      return err({ message: 'Transaction signature is required for normalization', type: 'error' });
    }

    try {
      const solanaTransaction = this.transformTransaction(rawData, signature, sourceContext);
      return ok(solanaTransaction);
    } catch (error) {
      const errorMessage = isErrorWithMessage(error) ? error.message : String(error);
      return err({ message: `Failed to transform transaction: ${errorMessage}`, type: 'error' });
    }
  }

  private transformTransaction(
    tx: HeliusTransaction,
    signature: string,
    _sourceContext: SourceMetadata
  ): SolanaTransaction {
    const accountKeys = tx.transaction.message.accountKeys;
    const fee = lamportsToSol(tx.meta.fee);

    // Extract account balance changes for accurate fund flow analysis
    const accountChanges = extractAccountChanges(tx.meta.preBalances, tx.meta.postBalances, accountKeys);

    // Extract token balance changes for SPL token analysis with mint addresses
    const tokenChanges = extractTokenChanges(tx.meta.preTokenBalances, tx.meta.postTokenBalances, true);

    // Determine primary currency and amount from balance changes
    const { primaryAmount, primaryCurrency } = determinePrimaryTransfer(accountChanges, tokenChanges);

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
        programId: undefined, // Will be extracted by processor if needed
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
}
