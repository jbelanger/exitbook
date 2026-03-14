# Theta Family Extraction Plan

Status: phases 1-4 implemented; phase 5 validation pending

## Why This Exists

Theta currently lives inside the EVM family, but it does not actually share the
same transaction semantics.

The current placement creates architectural debt in two places:

- generic EVM configuration models Theta-specific behavior
- generic EVM processing and reference resolution need Theta exceptions

The recent `THETA` asset-review false positive is only one symptom.
The deeper issue is that Theta is being treated as an EVM chain when it is
really a separate account-based chain family with its own native-asset model and
provider semantics.

## Decision To Implement

Extract Theta from the EVM family and give it its own blockchain family/module.

Do not solve this by making `EvmChainConfig` more permissive.
Do not add more EVM-side exceptions.
Do not introduce a new generic "account-based" super-family yet.

## Why Option A Wins

Bitcoin-family reuse in this repo is real family reuse:

- one shared chain config contract
- one shared registry
- provider base classes that do actual work for multiple chains
- no chain-name hacks in shared logic

Theta does not fit that pattern today:

- Theta providers are already standalone
- Theta uses dual native currencies
- Theta transaction semantics are not Ethereum-like
- Theta only reuses the EVM processor path through exceptions

That said, this extraction does not need to eliminate every code-level dependency on
`evm/`.
Theta may continue to reuse EVM-normalization contracts and helpers where that reuse
is still clean and truthful, for example `EvmTransaction`,
`EvmTransactionSchema`, and `normalizeEvmAddress`.

Note: those EVM-prefixed names are a known naming smell — Theta transactions are
not EVM transactions. This is acceptable for this refactor but should be revisited
if additional non-EVM families appear that also reuse these types. At that point,
extract into chain-family-neutral names (e.g. `AccountBasedTransaction`).

That means keeping Theta inside `evm/` preserves the wrong boundary.

## Goals

- Remove Theta from the EVM family package layout.
- Remove `additionalNativeCurrencies` from the EVM chain model.
- Remove Theta-specific native-asset handling from the EVM ingestion processor.
- Give Theta a first-class processor that models its dual native assets
  directly.
- Keep provider registration and ingestion adapter wiring explicit and
  capability-first.
- Replace temporary resolver-side Theta handling with a proper chain-family
  boundary.

## Non-Goals

- Designing a new generic "account-based family" abstraction for all future
  chains.
- Rewriting all EVM processor logic from scratch.
- Changing the asset ID format for existing Theta data in the same patch.
- Solving every canonical-reference policy question for every chain family.
- Refactoring unrelated provider-boundary cleanup in CLI.

## Smells This Plan Removes

### 1. Theta-specific semantics in `EvmChainConfig`

File:

- [packages/blockchain-providers/src/blockchains/evm/chain-config.interface.ts](./packages/blockchain-providers/src/blockchains/evm/chain-config.interface.ts)

Problem:

- `additionalNativeCurrencies` exists to accommodate Theta
- that field is not part of the true EVM family semantic model

### 2. Theta-specific asset identity handling inside the EVM processor

File:

- [packages/ingestion/src/sources/blockchains/evm/processor.ts](./packages/ingestion/src/sources/blockchains/evm/processor.ts)

Problem:

- `buildEvmAssetId()` contains Theta-native exceptions
- generic EVM transaction processing now knows about a non-EVM native-asset
  shape

### 3. Theta providers filed under the EVM provider tree even though they do not reuse EVM provider logic

Files:

- [packages/blockchain-providers/src/blockchains/evm/providers/theta-explorer/theta-explorer.api-client.ts](./packages/blockchain-providers/src/blockchains/evm/providers/theta-explorer/theta-explorer.api-client.ts)
- [packages/blockchain-providers/src/blockchains/evm/providers/thetascan/thetascan.api-client.ts](./packages/blockchain-providers/src/blockchains/evm/providers/thetascan/thetascan.api-client.ts)

Problem:

