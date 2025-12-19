import { isErrorWithMessage } from '@exitbook/core';
import { type Result, err } from 'neverthrow';

import type { NormalizationError } from '../../../../core/index.ts';
import { validateOutput } from '../../../../core/index.ts';
import type { SolanaTransaction } from '../../schemas.ts';
import { SolanaTransactionSchema } from '../../schemas.ts';
import {
  lamportsToSol,
  extractAccountChanges,
  extractTokenChanges,
  determinePrimaryTransfer,
  generateSolanaTransactionEventId,
} from '../../utils.ts';

import type { SolanaRPCTransaction } from './solana-rpc.schemas.js';

/**
 * Pure function for Solana RPC transaction mapping
 * Following the Functional Core / Imperative Shell pattern
 */

/**
 * Map Solana RPC transaction to normalized SolanaTransaction
 * Input is already validated by HTTP client, output validated here
 */
export function mapSolanaRPCTransaction(rawData: SolanaRPCTransaction): Result<SolanaTransaction, NormalizationError> {
  try {
    const accountKeys = rawData.transaction.message.accountKeys;
    const signature = rawData.transaction.signatures?.[0] || '';
    const fee = lamportsToSol(rawData.meta.fee);

    const accountChanges = extractAccountChanges(rawData.meta.preBalances, rawData.meta.postBalances, accountKeys);

    const tokenChanges = extractTokenChanges(rawData.meta.preTokenBalances, rawData.meta.postTokenBalances, false);

    const { primaryAmount, primaryCurrency } = determinePrimaryTransfer(accountChanges, tokenChanges);

    const timestamp = rawData.blockTime?.getTime() ?? 0;
    const from = accountKeys?.[0] || '';
    const to = accountKeys?.[1] || '';

    const solanaTransaction: SolanaTransaction = {
      accountChanges,
      amount: primaryAmount,
      blockHeight: rawData.slot,
      blockId: signature,
      currency: primaryCurrency,
      eventId: generateSolanaTransactionEventId({ signature }),
      feeAmount: fee.toString(),
      feeCurrency: 'SOL',
      from,
      id: signature,
      instructions: rawData.transaction.message.instructions.map((instruction) => ({
        accounts: instruction.accounts.map((accountIndex) => accountKeys[accountIndex] || ''),
        data: instruction.data,
        programId: accountKeys[instruction.programIdIndex] || '',
      })),
      logMessages: rawData.meta.logMessages || [],
      providerName: 'solana-rpc',
      signature,
      slot: rawData.slot,
      status: rawData.meta.err ? 'failed' : 'success',
      timestamp,
      to,
      tokenChanges,
    };

    return validateOutput(solanaTransaction, SolanaTransactionSchema, 'SolanaRPCTransaction');
  } catch (error) {
    const errorMessage = isErrorWithMessage(error) ? error.message : String(error);
    return err({ message: `Failed to transform transaction: ${errorMessage}`, type: 'error' });
  }
}
