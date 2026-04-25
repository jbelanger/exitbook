# Reprocess Performance Plan - 2026-04-25

## Problem

`pnpm run dev reprocess` is currently unusable on a large EVM account. A recent run processed
265,081 raw rows in 440 minutes and reported 15,146 provider API calls even though token
metadata was effectively cached. Reprocess should be a local rebuild from persisted raw data;
provider traffic during this workflow makes runtime depend on network latency, stale cache
refreshes, rate limits, and provider failures.

## Design Issue

`reprocess` should be an offline projection rebuild. It should consume persisted raw import facts
and rebuild derived transactions, ledger rows, scam review rows, and asset review projections from
local data only. The current processing workflow receives the same provider runtime used by import
and enrichment commands, so processing code can call provider-backed methods while rebuilding local
state.

The immediate expensive path was token metadata:

- EVM-style processing enriches token transfers with `providerRuntime.getTokenMetadata()`.
- Scam detection calls `providerRuntime.getTokenMetadata()` again for token movements.
- The token metadata cache returns stale cached rows but also schedules background refreshes.
- Large reprocess runs revisit the same cached/stale contracts across many batches, turning a local
  rebuild into repeated provider traffic.

There is still a second design leak after this containment patch: EVM fee attribution can call
`providerRuntime.getAddressInfo()` to determine whether an address is a contract. That should also
be made local or moved out of transaction materialization before `reprocess` can be called fully
offline by construction.

Token metadata also has a modeling issue. The current `TokenMetadataRecord` mixes stable token
identity fields, such as contract address and decimals, with mutable provider annotations, such as
`possibleSpam`, `verifiedContract`, `logoUrl`, descriptions, and external URLs. A single stale
policy for the whole record is too blunt: identity metadata can usually be cached indefinitely for
accounting, while review/enrichment annotations need explicit refresh policy.

## Current Surfaces

- `apps/cli/src/features/reprocess/command/run-reprocess.ts`
  - Orchestrates reprocess through `withIngestionRuntime()`.
- `apps/cli/src/runtime/ingestion-runtime.ts`
  - Creates the provider runtime and the `ProcessingWorkflow`.
- `packages/ingestion/src/features/process/process-workflow.ts`
  - Resets raw rows to pending, batches pending raw rows, builds processors, persists derived rows.
- `packages/ingestion/src/sources/blockchains/shared/correlated-transaction-processor.ts`
  - EVM-style processing calls `providerRuntime.getTokenMetadata()` before processing each batch.
- `packages/ingestion/src/features/process/base-transaction-processor.ts`
  - Scam detection calls `providerRuntime.getTokenMetadata()` again for token movements in the same batch.
- `packages/blockchain-providers/src/token-metadata/cache.ts`
  - Returns cached metadata but also fires background refreshes for stale cached contracts.
- `packages/blockchain-providers/src/runtime/manager/provider-manager.ts`
  - Owns provider-backed token metadata reads.

## Already True

- Raw blockchain rows persist normalized provider data, including token address and usually token
  symbol/decimals.
- Token metadata has its own persisted database and can answer cached reads without provider calls.
- Scam detection is pure once metadata is supplied.
- Processing already treats unavailable token metadata as a recoverable fallback in several paths.

## Missing

- A command-level policy that says reprocess must be cache-only for token metadata.
- A provider runtime/cache option for "read cached metadata only; do not fetch or refresh".
- Deduplication for stale metadata background refreshes, so repeated processing batches do not
  refetch the same stale contracts.
- Longer-term: a pure processing context that separates local rebuild inputs from online enrichment.

## Options

1. Disable scam/token metadata during reprocess entirely.
   - Fastest, but loses existing scam diagnostics and metadata-enriched symbols when cache exists.
2. Add cache-only metadata lookup for reprocess.
   - Keeps deterministic cached enrichment and scam detection, prevents provider calls.
   - Missing cache entries fall back to stored raw normalized fields.
3. Move token metadata enrichment out of processing completely.
   - Correct long-term boundary, but larger blast radius because processors and asset review rely
     on metadata during transaction construction.

## Chosen Model

Phase 1 uses option 2:

- Reprocess is a local rebuild.
- Token metadata reads are cache-only and do not refresh stale entries.
- Import-time processing can remain read-through for now.
- The token metadata cache also deduplicates stale background refreshes globally so online flows do
  not refetch the same stale contract once per batch.

