import { type TokenMetadataRecord, type TokenReferenceLookupResult } from '@exitbook/blockchain-providers';
import type { AssetReviewEvidence, AssetReviewSummary, TransactionDiagnostic, Transaction } from '@exitbook/core';
import { buildBlockchainTokenAssetId, err, ok, parseAssetId, sha256Hex, type Result } from '@exitbook/foundation';
import { getLogger } from '@exitbook/logger';

const logger = getLogger('asset-review-service');

interface AssetSignal {
  assetId: string;
  hasSpamFlag: boolean;
  scamDiagnosticHasError: boolean;
  scamDiagnosticCount: number;
  suspiciousAirdropDiagnosticHasError: boolean;
  suspiciousAirdropDiagnosticCount: number;
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
  getByTokenRefs(
    blockchain: string,
    tokenRefs: string[]
  ): Promise<Result<Map<string, TokenMetadataRecord | undefined>, Error>>;
}

export interface AssetReviewReferenceResolver {
  resolveBatch(
    blockchain: string,
    tokenRefs: string[]
  ): Promise<Result<Map<string, TokenReferenceLookupResult>, Error>>;
}

export interface BuildAssetReviewSummariesOptions {
  referenceResolver?: AssetReviewReferenceResolver | undefined;
  reviewDecisions?: ReadonlyMap<string, AssetReviewDecisionInput> | undefined;
  tokenMetadataReader?: AssetReviewTokenMetadataReader | undefined;
}

