import { parseDecimal } from '@exitbook/foundation';

import type { ProfileLinkGapCrossProfileContext } from '../../ports/profile-link-gap-source-reader.js';

import { buildLinkGapIssueKey, type LinkGapDirection, type LinkGapIssue } from './gap-model.js';

const DEFAULT_CROSS_PROFILE_GAP_COUNTERPART_WINDOW_SECONDS = 60 * 60;
const DEFAULT_MAX_CROSS_PROFILE_GAP_COUNTERPARTS = 3;

export interface LinkGapCrossProfileCounterpart {
  amount: string;
  direction: LinkGapDirection;
  platformKey: string;
  profileDisplayName: string;
  profileKey: string;
  secondsDeltaFromGap: number;
  timestamp: string;
  txFingerprint: string;
}

interface IndexedCrossProfileGapCounterpart extends Omit<LinkGapCrossProfileCounterpart, 'secondsDeltaFromGap'> {
  timestampMs: number;
}

export function buildLinkGapCrossProfileCounterpartsByIssueKey(
  issues: readonly LinkGapIssue[],
  source?: ProfileLinkGapCrossProfileContext,
  options?: {
    maxCounterparts?: number | undefined;
    windowSeconds?: number | undefined;
  }
): Map<string, LinkGapCrossProfileCounterpart[]> {
  if (source === undefined || issues.length === 0 || source.profiles.length < 2) {
    return new Map();
  }

  const counterpartLookup = buildCrossProfileCounterpartLookup(source);
  const candidatesByIssueKey = new Map<string, LinkGapCrossProfileCounterpart[]>();
  const maxCounterparts = options?.maxCounterparts ?? DEFAULT_MAX_CROSS_PROFILE_GAP_COUNTERPARTS;
  const windowSeconds = options?.windowSeconds ?? DEFAULT_CROSS_PROFILE_GAP_COUNTERPART_WINDOW_SECONDS;

  for (const issue of issues) {
    const issueTimestampMs = Date.parse(issue.timestamp);
    if (Number.isNaN(issueTimestampMs)) {
      continue;
    }

    const oppositeDirection = issue.direction === 'inflow' ? 'outflow' : 'inflow';
    const lookupKey = buildCrossProfileCounterpartLookupKey(oppositeDirection, issue.assetSymbol, issue.missingAmount);
    const counterpartCandidates = counterpartLookup.get(lookupKey);

    if (counterpartCandidates === undefined || counterpartCandidates.length === 0) {
      continue;
    }

    const matchingCandidates = counterpartCandidates
      .filter((candidate) => Math.abs(candidate.timestampMs - issueTimestampMs) / 1000 <= windowSeconds)
      .map((candidate) => ({
        amount: candidate.amount,
        direction: candidate.direction,
        platformKey: candidate.platformKey,
        profileDisplayName: candidate.profileDisplayName,
        profileKey: candidate.profileKey,
        secondsDeltaFromGap: Math.round((candidate.timestampMs - issueTimestampMs) / 1000),
        timestamp: candidate.timestamp,
        txFingerprint: candidate.txFingerprint,
      }))
      .sort(compareCrossProfileGapCounterparts)
      .slice(0, maxCounterparts);

    if (matchingCandidates.length === 0) {
      continue;
    }

    candidatesByIssueKey.set(
      buildLinkGapIssueKey({
        txFingerprint: issue.txFingerprint,
        assetId: issue.assetId,
        direction: issue.direction,
      }),
      matchingCandidates
    );
  }

  return candidatesByIssueKey;
}

function buildCrossProfileCounterpartLookup(
  source: ProfileLinkGapCrossProfileContext
): Map<string, IndexedCrossProfileGapCounterpart[]> {
  const profileIdByAccountId = new Map(source.accounts.map((account) => [account.id, account.profileId]));
  const profileById = new Map(source.profiles.map((profile) => [profile.id, profile]));
  const counterpartLookup = new Map<string, IndexedCrossProfileGapCounterpart[]>();

  for (const transaction of source.transactions) {
    const profileId = profileIdByAccountId.get(transaction.accountId);
    if (
      profileId === undefined ||
      profileId === source.activeProfileId ||
      transaction.operation.category !== 'transfer'
    ) {
      continue;
    }

    const profile = profileById.get(profileId);
    if (profile === undefined) {
      continue;
    }

    const timestampMs = Date.parse(transaction.datetime);
    if (Number.isNaN(timestampMs)) {
      continue;
    }

    const seenLookupKeys = new Set<string>();
    for (const movement of listCrossProfileCounterpartMovements(transaction)) {
      const lookupKey = buildCrossProfileCounterpartLookupKey(
        movement.direction,
        movement.assetSymbol,
        movement.amount
      );
      const dedupeKey = `${lookupKey}|${transaction.txFingerprint}`;
      if (seenLookupKeys.has(dedupeKey)) {
        continue;
      }

      seenLookupKeys.add(dedupeKey);
      const counterparts = counterpartLookup.get(lookupKey) ?? [];
      counterparts.push({
        amount: movement.amount,
        direction: movement.direction,
        platformKey: transaction.platformKey,
        profileDisplayName: profile.displayName,
        profileKey: profile.profileKey,
        timestamp: transaction.datetime,
        timestampMs,
        txFingerprint: transaction.txFingerprint,
      });
      counterpartLookup.set(lookupKey, counterparts);
    }
  }

  return counterpartLookup;
}

function listCrossProfileCounterpartMovements(
  transaction: ProfileLinkGapCrossProfileContext['transactions'][number]
): { amount: string; assetSymbol: string; direction: LinkGapDirection }[] {
  const movements: { amount: string; assetSymbol: string; direction: LinkGapDirection }[] = [];

  for (const inflow of transaction.movements.inflows ?? []) {
    movements.push({
      amount: inflow.grossAmount.toFixed(),
      assetSymbol: inflow.assetSymbol,
      direction: 'inflow',
    });
  }

  for (const outflow of transaction.movements.outflows ?? []) {
    movements.push({
      amount: outflow.grossAmount.toFixed(),
      assetSymbol: outflow.assetSymbol,
      direction: 'outflow',
    });
  }

  return movements;
}

function buildCrossProfileCounterpartLookupKey(
  direction: LinkGapDirection,
  assetSymbol: string,
  amount: string
): string {
  return `${direction}|${assetSymbol.trim().toUpperCase()}|${parseDecimal(amount).toFixed()}`;
}

function compareCrossProfileGapCounterparts(
  left: LinkGapCrossProfileCounterpart,
  right: LinkGapCrossProfileCounterpart
): number {
  const deltaDifference = Math.abs(left.secondsDeltaFromGap) - Math.abs(right.secondsDeltaFromGap);
  if (deltaDifference !== 0) {
    return deltaDifference;
  }

  const timestampCompare = left.timestamp.localeCompare(right.timestamp);
  if (timestampCompare !== 0) {
    return timestampCompare;
  }

  const profileCompare = left.profileDisplayName.localeCompare(right.profileDisplayName);
  if (profileCompare !== 0) {
    return profileCompare;
  }

  return left.txFingerprint.localeCompare(right.txFingerprint);
}
