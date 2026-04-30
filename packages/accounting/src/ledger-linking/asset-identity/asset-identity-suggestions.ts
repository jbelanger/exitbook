import { err, ok, type Currency, type Result } from '@exitbook/foundation';
import type { AccountingJournalRelationshipKind } from '@exitbook/ledger';

import type { LedgerLinkingDiagnostics } from '../diagnostics/linking-diagnostics.js';

import {
  canonicalizeLedgerLinkingAssetIdentityPair,
  type LedgerLinkingAssetIdentityEvidenceKind,
} from './asset-identity-resolution.js';

const DEFAULT_MAX_EXAMPLES_PER_SUGGESTION = 3;

export type LedgerLinkingAssetIdentitySuggestionEvidenceKind = Extract<
  LedgerLinkingAssetIdentityEvidenceKind,
  'exact_hash_observed' | 'amount_time_observed'
>;

export interface LedgerLinkingAssetIdentitySuggestionInput {
  amount: string;
  assetSymbol: Currency;
  sourceAssetId: string;
  sourceBlockchainTransactionHash?: string | undefined;
  sourceCandidateId?: number | undefined;
  sourcePostingFingerprint: string;
  targetAssetId: string;
  targetBlockchainTransactionHash?: string | undefined;
  targetCandidateId?: number | undefined;
  targetPostingFingerprint: string;
  timeDistanceSeconds?: number | undefined;
}

export interface LedgerLinkingAssetIdentitySuggestionExample {
  amount: string;
  sourceBlockchainTransactionHash?: string | undefined;
  sourceCandidateId?: number | undefined;
  sourcePostingFingerprint: string;
  targetBlockchainTransactionHash?: string | undefined;
  targetCandidateId?: number | undefined;
  targetPostingFingerprint: string;
  timeDistanceSeconds?: number | undefined;
}

export interface LedgerLinkingAssetIdentitySuggestion {
  assetIdA: string;
  assetIdB: string;
  assetSymbol: Currency;
  blockCount: number;
  evidenceKind: LedgerLinkingAssetIdentitySuggestionEvidenceKind;
  examples: readonly LedgerLinkingAssetIdentitySuggestionExample[];
  relationshipKind: AccountingJournalRelationshipKind;
}

export interface LedgerLinkingAssetIdentitySuggestionOptions {
  evidenceKind?: LedgerLinkingAssetIdentitySuggestionEvidenceKind | undefined;
  maxExamplesPerSuggestion?: number | undefined;
  relationshipKind?: AccountingJournalRelationshipKind | undefined;
}

interface AssetIdentitySuggestionGroup {
  assetIdA: string;
  assetIdB: string;
  assetSymbol: Currency;
  evidenceKind: LedgerLinkingAssetIdentitySuggestionEvidenceKind;
  examples: LedgerLinkingAssetIdentitySuggestionExample[];
  relationshipKind: AccountingJournalRelationshipKind;
}

