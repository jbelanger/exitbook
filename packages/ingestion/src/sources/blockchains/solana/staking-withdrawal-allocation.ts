import { type SolanaTransaction } from '@exitbook/blockchain-providers/solana';
import { fromBaseUnitsToDecimalString, type Result } from '@exitbook/foundation';
import { err, ok } from '@exitbook/foundation';
import { getLogger } from '@exitbook/logger';

import { SOLANA_NATIVE_STAKE_PROGRAM_ID } from './program-ids.js';
import type { SolanaStakingWithdrawalAllocation } from './types.js';

const logger = getLogger('solana-staking-withdrawal-allocation');

interface SolanaAccountLamportsChange {
  account: string;
  delta: bigint;
  postBalance: bigint;
  preBalance: bigint;
}

function hasNativeStakeProgramInstruction(tx: SolanaTransaction): boolean {
  return tx.instructions?.some((instruction) => instruction.programId === SOLANA_NATIVE_STAKE_PROGRAM_ID) ?? false;
}

function isNativeStakeProgramAccount(tx: SolanaTransaction, account: string): boolean {
  return (
    tx.instructions?.some(
      (instruction) =>
        instruction.programId === SOLANA_NATIVE_STAKE_PROGRAM_ID && instruction.accounts?.includes(account)
    ) ?? false
  );
}

function parseLamportsAmount(params: { label: string; transactionId: string; value: string }): Result<bigint, Error> {
  try {
    return ok(BigInt(params.value));
  } catch (error) {
    return err(
      new Error(
        `Failed to parse Solana lamports for ${params.label} in transaction ${params.transactionId}: ${String(error)}`
      )
    );
  }
}

function lamportsToSolAmount(lamports: bigint): Result<string, Error> {
  return fromBaseUnitsToDecimalString(lamports.toString(), 9);
}

function collectSolanaAccountLamportsChanges(tx: SolanaTransaction): Result<SolanaAccountLamportsChange[], Error> {
  const changes: SolanaAccountLamportsChange[] = [];

  for (const change of tx.accountChanges ?? []) {
    const preBalanceResult = parseLamportsAmount({
      label: `preBalance for account ${change.account}`,
      transactionId: tx.id,
      value: change.preBalance,
    });
    if (preBalanceResult.isErr()) {
      return err(preBalanceResult.error);
    }

    const postBalanceResult = parseLamportsAmount({
      label: `postBalance for account ${change.account}`,
      transactionId: tx.id,
      value: change.postBalance,
    });
    if (postBalanceResult.isErr()) {
      return err(postBalanceResult.error);
    }

    changes.push({
      account: change.account,
      delta: postBalanceResult.value - preBalanceResult.value,
      postBalance: postBalanceResult.value,
      preBalance: preBalanceResult.value,
    });
  }

  return ok(changes);
}

function sumPositiveUserLamportsDelta(
  changes: readonly SolanaAccountLamportsChange[],
  userAddresses: ReadonlySet<string>
): bigint {
  return changes
    .filter((change) => userAddresses.has(change.account) && change.delta > 0n)
    .reduce((total, change) => total + change.delta, 0n);
}

function findCreatedNativeStakeAccounts(params: {
  changes: readonly SolanaAccountLamportsChange[];
  tx: SolanaTransaction;
  userAddresses: ReadonlySet<string>;
}): SolanaAccountLamportsChange[] {
  return params.changes.filter(
    (change) =>
      !params.userAddresses.has(change.account) &&
      change.preBalance === 0n &&
      change.postBalance > 0n &&
      isNativeStakeProgramAccount(params.tx, change.account)
  );
}

function findClosedNativeStakeAccounts(params: {
  changes: readonly SolanaAccountLamportsChange[];
  tx: SolanaTransaction;
  userAddresses: ReadonlySet<string>;
}): SolanaAccountLamportsChange[] {
  return params.changes.filter(
    (change) =>
      !params.userAddresses.has(change.account) &&
      change.preBalance > 0n &&
      change.postBalance === 0n &&
      isNativeStakeProgramAccount(params.tx, change.account)
  );
}