- file placement implies family membership that is not real
- duplicate Theta-specific mapping helpers are split across provider folders

### 4. Canonical reference logic needs family inference to avoid Theta false positives

File:

- [packages/blockchain-providers/src/reference/coingecko/coingecko-token-reference.ts](./packages/blockchain-providers/src/reference/coingecko/coingecko-token-reference.ts)

Problem:

- current resolver logic has to distinguish EVM-like contract refs from
  symbolic/native-like refs
- this is better owned by clean chain-family boundaries than by family
  inference inside the resolver

## Target Architecture

### Blockchain providers

Create a new Theta family under:

- `packages/blockchain-providers/src/blockchains/theta/`

This family should own:

- Theta chain config
- Theta chain registry
- Theta provider registration
- Theta provider implementations
- Theta-specific shared mapper utilities

### Ingestion

Create a new Theta ingestion source under:

- `packages/ingestion/src/sources/blockchains/theta/`

This family should own:

- Theta importer
- Theta processor
- Theta register file
- Theta-specific processing helpers

### Shared logic

If there is genuinely reusable logic between EVM and Theta, extract only that
logic into narrowly named helpers.

It is also acceptable for Theta to keep importing a small amount of existing
EVM normalization code during this refactor if that reuse stays clean.
Do not force a rename or shared-module extraction in the same patch unless the
dependency becomes messy.

It is acceptable for Theta to reuse account-based fund-flow helpers that still
live under `evm/` for now, but only if Ethereum-only classification rules stay
behind an EVM-specific entry point. Theta must not run through Ethereum staking
or beacon-withdrawal classification branches.

Do not keep Theta under `evm/` just to reuse a large processor class.

Good candidates for extraction:

- generic account-based transaction grouping helpers
- generic correlated-transaction processing helpers
- generic processed-transaction assembly helpers
- generic scam-detection invocation plumbing

Bad candidates for extraction:

- native-asset identity rules
- token-reference eligibility rules
- transaction-type semantics

## Delivery Plan

Implement this in five ordered phases.
Do not mix all phases into one huge patch.

## Phase 1: Create the Theta Provider Family

### New files and directories

Add:

- `packages/blockchain-providers/src/blockchains/theta/chain-config.interface.ts`
- `packages/blockchain-providers/src/blockchains/theta/chain-registry.ts`
- `packages/blockchain-providers/src/blockchains/theta/theta-chains.json`
- `packages/blockchain-providers/src/blockchains/theta/register-apis.ts`
- `packages/blockchain-providers/src/blockchains/theta/index.ts`
- `packages/blockchain-providers/src/blockchains/theta/types.ts`
- `packages/blockchain-providers/src/blockchains/theta/schemas.ts`
- `packages/blockchain-providers/src/blockchains/theta/utils.ts`

Move:

- `packages/blockchain-providers/src/blockchains/evm/providers/theta-explorer/`
- `packages/blockchain-providers/src/blockchains/evm/providers/thetascan/`

to:

- `packages/blockchain-providers/src/blockchains/theta/providers/theta-explorer/`
- `packages/blockchain-providers/src/blockchains/theta/providers/thetascan/`

### Required code changes

Update imports in moved Theta provider files so they resolve against the new
Theta family root instead of `../..` paths under `evm/`.

Create a Theta chain config contract that models what Theta actually needs.

Pseudo-shape:

```ts
interface ThetaChainConfig {
  chainName: 'theta';
  explorerUrls?: string[] | undefined;
  nativeAssets: Array<{
    symbol: Currency;
    decimals: number;
    role: 'gas' | 'primary';
  }>;
  transactionTypes: string[];
  providerHints?: ChainProviderHints | undefined;
}
```

Important:

- represent `TFUEL` and `THETA` as first-class native assets
- do not recreate `additionalNativeCurrencies`

### Files to edit

