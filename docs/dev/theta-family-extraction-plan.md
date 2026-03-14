# Theta Family Extraction Plan

Status: proposed refactor plan

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

## Current Smells To Remove

### 1. Theta-specific semantics in `EvmChainConfig`

File:

- [packages/blockchain-providers/src/blockchains/evm/chain-config.interface.ts](/Users/joel/Dev/exitbook/packages/blockchain-providers/src/blockchains/evm/chain-config.interface.ts)

Problem:

- `additionalNativeCurrencies` exists to accommodate Theta
- that field is not part of the true EVM family semantic model

### 2. Theta-specific asset identity handling inside the EVM processor

File:

- [packages/ingestion/src/sources/blockchains/evm/processor.ts](/Users/joel/Dev/exitbook/packages/ingestion/src/sources/blockchains/evm/processor.ts)

Problem:

- `buildEvmAssetId()` contains Theta-native exceptions
- generic EVM transaction processing now knows about a non-EVM native-asset
  shape

### 3. Theta providers filed under the EVM provider tree even though they do not reuse EVM provider logic

Files:

- [packages/blockchain-providers/src/blockchains/evm/providers/theta-explorer/theta-explorer.api-client.ts](/Users/joel/Dev/exitbook/packages/blockchain-providers/src/blockchains/evm/providers/theta-explorer/theta-explorer.api-client.ts)
- [packages/blockchain-providers/src/blockchains/evm/providers/thetascan/thetascan.api-client.ts](/Users/joel/Dev/exitbook/packages/blockchain-providers/src/blockchains/evm/providers/thetascan/thetascan.api-client.ts)

Problem:

- file placement implies family membership that is not real
- duplicate Theta-specific mapping helpers are split across provider folders

### 4. Canonical reference logic needs family inference to avoid Theta false positives

File:

- [packages/blockchain-providers/src/reference/coingecko/coingecko-token-reference.ts](/Users/joel/Dev/exitbook/packages/blockchain-providers/src/reference/coingecko/coingecko-token-reference.ts)

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

Do not keep Theta under `evm/` just to reuse a large processor class.

Good candidates for extraction:

- generic account-based transaction grouping helpers
- generic processed-transaction assembly helpers
- generic scam-detection invocation plumbing

Bad candidates for extraction:

- native-asset identity rules
- token-reference eligibility rules
- transaction-type semantics

## Delivery Plan

Implement this in six ordered phases.
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

- [packages/blockchain-providers/src/register-apis.ts](/Users/joel/Dev/exitbook/packages/blockchain-providers/src/register-apis.ts)
- [packages/blockchain-providers/src/catalog/chain-catalog.ts](/Users/joel/Dev/exitbook/packages/blockchain-providers/src/catalog/chain-catalog.ts)
- [packages/blockchain-providers/src/index.ts](/Users/joel/Dev/exitbook/packages/blockchain-providers/src/index.ts)

### Expected outcome

- Theta providers are registered from their own family
- EVM provider registration no longer imports Theta providers

## Phase 2: Consolidate Theta-Only Shared Logic

### Why this phase exists

The Theta providers already duplicate family-specific logic.
Before touching ingestion, centralize those semantics in the new family.

### New or updated files

Add a Theta-specific shared helper module, for example:

- `packages/blockchain-providers/src/blockchains/theta/mapper-utils.ts`

Move or consolidate logic from:

- `packages/blockchain-providers/src/blockchains/theta/providers/theta-explorer/theta-explorer.mapper-utils.ts`
- `packages/blockchain-providers/src/blockchains/theta/providers/thetascan/thetascan.mapper-utils.ts`

Shared candidates:

- `selectThetaCurrency`
- `isThetaTokenTransfer`
- Theta amount formatting and native-asset selection helpers

### Expected outcome

- Theta family semantics are defined once
- Theta providers become thinner adapters over Theta family helpers

## Phase 3: Create Theta Ingestion Source

### New files and directories

Add:

- `packages/ingestion/src/sources/blockchains/theta/importer.ts`
- `packages/ingestion/src/sources/blockchains/theta/processor.ts`
- `packages/ingestion/src/sources/blockchains/theta/processor-utils.ts`
- `packages/ingestion/src/sources/blockchains/theta/address-utils.ts`
- `packages/ingestion/src/sources/blockchains/theta/register.ts`
- `packages/ingestion/src/sources/blockchains/theta/types.ts`

### Importer plan

Start by copying the minimum necessary behavior from:

- [packages/ingestion/src/sources/blockchains/evm/importer.ts](/Users/joel/Dev/exitbook/packages/ingestion/src/sources/blockchains/evm/importer.ts)

Then strip out assumptions that only hold for real EVM chains.

The importer should:

- request Theta providers by Theta chain name
- fetch Theta-supported transaction streams only
- normalize addresses with Theta-specific address utilities if needed

### Processor plan

Start by copying the minimum necessary behavior from:

- [packages/ingestion/src/sources/blockchains/evm/processor.ts](/Users/joel/Dev/exitbook/packages/ingestion/src/sources/blockchains/evm/processor.ts)

Then explicitly replace EVM-only assumptions with Theta-native logic.

The Theta processor must:

- treat `TFUEL` and `THETA` as native assets, not token exceptions
- assemble asset IDs without an EVM special case path
- run scam detection only for real token-contract movements
- keep output in the existing `ProcessedTransaction` shape

