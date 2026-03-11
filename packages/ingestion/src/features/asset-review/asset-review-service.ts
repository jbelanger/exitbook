import { getEvmChainConfig, type TokenReferenceLookupResult } from '@exitbook/blockchain-providers';
import type {
  AssetReviewEvidence,
  AssetReviewSummary,
  TokenMetadataRecord,
  TransactionNote,
  UniversalTransactionData,
} from '@exitbook/core';
import { err, ok, parseAssetId, type Result } from '@exitbook/core';
import { getLogger } from '@exitbook/logger';

const logger = getLogger('asset-review-service');

interface AssetSignal {
  assetId: string;
  hasSpamFlag: boolean;
  scamNoteHasError: boolean;
  scamNoteCount: number;
  suspiciousAirdropNoteHasError: boolean;
  suspiciousAirdropNoteCount: number;
  symbols: Set<string>;
}

interface SymbolAmbiguityGroup {
  chain: string;
  conflictingAssetIds: string[];
  normalizedSymbol: string;
}

export interface AssetReviewDecisionInput {
  action: 'clear' | 'confirm';
  evidenceFingerprint?: string | undefined;
}

export interface AssetReviewTokenMetadataReader {
  getByContracts(
    blockchain: string,
    contractAddresses: string[]
  ): Promise<Result<Map<string, TokenMetadataRecord | undefined>, Error>>;
}

export interface AssetReviewReferenceResolver {
  resolveBatch(
    blockchain: string,
    contractAddresses: string[]
  ): Promise<Result<Map<string, TokenReferenceLookupResult>, Error>>;
}

export interface BuildAssetReviewSummariesOptions {
  referenceResolver?: AssetReviewReferenceResolver | undefined;
  reviewDecisions?: ReadonlyMap<string, AssetReviewDecisionInput> | undefined;
  tokenMetadataReader?: AssetReviewTokenMetadataReader | undefined;
}