export function buildLedgerLinkingAssetIdentitySuggestions(
  blocks: readonly LedgerLinkingAssetIdentitySuggestionInput[],
  options: LedgerLinkingAssetIdentitySuggestionOptions = {}
): Result<LedgerLinkingAssetIdentitySuggestion[], Error> {
  const evidenceKind = options.evidenceKind ?? 'exact_hash_observed';
  const relationshipKind = options.relationshipKind ?? 'internal_transfer';
  const maxExamplesPerSuggestion = options.maxExamplesPerSuggestion ?? DEFAULT_MAX_EXAMPLES_PER_SUGGESTION;
  if (!Number.isInteger(maxExamplesPerSuggestion) || maxExamplesPerSuggestion <= 0) {
    return err(
      new Error(
        `Ledger-linking asset identity suggestions require a positive integer example limit, got ${maxExamplesPerSuggestion}`
      )
    );
  }

  const groups = new Map<string, AssetIdentitySuggestionGroup>();
  const blockCounts = new Map<string, number>();

  for (const block of blocks) {
    const validation = validateAssetIdentitySuggestionInput(block, evidenceKind);
    if (validation.isErr()) {
      return err(validation.error);
    }

    const pair = canonicalizeLedgerLinkingAssetIdentityPair(block.sourceAssetId, block.targetAssetId);
    if (pair.isErr()) {
      return err(pair.error);
    }

    const key = buildAssetIdentitySuggestionKey(
      evidenceKind,
      relationshipKind,
      pair.value.assetIdA,
      pair.value.assetIdB,
      block
    );
    const group =
      groups.get(key) ??
      ({
        assetIdA: pair.value.assetIdA,
        assetIdB: pair.value.assetIdB,
        assetSymbol: block.assetSymbol,
        evidenceKind,
        examples: [],
        relationshipKind,
      } satisfies AssetIdentitySuggestionGroup);

    group.examples.push(toSuggestionExample(block));
    groups.set(key, group);
    blockCounts.set(key, (blockCounts.get(key) ?? 0) + 1);
  }

  const suggestions: LedgerLinkingAssetIdentitySuggestion[] = [];
  for (const [key, group] of groups) {
    const blockCount = blockCounts.get(key);
    if (blockCount === undefined) {
      return err(new Error(`Missing ledger-linking asset identity suggestion block count for ${key}`));
    }

    suggestions.push({
      assetIdA: group.assetIdA,
      assetIdB: group.assetIdB,
      assetSymbol: group.assetSymbol,
      blockCount,
      evidenceKind: group.evidenceKind,
      examples: group.examples.sort(compareSuggestionExamples).slice(0, maxExamplesPerSuggestion),
      relationshipKind: group.relationshipKind,
    });
  }

  return ok(suggestions.sort(compareAssetIdentitySuggestions));
}

export function buildLedgerLinkingAssetIdentitySuggestionsFromDiagnostics(
  diagnostics: LedgerLinkingDiagnostics,
  options: Omit<LedgerLinkingAssetIdentitySuggestionOptions, 'evidenceKind'> = {}
): Result<LedgerLinkingAssetIdentitySuggestion[], Error> {
  return buildLedgerLinkingAssetIdentitySuggestions(
    diagnostics.assetIdentityBlockerProposals
      .filter((proposal) => proposal.timeDirection !== 'target_before_source')
      .map((proposal) => ({
        amount: proposal.amount,
        assetSymbol: proposal.assetSymbol,
        sourceAssetId: proposal.source.assetId,
        sourceBlockchainTransactionHash: proposal.source.blockchainTransactionHash,
        sourceCandidateId: proposal.source.candidateId,
        sourcePostingFingerprint: proposal.source.postingFingerprint,
        targetAssetId: proposal.target.assetId,
        targetBlockchainTransactionHash: proposal.target.blockchainTransactionHash,
        targetCandidateId: proposal.target.candidateId,
        targetPostingFingerprint: proposal.target.postingFingerprint,
        timeDistanceSeconds: proposal.timeDistanceSeconds,
      })),
    {
      ...options,
      evidenceKind: 'amount_time_observed',
    }
  );
}

function validateAssetIdentitySuggestionInput(
  block: LedgerLinkingAssetIdentitySuggestionInput,
  evidenceKind: LedgerLinkingAssetIdentitySuggestionEvidenceKind
): Result<void, Error> {
  const requiredFields = {
    amount: block.amount,
    assetSymbol: block.assetSymbol,
    sourceAssetId: block.sourceAssetId,
    sourcePostingFingerprint: block.sourcePostingFingerprint,
    targetAssetId: block.targetAssetId,
    targetPostingFingerprint: block.targetPostingFingerprint,
  };

  for (const [fieldName, value] of Object.entries(requiredFields)) {
    if (value.trim().length === 0) {
      return err(new Error(`Ledger-linking asset identity suggestion input has empty ${fieldName}`));
    }
  }

  if (evidenceKind === 'exact_hash_observed') {
    const hashFields = {
      sourceBlockchainTransactionHash: block.sourceBlockchainTransactionHash,
      targetBlockchainTransactionHash: block.targetBlockchainTransactionHash,
    };

    for (const [fieldName, value] of Object.entries(hashFields)) {
      if (value === undefined || value.trim().length === 0) {
        return err(new Error(`Ledger-linking exact-hash asset identity suggestion input has empty ${fieldName}`));
      }
    }
  }

  if (
    evidenceKind === 'amount_time_observed' &&
    (block.timeDistanceSeconds === undefined ||
      !Number.isFinite(block.timeDistanceSeconds) ||
      block.timeDistanceSeconds < 0)
  ) {
    return err(
      new Error(
        `Ledger-linking amount/time asset identity suggestion input has invalid timeDistanceSeconds ${block.timeDistanceSeconds}`
      )
    );
  }

  return ok(undefined);
}

