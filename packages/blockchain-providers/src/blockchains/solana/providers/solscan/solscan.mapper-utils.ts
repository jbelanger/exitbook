import { isErrorWithMessage } from '@exitbook/core';
import { type Result, err } from 'neverthrow';

import { type NormalizationError } from '../../../../core/index.js';
import { validateOutput } from '../../../../core/index.js';
import type { SolanaTransaction, SolanaTokenChange } from '../../schemas.js';
import { SolanaTransactionSchema } from '../../schemas.js';
import { lamportsToSol, extractAccountChangesFromSolscan, generateSolanaTransactionEventId } from '../../utils.js';

import type { SolscanTransaction } from './solscan.schemas.js';

/**
 * Pure function for Solscan transaction mapping
 * Following the Functional Core / Imperative Shell pattern
 */

/**
 * Map Solscan transaction to normalized SolanaTransaction
 * Input is already validated by HTTP client, output validated here
 */
export function mapSolscanTransaction(rawData: SolscanTransaction): Result<SolanaTransaction, NormalizationError> {
  try {
    const fee = lamportsToSol(rawData.fee);

    const accountChanges = rawData.inputAccount ? extractAccountChangesFromSolscan(rawData.inputAccount) : [];

    const tokenChanges: SolanaTokenChange[] = [];

    const timestamp = rawData.blockTime?.getTime() ?? 0;

    const solanaTransaction: SolanaTransaction = {
      accountChanges,
      blockHeight: rawData.slot,
      blockId: rawData.txHash,
      eventId: generateSolanaTransactionEventId({ signature: rawData.txHash }),
      feeAmount: fee.toFixed(),
      feeCurrency: 'SOL',
      feePayer: rawData.signer?.[0], // First signer is the fee payer in Solana
      id: rawData.txHash,
      instructions:
        rawData.parsedInstruction?.map((instruction) => ({
          data: JSON.stringify(instruction.params || {}),
          instructionType: instruction.type,
          programId: instruction.programId,
          programName: instruction.program,
        })) || [],
      logMessages: rawData.logMessage || [],
      providerName: 'solscan',
      signature: rawData.txHash,
      slot: rawData.slot,
      status: rawData.status === 'Success' ? 'success' : 'failed',
      timestamp,
      tokenChanges,
    };

    return validateOutput(solanaTransaction, SolanaTransactionSchema, 'SolscanTransaction');
  } catch (error) {
    const errorMessage = isErrorWithMessage(error) ? error.message : String(error);
    return err({ message: `Failed to transform transaction: ${errorMessage}`, type: 'error' });
  }
}
