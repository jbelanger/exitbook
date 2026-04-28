import type { TransactionDiagnostic } from '@exitbook/core';
import { err, ok, type Result } from '@exitbook/foundation';
import type {
  AccountingDiagnosticDraft,
  AccountingJournalDraft,
  AccountingJournalRelationshipDraft,
  AccountingPostingDraft,
} from '@exitbook/ledger';

import {
  resolveDefaultJournalStableKey,
  resolvePostingDrivenJournalKind,
} from '../shared/ledger-journal-kind-utils.js';

import type { EvmJournalAssemblyParts } from './journal-assembler-types.js';
import type { EvmProtocolEvent } from './types.js';

function findProtocolEventPosting(params: {
  assetId: string;
  direction: 'in' | 'out';
  postings: readonly AccountingPostingDraft[];
}): AccountingPostingDraft | undefined {
  return params.postings.find((posting) => {
    if (posting.assetId !== params.assetId || posting.role !== 'principal') {
      return false;
    }

    return params.direction === 'in' ? posting.quantity.gt(0) : posting.quantity.lt(0);
  });
}

function buildProtocolEventRelationships(params: {
  journalStableKey: string;
  postings: readonly AccountingPostingDraft[];
  protocolEvents: readonly EvmProtocolEvent[];
  sourceActivityFingerprint: string;
}): Result<AccountingJournalRelationshipDraft[], Error> {
  const relationships: AccountingJournalRelationshipDraft[] = [];

  for (let index = 0; index < params.protocolEvents.length; index++) {
    const event = params.protocolEvents[index];
    if (!event) {
      continue;
    }

    const sourcePosting = findProtocolEventPosting({
      assetId: event.sourceAssetId,
      direction: 'out',
      postings: params.postings,
    });
    const targetPosting = findProtocolEventPosting({
      assetId: event.targetAssetId,
      direction: 'in',
      postings: params.postings,
    });

    if (!sourcePosting || !targetPosting) {
      return err(
        new Error(
          `EVM v2 protocol event ${event.kind} could not resolve source/target postings for relationship ${index + 1}`
        )
      );
    }

    relationships.push({
      relationshipStableKey: `${event.kind}:${index + 1}`,
      relationshipKind: event.relationshipKind,
      source: {
        sourceActivityFingerprint: params.sourceActivityFingerprint,
        journalStableKey: params.journalStableKey,
        postingStableKey: sourcePosting.postingStableKey,
      },
      target: {
        sourceActivityFingerprint: params.sourceActivityFingerprint,
        journalStableKey: params.journalStableKey,
        postingStableKey: targetPosting.postingStableKey,
      },
    });
  }

  return ok(relationships);
}

export function buildEvmJournals(parts: EvmJournalAssemblyParts): Result<AccountingJournalDraft[], Error> {
  const journalKind = resolvePostingDrivenJournalKind({
    forceProtocolEvent: parts.protocolEvents.length > 0,
    valuePostings: parts.valuePostings,
  });
  const postings = parts.feePosting ? [...parts.valuePostings, parts.feePosting] : [...parts.valuePostings];

  if (postings.length === 0) {
    return ok([]);
  }

  const journalStableKey = resolveDefaultJournalStableKey(journalKind);
  const relationships = buildProtocolEventRelationships({
    journalStableKey,
    postings,
    protocolEvents: parts.protocolEvents,
    sourceActivityFingerprint: parts.sourceActivityFingerprint,
  });
  if (relationships.isErr()) {
    return err(relationships.error);
  }

  return ok([
    {
      sourceActivityFingerprint: parts.sourceActivityFingerprint,
      journalStableKey,
      journalKind,
      postings,
      ...(relationships.value.length === 0 ? {} : { relationships: relationships.value }),
      ...(parts.diagnostics.length === 0 ? {} : { diagnostics: [...parts.diagnostics] }),
    },
  ]);
}

export function mapTransactionDiagnostics(
  diagnostics: readonly TransactionDiagnostic[] | undefined
): AccountingDiagnosticDraft[] {
  return (diagnostics ?? []).map((diagnostic) => ({
    code: diagnostic.code,
    message: diagnostic.message,
    ...(diagnostic.severity === undefined ? {} : { severity: diagnostic.severity }),
    ...(diagnostic.metadata === undefined ? {} : { metadata: diagnostic.metadata }),
  }));
}