### Important extraction rule

If you notice a helper in the EVM processor that is generic enough for Theta,
extract that helper into a shared module and make both processors call it.

Do not make the Theta processor subclass `EvmProcessor` unless the superclass
loses all Theta-specific branching first.

## Phase 4: Rewire Blockchain Adapter Registration

### Files to edit

- [packages/ingestion/src/sources/blockchains/index.ts](/Users/joel/Dev/exitbook/packages/ingestion/src/sources/blockchains/index.ts)
- [packages/ingestion/src/sources/blockchains/evm/register.ts](/Users/joel/Dev/exitbook/packages/ingestion/src/sources/blockchains/evm/register.ts)
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

## Phase 5: Remove EVM Theta Debt

### Files to edit

- [packages/blockchain-providers/src/blockchains/evm/chain-config.interface.ts](/Users/joel/Dev/exitbook/packages/blockchain-providers/src/blockchains/evm/chain-config.interface.ts)
- [packages/blockchain-providers/src/blockchains/evm/evm-chains.json](/Users/joel/Dev/exitbook/packages/blockchain-providers/src/blockchains/evm/evm-chains.json)
- [packages/ingestion/src/sources/blockchains/evm/processor.ts](/Users/joel/Dev/exitbook/packages/ingestion/src/sources/blockchains/evm/processor.ts)
- [packages/blockchain-providers/src/blockchains/evm/register-apis.ts](/Users/joel/Dev/exitbook/packages/blockchain-providers/src/blockchains/evm/register-apis.ts)

### Required changes

Delete:

- Theta entry from `evm-chains.json`
- `additionalNativeCurrencies` from `EvmChainConfig`
- Theta provider imports from EVM provider registration
- Theta-only branches from EVM asset ID handling

### Expected outcome

- EVM family becomes purely EVM again
- `buildEvmAssetId()` no longer needs Theta semantics

## Phase 6: Simplify Canonical Reference Eligibility

### Files to edit

- [packages/blockchain-providers/src/reference/coingecko/coingecko-token-reference.ts](/Users/joel/Dev/exitbook/packages/blockchain-providers/src/reference/coingecko/coingecko-token-reference.ts)
- [packages/blockchain-providers/src/catalog/types.ts](/Users/joel/Dev/exitbook/packages/blockchain-providers/src/catalog/types.ts)

### Goal

Remove temporary family inference added to avoid Theta false positives.

After Theta is its own family, canonical reference rules should be simpler:

- EVM family uses contract-address eligibility
- Theta family can declare its own reference behavior directly
- asset review stays orchestration-only

### Follow-up design question

At this phase, decide whether to make token reference semantics explicit in
catalog/provider hints.

Possible shape:

```ts
interface CoinGeckoChainHints {
  chainIdentifier?: number | undefined;
  platformId?: string | undefined;
  tokenRefFormat?: 'evm-contract' | 'platform-address' | 'unsupported';
}
```

This should be done only after Theta is out of `evm/`, not before.

## Testing Plan

### Provider package tests

Add or update tests for:

- Theta provider registration under the new family
- Theta mapper utility consolidation
- Theta chain registry loading
- CoinGecko reference behavior for Theta after extraction

Target files:

- `packages/blockchain-providers/src/blockchains/theta/**/__tests__/*.test.ts`
- [packages/blockchain-providers/src/reference/coingecko/**tests**/coingecko-token-reference.test.ts](/Users/joel/Dev/exitbook/packages/blockchain-providers/src/reference/coingecko/__tests__/coingecko-token-reference.test.ts)

### Ingestion tests

Add or update tests for:

- Theta adapter registration
- Theta importer construction
- Theta processor asset ID handling for `TFUEL` and `THETA`
- no Theta logic remaining in EVM processor tests

Target files:

- `packages/ingestion/src/sources/blockchains/theta/**/*.test.ts`
- [packages/ingestion/src/sources/blockchains/evm/**tests**/processor.test.ts](/Users/joel/Dev/exitbook/packages/ingestion/src/sources/blockchains/evm/__tests__/processor.test.ts)
- [packages/ingestion/src/features/asset-review/**tests**/asset-review-service.test.ts](/Users/joel/Dev/exitbook/packages/ingestion/src/features/asset-review/__tests__/asset-review-service.test.ts)

### Verification commands

Run at minimum:

- `pnpm vitest run packages/blockchain-providers/src/blockchains/theta`
- `pnpm vitest run packages/blockchain-providers/src/reference/coingecko/__tests__/coingecko-token-reference.test.ts`
- `pnpm vitest run packages/ingestion/src/sources/blockchains/theta`
- `pnpm vitest run packages/ingestion/src/features/asset-review/__tests__/asset-review-service.test.ts`
- `pnpm build`

## Rollout Notes

- Keep the current resolver-side Theta false-positive protection in place until
  Theta is fully extracted.
- Do not remove the protection first or `THETA` review regressions will come
  back mid-refactor.
- Once Theta is fully moved, simplify the resolver and delete the temporary
  inference.

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
- Smell: `additionalNativeCurrencies` is debt and should be deleted, not
  generalized.
- Smell: current Theta placement under `evm/` hides a semantic mismatch and
  distorts downstream logic.

## Naming Suggestions

- Prefer `theta/` family naming over `evm-like/` or `special-evm/`.
- If a later shared layer appears, name it after the actual reused behavior,
  not after Ethereum.