- [packages/blockchain-providers/src/register-apis.ts](./packages/blockchain-providers/src/register-apis.ts)
- [packages/blockchain-providers/src/catalog/chain-catalog.ts](./packages/blockchain-providers/src/catalog/chain-catalog.ts)
- [packages/blockchain-providers/src/index.ts](./packages/blockchain-providers/src/index.ts)

### Expected outcome

- Theta providers are registered from their own family
- EVM provider registration no longer imports Theta providers

## Phase 2: Create Theta Ingestion Source

This phase also consolidates the duplicated mapper utilities across the two
Theta providers. Building the processor reveals what shared helpers the family
actually needs, so consolidation happens here rather than as a separate step.

### New files and directories

Add:

- `packages/blockchain-providers/src/blockchains/theta/mapper-utils.ts`
- `packages/ingestion/src/sources/blockchains/theta/importer.ts`
- `packages/ingestion/src/sources/blockchains/theta/processor.ts`
- `packages/ingestion/src/sources/blockchains/theta/processor-utils.ts`
- `packages/ingestion/src/sources/blockchains/theta/address-utils.ts`
- `packages/ingestion/src/sources/blockchains/theta/register.ts`
- `packages/ingestion/src/sources/blockchains/theta/types.ts`

### Provider mapper consolidation

Consolidate duplicated logic from:

- `packages/blockchain-providers/src/blockchains/theta/providers/theta-explorer/theta-explorer.mapper-utils.ts`
- `packages/blockchain-providers/src/blockchains/theta/providers/thetascan/thetascan.mapper-utils.ts`

into:

- `packages/blockchain-providers/src/blockchains/theta/mapper-utils.ts`

Shared candidates:

- `selectThetaCurrency`
- `isThetaTokenTransfer`
- Theta amount formatting and native-asset selection helpers

Both providers should become thinner adapters that delegate to the shared
family-level helpers.

### Importer plan

Start by copying the minimum necessary behavior from:

- [packages/ingestion/src/sources/blockchains/evm/importer.ts](./packages/ingestion/src/sources/blockchains/evm/importer.ts)

Then strip out assumptions that only hold for real EVM chains.

The importer should:

- request Theta providers by Theta chain name
- fetch Theta-supported transaction streams only
- normalize addresses with Theta-specific address utilities if needed

### Processor plan

Start by copying the minimum necessary behavior from:

- [packages/ingestion/src/sources/blockchains/evm/processor.ts](./packages/ingestion/src/sources/blockchains/evm/processor.ts)

Then explicitly replace EVM-only assumptions with Theta-native logic.

The Theta processor must:

- treat `TFUEL` and `THETA` as native assets, not token exceptions
- assemble asset IDs without an EVM special case path
- run scam detection only for real token-contract movements
- keep output in the existing `ProcessedTransaction` shape

### Important extraction rule

If you notice a helper in the EVM processor that is generic enough for Theta,
extract that helper into a shared module and make both processors call it.

A copied Theta processor is not an acceptable stopping point.
If `theta/processor.ts` starts as a copy of `evm/processor.ts`, finish the
phase by extracting the shared correlated-transaction assembly into a narrowly
named shared module and keep only Theta-specific asset-ID and classification
logic in the Theta family.

Do not make the Theta processor subclass `EvmProcessor` unless the superclass
loses all Theta-specific branching first.

### Expected outcome

- Theta family semantics are defined once in shared mapper-utils
- Theta providers are thinner adapters over family helpers
- Theta ingestion source exists with its own importer and processor
- Theta and EVM processors share extracted correlated-processing helpers
  instead of near-cloned processor implementations

## Phase 3: Rewire Blockchain Adapter Registration

### Files to edit

- [packages/ingestion/src/sources/blockchains/index.ts](./packages/ingestion/src/sources/blockchains/index.ts)
- [packages/ingestion/src/sources/blockchains/evm/register.ts](./packages/ingestion/src/sources/blockchains/evm/register.ts)
- new `packages/ingestion/src/sources/blockchains/theta/register.ts`

### Required changes

