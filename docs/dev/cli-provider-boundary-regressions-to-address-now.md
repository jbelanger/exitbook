# CLI Provider Boundary Regressions To Address Now

Status: active cleanup

## Rule To Enforce Now

`apps/cli` is the host and composition root.

That does not mean it should own provider implementation details.

For provider-backed capabilities, the CLI should not:

- import `@exitbook/blockchain-providers` directly
- import `@exitbook/price-providers` directly
- open provider-owned cache databases directly
- know provider-owned table/query details directly
- construct concrete provider-specific resolvers directly

If the CLI needs provider-backed behavior, it should receive a coarse host-facing
service or facade from the package that owns that capability.

## Recent Regression We Need To Remove First

The recent asset-review projection work crossed this boundary again.

### 1. Asset review projection dependencies now open provider-owned cache state in CLI

`apps/cli/src/features/shared/asset-review-projection-dependencies.ts` currently:

- opens `token-metadata.db`
- initializes the token metadata database
- creates token metadata queries
- constructs the CoinGecko token reference resolver

That makes the CLI own `@exitbook/blockchain-providers` persistence and provider
selection details for asset review.

### 2. Asset review freshness now opens provider-owned cache state in CLI

`apps/cli/src/features/shared/asset-review-external-input-freshness.ts` currently:

- opens `token-metadata.db`
- calls provider-owned query APIs to decide whether asset review is stale

This is better than hardcoding table names in CLI, but it is still the wrong
boundary. The host is still reaching into provider-owned persistence to answer a
domain-level freshness question.

### 3. Adjacent smell from the same feature series

`packages/ingestion/src/features/asset-review/asset-review-service.ts` imports
`getEvmChainConfig` and `TokenReferenceLookupResult` from
`@exitbook/blockchain-providers`.

This is not the same rule as the CLI boundary above. `packages/ingestion` already
depends on `@exitbook/blockchain-providers` in many blockchain-source paths, and
the current architecture guidance allows some direct provider-package dependency
when the provider package owns that technical capability.

Even so, for asset review specifically this is still a smell:

- the compute path now knows provider-specific reference result shapes
- asset-review policy is harder to evolve independently of provider internals

Treat this as the next cleanup after the CLI seam is removed.

## Existing Older Boundary Debt

The recent asset-review regression is not the only violation if we enforce the
rule strictly.

Current production CLI surface:

- `13` files in `apps/cli/src` import `@exitbook/blockchain-providers`
- `9` files in `apps/cli/src` import `@exitbook/price-providers`

Representative older examples:

- `apps/cli/src/features/shared/provider-manager-factory.ts`
  - opens `providers.db`
  - opens `token-metadata.db`
  - constructs `BlockchainProviderManager`
- `apps/cli/src/features/shared/provider-registry.ts`
  - imports `createProviderRegistry()` directly from `@exitbook/blockchain-providers`
- `apps/cli/src/features/prices/command/prices-utils.ts`
  - constructs `PriceProviderManager` directly in CLI
- `apps/cli/src/features/cost-basis/command/cost-basis-handler.ts`
  - constructs `createPriceProviderManager()` directly in CLI

So this is not an isolated asset-review problem.

What is new is that the asset-review work added fresh coupling in a place that
previously did not need it.

## Why This Matters

When the host imports provider packages directly, several bad things happen:

- provider cache ownership leaks into unrelated features
- CLI files start knowing DB filenames and provider-specific setup steps
- domain-level workflows become harder to test without concrete infrastructure
- changing provider persistence or provider selection ripples into CLI code
- package boundaries stop telling the truth about who owns what

This is exactly the kind of spread that makes a modular monolith rot from the
composition edge inward.

## Things To Address Now

### 1. Remove the new asset-review CLI -> provider seam

Replace direct provider imports in:

- `apps/cli/src/features/shared/asset-review-projection-dependencies.ts`
- `apps/cli/src/features/shared/asset-review-external-input-freshness.ts`

with a provider-owned host-facing service that gives the CLI only what asset
review needs:

- token metadata reads
- reference resolution
- reference-cache freshness
- cleanup

The CLI should ask for that service.
It should not open `token-metadata.db` itself.

### 2. Keep the freshness fix, but move ownership

The asset-review freshness bug still needs to stay fixed.

The correction is architectural, not behavioral:

- keep comparing projection build time against external inputs
- stop making CLI read provider-owned cache persistence directly

### 3. Decide whether asset review owns its own reference-resolution port

After the CLI seam is removed, decide whether asset review should continue to
depend on provider-owned reference result types or whether `packages/ingestion`
should own a narrower asset-review-specific port and data shape.

This is a separate decision from the CLI rule above.

### 4. Audit the older CLI -> provider seams as a follow-up track

Do not pretend the asset-review cleanup fully restores the boundary.

After the new regression is removed, audit the older surfaces:

- blockchain provider manager composition in CLI
- provider registry composition in CLI
- price provider manager composition in CLI

The likely end state is one of:

- CLI is allowed to depend on coarse provider host factories, but not provider
  persistence details
- CLI is not allowed to import provider packages at all, in which case the
  existing price/provider composition code also needs to move

That policy needs to be stated explicitly and then enforced consistently.

## Non-Goals For This Cleanup Note

- redesign the entire provider system
- rewrite every existing CLI/provider seam in one patch
- settle the full long-term ingestion/provider contract model
- mix unrelated asset-review policy fixes into the boundary cleanup

## Decision To Lock In

For the current cleanup, treat this as the rule:

> `apps/cli` should not directly own provider-backed persistence or provider-specific
> resolver construction.

That rule is strong enough to reject the recent asset-review regression and clear
enough to guide the next refactor.
