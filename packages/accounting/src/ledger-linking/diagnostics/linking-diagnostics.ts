import { err, normalizeIdentifierForMatching, ok, type Result } from '@exitbook/foundation';
import { Decimal } from 'decimal.js';

import type { LedgerLinkingAssetIdentityResolver } from '../asset-identity/asset-identity-resolution.js';
import type { LedgerTransferLinkingCandidate } from '../candidates/candidate-construction.js';
import type { LedgerDeterministicCandidateClaim } from '../matching/deterministic-recognizer-runner.js';

const DEFAULT_AMOUNT_TIME_WINDOW_MINUTES = 7 * 24 * 60;
const SAME_ACCOUNT_ROUNDTRIP_WINDOW_SECONDS = 30 * 24 * 60 * 60;
const SPAM_AIRDROP_SYMBOL_PATTERN = /\b(airdrop|claim|reward|visit|https?:\/\/|www\.|\.org|\.xyz|\.net)\b/i;

export interface LedgerLinkingDiagnosticsOptions {
  amountTimeWindowMinutes?: number | undefined;
}

export interface LedgerLinkingCandidateRemainder {
  activityDatetime: Date;
  assetId: string;
  assetSymbol: LedgerTransferLinkingCandidate['assetSymbol'];
  blockchainTransactionHash: string | undefined;
  candidateId: number;
  claimedAmount: string;
  direction: LedgerTransferLinkingCandidate['direction'];
  fromAddress: string | undefined;
  journalFingerprint: string;
  originalAmount: string;
  ownerAccountId: number;
  platformKey: string;
  platformKind: LedgerTransferLinkingCandidate['platformKind'];
  postingFingerprint: string;
  remainingAmount: string;
  sourceActivityFingerprint: string;
  toAddress: string | undefined;
}

export interface LedgerLinkingUnmatchedCandidateGroup {
  assetId: string;
  assetSymbol: LedgerTransferLinkingCandidate['assetSymbol'];
  candidateCount: number;
  direction: LedgerTransferLinkingCandidate['direction'];
  earliestActivityDatetime: Date;
  latestActivityDatetime: Date;
  platformKey: string;
  platformKind: LedgerTransferLinkingCandidate['platformKind'];
  remainingAmountTotal: string;
}

export type LedgerLinkingAmountTimeProposalUniqueness =
  | 'unique_pair'
  | 'ambiguous_source'
  | 'ambiguous_target'
  | 'ambiguous_both';

export type LedgerLinkingAmountTimeProposalDirection = 'source_before_target' | 'target_before_source' | 'same_time';

export interface LedgerLinkingAmountTimeProposal {
  amount: string;
  assetIdentityReason: 'same_asset_id' | 'accepted_assertion';
  assetSymbol: LedgerTransferLinkingCandidate['assetSymbol'];
  source: LedgerLinkingCandidateRemainder;
  target: LedgerLinkingCandidateRemainder;
  timeDirection: LedgerLinkingAmountTimeProposalDirection;
  timeDistanceSeconds: number;
  uniqueness: LedgerLinkingAmountTimeProposalUniqueness;
}

export interface LedgerLinkingAmountTimeProposalGroup {
  amount: string;
  ambiguousProposalCount: number;
  assetSymbol: LedgerTransferLinkingCandidate['assetSymbol'];
  maxTimeDistanceSeconds: number;
  minTimeDistanceSeconds: number;
  proposalCount: number;
  sourcePlatformKey: string;
  sourcePlatformKind: LedgerTransferLinkingCandidate['platformKind'];
  targetPlatformKey: string;
  targetPlatformKind: LedgerTransferLinkingCandidate['platformKind'];
  uniqueProposalCount: number;
}

export type LedgerLinkingDiagnosticClassification =
  | 'amount_time_unique'
  | 'amount_time_ambiguous'
  | 'asset_identity_blocked'
  | 'same_account_roundtrip_candidate'
  | 'likely_spam_airdrop'
  | 'exchange_transfer_missing_hash'
  | 'missing_linking_evidence'
  | 'unclassified';

export interface LedgerLinkingCandidateClassification {
  candidateId: number;
  classifications: readonly LedgerLinkingDiagnosticClassification[];
  direction: LedgerTransferLinkingCandidate['direction'];
  platformKey: string;
}