Remove Theta from `evmAdapters`.

Pseudo-shape:

```ts
export const thetaAdapter: BlockchainAdapter = {
  blockchain: 'theta',
  chainModel: 'account-based',
  normalizeAddress,
  createImporter,
  createProcessor,
};
```

Then include `thetaAdapter` directly in `allBlockchainAdapters`.

### Expected outcome

- Theta is no longer instantiated through `EvmImporter` and `EvmProcessor`
- ingestion boundaries tell the truth about family ownership

## Phase 4: Remove EVM Theta Debt

### Files to edit

- [packages/blockchain-providers/src/blockchains/evm/chain-config.interface.ts](./packages/blockchain-providers/src/blockchains/evm/chain-config.interface.ts)
- [packages/blockchain-providers/src/blockchains/evm/evm-chains.json](./packages/blockchain-providers/src/blockchains/evm/evm-chains.json)
- [packages/ingestion/src/sources/blockchains/evm/processor.ts](./packages/ingestion/src/sources/blockchains/evm/processor.ts)
- [packages/blockchain-providers/src/blockchains/evm/register-apis.ts](./packages/blockchain-providers/src/blockchains/evm/register-apis.ts)

### Required changes

Delete:

- Theta entry from `evm-chains.json`
- `additionalNativeCurrencies` from `EvmChainConfig`
- Theta provider imports from EVM provider registration
- Theta-only branches from EVM asset ID handling

### Expected outcome

- EVM family becomes purely EVM again
- `buildEvmAssetId()` no longer needs Theta semantics

## Phase 5: Validate and Fix Reference Eligibility

### Why this phase comes last

There is no Theta-specific code in `coingecko-token-reference.ts` today. The
`THETA` false-positive in asset review comes from upstream logic treating
native-symbol asset IDs as token-reference candidates — not from resolver-level
family inference.

Once Theta has its own family, processor, and the EVM debt is removed (Phases
1–4), the false positive may already be resolved because Theta asset IDs will
no longer flow through EVM-shaped paths.

This phase validates that, and adds explicit reference semantics only if the
problem persists.

### Steps

1. Run `pnpm run dev reprocess` and `pnpm run dev prices enrich` against real
   Theta data to verify whether the `THETA` false positive still occurs.
2. If resolved, no further code changes are needed — document this in the PR.
3. If the false positive persists, make token-reference eligibility explicit:

### Conditional changes (only if false positive persists)

Files to edit:

- [packages/blockchain-providers/src/reference/coingecko/coingecko-token-reference.ts](./packages/blockchain-providers/src/reference/coingecko/coingecko-token-reference.ts)
- [packages/blockchain-providers/src/catalog/types.ts](./packages/blockchain-providers/src/catalog/types.ts)
- Theta chain catalog entry under `packages/blockchain-providers/src/blockchains/theta/`

Possible shape:

```ts
interface CoinGeckoChainHints {
  chainIdentifier?: number | undefined;
  platformId?: string | undefined;
  tokenRefFormat?: 'evm-contract' | 'platform-address' | 'unsupported';
}
```

Requirements if this path is needed:

- Theta must declare its CoinGecko token-reference behavior explicitly
- if Theta cannot support canonical token-reference matching yet, mark it as
  unsupported rather than relying on inference
- resolver behavior should be driven by declared chain semantics, not by trying
  to infer family shape from token refs
- also remove any temporary family-inference logic that was added to protect
  against the false positive during the original fix

### Expected outcome

- Theta-native asset IDs do not flow into CoinGecko contract-style matching
- `THETA` no longer surfaces as a false-positive unmatched reference
- no unnecessary abstraction is introduced if the extraction alone fixes the
  problem

## Testing Plan

### Phase 1 — Provider package tests

Add or update tests for:

- Theta provider registration under the new family
- Theta chain registry loading

Target files:

- `packages/blockchain-providers/src/blockchains/theta/**/__tests__/*.test.ts`

### Phase 2 — Ingestion and mapper tests

