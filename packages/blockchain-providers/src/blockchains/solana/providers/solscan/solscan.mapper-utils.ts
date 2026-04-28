import { isErrorWithMessage } from '@exitbook/foundation';
import { type Result, err } from '@exitbook/foundation';

import type { NormalizationError } from '../../../../contracts/errors.js';
import { validateOutput } from '../../../../normalization/mapper-validation.js';
import type { SolanaStakingInstruction, SolanaTransaction, SolanaTokenChange } from '../../schemas.js';
import { SolanaTransactionSchema } from '../../schemas.js';
import { lamportsToSol, extractAccountChangesFromSolscan, generateSolanaTransactionEventId } from '../../utils.js';

import type { SolscanTransaction } from './solscan.schemas.js';

const STAKE_PROGRAM_ID = 'Stake11111111111111111111111111111111111111';

function normalizeSolscanStakingInstructionType(type: string): SolanaStakingInstruction['type'] {
  const normalized = type.toLowerCase();
  if (normalized.includes('authorize')) return 'authorize';
  if (normalized.includes('create')) return 'create';
  if (normalized.includes('deactivate')) return 'deactivate';
  if (normalized.includes('delegate')) return 'delegate';
  if (normalized.includes('initialize')) return 'initialize';
  if (normalized.includes('merge')) return 'merge';
  if (normalized.includes('split')) return 'split';
  if (normalized.includes('withdraw')) return 'withdraw';
  return 'unknown';
}

function getStringParam(params: Record<string, unknown>, keys: readonly string[]): string | undefined {
  for (const key of keys) {
    const value = params[key];
    if (typeof value === 'string' && value.trim().length > 0) {
      return value;
    }
  }

  return undefined;
}

function getLamportsParam(params: Record<string, unknown>): string | undefined {
  const value = params['lamports'] ?? params['amount'];
  if (typeof value === 'string' && value.trim().length > 0) {
    return value;
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.trunc(value).toString();
  }
  return undefined;
}

function extractSolscanStakingInstructions(rawData: SolscanTransaction): SolanaStakingInstruction[] {
  return (rawData.parsedInstruction ?? [])
    .map((instruction, instructionIndex): SolanaStakingInstruction | undefined => {
      if (instruction.programId !== STAKE_PROGRAM_ID) {
        return undefined;
      }

      const params = instruction.params ?? {};

      return {
        instructionIndex,
        type: normalizeSolscanStakingInstructionType(instruction.type),
        stakeAccount: getStringParam(params, ['stakeAccount', 'stake_account', 'stakePubkey', 'account']),
        sourceAccount: getStringParam(params, ['source', 'sourceAccount', 'from']),
        destinationAccount: getStringParam(params, ['destination', 'destinationAccount', 'to']),
        voteAccount: getStringParam(params, ['voteAccount', 'vote_account', 'votePubkey']),
        lamports: getLamportsParam(params),
      };
    })
    .filter((instruction): instruction is SolanaStakingInstruction => instruction !== undefined);
}

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
      stakingInstructions: extractSolscanStakingInstructions(rawData),
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