export interface LedgerLinkingDiagnosticClassificationGroup {
  classification: LedgerLinkingDiagnosticClassification;
  candidateCount: number;
  sourceCandidateCount: number;
  targetCandidateCount: number;
}

export interface LedgerLinkingDiagnostics {
  amountTimeProposalCount: number;
  amountTimeProposalGroups: readonly LedgerLinkingAmountTimeProposalGroup[];
  amountTimeProposals: readonly LedgerLinkingAmountTimeProposal[];
  amountTimeUniqueProposalCount: number;
  amountTimeWindowMinutes: number;
  candidateClassificationGroups: readonly LedgerLinkingDiagnosticClassificationGroup[];
  candidateClassifications: readonly LedgerLinkingCandidateClassification[];
  unmatchedCandidateGroups: readonly LedgerLinkingUnmatchedCandidateGroup[];
  unmatchedCandidates: readonly LedgerLinkingCandidateRemainder[];
}

interface CandidateRemainderWithDecimal extends LedgerLinkingCandidateRemainder {
  remainingAmountDecimal: Decimal;
}

interface AmountTimeProposalDraft extends Omit<LedgerLinkingAmountTimeProposal, 'source' | 'target' | 'uniqueness'> {
  source: CandidateRemainderWithDecimal;
  target: CandidateRemainderWithDecimal;
}

export function buildLedgerLinkingDiagnostics(
  candidates: readonly LedgerTransferLinkingCandidate[],
  candidateClaims: readonly LedgerDeterministicCandidateClaim[],
  assetIdentityResolver: LedgerLinkingAssetIdentityResolver,
  options: LedgerLinkingDiagnosticsOptions = {}
): Result<LedgerLinkingDiagnostics, Error> {
  const amountTimeWindowMinutes = options.amountTimeWindowMinutes ?? DEFAULT_AMOUNT_TIME_WINDOW_MINUTES;
  if (!Number.isFinite(amountTimeWindowMinutes) || amountTimeWindowMinutes <= 0) {
    return err(
      new Error(`Ledger-linking diagnostics amount/time window must be positive, received ${amountTimeWindowMinutes}`)
    );
  }

  const claimedQuantitiesResult = buildClaimedQuantitiesByCandidateId(candidates, candidateClaims);
  if (claimedQuantitiesResult.isErr()) {
    return err(claimedQuantitiesResult.error);
  }

  const unmatchedCandidates = buildCandidateRemainders(candidates, claimedQuantitiesResult.value);
  const proposals = buildAmountTimeProposals(unmatchedCandidates, assetIdentityResolver, amountTimeWindowMinutes * 60);
  const proposalGroups = buildAmountTimeProposalGroups(proposals);
  const candidateClassifications = buildCandidateClassifications(
    unmatchedCandidates,
    proposals,
    assetIdentityResolver,
    amountTimeWindowMinutes * 60
  );

  return ok({
    amountTimeProposalCount: proposals.length,
    amountTimeProposalGroups: proposalGroups,
    amountTimeProposals: proposals,
    amountTimeUniqueProposalCount: proposals.filter((proposal) => proposal.uniqueness === 'unique_pair').length,
    amountTimeWindowMinutes,
    candidateClassificationGroups: buildCandidateClassificationGroups(candidateClassifications),
    candidateClassifications,
    unmatchedCandidateGroups: buildUnmatchedCandidateGroups(unmatchedCandidates),
    unmatchedCandidates: unmatchedCandidates.map(toPublicCandidateRemainder),
  });
}

function buildClaimedQuantitiesByCandidateId(
  candidates: readonly LedgerTransferLinkingCandidate[],
  candidateClaims: readonly LedgerDeterministicCandidateClaim[]
): Result<Map<number, Decimal>, Error> {
  const candidatesById = new Map(candidates.map((candidate) => [candidate.candidateId, candidate]));
  const claimedQuantitiesByCandidateId = new Map<number, Decimal>();

  for (const claim of candidateClaims) {
    const candidate = candidatesById.get(claim.candidateId);
    if (candidate === undefined) {
      return err(new Error(`Ledger-linking diagnostics received claim for unknown candidate ${claim.candidateId}`));
    }

    if (!(claim.quantity instanceof Decimal) || !claim.quantity.gt(0)) {
      return err(
        new Error(`Ledger-linking diagnostics received invalid claim quantity for candidate ${claim.candidateId}`)
      );
    }

    const claimedQuantity = (claimedQuantitiesByCandidateId.get(claim.candidateId) ?? new Decimal(0)).plus(
      claim.quantity
    );
    if (claimedQuantity.gt(candidate.amount)) {
      return err(
        new Error(
          `Ledger-linking diagnostics overclaimed candidate ${claim.candidateId}: claimed ${claimedQuantity.toFixed()} of ${candidate.amount.toFixed()}`
        )
      );
    }

    claimedQuantitiesByCandidateId.set(claim.candidateId, claimedQuantity);
  }

  return ok(claimedQuantitiesByCandidateId);
}