export async function buildAssetReviewSummaries(
  transactions: UniversalTransactionData[],
  options: BuildAssetReviewSummariesOptions = {}
): Promise<Result<Map<string, AssetReviewSummary>, Error>> {
  const signalsByAssetId = collectAssetSignals(transactions);
  const ambiguitiesByAssetId = collectSameSymbolAmbiguities(transactions);
  const metadataByAssetId = new Map<string, TokenMetadataRecord | undefined>();
  const referencesByAssetId = new Map<string, TokenReferenceLookupResult>();

  const evmAssetsByChain = new Map<string, string[]>();
  for (const assetId of signalsByAssetId.keys()) {
    const parsedAsset = parseAssetId(assetId);
    if (parsedAsset.isErr() || parsedAsset.value.namespace !== 'blockchain' || parsedAsset.value.ref === 'native') {
      continue;
    }

    const chain = parsedAsset.value.chain;
    const contractAddress = parsedAsset.value.ref;
    if (!chain || !contractAddress || !getEvmChainConfig(chain)) {
      continue;
    }

    const existing = evmAssetsByChain.get(chain) ?? [];
    existing.push(contractAddress.toLowerCase());
    evmAssetsByChain.set(chain, existing);
  }

  for (const [chain, contracts] of evmAssetsByChain) {
    if (options.tokenMetadataReader) {
      const metadataResult = await options.tokenMetadataReader.getByContracts(chain, contracts);
      if (metadataResult.isErr()) {
        return err(metadataResult.error);
      }

      for (const [contractAddress, metadata] of metadataResult.value) {
        metadataByAssetId.set(`blockchain:${chain}:${contractAddress.toLowerCase()}`, metadata);
      }
    }

    if (options.referenceResolver) {
      const referenceResult = await options.referenceResolver.resolveBatch(chain, contracts);
      if (referenceResult.isErr()) {
        return err(referenceResult.error);
      }

      for (const [contractAddress, reference] of referenceResult.value) {
        referencesByAssetId.set(`blockchain:${chain}:${contractAddress.toLowerCase()}`, reference);
      }
    }
  }

  const summaries = new Map<string, AssetReviewSummary>();
  for (const [assetId, signal] of signalsByAssetId) {
    const metadata = metadataByAssetId.get(assetId);
    const reference = referencesByAssetId.get(assetId) ?? {
      provider: 'coingecko',
      referenceStatus: 'unknown' as const,
    };
    const ambiguity = ambiguitiesByAssetId.get(assetId);
    const evidence = buildAssetEvidence(signal, metadata, ambiguity);
    const evidenceFingerprint = await computeEvidenceFingerprint({
      assetId,
      evidence: evidence.map((item) => ({
        kind: item.kind,
        metadata: item.metadata,
        message: item.message,
        severity: item.severity,
      })),
      referenceStatus: reference.referenceStatus,
    });

    const decision = options.reviewDecisions?.get(assetId);
    const confirmedEvidenceFingerprint =
      decision?.action === 'confirm' ? (decision.evidenceFingerprint ?? undefined) : undefined;
    const confirmationIsStale =
      decision?.action === 'confirm' &&
      decision.evidenceFingerprint !== undefined &&
      decision.evidenceFingerprint !== evidenceFingerprint;

    let reviewStatus: AssetReviewSummary['reviewStatus'] = evidence.length > 0 ? 'needs-review' : 'clear';
    if (
      decision?.action === 'confirm' &&
      decision.evidenceFingerprint !== undefined &&
      decision.evidenceFingerprint === evidenceFingerprint &&
      evidence.length > 0
    ) {
      reviewStatus = 'reviewed';
    }

    summaries.set(assetId, {
      assetId,
      reviewStatus,
      referenceStatus: reference.referenceStatus,
      evidenceFingerprint,
      confirmationIsStale,
      accountingBlocked: deriveAccountingBlocked(evidence, reviewStatus),
      confirmedEvidenceFingerprint,
      warningSummary: evidence.length > 0 ? evidence.map((item) => item.message).join('; ') : undefined,
      evidence,
    });
  }

  return ok(summaries);
}

function collectAssetSignals(transactions: UniversalTransactionData[]): Map<string, AssetSignal> {
  const signalsByAssetId = new Map<string, AssetSignal>();

  for (const transaction of transactions) {
    const assetEntries = [
      ...(transaction.movements.inflows ?? []),
      ...(transaction.movements.outflows ?? []),
      ...(transaction.fees ?? []),
    ];
    const assetIdsSeenInTransaction = new Set<string>();
    const primaryAssetIds = collectPrimaryAssetIds(transaction);

    for (const entry of assetEntries) {
      const signal = signalsByAssetId.get(entry.assetId) ?? {
        assetId: entry.assetId,
        hasSpamFlag: false,
        scamNoteHasError: false,
        scamNoteCount: 0,
        suspiciousAirdropNoteHasError: false,
        suspiciousAirdropNoteCount: 0,
        symbols: new Set<string>(),
      };

      signal.symbols.add(entry.assetSymbol);
      if (!assetIdsSeenInTransaction.has(entry.assetId)) {
        assetIdsSeenInTransaction.add(entry.assetId);

        const applicableNotes = collectApplicableNotes(transaction, entry.assetId, entry.assetSymbol, primaryAssetIds);
        const isOnlyPrimaryAsset = primaryAssetIds.size === 1 && primaryAssetIds.has(entry.assetId);

        if (
          transaction.isSpam === true &&
          (applicableNotes.some((note) => note.type === 'SCAM_TOKEN') ||
            (applicableNotes.length === 0 && isOnlyPrimaryAsset))
        ) {
          signal.hasSpamFlag = true;
        }

        for (const note of applicableNotes) {
          if (note.type === 'SCAM_TOKEN') {
            signal.scamNoteCount += 1;
            signal.scamNoteHasError ||= note.severity !== 'warning';
          }
          if (note.type === 'SUSPICIOUS_AIRDROP') {
            signal.suspiciousAirdropNoteCount += 1;
            signal.suspiciousAirdropNoteHasError ||= note.severity === 'error';
          }
        }
      }

      signalsByAssetId.set(entry.assetId, signal);
    }
  }

  return signalsByAssetId;
}

