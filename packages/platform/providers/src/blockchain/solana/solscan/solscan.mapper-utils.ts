import { isErrorWithMessage } from '@exitbook/core';
import type { SourceMetadata } from '@exitbook/core';
import { type Result, err, ok } from 'neverthrow';

import type { NormalizationError } from '../../../shared/blockchain/index.js';
import { determinePrimaryTransfer, determineRecipient, extractAccountChangesFromSolscan } from '../mapper-utils.js';
import type { SolanaTokenChange, SolanaTransaction } from '../types.js';
import { lamportsToSol } from '../utils.js';

import type { SolscanTransaction } from './solscan.schemas.js';

/**
 * Pure function for Solscan transaction mapping
 * Following the Functional Core / Imperative Shell pattern
 */

/**
 * Map Solscan transaction to normalized SolanaTransaction
 */
export function mapSolscanTransaction(
  rawData: SolscanTransaction,
  _sourceContext: SourceMetadata
): Result<SolanaTransaction, NormalizationError> {
  try {
    const fee = lamportsToSol(rawData.fee);

    const accountChanges = rawData.inputAccount ? extractAccountChangesFromSolscan(rawData.inputAccount) : [];

    const tokenChanges: SolanaTokenChange[] = [];

    const { primaryAmount, primaryCurrency } = determinePrimaryTransfer(accountChanges, tokenChanges);

    const feePayerAccount = rawData.signer?.[0] || '';
    const recipient = rawData.inputAccount ? determineRecipient(rawData.inputAccount, feePayerAccount) : '';

    const solanaTransaction: SolanaTransaction = {
      accountChanges,
      amount: primaryAmount,
      blockHeight: rawData.slot,
      blockId: rawData.txHash,
      currency: primaryCurrency,
      feeAmount: fee.toString(),
      feeCurrency: 'SOL',
      from: feePayerAccount,
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
      timestamp: rawData.blockTime?.getTime() ?? 0,
      to: recipient,
      tokenChanges,
    };

    return ok(solanaTransaction);
  } catch (error) {
    const errorMessage = isErrorWithMessage(error) ? error.message : String(error);
    return err({ message: `Failed to transform transaction: ${errorMessage}`, type: 'error' });
  }
}