function buildCandidateRemainders(
  candidates: readonly LedgerTransferLinkingCandidate[],
  claimedQuantitiesByCandidateId: ReadonlyMap<number, Decimal>
): CandidateRemainderWithDecimal[] {
  const remainders: CandidateRemainderWithDecimal[] = [];

  for (const candidate of candidates) {
    const claimedAmount = claimedQuantitiesByCandidateId.get(candidate.candidateId) ?? new Decimal(0);
    const remainingAmount = candidate.amount.minus(claimedAmount);
    if (!remainingAmount.gt(0)) {
      continue;
    }

    remainders.push({
      activityDatetime: candidate.activityDatetime,
      assetId: candidate.assetId,
      assetSymbol: candidate.assetSymbol,
      blockchainTransactionHash: candidate.blockchainTransactionHash,
      candidateId: candidate.candidateId,
      claimedAmount: claimedAmount.toFixed(),
      direction: candidate.direction,
      fromAddress: candidate.fromAddress,
      journalFingerprint: candidate.journalFingerprint,
      originalAmount: candidate.amount.toFixed(),
      ownerAccountId: candidate.ownerAccountId,
      platformKey: candidate.platformKey,
      platformKind: candidate.platformKind,
      postingFingerprint: candidate.postingFingerprint,
      remainingAmount: remainingAmount.toFixed(),
      remainingAmountDecimal: remainingAmount,
      sourceActivityFingerprint: candidate.sourceActivityFingerprint,
      toAddress: candidate.toAddress,
    });
  }

  return remainders.sort(compareCandidateRemainders);
}

function buildUnmatchedCandidateGroups(
  unmatchedCandidates: readonly CandidateRemainderWithDecimal[]
): LedgerLinkingUnmatchedCandidateGroup[] {
  const groupsByKey = new Map<
    string,
    LedgerLinkingUnmatchedCandidateGroup & { remainingAmountTotalDecimal: Decimal }
  >();

  for (const candidate of unmatchedCandidates) {
    const groupKey = [
      candidate.direction,
      candidate.platformKind,
      candidate.platformKey,
      candidate.assetSymbol,
      candidate.assetId,
    ].join('\0');
    const existing = groupsByKey.get(groupKey);
    if (existing === undefined) {
      groupsByKey.set(groupKey, {
        assetId: candidate.assetId,
        assetSymbol: candidate.assetSymbol,
        candidateCount: 1,
        direction: candidate.direction,
        earliestActivityDatetime: candidate.activityDatetime,
        latestActivityDatetime: candidate.activityDatetime,
        platformKey: candidate.platformKey,
        platformKind: candidate.platformKind,
        remainingAmountTotal: candidate.remainingAmount,
        remainingAmountTotalDecimal: candidate.remainingAmountDecimal,
      });
      continue;
    }

    const remainingAmountTotalDecimal = existing.remainingAmountTotalDecimal.plus(candidate.remainingAmountDecimal);
    groupsByKey.set(groupKey, {
      ...existing,
      candidateCount: existing.candidateCount + 1,
      earliestActivityDatetime:
        candidate.activityDatetime < existing.earliestActivityDatetime
          ? candidate.activityDatetime
          : existing.earliestActivityDatetime,
      latestActivityDatetime:
        candidate.activityDatetime > existing.latestActivityDatetime
          ? candidate.activityDatetime
          : existing.latestActivityDatetime,
      remainingAmountTotal: remainingAmountTotalDecimal.toFixed(),
      remainingAmountTotalDecimal,
    });
  }

  return [...groupsByKey.values()]
    .map(({ remainingAmountTotalDecimal: _remainingAmountTotalDecimal, ...group }) => group)
    .sort(compareUnmatchedCandidateGroups);
}