function collectSameSymbolAmbiguities(transactions: UniversalTransactionData[]): Map<string, SymbolAmbiguityGroup> {
  const groups = new Map<string, Set<string>>();

  for (const transaction of transactions) {
    const movements = [...(transaction.movements.inflows ?? []), ...(transaction.movements.outflows ?? [])];

    for (const movement of movements) {
      const parsedAssetId = parseAssetId(movement.assetId);
      if (parsedAssetId.isErr()) {
        logger.warn({ assetId: movement.assetId, error: parsedAssetId.error }, 'Failed to parse asset ID for review');
        continue;
      }

      if (parsedAssetId.value.namespace !== 'blockchain' || parsedAssetId.value.ref === 'native') {
        continue;
      }

      const chain = parsedAssetId.value.chain;
      if (!chain || !getEvmChainConfig(chain)) {
        continue;
      }

      const normalizedSymbol = movement.assetSymbol.trim().toLowerCase();
      const groupKey = `${chain}:${normalizedSymbol}`;
      const assetIds = groups.get(groupKey) ?? new Set<string>();
      assetIds.add(movement.assetId);
      groups.set(groupKey, assetIds);
    }
  }

  const ambiguities = new Map<string, SymbolAmbiguityGroup>();
  for (const [groupKey, assetIds] of groups) {
    if (assetIds.size <= 1) {
      continue;
    }

    const [chain, normalizedSymbol] = groupKey.split(':', 2) as [string, string];
    const conflictingAssetIds = [...assetIds].sort((left, right) => left.localeCompare(right));

    for (const assetId of conflictingAssetIds) {
      ambiguities.set(assetId, {
        chain,
        normalizedSymbol,
        conflictingAssetIds,
      });
    }
  }

  return ambiguities;
}

function collectPrimaryAssetIds(transaction: UniversalTransactionData): Set<string> {
  const primaryAssetIds = new Set<string>();

  for (const movement of [...(transaction.movements.inflows ?? []), ...(transaction.movements.outflows ?? [])]) {
    primaryAssetIds.add(movement.assetId);
  }

  return primaryAssetIds;
}

function collectApplicableNotes(
  transaction: UniversalTransactionData,
  assetId: string,
  assetSymbol: string,
  primaryAssetIds: Set<string>
): TransactionNote[] {
  const notes = transaction.notes ?? [];
  const exactMatches = notes.filter((note) => noteTargetsAsset(note, assetId));
  if (exactMatches.length > 0) {
    return exactMatches;
  }

  const isOnlyPrimaryAsset = primaryAssetIds.size === 1 && primaryAssetIds.has(assetId);
  if (isOnlyPrimaryAsset) {
    return notes.filter((note) => noteTargetsSymbol(note, assetSymbol) || noteHasNoTarget(note));
  }

  return [];
}

function noteTargetsAsset(note: TransactionNote, assetId: string): boolean {
  const noteAssetId: unknown = note.metadata?.['assetId'];
  if (typeof noteAssetId === 'string' && noteAssetId === assetId) {
    return true;
  }

  const noteContractAddress: unknown = note.metadata?.['contractAddress'];
  if (typeof noteContractAddress !== 'string' || noteContractAddress.trim() === '') {
    return false;
  }

  const parsedAssetId = parseAssetId(assetId);
  if (parsedAssetId.isErr()) {
    return false;
  }

  return (
    parsedAssetId.value.namespace === 'blockchain' &&
    typeof parsedAssetId.value.ref === 'string' &&
    parsedAssetId.value.ref !== 'native' &&
    parsedAssetId.value.ref.toLowerCase() === noteContractAddress.toLowerCase()
  );
}