function toSuggestionExample(
  block: LedgerLinkingAssetIdentitySuggestionInput
): LedgerLinkingAssetIdentitySuggestionExample {
  return {
    amount: block.amount.trim(),
    ...(block.sourceBlockchainTransactionHash !== undefined
      ? { sourceBlockchainTransactionHash: block.sourceBlockchainTransactionHash.trim() }
      : {}),
    ...(block.sourceCandidateId !== undefined ? { sourceCandidateId: block.sourceCandidateId } : {}),
    sourcePostingFingerprint: block.sourcePostingFingerprint.trim(),
    ...(block.targetBlockchainTransactionHash !== undefined
      ? { targetBlockchainTransactionHash: block.targetBlockchainTransactionHash.trim() }
      : {}),
    ...(block.targetCandidateId !== undefined ? { targetCandidateId: block.targetCandidateId } : {}),
    targetPostingFingerprint: block.targetPostingFingerprint.trim(),
    ...(block.timeDistanceSeconds !== undefined ? { timeDistanceSeconds: block.timeDistanceSeconds } : {}),
  };
}

function buildAssetIdentitySuggestionKey(
  evidenceKind: LedgerLinkingAssetIdentitySuggestionEvidenceKind,
  relationshipKind: AccountingJournalRelationshipKind,
  assetIdA: string,
  assetIdB: string,
  block: LedgerLinkingAssetIdentitySuggestionInput
): string {
  return [evidenceKind, relationshipKind, assetIdA, assetIdB, block.assetSymbol].join('\0');
}

function compareAssetIdentitySuggestions(
  left: LedgerLinkingAssetIdentitySuggestion,
  right: LedgerLinkingAssetIdentitySuggestion
): number {
  return (
    left.assetSymbol.localeCompare(right.assetSymbol) ||
    compareSuggestionEvidenceKind(left.evidenceKind, right.evidenceKind) ||
    left.relationshipKind.localeCompare(right.relationshipKind) ||
    left.assetIdA.localeCompare(right.assetIdA) ||
    left.assetIdB.localeCompare(right.assetIdB)
  );
}

function compareSuggestionExamples(
  left: LedgerLinkingAssetIdentitySuggestionExample,
  right: LedgerLinkingAssetIdentitySuggestionExample
): number {
  return (
    compareOptionalNumbers(left.timeDistanceSeconds, right.timeDistanceSeconds) ||
    left.sourcePostingFingerprint.localeCompare(right.sourcePostingFingerprint) ||
    left.targetPostingFingerprint.localeCompare(right.targetPostingFingerprint)
  );
}

function compareSuggestionEvidenceKind(
  left: LedgerLinkingAssetIdentitySuggestionEvidenceKind,
  right: LedgerLinkingAssetIdentitySuggestionEvidenceKind
): number {
  return suggestionEvidenceKindRank(left) - suggestionEvidenceKindRank(right);
}

function suggestionEvidenceKindRank(evidenceKind: LedgerLinkingAssetIdentitySuggestionEvidenceKind): number {
  switch (evidenceKind) {
    case 'exact_hash_observed':
      return 0;
    case 'amount_time_observed':
      return 1;
  }
}

function compareOptionalNumbers(left: number | undefined, right: number | undefined): number {
  if (left === undefined && right === undefined) {
    return 0;
  }

  if (left === undefined) {
    return 1;
  }

  if (right === undefined) {
    return -1;
  }

  return left - right;
}