function buildAmountTimeProposals(
  unmatchedCandidates: readonly CandidateRemainderWithDecimal[],
  assetIdentityResolver: LedgerLinkingAssetIdentityResolver,
  amountTimeWindowSeconds: number
): LedgerLinkingAmountTimeProposal[] {
  const sources = unmatchedCandidates.filter((candidate) => candidate.direction === 'source');
  const targets = unmatchedCandidates.filter((candidate) => candidate.direction === 'target');
  const drafts: AmountTimeProposalDraft[] = [];

  for (const source of sources) {
    for (const target of targets) {
      if (!source.remainingAmountDecimal.eq(target.remainingAmountDecimal)) {
        continue;
      }

      const assetIdentityResolution = assetIdentityResolver.resolve({
        relationshipKind: 'internal_transfer',
        sourceAssetId: source.assetId,
        targetAssetId: target.assetId,
      });
      if (assetIdentityResolution.status !== 'accepted') {
        continue;
      }

      const timeDistanceSeconds =
        Math.abs(target.activityDatetime.getTime() - source.activityDatetime.getTime()) / 1000;
      if (timeDistanceSeconds > amountTimeWindowSeconds) {
        continue;
      }

      drafts.push({
        amount: source.remainingAmount,
        assetIdentityReason: assetIdentityResolution.reason,
        assetSymbol: source.assetSymbol,
        source,
        target,
        timeDirection: resolveTimeDirection(source.activityDatetime, target.activityDatetime),
        timeDistanceSeconds,
      });
    }
  }

  return classifyAmountTimeProposalUniqueness(drafts).sort(compareAmountTimeProposals);
}

function buildCandidateClassifications(
  unmatchedCandidates: readonly CandidateRemainderWithDecimal[],
  proposals: readonly LedgerLinkingAmountTimeProposal[],
  assetIdentityResolver: LedgerLinkingAssetIdentityResolver,
  amountTimeWindowSeconds: number
): LedgerLinkingCandidateClassification[] {
  const classificationsByCandidateId = new Map<number, Set<LedgerLinkingDiagnosticClassification>>();

  for (const candidate of unmatchedCandidates) {
    classificationsByCandidateId.set(candidate.candidateId, new Set());
  }

  applyAmountTimeClassifications(classificationsByCandidateId, proposals);
  applyPairShapeClassifications(
    classificationsByCandidateId,
    unmatchedCandidates,
    assetIdentityResolver,
    amountTimeWindowSeconds
  );
  applySingleCandidateClassifications(classificationsByCandidateId, unmatchedCandidates);

  return unmatchedCandidates.map((candidate) => {
    const classifications = [...(classificationsByCandidateId.get(candidate.candidateId) ?? [])].sort();

    return {
      candidateId: candidate.candidateId,
      classifications: classifications.length === 0 ? ['unclassified'] : classifications,
      direction: candidate.direction,
      platformKey: candidate.platformKey,
    };
  });
}

function applyAmountTimeClassifications(
  classificationsByCandidateId: Map<number, Set<LedgerLinkingDiagnosticClassification>>,
  proposals: readonly LedgerLinkingAmountTimeProposal[]
): void {
  for (const proposal of proposals) {
    const classification = proposal.uniqueness === 'unique_pair' ? 'amount_time_unique' : 'amount_time_ambiguous';
    addClassification(classificationsByCandidateId, proposal.source.candidateId, classification);
    addClassification(classificationsByCandidateId, proposal.target.candidateId, classification);
  }
}

function applyPairShapeClassifications(
  classificationsByCandidateId: Map<number, Set<LedgerLinkingDiagnosticClassification>>,
  unmatchedCandidates: readonly CandidateRemainderWithDecimal[],
  assetIdentityResolver: LedgerLinkingAssetIdentityResolver,
  amountTimeWindowSeconds: number
): void {
  const sources = unmatchedCandidates.filter((candidate) => candidate.direction === 'source');
  const targets = unmatchedCandidates.filter((candidate) => candidate.direction === 'target');

  for (const source of sources) {
    for (const target of targets) {
      if (!source.remainingAmountDecimal.eq(target.remainingAmountDecimal)) {
        continue;
      }

      const timeDistanceSeconds =
        Math.abs(target.activityDatetime.getTime() - source.activityDatetime.getTime()) / 1000;

      if (
        timeDistanceSeconds <= amountTimeWindowSeconds &&
        isAssetIdentityBlockedPair(source, target, assetIdentityResolver)
      ) {
        addClassification(classificationsByCandidateId, source.candidateId, 'asset_identity_blocked');
        addClassification(classificationsByCandidateId, target.candidateId, 'asset_identity_blocked');
      }

      if (isSameAccountRoundtripCandidate(source, target, assetIdentityResolver, timeDistanceSeconds)) {
        addClassification(classificationsByCandidateId, source.candidateId, 'same_account_roundtrip_candidate');
        addClassification(classificationsByCandidateId, target.candidateId, 'same_account_roundtrip_candidate');
      }
    }
  }
}