function noteTargetsSymbol(note: TransactionNote, assetSymbol: string): boolean {
  const noteAssetSymbol: unknown = note.metadata?.['assetSymbol'] ?? note.metadata?.['scamAsset'];
  return (
    typeof noteAssetSymbol === 'string' && noteAssetSymbol.trim().toLowerCase() === assetSymbol.trim().toLowerCase()
  );
}

function noteHasNoTarget(note: TransactionNote): boolean {
  return note.metadata?.['assetId'] === undefined && note.metadata?.['contractAddress'] === undefined;
}

function buildAssetEvidence(
  signal: AssetSignal,
  metadata: TokenMetadataRecord | undefined,
  ambiguity: SymbolAmbiguityGroup | undefined
): AssetReviewEvidence[] {
  const evidence: AssetReviewEvidence[] = [];

  if (metadata?.possibleSpam === true) {
    evidence.push({
      kind: 'provider-spam-flag',
      severity: 'error',
      message: `Provider '${metadata.source}' flagged this token as spam`,
      metadata: {
        provider: metadata.source,
        verifiedContract: metadata.verifiedContract,
      },
    });
  }

  if (signal.hasSpamFlag) {
    evidence.push({
      kind: 'spam-flag',
      severity: 'error',
      message: 'Processed transactions marked this asset as spam',
    });
  }

  if (signal.scamNoteCount > 0) {
    evidence.push({
      kind: 'scam-note',
      severity: signal.scamNoteHasError ? 'error' : 'warning',
      message: `${signal.scamNoteCount} processed transaction(s) carried SCAM_TOKEN warnings`,
      metadata: {
        count: signal.scamNoteCount,
      },
    });
  }

  if (signal.suspiciousAirdropNoteCount > 0) {
    evidence.push({
      kind: 'suspicious-airdrop-note',
      severity: signal.suspiciousAirdropNoteHasError ? 'error' : 'warning',
      message: `${signal.suspiciousAirdropNoteCount} processed transaction(s) carried SUSPICIOUS_AIRDROP warnings`,
      metadata: {
        count: signal.suspiciousAirdropNoteCount,
      },
    });
  }

  if (ambiguity) {
    evidence.push({
      kind: 'same-symbol-ambiguity',
      severity: 'warning',
      message: `Same-chain symbol ambiguity on ${ambiguity.chain}:${ambiguity.normalizedSymbol}`,
      metadata: {
        chain: ambiguity.chain,
        conflictingAssetIds: ambiguity.conflictingAssetIds,
        normalizedSymbol: ambiguity.normalizedSymbol,
      },
    });
  }

  return evidence.sort((left, right) => {
    return (
      left.kind.localeCompare(right.kind) ||
      left.severity.localeCompare(right.severity) ||
      left.message.localeCompare(right.message)
    );
  });
}

function deriveAccountingBlocked(
  evidence: AssetReviewEvidence[],
  reviewStatus: AssetReviewSummary['reviewStatus']
): boolean {
  if (evidence.some((item) => item.kind === 'same-symbol-ambiguity')) {
    return true;
  }

  if (reviewStatus !== 'needs-review') {
    return false;
  }

  return evidence.some((item) => item.severity === 'error');
}

async function computeEvidenceFingerprint(value: unknown): Promise<string> {
  const canonicalJson = JSON.stringify(sortJsonValue(value));
  const bytes = new TextEncoder().encode(canonicalJson);
  const hashBuffer = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  const hashHex = [...new Uint8Array(hashBuffer)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
  return `asset-review:v1:${hashHex}`;
}

function sortJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => sortJsonValue(item));
  }

  if (value && typeof value === 'object') {
    const sortedEntries = Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entryValue]) => [key, sortJsonValue(entryValue)]);

    return Object.fromEntries(sortedEntries);
  }

  return value;
}
