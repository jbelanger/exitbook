import { wrapError } from '@exitbook/core';
import { getLogger } from '@exitbook/logger';
import { ok, type Result } from 'neverthrow';

import type { OverrideEvent, LinkOverridePayload, UnlinkOverridePayload } from './override.schemas.js';

const logger = getLogger('OverrideReplay');

/**
 * Transaction-like object with fingerprint lookup capability.
 * Uses domain model field names (source/externalId) matching UniversalTransactionData.
 */
interface TransactionWithFingerprint {
  id: number;
  source: string;
  externalId: string;
  [key: string]: unknown;
}

/**
 * Link-like object that can be modified by overrides.
 * Uses domain model field names matching TransactionLink from accounting.
 */
interface LinkWithStatus {
  id: string;
  sourceTransactionId: number;
  targetTransactionId: number;
  assetSymbol: string;
  status: 'suggested' | 'confirmed' | 'rejected';
  reviewedBy?: string | undefined;
  reviewedAt?: Date | undefined;
  [key: string]: unknown;
}

/**
 * Build a fingerprint lookup map for transactions
 * Fingerprint format: ${source}:${externalId}
 */
export function buildFingerprintMap(transactions: TransactionWithFingerprint[]): Map<string, number> {
  const map = new Map<string, number>();

  for (const tx of transactions) {
    const fingerprint = `${tx.source}:${tx.externalId}`;
    map.set(fingerprint, tx.id);
  }

  return map;
}

/**
 * Resolve transaction ID from fingerprint
 * Returns null if fingerprint not found
 */
export function resolveTxId(fingerprint: string, fingerprintMap: Map<string, number>): number | null {
  // eslint-disable-next-line unicorn/no-null -- null used to indicate "not found"
  return fingerprintMap.get(fingerprint) ?? null;
}

/**
 * A link_override whose transactions exist but no algorithm-generated link matched.
 * The caller should create a new link entity from this data.
 */
export interface OrphanedLinkOverride {
  override: OverrideEvent;
  sourceTransactionId: number;
  targetTransactionId: number;
  assetSymbol: string;
  linkType: string;
}

/**
 * Apply link overrides to a set of links
 * Modifies link statuses based on confirm/reject overrides.
 *
 * When a link_override resolves both transaction IDs but no matching link exists
 * in the algorithm output, it is returned in `orphaned` so the caller can
 * construct a new link — ensuring user decisions survive reprocessing even when
 * the algorithm doesn't rediscover the pair.
 *
 * @param links - Array of links to modify
 * @param overrides - Override events with scope='link' or 'unlink'
 * @param transactions - All transactions for fingerprint resolution
 * @returns Result with modified links, orphaned overrides (resolvable but no matching link), and unresolved overrides (transactions missing)
 */
export function applyLinkOverrides(
  links: LinkWithStatus[],
  overrides: OverrideEvent[],
  transactions: TransactionWithFingerprint[]
): Result<{ links: LinkWithStatus[]; orphaned: OrphanedLinkOverride[]; unresolved: OverrideEvent[] }, Error> {
  try {
    const fingerprintMap = buildFingerprintMap(transactions);
    const unresolved: OverrideEvent[] = [];
    const orphaned: OrphanedLinkOverride[] = [];

    // Filter to link-related overrides
    const linkOverrides = overrides.filter((o) => o.scope === 'link' || o.scope === 'unlink');

    // Build a map of transaction ID → transaction for O(1) lookup
    const txById = new Map<number, TransactionWithFingerprint>();
    for (const tx of transactions) {
      txById.set(tx.id, tx);
    }

    // Build a map of link fingerprints to link objects for fast lookup
    const linkMap = new Map<string, LinkWithStatus>();
    for (const link of links) {
      const sourceTx = txById.get(link.sourceTransactionId);
      const targetTx = txById.get(link.targetTransactionId);

      if (sourceTx && targetTx) {
        const sourceFingerprint = `${sourceTx.source}:${sourceTx.externalId}`;
        const targetFingerprint = `${targetTx.source}:${targetTx.externalId}`;

        // Sort fingerprints for deterministic ordering
        const [fp1, fp2] = [sourceFingerprint, targetFingerprint].sort();
        const linkFingerprint = `link:${fp1}:${fp2}:${link.assetSymbol}`;

        linkMap.set(linkFingerprint, link);
      }
    }

    // Apply each override
    for (const override of linkOverrides) {
      if (override.scope === 'link') {
        const payload = override.payload as LinkOverridePayload;

        // Resolve transaction IDs
        const sourceId = resolveTxId(payload.source_fingerprint, fingerprintMap);
        const targetId = resolveTxId(payload.target_fingerprint, fingerprintMap);

        if (sourceId === null || targetId === null) {
          logger.warn(
            {
              overrideId: override.id,
              sourceFingerprint: payload.source_fingerprint,
              targetFingerprint: payload.target_fingerprint,
            },
            'Could not resolve transaction fingerprints for link override'
          );
          unresolved.push(override);
          continue;
        }

        // Find matching link
        const [fp1, fp2] = [payload.source_fingerprint, payload.target_fingerprint].sort();
        const linkFingerprint = `link:${fp1}:${fp2}:${payload.asset}`;
        const link = linkMap.get(linkFingerprint);

        if (!link) {
          // Transactions exist but algorithm didn't produce this link.
          // Return as orphaned so the caller can create a new link entity.
          logger.info(
            {
              overrideId: override.id,
              linkFingerprint,
            },
            'Override references a link not produced by the algorithm — returning as orphaned'
          );
          orphaned.push({
            override,
            sourceTransactionId: sourceId,
            targetTransactionId: targetId,
            assetSymbol: payload.asset,
            linkType: payload.link_type,
          });
          continue;
        }

        if (payload.action === 'confirm') {
          link.status = 'confirmed';
          link.reviewedBy = override.actor;
          link.reviewedAt = new Date(override.created_at);
        }
      } else if (override.scope === 'unlink') {
        const payload = override.payload as UnlinkOverridePayload;

        const link = linkMap.get(payload.link_fingerprint);

        if (!link) {
          logger.warn(
            {
              overrideId: override.id,
              linkFingerprint: payload.link_fingerprint,
            },
            'Could not find link matching unlink override fingerprint'
          );
          unresolved.push(override);
          continue;
        }

        link.status = 'rejected';
        link.reviewedBy = override.actor;
        link.reviewedAt = new Date(override.created_at);
      }
    }

    return ok({ links, orphaned, unresolved });
  } catch (error) {
    return wrapError(error, 'Failed to apply link overrides');
  }
}