function applySingleCandidateClassifications(
  classificationsByCandidateId: Map<number, Set<LedgerLinkingDiagnosticClassification>>,
  unmatchedCandidates: readonly CandidateRemainderWithDecimal[]
): void {
  for (const candidate of unmatchedCandidates) {
    if (isLikelySpamAirdropCandidate(candidate)) {
      addClassification(classificationsByCandidateId, candidate.candidateId, 'likely_spam_airdrop');
    }

    if (candidate.platformKind === 'exchange' && candidate.blockchainTransactionHash === undefined) {
      addClassification(classificationsByCandidateId, candidate.candidateId, 'exchange_transfer_missing_hash');
    }

    if (
      candidate.blockchainTransactionHash === undefined &&
      candidate.fromAddress === undefined &&
      candidate.toAddress === undefined
    ) {
      addClassification(classificationsByCandidateId, candidate.candidateId, 'missing_linking_evidence');
    }
  }
}

function isAssetIdentityBlockedPair(
  source: CandidateRemainderWithDecimal,
  target: CandidateRemainderWithDecimal,
  assetIdentityResolver: LedgerLinkingAssetIdentityResolver
): boolean {
  if (source.assetSymbol !== target.assetSymbol || source.assetId === target.assetId) {
    return false;
  }

  const resolution = assetIdentityResolver.resolve({
    relationshipKind: 'internal_transfer',
    sourceAssetId: source.assetId,
    targetAssetId: target.assetId,
  });

  return resolution.status === 'blocked';
}

function isSameAccountRoundtripCandidate(
  source: CandidateRemainderWithDecimal,
  target: CandidateRemainderWithDecimal,
  assetIdentityResolver: LedgerLinkingAssetIdentityResolver,
  timeDistanceSeconds: number
): boolean {
  if (
    source.platformKind !== 'blockchain' ||
    target.platformKind !== 'blockchain' ||
    source.platformKey !== target.platformKey ||
    source.ownerAccountId !== target.ownerAccountId ||
    timeDistanceSeconds > SAME_ACCOUNT_ROUNDTRIP_WINDOW_SECONDS
  ) {
    return false;
  }

  const resolution = assetIdentityResolver.resolve({
    relationshipKind: 'external_transfer',
    sourceAssetId: source.assetId,
    targetAssetId: target.assetId,
  });
  if (resolution.status !== 'accepted') {
    return false;
  }

  const sourceFrom = normalizeAddressForDiagnostics(source.fromAddress);
  const sourceTo = normalizeAddressForDiagnostics(source.toAddress);
  const targetFrom = normalizeAddressForDiagnostics(target.fromAddress);
  const targetTo = normalizeAddressForDiagnostics(target.toAddress);

  return (
    sourceFrom !== undefined &&
    sourceTo !== undefined &&
    targetFrom !== undefined &&
    targetTo !== undefined &&
    sourceFrom !== sourceTo &&
    sourceFrom === targetTo &&
    sourceTo === targetFrom
  );
}

function isLikelySpamAirdropCandidate(candidate: CandidateRemainderWithDecimal): boolean {
  return (
    candidate.direction === 'target' &&
    candidate.platformKind === 'blockchain' &&
    SPAM_AIRDROP_SYMBOL_PATTERN.test(candidate.assetSymbol)
  );
}

function normalizeAddressForDiagnostics(address: string | undefined): string | undefined {
  const trimmedAddress = address?.trim();
  if (trimmedAddress === undefined || trimmedAddress.length === 0) {
    return undefined;
  }

  return normalizeIdentifierForMatching(trimmedAddress);
}

function addClassification(
  classificationsByCandidateId: Map<number, Set<LedgerLinkingDiagnosticClassification>>,
  candidateId: number,
  classification: LedgerLinkingDiagnosticClassification
): void {
  const classifications = classificationsByCandidateId.get(candidateId);
  if (classifications === undefined) {
    return;
  }

  classifications.add(classification);
}