Add or update tests for:

- Theta mapper utility consolidation (shared helpers replace per-provider dupes)
- Theta adapter registration
- Theta importer construction
- Theta processor asset ID handling for `TFUEL` and `THETA`

Target files:

- `packages/blockchain-providers/src/blockchains/theta/**/__tests__/*.test.ts`
- `packages/ingestion/src/sources/blockchains/theta/**/*.test.ts`

### Phase 4 — EVM cleanup verification

Verify:

- no Theta logic remaining in EVM processor tests
- EVM processor tests still pass without `additionalNativeCurrencies`

Target files:

- [packages/ingestion/src/sources/blockchains/evm/**tests**/processor.test.ts](./packages/ingestion/src/sources/blockchains/evm/__tests__/processor.test.ts)

### Phase 5 — Reference eligibility verification

Verify:

- `THETA` no longer surfaces as a false-positive unmatched reference
- CoinGecko reference behavior for Theta after extraction

Target files (only if explicit reference semantics are needed):

- [packages/blockchain-providers/src/reference/coingecko/**tests**/coingecko-token-reference.test.ts](./packages/blockchain-providers/src/reference/coingecko/__tests__/coingecko-token-reference.test.ts)
- [packages/ingestion/src/features/asset-review/**tests**/asset-review-service.test.ts](./packages/ingestion/src/features/asset-review/__tests__/asset-review-service.test.ts)

### Verification commands

Run at minimum:

- `pnpm vitest run packages/blockchain-providers/src/blockchains/theta`
- `pnpm vitest run packages/blockchain-providers/src/reference/coingecko/__tests__/coingecko-token-reference.test.ts`
- `pnpm vitest run packages/ingestion/src/sources/blockchains/theta`
- `pnpm vitest run packages/ingestion/src/features/asset-review/__tests__/asset-review-service.test.ts`
- `pnpm build`

## Rollout Notes

- Keep the current resolver-side Theta false-positive protection in place until
  Theta is fully extracted (through Phase 4).
- Do not remove the protection first or `THETA` review regressions will come
  back mid-refactor.
- Phase 5 validates whether the false positive is resolved by the extraction
  itself. Only add explicit reference semantics if the problem persists.

## Success Criteria

This plan is done when all of the following are true:

- Theta no longer appears under `blockchains/evm/`
- `EvmChainConfig` no longer contains Theta-driven native-asset escape hatches
- Theta ingestion does not instantiate `EvmProcessor`
- Theta native assets are modeled directly, not as EVM exceptions
- CoinGecko reference logic no longer needs Theta-specific protection through
  family inference
- `THETA` no longer surfaces as a false-positive unmatched reference

## Decisions And Smells

- Decision: choose truthful chain-family boundaries over preserving superficial
  reuse.
- Decision: defer any generic "account-based family" abstraction until there
  are multiple real consumers.
- Decision: a multi-native-asset-aware EVM config would be ~30 lines of change
  instead of a new processor, but would make `EvmChainConfig` more permissive
  for a single outlier. The plan chooses correctness over minimalism.
- Decision: Phase 4 deletes `additionalNativeCurrencies` and the EVM-side
  Theta asset-ID branch instead of preserving a broader EVM config contract.
- Smell: Theta will continue to import `EvmTransaction`, `EvmTransactionSchema`,
  and `normalizeEvmAddress` after extraction. These names are misleading for a
  non-EVM chain. Acceptable for this refactor but should be revisited if a
  second non-EVM family reuses them (extract to chain-family-neutral names at
  that point).
- Smell: Theta currently reuses account-based helpers that still live under
  `evm/processor-utils.ts`. This is accepted debt only because Ethereum-only
  rules are isolated behind `determineEvmOperationFromFundFlow`.

## Naming Suggestions

- Prefer `theta/` family naming over `evm-like/` or `special-evm/`.
- If a later shared layer appears, name it after the actual reused behavior,
  not after Ethereum.
