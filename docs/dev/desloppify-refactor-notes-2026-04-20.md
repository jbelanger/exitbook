# Desloppify Refactor Notes (2026-04-20)

## CLI Runtime Initialization Boundaries

Immediate fix scope:

- Make `CommandRuntime` lifecycle methods explicit about opening/creating managed resources.
- Use one CLI-owned adapter-registry builder so app startup and import processing stop diverging on NEAR-aware registry construction.
- Keep the process-wide logger flush hook at the executable boundary instead of the reusable `runCli()` entrypoint.

Useful follow-on refactors:

- Extract a small runtime-resources layer for CLI capabilities so command scopes compose typed resource factories instead of calling `CommandRuntime` directly for every dependency.
- Export stable resource aliases from `command-runtime.ts` (for example database and managed-runtime result types) so feature modules stop encoding those contracts as `ReturnType<CommandRuntime['...']>`. The current method-based typing works, but every naming cleanup turns into a broad mechanical ripple.
- Revisit asset and balance workflow bootstrapping after the runtime seam settles; `getOrCreateWorkflow()` is honest now, but setup, cleanup registration, and workflow construction are still coupled in one closure.
- Consider splitting CLI app runtime into immutable host config plus factory functions so tests can inject narrower dependencies without carrying the whole `CliAppRuntime` shape.

## Asset Review Config Ownership

Immediate fix scope:

- Stop the CLI asset-review projection runtime from rebuilding CoinGecko config from env inside the feature slice.
- Thread the CLI-owned price provider config through ingestion rebuilds, readiness checks, and the assets snapshot reader so all asset-review entrypoints share one config source.

Useful follow-on refactors:

- Introduce a small CLI projection-runtime factory so asset-review, balance, and linking prerequisites do not each thread `dataDir`, profile scope, and provider config through separate helper signatures.
- Revisit whether `AssetSnapshotReader` should own freshness-triggered projection rebuilds at all; it currently mixes read-model assembly with prerequisite orchestration because the command scope has no narrower projection service to delegate to.

## Links Review Outcome Semantics

Immediate fix scope:

- Distinguish idempotent links review no-ops from real status writes with a `changed` outcome flag.
- Skip `refreshProfileIssues()` when a review action is already satisfied, and make JSON/text output say so explicitly instead of reporting a fake successful update.
- Add direct parser tests for shared source-selection schemas and links-specific browse/run option schema invariants.

Useful follow-on refactors:

- Split the links review command result into `applied`, `noop`, and `applied_with_refresh_warning` variants instead of overloading one shape with booleans. The current `changed` fix is honest, but partial-success behavior is still flattened into generic command failure if persistence succeeds and the issue refresh fails afterward.

## Scam Detection Port Boundary

Immediate fix scope:

- Narrow the processor-facing scam-detection contract to pure classification over movements plus prefetched metadata.
- Remove event-bus ownership and blockchain context from `ScamDetectionService`, and move `scam.batch.summary` emission behind a caller-owned wrapper used by `ProcessingWorkflow`.

Useful follow-on refactors:

- Collapse `IScamDetectionService` into a local `ScamDetector` function/type alias if no second implementation materializes. The boundary is cleaner now, but it is still a one-method interface carried mostly for historical constructor wiring.

## Chain Registry Literal Keys

Immediate fix scope:

- Replace the `Record<string, ...>` chain-registry assertions in Bitcoin, Cosmos, and EVM with a shared helper that preserves registry key unions while typing the values as chain configs.
- Keep the EVM CoinGecko defaulting pass on top of a key-preserving registry transform so `EvmChainName` remains usable as a real domain union.
- Add compile-time type tests covering chain-name unions and helper return contracts.

Useful follow-on refactors:

- Apply the same key-preserving helper to the remaining chain registries (`substrate`, `theta`, and any other JSON-backed registries) so the package stops mixing literal-key registries with widened ones.
- If branded JSON config types become more common, consider adding a small runtime registry validator instead of relying on typed casts at the JSON boundary. The current helper preserves unions and contract shape, but it still trusts the JSON payload.

## Exchange Provider Event Generics

Immediate fix scope:

- Make the shared exchange provider event and correlation-group contracts generic over provider metadata.
- Propagate provider-specific metadata aliases through Coinbase, Kraken, and KuCoin normalization, grouping, and interpretation so downstream modules stop re-casting `providerMetadata` from `Record<string, unknown>`.
- Add compile-time type tests for the shared exchange-event contract.

Useful follow-on refactors:

- Push the generic event typing one step further into the exchange processing helpers so diagnostics and batch collectors can express provider-specific evidence types instead of always collapsing to `Record<string, unknown>`.
- Consider splitting provider metadata definitions into dedicated `*-provider-event.ts` files if more exchanges join this pattern; the normalize modules now own both parsing behavior and shared contract types.

## KuCoin CSV Boundary Errors

Immediate fix scope:

- Stop treating unreadable KuCoin CSV files as `'unknown'` file types.
- Make CSV header validation and record counting return `Result`s so boundary failures surface as import errors instead of fabricated empty-file skips.
- Route known-but-skipped file types through the normal batch path so duplicate-order, snapshot, and not-yet-implemented skip logging can fail honestly when the file becomes unreadable.

Useful follow-on refactors:

- Split KuCoin CSV import into an explicit inspection phase (`discover -> classify -> count/skip decision`) plus a processing phase. The current importer still interleaves discovery, file-type policy, and per-file execution, which is how boundary failures ended up being downgraded into skip semantics in the first place.

## Accounts Stored-Balance Ownership

Immediate fix scope:

- Move the accounts-owned stored-balance diagnostics, sorting, and presentation helpers out of
  `apps/cli/src/features/shared/` and into `apps/cli/src/features/accounts/stored-balance/`.
- Add direct tests for the moved accounts slice instead of relying on broad accounts view coverage
  and one orphaned shared test file.

Useful follow-on refactors:

- Split the stored-balance slice into a small read-model layer and separate TUI/static presentation
  modules if more account balance surfaces start sharing the same `StoredBalanceAssetViewItem`
  contract.

## Ingestion Monitor Event Families

Immediate fix scope:

- Split the import monitor reducer into import/xpub, provider-telemetry, and clear/process/scam
  updater families while keeping the public reducer API stable for the Ink view layer.
- Add direct reducer-seam tests so provider request telemetry, failover/backoff messaging, and
  process completion paths are not only exercised through the batch monitor shell.

Useful follow-on refactors:

- Replace the shared mutable `IngestionMonitorState` updates with explicit patch-returning helpers
  once the extracted updater boundaries settle. The family split makes the responsibilities clearer,
  but the modules still coordinate through one large mutable state object.