function buildCandidateClassificationGroups(
  candidateClassifications: readonly LedgerLinkingCandidateClassification[]
): LedgerLinkingDiagnosticClassificationGroup[] {
  const groupsByClassification = new Map<
    LedgerLinkingDiagnosticClassification,
    LedgerLinkingDiagnosticClassificationGroup
  >();

  for (const candidate of candidateClassifications) {
    for (const classification of candidate.classifications) {
      const existing = groupsByClassification.get(classification) ?? {
        candidateCount: 0,
        classification,
        sourceCandidateCount: 0,
        targetCandidateCount: 0,
      };

      groupsByClassification.set(classification, {
        ...existing,
        candidateCount: existing.candidateCount + 1,
        sourceCandidateCount: existing.sourceCandidateCount + (candidate.direction === 'source' ? 1 : 0),
        targetCandidateCount: existing.targetCandidateCount + (candidate.direction === 'target' ? 1 : 0),
      });
    }
  }

  return [...groupsByClassification.values()].sort(compareCandidateClassificationGroups);
}

function classifyAmountTimeProposalUniqueness(
  proposals: readonly AmountTimeProposalDraft[]
): LedgerLinkingAmountTimeProposal[] {
  const sourceProposalCounts = countProposalsByCandidateId(proposals, 'source');
  const targetProposalCounts = countProposalsByCandidateId(proposals, 'target');

  return proposals.map((proposal) => {
    const sourceIsAmbiguous = (sourceProposalCounts.get(proposal.source.candidateId) ?? 0) > 1;
    const targetIsAmbiguous = (targetProposalCounts.get(proposal.target.candidateId) ?? 0) > 1;

    return {
      ...proposal,
      source: toPublicCandidateRemainder(proposal.source),
      target: toPublicCandidateRemainder(proposal.target),
      uniqueness: resolveProposalUniqueness(sourceIsAmbiguous, targetIsAmbiguous),
    };
  });
}

function toPublicCandidateRemainder(candidate: CandidateRemainderWithDecimal): LedgerLinkingCandidateRemainder {
  const { remainingAmountDecimal: _remainingAmountDecimal, ...publicCandidate } = candidate;
  return publicCandidate;
}

function countProposalsByCandidateId(
  proposals: readonly AmountTimeProposalDraft[],
  side: 'source' | 'target'
): Map<number, number> {
  const counts = new Map<number, number>();

  for (const proposal of proposals) {
    const candidateId = side === 'source' ? proposal.source.candidateId : proposal.target.candidateId;
    counts.set(candidateId, (counts.get(candidateId) ?? 0) + 1);
  }

  return counts;
}

function resolveProposalUniqueness(
  sourceIsAmbiguous: boolean,
  targetIsAmbiguous: boolean
): LedgerLinkingAmountTimeProposalUniqueness {
  if (sourceIsAmbiguous && targetIsAmbiguous) {
    return 'ambiguous_both';
  }

  if (sourceIsAmbiguous) {
    return 'ambiguous_source';
  }

  if (targetIsAmbiguous) {
    return 'ambiguous_target';
  }

  return 'unique_pair';
}

function buildAmountTimeProposalGroups(
  proposals: readonly LedgerLinkingAmountTimeProposal[]
): LedgerLinkingAmountTimeProposalGroup[] {
  const groupsByKey = new Map<string, LedgerLinkingAmountTimeProposalGroup>();

  for (const proposal of proposals) {
    const groupKey = [
      proposal.assetSymbol,
      proposal.amount,
      proposal.source.platformKind,
      proposal.source.platformKey,
      proposal.target.platformKind,
      proposal.target.platformKey,
    ].join('\0');
    const existing = groupsByKey.get(groupKey);
    const isUnique = proposal.uniqueness === 'unique_pair';

    if (existing === undefined) {
      groupsByKey.set(groupKey, {
        amount: proposal.amount,
        ambiguousProposalCount: isUnique ? 0 : 1,
        assetSymbol: proposal.assetSymbol,
        maxTimeDistanceSeconds: proposal.timeDistanceSeconds,
        minTimeDistanceSeconds: proposal.timeDistanceSeconds,
        proposalCount: 1,
        sourcePlatformKey: proposal.source.platformKey,
        sourcePlatformKind: proposal.source.platformKind,
        targetPlatformKey: proposal.target.platformKey,
        targetPlatformKind: proposal.target.platformKind,
        uniqueProposalCount: isUnique ? 1 : 0,
      });
      continue;
    }

    groupsByKey.set(groupKey, {
      ...existing,
      ambiguousProposalCount: existing.ambiguousProposalCount + (isUnique ? 0 : 1),
      maxTimeDistanceSeconds: Math.max(existing.maxTimeDistanceSeconds, proposal.timeDistanceSeconds),
      minTimeDistanceSeconds: Math.min(existing.minTimeDistanceSeconds, proposal.timeDistanceSeconds),
      proposalCount: existing.proposalCount + 1,
      uniqueProposalCount: existing.uniqueProposalCount + (isUnique ? 1 : 0),
    });
  }

  return [...groupsByKey.values()].sort(compareAmountTimeProposalGroups);
}

