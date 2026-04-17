import { buildVisibleProfileLinkGapAnalysis, type LinkGapIssue } from '@exitbook/accounting/linking';
import type { ProfileLinkGapSourceData } from '@exitbook/accounting/ports';
import { formatAccountFingerprintRef, type Account, type Transaction } from '@exitbook/core';

import { buildLinkGapRef } from '../links/link-selector.js';
import { normalizeBlockchainTransactionHashForGrouping } from '../shared/blockchain-transaction-hash-grouping.js';

import { formatTransactionFingerprintRef } from './transaction-selector.js';
import type { TransactionRelatedContext } from './transactions-view-model.js';

const MAX_RELATED_TRANSACTION_REFS = 5;

export function buildTransactionRelatedContext(
  source: ProfileLinkGapSourceData,
  transaction: Transaction,
  options?: {
    visibleGapIssues?: readonly LinkGapIssue[] | undefined;
  }
): TransactionRelatedContext | undefined {
  const visibleGapIssues = options?.visibleGapIssues ?? buildVisibleProfileLinkGapAnalysis(source).analysis.issues;
  const openGapRefs = buildOpenGapRefs(visibleGapIssues, transaction.txFingerprint);
  const sameHashSiblingRefs = buildSameHashSiblingTransactionRefs(source.transactions, transaction);
  const sharedFromRefs = buildSharedEndpointTransactionRefs(source.transactions, transaction, 'from');
  const sharedToRefs = buildSharedEndpointTransactionRefs(source.transactions, transaction, 'to');
  const fromAccount = buildEndpointAccountMatch(source.accounts, transaction.from);
  const toAccount = buildEndpointAccountMatch(source.accounts, transaction.to);

  const context: TransactionRelatedContext = {
    ...(fromAccount !== undefined ? { fromAccount } : {}),
    ...(openGapRefs.length > 0 ? { openGapRefs } : {}),
    ...(sameHashSiblingRefs.totalCount > 0
      ? {
          sameHashSiblingTransactionCount: sameHashSiblingRefs.totalCount,
          sameHashSiblingTransactionRefs: sameHashSiblingRefs.refs,
        }
      : {}),
    ...(sharedFromRefs.totalCount > 0
      ? {
          sharedFromTransactionCount: sharedFromRefs.totalCount,
          sharedFromTransactionRefs: sharedFromRefs.refs,
        }
      : {}),
    ...(sharedToRefs.totalCount > 0
      ? {
          sharedToTransactionCount: sharedToRefs.totalCount,
          sharedToTransactionRefs: sharedToRefs.refs,
        }
      : {}),
    ...(toAccount !== undefined ? { toAccount } : {}),
  };

  return hasTransactionRelatedContext(context) ? context : undefined;
}

function buildOpenGapRefs(issues: readonly LinkGapIssue[], txFingerprint: string): string[] {
  return issues
    .filter((issue) => issue.txFingerprint === txFingerprint)
    .map((issue) =>
      buildLinkGapRef({
        txFingerprint: issue.txFingerprint,
        assetId: issue.assetId,
        direction: issue.direction,
      })
    )
    .sort();
}

function buildSameHashSiblingTransactionRefs(
  transactions: readonly Transaction[],
  transaction: Transaction
): {
  refs: string[];
  totalCount: number;
} {
  const blockchainHash = transaction.blockchain?.transaction_hash;
  if (blockchainHash === undefined) {
    return {
      refs: [],
      totalCount: 0,
    };
  }

  const normalizedHash = normalizeBlockchainTransactionHashForGrouping(blockchainHash);
  const siblings = transactions
    .filter(
      (candidate) =>
        candidate.txFingerprint !== transaction.txFingerprint &&
        candidate.blockchain?.transaction_hash !== undefined &&
        normalizeBlockchainTransactionHashForGrouping(candidate.blockchain.transaction_hash) === normalizedHash
    )
    .sort(compareTransactionsByTimestampThenId);

  return {
    refs: siblings
      .slice(0, MAX_RELATED_TRANSACTION_REFS)
      .map((candidate) => formatTransactionFingerprintRef(candidate.txFingerprint)),
    totalCount: siblings.length,
  };
}

function buildSharedEndpointTransactionRefs(
  transactions: readonly Transaction[],
  transaction: Transaction,
  endpoint: 'from' | 'to'
): {
  refs: string[];
  totalCount: number;
} {
  const endpointValue = endpoint === 'from' ? transaction.from : transaction.to;
  if (endpointValue === undefined) {
    return {
      refs: [],
      totalCount: 0,
    };
  }

  const relatedTransactions = transactions
    .filter((candidate) => {
      if (candidate.txFingerprint === transaction.txFingerprint) {
        return false;
      }

      const candidateEndpoint = endpoint === 'from' ? candidate.from : candidate.to;
      return candidateEndpoint === endpointValue;
    })
    .sort((left, right) => compareTransactionsByCloseness(transaction, left, right));

  return {
    refs: relatedTransactions
      .slice(0, MAX_RELATED_TRANSACTION_REFS)
      .map((candidate) => formatTransactionFingerprintRef(candidate.txFingerprint)),
    totalCount: relatedTransactions.length,
  };
}

function buildEndpointAccountMatch(
  accounts: readonly Account[],
  endpoint: string | undefined
): TransactionRelatedContext['fromAccount'] {
  if (endpoint === undefined) {
    return undefined;
  }

  const account = accounts.find((candidate) => candidate.identifier === endpoint);
  if (account === undefined) {
    return undefined;
  }

  return {
    accountName: account.name,
    accountRef: formatAccountFingerprintRef(account.accountFingerprint),
    platformKey: account.platformKey,
  };
}

function compareTransactionsByCloseness(reference: Transaction, left: Transaction, right: Transaction): number {
  const referenceTimestamp = reference.timestamp;
  const leftDelta = Math.abs(left.timestamp - referenceTimestamp);
  const rightDelta = Math.abs(right.timestamp - referenceTimestamp);

  if (leftDelta !== rightDelta) {
    return leftDelta - rightDelta;
  }

  return compareTransactionsByTimestampThenId(left, right);
}

function compareTransactionsByTimestampThenId(left: Transaction, right: Transaction): number {
  if (left.timestamp !== right.timestamp) {
    return left.timestamp - right.timestamp;
  }

  return left.id - right.id;
}

function hasTransactionRelatedContext(context: TransactionRelatedContext): boolean {
  return (
    context.fromAccount !== undefined ||
    context.openGapRefs !== undefined ||
    context.sameHashSiblingTransactionRefs !== undefined ||
    context.sharedFromTransactionRefs !== undefined ||
    context.sharedToTransactionRefs !== undefined ||
    context.toAccount !== undefined
  );
}