## Phase Plan

1. Add token metadata lookup options.
   - Extend `BlockchainProviderSelectionOptions` or add a token-metadata-specific options shape in
     `packages/blockchain-providers/src/contracts/provider-runtime.ts`.
   - Support `allowProviderFetch?: boolean` and `refreshStale?: boolean`.
   - In `BlockchainProviderManager.getTokenMetadata()`, when `allowProviderFetch === false`, read
     from cache without registering providers; if no cache is configured, return all requested
     addresses as `undefined`.
   - In `TokenMetadataCache.getBatch()`, skip provider fetches and stale refreshes when requested.
2. Apply cache-only policy to reprocess.
   - Add a small provider runtime wrapper in `apps/cli/src/runtime/ingestion-runtime.ts`.
   - Pass the wrapped runtime into `createCliProcessingWorkflowRuntime()` only for reprocess.
   - Keep the normal runtime for imports and monitor provider stats.
3. Deduplicate stale refreshes.
   - Add an in-memory `refreshInFlight` set/map in `TokenMetadataCache`.
   - Chunk stale refreshes using the existing batch size.
   - Do not schedule a second refresh while a contract is already in flight.
4. Verify.
   - Focused tests for provider manager cache-only behavior and token metadata cache refresh dedupe.
   - Reprocess runner test proving reprocess selects cache-only processing metadata policy.
   - Full `pnpm build`.

## Status

- Phase 1 is implemented: reprocess now runs processing with a cache-only token metadata runtime,
  cache misses return `undefined`, and stale cached rows do not schedule provider refreshes.
- Stale token metadata refreshes are deduplicated for online workflows so repeated batches do not
  refetch the same stale contract while a refresh is already in flight.
- Long-running monitor views clear React development performance measures after render and refresh
  timer-only UI state once per second instead of four times per second.
- Remaining design work is the larger processing split: collapse duplicate EVM metadata lookups and
  make transaction materialization explicitly offline by construction.

## Commit Boundary

This patch is intentionally a tactical containment commit, not the larger processing redesign. It
is safe to commit separately because it adds an explicit command-level policy for reprocess token
metadata and keeps online import/enrichment behavior read-through.

Do not include unrelated dirty worktree files in this commit. The intended commit scope is:

- Reprocess selects cache-only token metadata for processing.
- Provider runtime/cache supports cache-only token metadata lookup.
- Stale token metadata refreshes are deduplicated for read-through workflows.
- Monitor metadata telemetry reports actual provider fetches separately from cache misses.
- Long-running monitor views clear React development performance measures.
- Ledger reset cascade indexes are ensured for initial and existing development databases.
- Focused tests cover the new cache-only, refresh dedupe, reprocess policy, and reset index behavior.

## Acceptance Criteria

- `reprocess` does not fetch token metadata from providers.
- Stale cached token metadata does not trigger background provider calls during reprocess.
- Online workflows still support read-through metadata lookup.
- Stale refreshes are deduped across repeated batch lookups.
- No errors are hidden; cache lookup failures still warn/fallback according to current behavior.

## Open Longer-Term Work

1. Make processing offline by construction.
   - Introduce an explicit processing dependency boundary that exposes only local readers needed by
     processors.
   - Prevent `reprocess` from passing a provider-backed runtime into transaction materialization.
   - Add a regression test that fails if reprocess processing calls provider-backed metadata or
     address-info methods.
2. Split token metadata concepts.
   - Separate stable token identity fields from mutable provider/review annotations.
   - Give identity metadata an effectively indefinite cache policy.
   - Give scam/review/enrichment annotations explicit refresh commands or a separate stale policy.
3. Collapse duplicate metadata lookup.
   - Fetch or resolve token identity once per processing batch.
   - Pass the resolved map into scam detection instead of making a second cache lookup.
4. Remove provider-backed EVM fee attribution from reprocess.
   - Persist contract/address classification during import when provider data is available, or
     make fee attribution tolerate unknown classification without a network call.
   - Rebuild fee attribution from local address facts during reprocess.
5. Move scam detection and asset review toward projections.
   - Keep transaction materialization focused on normalized financial facts.
   - Rebuild scam/review outputs from persisted token review metadata as a separate projection.
6. Revisit batch sizing and correlation.
   - After provider traffic is removed, profile processing CPU and database write paths.
   - Increase batch size or account-aware grouping only where transaction correlation remains
     correct.
