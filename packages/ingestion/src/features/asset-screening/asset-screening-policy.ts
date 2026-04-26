import { err, ok, parseAssetId, type Result } from '@exitbook/foundation';

export type ReferenceBalanceDiscoveryMode = 'tracked-reference-assets' | 'discover-all-reference-assets';

export type AssetScreeningSuppressionReason = 'accounting-blocked-asset' | 'spam-diagnostic';

export type AssetScreeningDecisionReason =
  | AssetScreeningSuppressionReason
  | 'discovered-reference-asset'
  | 'native-asset'
  | 'outside-reference-scope'
  | 'tracked-reference-asset';

export interface AssetScreeningDecision {
  action: 'include' | 'suppress';
  assetId: string;
  reason: AssetScreeningDecisionReason;
}

export interface ReferenceBalanceAssetScreeningPolicy {
  readonly candidateAssetIds: ReadonlySet<string>;
  readonly discoveryMode: ReferenceBalanceDiscoveryMode;
  readonly suppressedAssetIds: ReadonlySet<string>;
  getTokenContractAllowlist(blockchain: string): readonly string[] | undefined;
  screenReferenceAsset(assetId: string): AssetScreeningDecision;
}

export interface BuildReferenceBalanceAssetScreeningPolicyParams {
  balanceAdjustmentAssetIds?: Iterable<string> | undefined;
  blockchain: string;
  calculatedAssetIds: Iterable<string>;
  discoveryMode?: ReferenceBalanceDiscoveryMode | undefined;
  suppressedAssetReasons?: ReadonlyMap<string, AssetScreeningSuppressionReason> | undefined;
}

class ReferenceBalanceAssetScreeningPolicyImpl implements ReferenceBalanceAssetScreeningPolicy {
  readonly candidateAssetIds: ReadonlySet<string>;
  readonly discoveryMode: ReferenceBalanceDiscoveryMode;
  readonly suppressedAssetIds: ReadonlySet<string>;

  constructor(
    private readonly params: {
      candidateAssetIds: ReadonlySet<string>;
      discoveryMode: ReferenceBalanceDiscoveryMode;
      suppressedAssetReasons: ReadonlyMap<string, AssetScreeningSuppressionReason>;
      tokenContractAllowlistByChain: ReadonlyMap<string, readonly string[]>;
    }
  ) {
    this.candidateAssetIds = params.candidateAssetIds;
    this.discoveryMode = params.discoveryMode;
    this.suppressedAssetIds = new Set(params.suppressedAssetReasons.keys());
  }

  getTokenContractAllowlist(blockchain: string): readonly string[] | undefined {
    if (this.discoveryMode === 'discover-all-reference-assets') {
      return undefined;
    }

    return this.params.tokenContractAllowlistByChain.get(normalizeChain(blockchain)) ?? [];
  }

  screenReferenceAsset(assetId: string): AssetScreeningDecision {
    const suppressionReason = this.params.suppressedAssetReasons.get(assetId);
    if (suppressionReason !== undefined) {
      return {
        action: 'suppress',
        assetId,
        reason: suppressionReason,
      };
    }

    if (this.candidateAssetIds.has(assetId)) {
      return {
        action: 'include',
        assetId,
        reason: assetId.endsWith(':native') ? 'native-asset' : 'tracked-reference-asset',
      };
    }

    if (this.discoveryMode === 'discover-all-reference-assets') {
      return {
        action: 'include',
        assetId,
        reason: 'discovered-reference-asset',
      };
    }

    return {
      action: 'suppress',
      assetId,
      reason: 'outside-reference-scope',
    };
  }
}

export function buildReferenceBalanceAssetScreeningPolicy(
  params: BuildReferenceBalanceAssetScreeningPolicyParams
): Result<ReferenceBalanceAssetScreeningPolicy, Error> {
  const discoveryMode = params.discoveryMode ?? 'tracked-reference-assets';
  const candidateAssetIds = new Set<string>();

  for (const assetId of params.calculatedAssetIds) {
    candidateAssetIds.add(assetId);
  }

  for (const assetId of params.balanceAdjustmentAssetIds ?? []) {
    candidateAssetIds.add(assetId);
  }

  for (const assetId of params.suppressedAssetReasons?.keys() ?? []) {
    candidateAssetIds.delete(assetId);
  }

  const tokenContractAllowlistResult = buildTokenContractAllowlistByChain({
    blockchain: params.blockchain,
    candidateAssetIds,
  });
  if (tokenContractAllowlistResult.isErr()) {
    return err(tokenContractAllowlistResult.error);
  }

  return ok(
    new ReferenceBalanceAssetScreeningPolicyImpl({
      candidateAssetIds,
      discoveryMode,
      tokenContractAllowlistByChain: tokenContractAllowlistResult.value,
      suppressedAssetReasons: params.suppressedAssetReasons ?? new Map(),
    })
  );
}

function buildTokenContractAllowlistByChain(params: {
  blockchain: string;
  candidateAssetIds: ReadonlySet<string>;
}): Result<ReadonlyMap<string, readonly string[]>, Error> {
  const tokenRefsByChain = new Map<string, Set<string>>();
  const expectedChain = normalizeChain(params.blockchain);

  for (const assetId of params.candidateAssetIds) {
    const parsedResult = parseAssetId(assetId);
    if (parsedResult.isErr()) {
      return err(new Error(`Failed to parse balance reference asset id '${assetId}': ${parsedResult.error.message}`));
    }

    const parsed = parsedResult.value;
    if (parsed.namespace !== 'blockchain' || parsed.ref === 'native') {
      continue;
    }

    const chain = normalizeChain(parsed.chain ?? '');
    if (chain !== expectedChain) {
      continue;
    }

    const tokenRef = parsed.ref;
    if (tokenRef === undefined || tokenRef.trim().length === 0) {
      return err(new Error(`Blockchain token asset id '${assetId}' is missing a token reference`));
    }

    const existing = tokenRefsByChain.get(chain) ?? new Set<string>();
    existing.add(tokenRef);
    tokenRefsByChain.set(chain, existing);
  }

  return ok(new Map([...tokenRefsByChain].map(([chain, tokenRefs]) => [chain, [...tokenRefs].sort()])));
}

function normalizeChain(blockchain: string): string {
  return blockchain.trim().toLowerCase();
}
