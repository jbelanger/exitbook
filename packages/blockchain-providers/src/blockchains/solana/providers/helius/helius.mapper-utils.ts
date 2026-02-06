import { isErrorWithMessage } from '@exitbook/core';
import { type Result, err } from 'neverthrow';

import { type NormalizationError } from '../../../../core/index.js';
import { validateOutput } from '../../../../core/index.js';
import type { SolanaTransaction } from '../../schemas.js';
import { SolanaTransactionSchema } from '../../schemas.js';
import {
  lamportsToSol,
  extractAccountChanges,
  extractTokenChanges,
  generateSolanaTransactionEventId,
} from '../../utils.js';

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

    const tokenChanges = extractTokenChanges(
      rawData.meta.preTokenBalances ?? undefined,
      rawData.meta.postTokenBalances ?? undefined,
      true
    );

    const timestamp =
      typeof rawData.blockTime === 'number' ? rawData.blockTime * 1000 : (rawData.blockTime?.getTime() ?? 0);

    const solanaTransaction: SolanaTransaction = {
      accountChanges,
      blockHeight: rawData.slot,
      blockId: signature,
      eventId: generateSolanaTransactionEventId({ signature }),
      feeAmount: fee.toFixed(),
      feeCurrency: 'SOL',
      feePayer: accountKeys?.[0], // First account is always the fee payer in Solana
      id: signature,
      instructions: (rawData.transaction.message.instructions || []).map((instruction) => {
        // Extract programId from accountKeys using programIdIndex
        const programId = accountKeys?.[instruction.programIdIndex];
        // Map account indices to actual account addresses
        const accounts = (instruction.accounts || [])
          .map((accountIndex) => accountKeys?.[accountIndex])
          .filter((account): account is string => !!account);
        return {
          accounts,
          data: instruction.data,
          programId,
        };
      }),
      logMessages: rawData.meta.logMessages || [],
      providerName: 'helius',
      signature,
      slot: rawData.slot,
      status: rawData.meta.err ? 'failed' : 'success',
      timestamp,
      tokenChanges,
    };

    return validateOutput(solanaTransaction, SolanaTransactionSchema, 'HeliusTransaction');
  } catch (error) {
    const errorMessage = isErrorWithMessage(error) ? error.message : String(error);
    return err({ message: `Failed to transform transaction: ${errorMessage}`, type: 'error' });
  }
}