export async function buildAssetReviewSummaries(
  transactions: Transaction[],
  options: BuildAssetReviewSummariesOptions = {}
): Promise<Result<Map<string, AssetReviewSummary>, Error>> {
  const signalsByAssetId = collectAssetSignals(transactions);
  const ambiguitiesByAssetId = collectSameSymbolAmbiguities(transactions);
  const metadataByAssetId = new Map<string, TokenMetadataRecord | undefined>();
  const referencesByAssetId = new Map<string, TokenReferenceLookupResult>();

  const tokenRefsByChain = new Map<string, string[]>();
  for (const assetId of signalsByAssetId.keys()) {
    const parsedAsset = parseAssetId(assetId);
    if (parsedAsset.isErr() || parsedAsset.value.namespace !== 'blockchain' || parsedAsset.value.ref === 'native') {
      continue;
    }

    const chain = parsedAsset.value.chain;
    const tokenRef = parsedAsset.value.ref;
    if (!chain || !tokenRef) {
      continue;
    }

    const existing = tokenRefsByChain.get(chain) ?? [];
    existing.push(tokenRef);
    tokenRefsByChain.set(chain, existing);
  }

  for (const [chain, tokenRefs] of tokenRefsByChain) {
    if (options.tokenMetadataReader) {
      const metadataResult = await options.tokenMetadataReader.getByTokenRefs(chain, tokenRefs);
      if (metadataResult.isErr()) {
        return err(metadataResult.error);
      }

      for (const [tokenRef, metadata] of metadataResult.value) {
        const lookupAssetId = buildTokenLookupAssetId(chain, tokenRef);
        if (!lookupAssetId) {
          continue;
        }

        metadataByAssetId.set(lookupAssetId, metadata);
      }
    }

    if (options.referenceResolver) {
      const referenceResult = await options.referenceResolver.resolveBatch(chain, tokenRefs);
      if (referenceResult.isErr()) {
        return err(referenceResult.error);
      }

      for (const [tokenRef, reference] of referenceResult.value) {
        const lookupAssetId = buildTokenLookupAssetId(chain, tokenRef);
        if (!lookupAssetId) {
          continue;
        }

        referencesByAssetId.set(lookupAssetId, reference);
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
    const evidence = buildAssetEvidence(signal, metadata, reference, ambiguity);
    const evidenceFingerprint = computeEvidenceFingerprint({
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

function collectAssetSignals(transactions: Transaction[]): Map<string, AssetSignal> {
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
        scamDiagnosticHasError: false,
        scamDiagnosticCount: 0,
        suspiciousAirdropDiagnosticHasError: false,
        suspiciousAirdropDiagnosticCount: 0,
        symbols: new Set<string>(),
      };

      signal.symbols.add(entry.assetSymbol);
      if (!assetIdsSeenInTransaction.has(entry.assetId)) {
        assetIdsSeenInTransaction.add(entry.assetId);

        const applicableDiagnostics = collectApplicableDiagnostics(
          transaction,
          entry.assetId,
          entry.assetSymbol,
          primaryAssetIds
        );
        const isOnlyPrimaryAsset = primaryAssetIds.size === 1 && primaryAssetIds.has(entry.assetId);

        if (
          transaction.isSpam === true &&
          (applicableDiagnostics.some((diagnostic) => diagnostic.code === 'SCAM_TOKEN') ||
            (applicableDiagnostics.length === 0 && isOnlyPrimaryAsset))
        ) {
          signal.hasSpamFlag = true;
        }

        for (const diagnostic of applicableDiagnostics) {
          if (diagnostic.code === 'SCAM_TOKEN') {
            signal.scamDiagnosticCount += 1;
            signal.scamDiagnosticHasError ||= diagnostic.severity !== 'warning';
          }
          if (diagnostic.code === 'SUSPICIOUS_AIRDROP') {
            signal.suspiciousAirdropDiagnosticCount += 1;
            signal.suspiciousAirdropDiagnosticHasError ||= diagnostic.severity === 'error';
          }
        }
      }

      signalsByAssetId.set(entry.assetId, signal);
    }
  }

  return signalsByAssetId;
}

function collectSameSymbolAmbiguities(transactions: Transaction[]): Map<string, SymbolAmbiguityGroup> {
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
      if (!chain) {
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

function buildTokenLookupAssetId(chain: string, tokenRef: string): string | undefined {
  const assetIdResult = buildBlockchainTokenAssetId(chain, tokenRef);
  if (assetIdResult.isErr()) {
    logger.warn({ chain, tokenRef, error: assetIdResult.error }, 'Failed to build asset ID for asset review lookup');
    return undefined;
  }

  return assetIdResult.value;
}

function collectPrimaryAssetIds(transaction: Transaction): Set<string> {
  const primaryAssetIds = new Set<string>();

  for (const movement of [...(transaction.movements.inflows ?? []), ...(transaction.movements.outflows ?? [])]) {
    primaryAssetIds.add(movement.assetId);
  }

  return primaryAssetIds;
}

function collectApplicableDiagnostics(
  transaction: Transaction,
  assetId: string,
  assetSymbol: string,
  primaryAssetIds: Set<string>
): TransactionDiagnostic[] {
  const diagnostics = transaction.diagnostics ?? [];
  const exactMatches = diagnostics.filter((diagnostic) => diagnosticTargetsAsset(diagnostic, assetId));
  if (exactMatches.length > 0) {
    return exactMatches;
  }

  const applicableDiagnostics: TransactionDiagnostic[] = [];
  const symbolMatches = diagnostics.filter((diagnostic) => diagnosticTargetsSymbol(diagnostic, assetSymbol));
  if (symbolMatches.length > 0 && symbolTargetIsUnambiguous(transaction, assetId, assetSymbol)) {
    applicableDiagnostics.push(...symbolMatches);
  }

  const isOnlyPrimaryAsset = primaryAssetIds.size === 1 && primaryAssetIds.has(assetId);
  if (isOnlyPrimaryAsset) {
    applicableDiagnostics.push(...diagnostics.filter((diagnostic) => diagnosticHasNoTarget(diagnostic)));
  }

  return applicableDiagnostics;
}

function diagnosticTargetsAsset(diagnostic: TransactionDiagnostic, assetId: string): boolean {
  const diagnosticAssetId: unknown = diagnostic.metadata?.['assetId'];
  if (typeof diagnosticAssetId === 'string' && diagnosticAssetId === assetId) {
    return true;
  }

  const diagnosticContractAddress: unknown = diagnostic.metadata?.['contractAddress'];
  if (typeof diagnosticContractAddress !== 'string' || diagnosticContractAddress.trim() === '') {
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
    parsedAssetId.value.ref.toLowerCase() === diagnosticContractAddress.toLowerCase()
  );
}

function diagnosticTargetsSymbol(diagnostic: TransactionDiagnostic, assetSymbol: string): boolean {
  const diagnosticAssetSymbol: unknown = diagnostic.metadata?.['assetSymbol'] ?? diagnostic.metadata?.['scamAsset'];
  return (
    typeof diagnosticAssetSymbol === 'string' &&
    diagnosticAssetSymbol.trim().toLowerCase() === assetSymbol.trim().toLowerCase()
  );
}

function diagnosticHasNoTarget(diagnostic: TransactionDiagnostic): boolean {
  return (
    diagnostic.metadata?.['assetId'] === undefined &&
    diagnostic.metadata?.['contractAddress'] === undefined &&
    diagnostic.metadata?.['assetSymbol'] === undefined &&
    diagnostic.metadata?.['scamAsset'] === undefined
  );
}

function symbolTargetIsUnambiguous(transaction: Transaction, assetId: string, assetSymbol: string): boolean {
  const normalizedSymbol = assetSymbol.trim().toLowerCase();
  const matchingAssetIds = new Set<string>();

  for (const entry of [
    ...(transaction.movements.inflows ?? []),
    ...(transaction.movements.outflows ?? []),
    ...(transaction.fees ?? []),
  ]) {
    if (entry.assetSymbol.trim().toLowerCase() === normalizedSymbol) {
      matchingAssetIds.add(entry.assetId);
    }
  }

  return matchingAssetIds.size === 1 && matchingAssetIds.has(assetId);
}

function buildAssetEvidence(
  signal: AssetSignal,
  metadata: TokenMetadataRecord | undefined,
  reference: TokenReferenceLookupResult,
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

  if (signal.scamDiagnosticCount > 0) {
    evidence.push({
      kind: 'scam-note',
      severity: signal.scamDiagnosticHasError ? 'error' : 'warning',
      message: `${signal.scamDiagnosticCount} processed transaction(s) carried SCAM_TOKEN warnings`,
      metadata: {
        count: signal.scamDiagnosticCount,
      },
    });
  }

  if (signal.suspiciousAirdropDiagnosticCount > 0) {
    evidence.push({
      kind: 'suspicious-airdrop-note',
      severity: signal.suspiciousAirdropDiagnosticHasError ? 'error' : 'warning',
      message: `${signal.suspiciousAirdropDiagnosticCount} processed transaction(s) carried SUSPICIOUS_AIRDROP warnings`,
      metadata: {
        count: signal.suspiciousAirdropDiagnosticCount,
      },
    });
  }

  if (reference.referenceStatus === 'unmatched') {
    evidence.push({
      kind: 'unmatched-reference',
      severity: 'warning',
      message: `Provider '${reference.provider}' could not match this token to a canonical asset`,
      metadata: {
        provider: reference.provider,
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

function computeEvidenceFingerprint(value: unknown): string {
  const canonicalJson = JSON.stringify(sortJsonValue(value));
  return `asset-review:v1:${sha256Hex(canonicalJson)}`;
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
