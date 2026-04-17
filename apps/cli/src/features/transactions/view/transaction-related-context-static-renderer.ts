import pc from 'picocolors';

import type { TransactionRelatedContext } from '../transactions-view-model.js';

export function buildTransactionRelatedContextLines(relatedContext: TransactionRelatedContext): string[] {
  const lines = [pc.dim('Related context')];

  if (relatedContext.fromAccount) {
    lines.push(`  From account: ${formatEndpointAccountMatch(relatedContext.fromAccount)}`);
  }

  if (relatedContext.toAccount) {
    lines.push(`  To account: ${formatEndpointAccountMatch(relatedContext.toAccount)}`);
  }

  if (relatedContext.openGapRefs && relatedContext.openGapRefs.length > 0) {
    lines.push(`  Open gap refs: ${relatedContext.openGapRefs.join(', ')}`);
  }

  if (relatedContext.sameHashSiblingTransactionRefs && relatedContext.sameHashSiblingTransactionCount) {
    lines.push(
      `  Same-hash sibling txs: ${formatRelatedTransactionRefs(
        relatedContext.sameHashSiblingTransactionRefs,
        relatedContext.sameHashSiblingTransactionCount
      )}`
    );
  }

  if (relatedContext.sharedFromTransactionRefs && relatedContext.sharedFromTransactionCount) {
    lines.push(
      `  Same from endpoint txs: ${formatRelatedTransactionRefs(
        relatedContext.sharedFromTransactionRefs,
        relatedContext.sharedFromTransactionCount
      )}`
    );
  }

  if (relatedContext.sharedToTransactionRefs && relatedContext.sharedToTransactionCount) {
    lines.push(
      `  Same to endpoint txs: ${formatRelatedTransactionRefs(
        relatedContext.sharedToTransactionRefs,
        relatedContext.sharedToTransactionCount
      )}`
    );
  }

  return lines;
}

function formatEndpointAccountMatch(accountMatch: NonNullable<TransactionRelatedContext['fromAccount']>): string {
  const namePrefix = accountMatch.accountName ? `${accountMatch.accountName} ` : '';
  return `${namePrefix}${pc.dim(`(${accountMatch.accountRef})`)} ${pc.cyan(accountMatch.platformKey)}`.trimEnd();
}

function formatRelatedTransactionRefs(refs: string[], totalCount: number): string {
  if (totalCount > refs.length) {
    return `${refs.join(', ')} ${pc.dim(`(${totalCount} total)`)}`;
  }

  return refs.join(', ');
}