function resolveTimeDirection(sourceDatetime: Date, targetDatetime: Date): LedgerLinkingAmountTimeProposalDirection {
  if (sourceDatetime.getTime() < targetDatetime.getTime()) {
    return 'source_before_target';
  }

  if (sourceDatetime.getTime() > targetDatetime.getTime()) {
    return 'target_before_source';
  }

  return 'same_time';
}

function compareCandidateRemainders(
  left: LedgerLinkingCandidateRemainder,
  right: LedgerLinkingCandidateRemainder
): number {
  return (
    left.direction.localeCompare(right.direction) ||
    left.assetSymbol.localeCompare(right.assetSymbol) ||
    left.platformKey.localeCompare(right.platformKey) ||
    left.activityDatetime.getTime() - right.activityDatetime.getTime() ||
    left.candidateId - right.candidateId
  );
}

function compareUnmatchedCandidateGroups(
  left: LedgerLinkingUnmatchedCandidateGroup,
  right: LedgerLinkingUnmatchedCandidateGroup
): number {
  return (
    left.direction.localeCompare(right.direction) ||
    left.assetSymbol.localeCompare(right.assetSymbol) ||
    left.platformKey.localeCompare(right.platformKey) ||
    left.assetId.localeCompare(right.assetId)
  );
}

function compareAmountTimeProposals(
  left: LedgerLinkingAmountTimeProposal,
  right: LedgerLinkingAmountTimeProposal
): number {
  return (
    compareUniqueness(left.uniqueness, right.uniqueness) ||
    left.timeDistanceSeconds - right.timeDistanceSeconds ||
    left.assetSymbol.localeCompare(right.assetSymbol) ||
    left.amount.localeCompare(right.amount) ||
    left.source.platformKey.localeCompare(right.source.platformKey) ||
    left.target.platformKey.localeCompare(right.target.platformKey) ||
    left.source.candidateId - right.source.candidateId ||
    left.target.candidateId - right.target.candidateId
  );
}

function compareAmountTimeProposalGroups(
  left: LedgerLinkingAmountTimeProposalGroup,
  right: LedgerLinkingAmountTimeProposalGroup
): number {
  return (
    right.uniqueProposalCount - left.uniqueProposalCount ||
    right.proposalCount - left.proposalCount ||
    left.minTimeDistanceSeconds - right.minTimeDistanceSeconds ||
    left.assetSymbol.localeCompare(right.assetSymbol) ||
    left.sourcePlatformKey.localeCompare(right.sourcePlatformKey) ||
    left.targetPlatformKey.localeCompare(right.targetPlatformKey) ||
    left.amount.localeCompare(right.amount)
  );
}

function compareCandidateClassificationGroups(
  left: LedgerLinkingDiagnosticClassificationGroup,
  right: LedgerLinkingDiagnosticClassificationGroup
): number {
  return right.candidateCount - left.candidateCount || left.classification.localeCompare(right.classification);
}

function compareUniqueness(
  left: LedgerLinkingAmountTimeProposalUniqueness,
  right: LedgerLinkingAmountTimeProposalUniqueness
): number {
  return uniquenessRank(left) - uniquenessRank(right);
}

function uniquenessRank(uniqueness: LedgerLinkingAmountTimeProposalUniqueness): number {
  switch (uniqueness) {
    case 'unique_pair':
      return 0;
    case 'ambiguous_source':
      return 1;
    case 'ambiguous_target':
      return 2;
    case 'ambiguous_both':
      return 3;
  }
}
