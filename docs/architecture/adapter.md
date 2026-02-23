V2 Architecture Audit — Ingestion Package: Adapter Concerns

     Scope: the adapter layer as it exists in packages/ingestion/src/. All seven analysis dimensions are covered, with findings ordered by leverage within
     each dimension.

     ---
     2. Architectural Seams


     ---
     2.2 Finding: Module-level mutable global registries create invisible state and testing friction

     What exists:

     blockchain-adapter.ts:60-84 and exchange-adapter.ts:10-34 each hold a module-level Map<string, Adapter> that is populated by side-effectful
     register*() calls. clearBlockchainAdapters() / clearExchangeAdapters() exist solely to reset this state between tests.

     const adapters = new Map<string, BlockchainAdapter>(); // line 60
     export function registerBlockchain(config: BlockchainAdapter): void {
       adapters.set(config.blockchain, config);
     }

     The registries are populated by registerAllBlockchains() / registerAllExchanges() called from sources/blockchains/index.ts and
     sources/exchanges/index.ts, which are themselves called imperatively at app boot in the CLI (confirmed by the presence of registerAll* exports in
     index.ts).

     Why it's a problem:

     1. The global state means test suites that forget to call clearBlockchainAdapters() between tests see registrations from prior suites. The clear*
     functions are a symptom, not a solution.
     2. If two packages both import and call registerBlockchain for the same chain (feasible in a monorepo where the same chain id might exist across two
     packages), there is a silent overwrite with no error or warning.
     3. The registry is not typed at the point of lookup — getBlockchainAdapter returns BlockchainAdapter | undefined, so every consumer (there are at
     least 5: process-service.ts, import-service.ts, balance-related code, etc.) must repeat the if (!adapter) return err(...) guard.
     4. Adding a new blockchain requires touching sources/blockchains/index.ts (the manual aggregator). This is the opposite of the "Dynamic Over
     Hardcoded" CLAUDE.md principle — it's a hand-maintained list.

     What V2 should do:

     Replace the global Map with an explicit AdapterRegistry class (or record) constructed once at startup and passed via dependency injection to the
     services that need it. This makes state visible, testable without a clear* escape hatch, and eliminates the silent overwrite risk.

     // V2 concept
     class AdapterRegistry {
       constructor(private readonly blockchains: Record<string, BlockchainAdapter>, ...) {}
       getBlockchain(name: string): Result<BlockchainAdapter, Error> { ... }
     }

     Auto-discovery of adapters (eliminating the manual registerAllBlockchains list) could be achieved by having each adapter export its registration
     object and having the index file use Object.values() over an imported record — no global mutation, no clear* methods needed.

     Needs coverage:

     ┌──────────────────────────────────┬─────────────────────────┬────────────────────────────────────────────────────┐
     │        Current capability        │ Covered by replacement? │                       Notes                        │
     ├──────────────────────────────────┼─────────────────────────┼────────────────────────────────────────────────────┤
     │ Lookup by name                   │ Yes                     │ registry.getBlockchain(name)                       │
     ├──────────────────────────────────┼─────────────────────────┼────────────────────────────────────────────────────┤
     │ Test isolation                   │ Yes                     │ Inject a fresh registry per test; no clear* needed │
     ├──────────────────────────────────┼─────────────────────────┼────────────────────────────────────────────────────┤
     │ App-wide registration at startup │ Yes                     │ Constructed once in CLI entry point                │
     ├──────────────────────────────────┼─────────────────────────┼────────────────────────────────────────────────────┤
     │ Overwrite detection              │ Yes / improved          │ Registry constructor can reject duplicates         │
     └──────────────────────────────────┴─────────────────────────┴────────────────────────────────────────────────────┘

     Surface: 2 registry files, 5+ consumer call-sites (process-service.ts, import-service.ts, balance service, etc.), all 11 register.ts files.

     Leverage: High — the global mutable state is the root cause of the clear* testing anti-pattern and the hidden overwrite risk.

     ---
     2.3 Finding: BlockchainAdapter and ExchangeAdapter are parallel hierarchies with radically asymmetric complexity — they should not share a single
     "adapter" concept

     What exists:

     ExchangeAdapter (line 4-8 of exchange-adapter.ts) is 4 lines:

     export interface ExchangeAdapter {
       exchange: string;
       createImporter: () => IImporter;
       createProcessor: () => ITransactionProcessor;
     }

     BlockchainAdapter (line 17-58 of blockchain-adapter.ts) is 41 lines spanning: normalizeAddress, createImporter, createBatchProvider, createProcessor
     (5-arg), isUTXOChain, isExtendedPublicKey, deriveAddressesFromXpub.

     These two interfaces share only the names createImporter and createProcessor. Everything else diverges. Yet both are called "adapters", stored in
     similarly-named Maps, and consumed via identically-named getXxxAdapter() functions called together in process-service.ts and import-service.ts under
     the same if (sourceType === 'blockchain') ... else ... branching pattern.

     Why it's a problem:

     The naming suggests they are instances of the same concept but they are not. Callers must already know which category they are in ('blockchain' vs
     'exchange'), so the abstraction provides no polymorphism benefit. It merely creates a lookup indirection. A reader encountering getBlockchainAdapter
     and getExchangeAdapter in the same function must hold two separate mental models, neither of which reflects the other.

     The xpub-related methods (isExtendedPublicKey, deriveAddressesFromXpub) are optional on BlockchainAdapter — meaning code that uses them must
     defensively check for their presence and UTXO-chain behavior is similarly signaled through an optional isUTXOChain flag rather than a distinct type.

     What V2 should do:

     Use distinct types for distinct concepts. Instead of BlockchainAdapter as one bloated interface with optional capability flags, model capabilities
     explicitly:

     - AccountBasedBlockchainAdapter vs UtxoBlockchainAdapter (or a capabilities record), each with only the methods they actually provide.
     - XpubCapableAdapter as a mixin or extension for chains that support extended public keys.

     This removes the isUTXOChain?: boolean flag, removes the optional isExtendedPublicKey? and deriveAddressesFromXpub? fields, and makes TypeScript
     enforce at compile time which chains support xpub rather than requiring runtime if (adapter.isExtendedPublicKey) checks.

     Needs coverage:

     ┌───────────────────────────────┬─────────────────────────┬───────────────────────────────────────────────────┐
     │      Current capability       │ Covered by replacement? │                       Notes                       │
     ├───────────────────────────────┼─────────────────────────┼───────────────────────────────────────────────────┤
     │ Address normalization         │ Yes                     │ On both adapter variants                          │
     ├───────────────────────────────┼─────────────────────────┼───────────────────────────────────────────────────┤
     │ Importer creation             │ Yes                     │ On both; exchange version remains zero-arg        │
     ├───────────────────────────────┼─────────────────────────┼───────────────────────────────────────────────────┤
     │ Batch provider creation       │ Yes                     │ On blockchain adapter only; no longer on exchange │
     ├───────────────────────────────┼─────────────────────────┼───────────────────────────────────────────────────┤
     │ Xpub derivation               │ Yes                     │ On XpubCapableAdapter extension                   │
     ├───────────────────────────────┼─────────────────────────┼───────────────────────────────────────────────────┤
     │ UTXO vs account-based routing │ Yes                     │ Explicit type rather than flag                    │
     └───────────────────────────────┴─────────────────────────┴───────────────────────────────────────────────────┘

     Surface: blockchain-adapter.ts, exchange-adapter.ts, 8 blockchain register.ts files (2 of which use xpub), process-service.ts, import-service.ts,
     balance code.

     Leverage: Medium — reduces cognitive load but not a correctness risk today. Worth doing in V2 as it directly enables finding 2.1's fix.

     ---
     3. Pattern Re-evaluation

     3.1 Finding: The single-stream importer classes are ~115 lines of near-identical boilerplate — the pattern does not carry its weight

     What exists:

     Five blockchain importers implement a structurally identical pattern:

     - bitcoin/importer.ts (118 lines)
     - cardano/importer.ts (114 lines)
     - xrp/importer.ts (118 lines)
     - substrate/importer.ts (121 lines)
     - cosmos/importer.ts (124 lines)

     Each contains:
     1. Constructor: guard check for providerManager, autoRegisterFromConfig, log line.
     2. importStreaming: guard for params.address, extract params.cursor?.['normal'], delegate to streamTransactionsForAddress.
     3. streamTransactionsForAddress: call providerManager.executeWithFailover<TransactionWithRawData<T>>, for await, error propagation, map to
     RawTransactionInput[], yield ok(...).

     The only differences are: chain name (a string), the transaction type parameter (BitcoinTransaction, CardanoTransaction, etc.), and the log labels.
     The mapping body (lines 96-115 in cardano/importer.ts) is character-for-character identical to xrp/importer.ts:99-115, substrate/importer.ts:103-118,
     and cosmos/importer.ts:106-122.

     Why it's a problem:

     - Any bug in the streamTransactionsForAddress loop (e.g., an error handling edge case, a missing stat log condition) must be fixed in all five copies.
     - The pattern diverges for EVM (multi-stream), Solana (two streams), and NEAR (four streams + special batch provider), meaning the "standard" importer
      shape is implemented 5 times for the 5 simplest chains and 3 custom shapes for the complex ones.
     - A new chain author must copy an existing importer and change 3-4 strings, with no type-level enforcement that the copy is correct.

     What V2 should do:

     Extract a generic SingleStreamBlockchainImporter<T> class or factory function that accepts chainName: string, txType: NormalizedType<T>, and options.
     The 5 simple importers become 5 one-line instantiations:

     // V2 concept in bitcoin/register.ts
     createImporter: (pm, preferredProvider) =>
       createSingleStreamImporter<BitcoinTransaction>({
         chainName: config.chainName,
         providerManager: pm,
         preferredProvider,
       }),

     The three complex importers (EVM, Solana, NEAR) retain their custom class implementations.

     Needs coverage:

     ┌───────────────────────────┬─────────────────────────┬─────────────────────────────────────────────────────────┐
     │    Current capability     │ Covered by replacement? │                          Notes                          │
     ├───────────────────────────┼─────────────────────────┼─────────────────────────────────────────────────────────┤
     │ Provider failover         │ Yes                     │ Delegated to providerManager.executeWithFailover as now │
     ├───────────────────────────┼─────────────────────────┼─────────────────────────────────────────────────────────┤
     │ Resume cursor support     │ Yes                     │ params.cursor?.['normal'] extracted in generic          │
     ├───────────────────────────┼─────────────────────────┼─────────────────────────────────────────────────────────┤
     │ Chain-specific log labels │ Yes                     │ chainName parameter                                     │
     ├───────────────────────────┼─────────────────────────┼─────────────────────────────────────────────────────────┤
     │ Type-safe normalized data │ Yes                     │ Generic T parameter                                     │
     ├───────────────────────────┼─────────────────────────┼─────────────────────────────────────────────────────────┤
     │ Dedup stat logging        │ Yes                     │ Extracted into the shared implementation                │
     └───────────────────────────┴─────────────────────────┴─────────────────────────────────────────────────────────┘

     Surface: 5 importer files (~575 lines) collapse to 5 one-liners. The generic implementation is ~80 lines once.

     Leverage: Medium — reduces maintenance surface but no correctness risk today. The duplicate mapping body is the highest-priority fix within this
     finding.

     ---

     ---
     7.3 Finding: No tracing correlation between import session ID and processing batches

     What exists:

     Events emitted via eventBus carry accountId and batchNumber but not importSessionId. The import session ID is created in import-service.ts but never
     appears in the processing events in process-service.ts. If an import and a reprocess run sequentially (or a reprocess happens during an
     investigation), there is no way to correlate which import session's data a given processing batch corresponds to.

     Why it's a problem:

     For a financial system, diagnosing a discrepancy requires knowing which import session produced the raw data that was processed. The current logs
     would require joining import session #N logs with processing account M batch B logs by timestamp inference, which is fragile.

     What V2 should do:

     Attach importSessionId to processing events and include it in processing-related log entries. This is a low-cost, high-observability improvement.

     Surface: process-service.ts event emissions (~10 call-sites), IngestionEvent type in events.ts.

     Leverage: Low — no correctness impact; diagnostic value only. Worth doing for a financial system where audit trails matter.

     ---
     V2 Decision Summary

     Rank: 1
     Change: Replace unknown[] boundary between normalizeRawData and processor.process with chain-specific typed schemas
     Dimension: 4
     Leverage: High
     One-line Rationale: Unchecked as ChainType casts after base-schema validation leave malformed provider data able to pass undetected through the type
       system
     ────────────────────────────────────────
     Rank: 2
     Change: Change deriveAddressesFromXpub to return Promise<Result<DerivedAddress[], Error>> — eliminate throw from both xpub register files
     Dimension: 4
     Leverage: High
     One-line Rationale: throw in a Result-typed financial codebase breaks the error contract; two call-sites today, more as xpub chains are added
     ────────────────────────────────────────
     Rank: 3
     Change: Replace module-level global adapter registries with an injected AdapterRegistry class
     Dimension: 2
     Leverage: High
     One-line Rationale: Global mutable state is the source of test clear* anti-patterns and silent overwrite risk; violates DI principles the rest of the
       codebase follows
     ────────────────────────────────────────
     Rank: 4
     Change: Make createImporter return Result<IImporter, Error> on BlockchainAdapter to align with createProcessor's contract
     Dimension: 7
     Leverage: High
     One-line Rationale: Constructor throws in importer classes bypass the Result chain; inconsistent error contracts in a financial system reduce
     reliability
       of error handling
     ────────────────────────────────────────
     Rank: 5
     Change: Refactor BlockchainAdapter.createProcessor to remove the 5-argument optional-parameter superset
     Dimension: 2
     Leverage: High
     One-line Rationale: Optional params _db? and _accountId? are dead weight in 7 of 8 chains; omitting required guards (present in EVM/Solana/NEAR,
     absent in
       others) is a silent runtime failure path
     ────────────────────────────────────────
     Rank: 6
     Change: Extract SingleStreamBlockchainImporter<T> generic to replace the 5 near-identical 115-line importer classes
     Dimension: 3
     Leverage: Medium
     One-line Rationale: Five files share a character-for-character identical streamTransactionsForAddress body; any fix must be applied to all five
     ────────────────────────────────────────
     Rank: 7
     Change: Remove createBatchProvider from BlockchainAdapter; choose batch provider in process-service via a batchStrategy property
     Dimension: 3
     Leverage: Medium
     One-line Rationale: Seven of eight adapters carry a dead _db parameter; the abstraction hides NEAR's special needs rather than making them explicit
     ────────────────────────────────────────
     Rank: 8
     Change: Split BlockchainAdapter into AccountBasedBlockchainAdapter and UtxoBlockchainAdapter with explicit xpub capability
     Dimension: 2
     Leverage: Medium
     One-line Rationale: The single interface mixes two distinct chain models under optional fields; EVM/Solana/NEAR vs UTXO vs xpub-capable chains all
     have
       different behavioral contracts
     ────────────────────────────────────────
     Rank: 9
     Change: Move normalizeAddress out of register.ts closures into standalone address-utils.ts per chain; fix Cosmos importer's independent .toLowerCase()

       call
     Dimension: 6
     Leverage: Medium
     One-line Rationale: Cosmos's dual-normalization path (register.ts says case-sensitive, importer lowercases) is a latent correctness split; Bitcoin's
       52-line inline regex is untestable in isolation
     ────────────────────────────────────────
     Rank: 10
     Change: Attach importSessionId to processing events and log entries
     Dimension: 7
     Leverage: Low
     One-line Rationale: Financial system audit trails require linking import provenance to processing output

     ---
     What V2 Keeps

     The following patterns and tools earned their place and should carry forward unchanged:

     neverthrow Result types throughout. Every fallible function returns Result<T, Error>. The pattern is applied uniformly across the adapter layer (with
     the two exceptions noted above). The IImporter.importStreaming returning AsyncIterableIterator<Result<...>> is the correct shape for streaming with
     per-batch error signaling.

     The IImporter / ITransactionProcessor interface split. Separating fetch-and-store from transform is the correct architectural cut. Importers are
     stateful (they hold provider managers, emit events); processors are pure-ish (they take normalized data and return processed transactions). This maps
     to CLAUDE.md's "Functional Core, Imperative Shell".

     The BaseTransactionProcessor abstract class. Post-processing hooks (dropZeroValueContractInteractions, postProcessTransactions/schema validation,
     applyScamDetection) are correctly factored into the base. Every processor benefits from these without re-implementing them.

     The CorrelatingExchangeProcessor + strategy pattern for exchanges. The GroupingStrategy / InterpretationStrategy composition in
     correlating-exchange-processor.ts is well-designed. New exchanges can reuse DefaultExchangeProcessor (Kraken does this today) or provide custom
     strategies. This is a genuinely extensible abstraction.

     The streaming import shape. AsyncIterableIterator<Result<ImportBatchResult, Error>> with per-batch cursor persistence (in import-service.ts) is the
     right model: memory-bounded, crash-resumable, composable. Keep this in V2.

     Vertical slice organization. sources/blockchains/<chain>/ and sources/exchanges/<exchange>/ with importer, processor, types, utils, and tests
     collocated is correct and follows CLAUDE.md's stated preference. Do not flatten this into technical layers in V2.

     The HashGroupedBatchProvider / NearStreamBatchProvider / AllAtOnceBatchProvider trio. The IRawDataBatchProvider interface is the right abstraction for
      the batch loop in process-service.ts. The implementations are correct. The only change needed is removing the factory from BlockchainAdapter (finding
      3.3 above) — the providers themselves are sound.
