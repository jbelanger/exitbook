import { isErrorWithMessage } from '@exitbook/core';
import { type Result, err } from 'neverthrow';

import type { NormalizationError } from '../../../../core/index.ts';
import { validateOutput } from '../../../../core/index.ts';
import type { SolanaTransaction } from '../../schemas.ts';
import { SolanaTransactionSchema } from '../../schemas.ts';
import { lamportsToSol, extractAccountChanges, extractTokenChanges, determinePrimaryTransfer } from '../../utils.ts';

import type { HeliusTransaction } from './helius.schemas.js';

/**
 * Pure function for Helius transaction mapping
 * Following the Functional Core / Imperative Shell pattern
 */

/**
 * Map Helius transaction to normalized SolanaTransaction
 * Input is already validated by HTTP client, output validated here
 */
export function mapHeliusTransaction(rawData: HeliusTransaction): Result<SolanaTransaction, NormalizationError> {
  const signature = rawData.transaction.signatures?.[0] ?? rawData.signature;
  if (!signature) {
    return err({ message: 'Transaction signature is required for normalization', type: 'error' });
  }

  try {
    const accountKeys = rawData.transaction.message.accountKeys;
    const fee = lamportsToSol(rawData.meta.fee);

    const accountChanges = extractAccountChanges(rawData.meta.preBalances, rawData.meta.postBalances, accountKeys);

    const tokenChanges = extractTokenChanges(rawData.meta.preTokenBalances, rawData.meta.postTokenBalances, true);

    const { primaryAmount, primaryCurrency } = determinePrimaryTransfer(accountChanges, tokenChanges);

    const solanaTransaction: SolanaTransaction = {
      accountChanges,
      amount: primaryAmount ?? '0',
      blockHeight: rawData.slot,
      blockId: signature,
      currency: primaryCurrency ?? 'SOL',
      feeAmount: fee.toString(),
      feeCurrency: 'SOL',
      from: accountKeys?.[0] || '',
      id: signature,
      instructions: (rawData.transaction.message.instructions || []).map((instruction) => ({
        accounts: [],
        data: JSON.stringify(instruction),
        programId: undefined,
      })),
      logMessages: rawData.meta.logMessages || [],
      providerName: 'helius',
      signature,
      slot: rawData.slot,
      status: rawData.meta.err ? 'failed' : 'success',
      timestamp: typeof rawData.blockTime === 'number' ? rawData.blockTime * 1000 : (rawData.blockTime?.getTime() ?? 0),
      to: accountKeys?.[1] || '',
      tokenChanges,
    };

    return validateOutput(solanaTransaction, SolanaTransactionSchema, 'HeliusTransaction');
  } catch (error) {
    const errorMessage = isErrorWithMessage(error) ? error.message : String(error);
    return err({ message: `Failed to transform transaction: ${errorMessage}`, type: 'error' });
  }
}