function sortTransactionsByLedgerOrder(transactions: Iterable<SolanaTransaction>): SolanaTransaction[] {
  return [...transactions].sort((left, right) => left.timestamp - right.timestamp || left.id.localeCompare(right.id));
}

function dedupeTransactionsByHash(transactions: readonly SolanaTransaction[]): SolanaTransaction[] {
  const uniqueTransactionsByHash = new Map<string, SolanaTransaction>();

  for (const transaction of transactions) {
    if (!uniqueTransactionsByHash.has(transaction.id)) {
      uniqueTransactionsByHash.set(transaction.id, transaction);
    }
  }

  return [...uniqueTransactionsByHash.values()];
}

export function buildSolanaStakingWithdrawalAllocations(params: {
  transactions: readonly SolanaTransaction[];
  userAddresses: readonly string[];
}): Result<ReadonlyMap<string, SolanaStakingWithdrawalAllocation>, Error> {
  const userAddresses = new Set(params.userAddresses);
  const principalLamportsByStakeAccount = new Map<string, bigint>();
  const allocations = new Map<string, SolanaStakingWithdrawalAllocation>();
  const transactions = sortTransactionsByLedgerOrder(dedupeTransactionsByHash(params.transactions));

  for (const tx of transactions) {
    if (!hasNativeStakeProgramInstruction(tx)) {
      continue;
    }

    const changesResult = collectSolanaAccountLamportsChanges(tx);
    if (changesResult.isErr()) {
      return err(changesResult.error);
    }
    const changes = changesResult.value;

    const closedStakeAccounts = findClosedNativeStakeAccounts({ changes, tx, userAddresses });
    const userInflowLamports = sumPositiveUserLamportsDelta(changes, userAddresses);
    if (closedStakeAccounts.length > 0 && userInflowLamports > 0n) {
      let stakedPrincipalLamports = 0n;
      const stakeAccountAddresses: string[] = [];

      for (const closedStakeAccount of closedStakeAccounts) {
        stakeAccountAddresses.push(closedStakeAccount.account);
        const knownPrincipalLamports = principalLamportsByStakeAccount.get(closedStakeAccount.account);
        if (knownPrincipalLamports === undefined) {
          logger.warn(
            { stakeAccount: closedStakeAccount.account, transactionId: tx.id },
            'Solana stake account closed without a prior principal record; treating withdrawal as principal'
          );
          stakedPrincipalLamports = userInflowLamports;
          break;
        }

        stakedPrincipalLamports += knownPrincipalLamports;
        principalLamportsByStakeAccount.delete(closedStakeAccount.account);
      }

      const liquidPrincipalLamports =
        userInflowLamports < stakedPrincipalLamports ? userInflowLamports : stakedPrincipalLamports;
      const rewardLamports =
        userInflowLamports > stakedPrincipalLamports ? userInflowLamports - stakedPrincipalLamports : 0n;
      const stakedPrincipalAmountResult = lamportsToSolAmount(stakedPrincipalLamports);
      if (stakedPrincipalAmountResult.isErr()) {
        return err(stakedPrincipalAmountResult.error);
      }
      const liquidPrincipalAmountResult = lamportsToSolAmount(liquidPrincipalLamports);
      if (liquidPrincipalAmountResult.isErr()) {
        return err(liquidPrincipalAmountResult.error);
      }
      const rewardAmountResult = lamportsToSolAmount(rewardLamports);
      if (rewardAmountResult.isErr()) {
        return err(rewardAmountResult.error);
      }

      allocations.set(tx.id, {
        liquidPrincipalAmount: liquidPrincipalAmountResult.value,
        rewardAmount: rewardAmountResult.value,
        stakeAccountAddresses,
        stakedPrincipalAmount: stakedPrincipalAmountResult.value,
      });
    }

    for (const createdStakeAccount of findCreatedNativeStakeAccounts({ changes, tx, userAddresses })) {
      const currentPrincipalLamports = principalLamportsByStakeAccount.get(createdStakeAccount.account) ?? 0n;
      principalLamportsByStakeAccount.set(
        createdStakeAccount.account,
        currentPrincipalLamports + createdStakeAccount.postBalance
      );
    }
  }

  return ok(allocations);
}
