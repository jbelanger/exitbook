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
 * Build both fingerprint and ID lookup maps in a single pass
 * More efficient than calling buildFingerprintMap separately when both maps are needed
 */
function buildTransactionMaps(transactions: TransactionWithFingerprint[]): {
  fingerprintMap: Map<string, number>;
  txById: Map<number, TransactionWithFingerprint>;
} {
  const fingerprintMap = new Map<string, number>();
  const txById = new Map<number, TransactionWithFingerprint>();

  for (const tx of transactions) {
    const fingerprint = `${tx.source}:${tx.externalId}`;
    fingerprintMap.set(fingerprint, tx.id);
    txById.set(tx.id, tx);
  }

  return { fingerprintMap, txById };
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
 * Final override state for a specific link (identified by fingerprint).
 * Projected from the event stream using "last event wins" semantics.
 */
interface OverrideState {
  action: 'confirm' | 'reject';
  lastEvent: OverrideEvent;
  sourceTransactionId: number;
  targetTransactionId: number;
  assetSymbol: string;
  linkType: string;
}

/**
 * Project final override state from event stream.
 * Returns a map of link fingerprint → final override state.
 *
 * Uses "last event wins" semantics: if events are link→unlink→link,
 * the final state is 'confirm'. This correctly handles any sequence
 * of override events for the same link.
 *
 * @param overrides - Override events with scope='link' or 'unlink'
 * @param fingerprintMap - Map of transaction fingerprint → transaction ID
 * @returns Object with final override states and unresolved events
 */
function projectOverrideState(
  overrides: OverrideEvent[],
  fingerprintMap: Map<string, number>
): {
  overrideStates: Map<string, OverrideState>;
  unresolved: OverrideEvent[];
} {
  const overrideStates = new Map<string, OverrideState>();
  const unresolved: OverrideEvent[] = [];

  // Process events in chronological order (already sorted in JSONL)
  for (const override of overrides) {
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

      // Build link fingerprint (sorted for deterministic ordering)
      const [fp1, fp2] = [payload.source_fingerprint, payload.target_fingerprint].sort();
      const linkFingerprint = `link:${fp1}:${fp2}:${payload.asset}`;

      // Upsert state (last event wins)
      overrideStates.set(linkFingerprint, {
        action: 'confirm',
        lastEvent: override,
        sourceTransactionId: sourceId,
        targetTransactionId: targetId,
        assetSymbol: payload.asset,
        linkType: payload.link_type,
      });
    } else if (override.scope === 'unlink') {
      const payload = override.payload as UnlinkOverridePayload;
      const linkFingerprint = payload.link_fingerprint;

      // Get existing state to preserve transaction details
      const existingState = overrideStates.get(linkFingerprint);

      if (existingState) {
        // Update existing state to reject, preserving transaction details
        overrideStates.set(linkFingerprint, {
          ...existingState,
          action: 'reject',
          lastEvent: override,
        });
      } else {
        // Unlink without prior link event - create minimal reject state.
        // This can occur when a user rejects an algorithm-generated link before
        // any confirm event. The placeholder values (-1, '') indicate that we
        // don't have full transaction details yet. If the final projected state
        // is still 'reject', no link will be created. If a later link event
        // arrives, it will update this state with real transaction details.
        overrideStates.set(linkFingerprint, {
          action: 'reject',
          lastEvent: override,
          sourceTransactionId: -1, // Placeholder - will be replaced if link event arrives
          targetTransactionId: -1, // Placeholder - will be replaced if link event arrives
          assetSymbol: '', // Placeholder - will be replaced if link event arrives
          linkType: '', // Placeholder - will be replaced if link event arrives
        });
      }
    }
  }

  return { overrideStates, unresolved };
}

/**
 * Apply link overrides to a set of links using event sourcing projection.
 *
 * Projects final override state from the event stream, then applies to links once.
 * Uses "last event wins" semantics to handle any sequence of overrides correctly.
 *
 * When a link_override resolves both transaction IDs but no matching link exists
 * in the algorithm output, it is returned in `orphaned` ONLY if the final state
 * is 'confirm'. If the final state is 'reject', the link is not created.
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
    // Build both lookup maps in a single pass for efficiency
    const { fingerprintMap, txById } = buildTransactionMaps(transactions);
    const orphaned: OrphanedLinkOverride[] = [];

    // Filter to link-related overrides
    const linkOverrides = overrides.filter((o) => o.scope === 'link' || o.scope === 'unlink');

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

    // Project final override state from event stream
    const { overrideStates, unresolved } = projectOverrideState(linkOverrides, fingerprintMap);

    // Apply final state to links and collect orphaned overrides
    for (const [linkFingerprint, state] of overrideStates) {
      const link = linkMap.get(linkFingerprint);

      if (link) {
        // Apply override to existing link
        link.status = state.action === 'confirm' ? 'confirmed' : 'rejected';
        link.reviewedBy = state.lastEvent.actor;
        link.reviewedAt = new Date(state.lastEvent.created_at);
      } else {
        // Orphaned: algorithm didn't produce this link
        if (state.action === 'confirm') {
          // Only create orphaned if final state is confirm
          // Validate we have proper transaction IDs (not placeholders from unlink-only)
          if (state.sourceTransactionId === -1 || state.targetTransactionId === -1) {
            logger.warn(
              {
                overrideId: state.lastEvent.id,
                linkFingerprint,
              },
              'Cannot create orphaned link from unlink-only override (missing transaction details)'
            );
            unresolved.push(state.lastEvent);
            continue;
          }

          logger.info(
            {
              overrideId: state.lastEvent.id,
              linkFingerprint,
            },
            'Override references a link not produced by the algorithm — returning as orphaned'
          );
          orphaned.push({
            override: state.lastEvent,
            sourceTransactionId: state.sourceTransactionId,
            targetTransactionId: state.targetTransactionId,
            assetSymbol: state.assetSymbol,
            linkType: state.linkType,
          });
        }
        // If final state is 'reject', don't create the link at all
        // (this correctly handles the bug: orphaned link later rejected)
      }
    }

    return ok({ links, orphaned, unresolved });
  } catch (error) {
    return wrapError(error, 'Failed to apply link overrides');
  }
}
