V2 Architecture Audit: @exitbook/blockchain-providers

     Scope: packages/blockchain-providers (295 source files, ~28k LOC non-test)

     ---
     1. Dependency Audit

    1b. Over-dependency

     [1b-1] Heavy crypto dependencies used for address derivation only

     What exists:
     Four chain-specific cryptography packages are declared as dependencies:
     - @cardano-sdk/core + @cardano-sdk/crypto -- used in 1 file (/Users/joel/Dev/exitbook/packages/blockchain-providers/src/blockchains/cardano/utils.ts)
     - @polkadot/util-crypto -- used in 1 file (/Users/joel/Dev/exitbook/packages/blockchain-providers/src/blockchains/substrate/utils.ts)
     - bitcoinjs-lib + @scure/bip32 -- used in 2 files (/Users/joel/Dev/exitbook/packages/blockchain-providers/src/blockchains/bitcoin/utils.ts,
     /Users/joel/Dev/exitbook/packages/blockchain-providers/src/blockchains/bitcoin/network-registry.ts)
     - bech32 -- used in 1 file (/Users/joel/Dev/exitbook/packages/blockchain-providers/src/blockchains/cosmos/utils.ts)

     Why it's a problem:
     These are large dependency trees (especially @cardano-sdk and @polkadot) pulled into every installation of this package. They are used exclusively for xpub-to-address derivation
      and address validation -- functionality that is consumed by exactly one caller (the gap scanning flow). This inflates install size and introduces native compilation
     requirements (libsodium for Cardano) for all consumers, even those who never use xpub derivation.

     What V2 should do:
     Extract address derivation into a separate @exitbook/address-derivation package. The blockchain-providers package would depend on it only for the gap-scan flow, and the heavy
     crypto libraries would be scoped to a smaller boundary that most consumers never import.

     Needs coverage:

     ┌────────────────────────────┬────────────────────────┬───────────────────────────────┐
     │     Current capability     │ Covered by separation? │             Notes             │
     ├────────────────────────────┼────────────────────────┼───────────────────────────────┤
     │ Bitcoin xpub derivation    │ Yes                    │ Moves to dedicated package    │
     ├────────────────────────────┼────────────────────────┼───────────────────────────────┤
     │ Cardano address derivation │ Yes                    │ Moves to dedicated package    │
     ├────────────────────────────┼────────────────────────┼───────────────────────────────┤
     │ Substrate SS58 encoding    │ Yes                    │ Moves to dedicated package    │
     ├────────────────────────────┼────────────────────────┼───────────────────────────────┤
     │ Cosmos bech32 encoding     │ Yes                    │ Moves to dedicated package    │
     ├────────────────────────────┼────────────────────────┼───────────────────────────────┤
     │ API client address masking │ Yes                    │ Stays in blockchain-providers │
     └────────────────────────────┴────────────────────────┴───────────────────────────────┘

     Surface: ~6 files, 4 dependency declarations affected

     Leverage: Medium -- reduces install footprint and build complexity; no correctness improvement.



     ---
     V2 Decision Summary

     Rank: 1
     Change: Replace execute<T> switch dispatch with typed operation methods
     Dimension: 3 (Patterns)
     Leverage: High
     One-line Rationale: Eliminates unsafe generic casts and boilerplate in every provider
     ────────────────────────────────────────
     Rank: 2
     Change: Add mapErrors to BatchStats for structured skip tracking
     Dimension: 7 (Observability)
     Leverage: Medium
     One-line Rationale: Financial system should surface data quality issues structurally
     ────────────────────────────────────────
     Rank: 3
     Change: Move persistence layer to @exitbook/data
     Dimension: 2 (Seams)
     Leverage: Medium
     One-line Rationale: Consolidates database ownership; removes sqlite/kysely from provider deps
     ────────────────────────────────────────
     Rank: 4
     Change: Extract address derivation crypto deps into separate package
     Dimension: 1 (Dependencies)
     Leverage: Medium
     One-line Rationale: Reduces install footprint; heavy crypto deps scoped to opt-in boundary
     ────────────────────────────────────────
     Rank: 5
     Change: Add HTTP replay/recording for provider tests
     Dimension: 5 (Toolchain)
     Leverage: Medium
     One-line Rationale: CI reliability without API keys; faster test cycles
     ────────────────────────────────────────
     Rank: 6
     Change: Extract streaming failover from provider-manager.ts
     Dimension: 6 (Organization)
     Leverage: Low
     One-line Rationale: 871-LOC file becomes two focused modules
     ────────────────────────────────────────
     Rank: 7
     Change: Delete dead BaseRawDataMapper class
     Dimension: 2 (Seams)
     Leverage: Low
     One-line Rationale: Zero consumers; false signal about architecture
     ────────────────────────────────────────
     Rank: 8
     Change: Update CLAUDE.md re: @RegisterApiClient
     Dimension: 2 (Seams)
     Leverage: Low
     One-line Rationale: Documentation accuracy

     What V2 Keeps

     Patterns and tools that earned their place:

     - neverthrow Result types -- consistently applied, good fit for fallible API operations. The NormalizationError skip/error discriminated union is well-designed.
     - Zod runtime validation -- every provider validates API responses through colocated schemas. Catches contract drift early.
     - Streaming adapter (createStreamingIterator) -- clean separation of pagination mechanics from provider-specific logic. The fetchPage/mapItem callback design scales well.
     - Factory-based registration -- explicit, debuggable, no magic decorators. The ProviderFactory interface is minimal.
     - Vertical-slice directory structure -- blockchains/<chain>/providers/<provider>/ is clear and self-documenting. New providers follow an obvious pattern.
     - Circuit breaker + health scoring for failover -- production-grade resilience with pure-function scoring logic that is independently testable.
     - Event bus for CLI observability -- 9 well-typed events provide structured telemetry without requiring distributed tracing infrastructure.
     - Chain configuration via JSON -- evm-chains.json, cosmos-chains.json, etc. make adding new chains a data change, not a code change.
     - Peer dependency model -- @exitbook/core, @exitbook/http, @exitbook/resilience as peer deps keeps the dependency graph clean and avoids version conflicts.
