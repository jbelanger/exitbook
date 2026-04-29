import { err, ok, type Currency, type Result } from '@exitbook/foundation';
import type { AccountingJournalRelationshipKind } from '@exitbook/ledger';

import { canonicalizeLedgerLinkingAssetIdentityPair } from './asset-identity-resolution.js';

const DEFAULT_MAX_EXAMPLES_PER_SUGGESTION = 3;

export interface LedgerLinkingAssetIdentitySuggestionInput {
  amount: string;
  assetSymbol: Currency;
  sourceAssetId: string;
  sourceBlockchainTransactionHash: string;
  sourcePostingFingerprint: string;
  targetAssetId: string;
  targetBlockchainTransactionHash: string;
  targetPostingFingerprint: string;
}

export interface LedgerLinkingAssetIdentitySuggestionExample {
  amount: string;
  sourceBlockchainTransactionHash: string;
  sourcePostingFingerprint: string;
  targetBlockchainTransactionHash: string;
  targetPostingFingerprint: string;
}

export interface LedgerLinkingAssetIdentitySuggestion {
  assetIdA: string;
  assetIdB: string;
  assetSymbol: Currency;
  blockCount: number;
  examples: readonly LedgerLinkingAssetIdentitySuggestionExample[];
  relationshipKind: AccountingJournalRelationshipKind;
}

export interface LedgerLinkingAssetIdentitySuggestionOptions {
  maxExamplesPerSuggestion?: number | undefined;
  relationshipKind?: AccountingJournalRelationshipKind | undefined;
}

interface AssetIdentitySuggestionGroup {
  assetIdA: string;
  assetIdB: string;
  assetSymbol: Currency;
  examples: LedgerLinkingAssetIdentitySuggestionExample[];
  relationshipKind: AccountingJournalRelationshipKind;
}

export function buildLedgerLinkingAssetIdentitySuggestions(
  blocks: readonly LedgerLinkingAssetIdentitySuggestionInput[],
  options: LedgerLinkingAssetIdentitySuggestionOptions = {}
): Result<LedgerLinkingAssetIdentitySuggestion[], Error> {
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
    const validation = validateAssetIdentitySuggestionInput(block);
    if (validation.isErr()) {
      return err(validation.error);
    }

    const pair = canonicalizeLedgerLinkingAssetIdentityPair(block.sourceAssetId, block.targetAssetId);
    if (pair.isErr()) {
      return err(pair.error);
    }

    const key = buildAssetIdentitySuggestionKey(relationshipKind, pair.value.assetIdA, pair.value.assetIdB, block);
    const group =
      groups.get(key) ??
      ({
        assetIdA: pair.value.assetIdA,
        assetIdB: pair.value.assetIdB,
        assetSymbol: block.assetSymbol,
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
      examples: group.examples.sort(compareSuggestionExamples).slice(0, maxExamplesPerSuggestion),
      relationshipKind: group.relationshipKind,
    });
  }

  return ok(suggestions.sort(compareAssetIdentitySuggestions));
}

function validateAssetIdentitySuggestionInput(block: LedgerLinkingAssetIdentitySuggestionInput): Result<void, Error> {
  const requiredFields = {
    amount: block.amount,
    assetSymbol: block.assetSymbol,
    sourceAssetId: block.sourceAssetId,
    sourceBlockchainTransactionHash: block.sourceBlockchainTransactionHash,
    sourcePostingFingerprint: block.sourcePostingFingerprint,
    targetAssetId: block.targetAssetId,
    targetBlockchainTransactionHash: block.targetBlockchainTransactionHash,
    targetPostingFingerprint: block.targetPostingFingerprint,
  };

  for (const [fieldName, value] of Object.entries(requiredFields)) {
    if (value.trim().length === 0) {
      return err(new Error(`Ledger-linking asset identity suggestion input has empty ${fieldName}`));
    }
  }

  return ok(undefined);
}

function toSuggestionExample(
  block: LedgerLinkingAssetIdentitySuggestionInput
): LedgerLinkingAssetIdentitySuggestionExample {
  return {
    amount: block.amount.trim(),
    sourceBlockchainTransactionHash: block.sourceBlockchainTransactionHash.trim(),
    sourcePostingFingerprint: block.sourcePostingFingerprint.trim(),
    targetBlockchainTransactionHash: block.targetBlockchainTransactionHash.trim(),
    targetPostingFingerprint: block.targetPostingFingerprint.trim(),
  };
}

function buildAssetIdentitySuggestionKey(
  relationshipKind: AccountingJournalRelationshipKind,
  assetIdA: string,
  assetIdB: string,
  block: LedgerLinkingAssetIdentitySuggestionInput
): string {
  return [relationshipKind, assetIdA, assetIdB, block.assetSymbol].join('\0');
}

function compareAssetIdentitySuggestions(
  left: LedgerLinkingAssetIdentitySuggestion,
  right: LedgerLinkingAssetIdentitySuggestion
): number {
  return (
    left.assetSymbol.localeCompare(right.assetSymbol) ||
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
    left.sourcePostingFingerprint.localeCompare(right.sourcePostingFingerprint) ||
    left.targetPostingFingerprint.localeCompare(right.targetPostingFingerprint)
  );
}
