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
     3.2 Finding: normalizeAddress lives in register.ts but is pure address logic — misplaced in the wrong layer

     What exists:

     Every blockchain register.ts contains an inline normalizeAddress implementation. For example, Bitcoin's register.ts:69-121 is 52 lines of regex
     validation for bech32, cashaddr, base58, and xpub formats — logic that references the config.addressPrefixes array from the chain config.

     The function is placed inside the registerBlockchain({...}) call object literal, making it a closure over config but not a standalone testable pure
     function.

     Cosmos's importer.ts:56 mutates params.address = params.address.toLowerCase() — normalization performed at import time, inconsistently with where
     normalization is defined for other chains (in register.ts). This is the only instance of normalization occurring inside an importer.

     Why it's a problem:

     1. The Bitcoin normalizeAddress logic at 52 lines is the longest single piece of business logic in a register.ts file. It belongs in a
     bitcoin/address-utils.ts module alongside the processor utility functions that are already isolated there.
     2. The Cosmos importer performing its own normalization step (params.address.toLowerCase()) means the canonical normalization path is split: the
     register.ts validator says "Cosmos addresses are case-sensitive bech32", the importer says "actually I'll lowercase before fetching". These should
     agree via a single call to the same function.
     3. Address validation tests would need to go through the full adapter registration flow rather than calling a standalone pure function.

     What V2 should do:

     Move each chain's normalizeAddress to a file alongside its processor utilities (e.g., bitcoin/address-utils.ts). The register.ts calls it by
     reference. The Cosmos importer calls the same function instead of doing its own .toLowerCase().

     Needs coverage:

     ┌──────────────────────────────┬─────────────────────────┬──────────────────────────────────────────────────┐
     │      Current capability      │ Covered by replacement? │                      Notes                       │
     ├──────────────────────────────┼─────────────────────────┼──────────────────────────────────────────────────┤
     │ Address validation per-chain │ Yes                     │ Same logic, isolated function                    │
     ├──────────────────────────────┼─────────────────────────┼──────────────────────────────────────────────────┤
     │ Chain config access          │ Yes                     │ Config passed as parameter or imported           │
     ├──────────────────────────────┼─────────────────────────┼──────────────────────────────────────────────────┤
     │ Testability                  │ Yes / improved          │ Can test address validation without registration │
     └──────────────────────────────┴─────────────────────────┴──────────────────────────────────────────────────┘

     Surface: 8 register.ts files, 1 importer file (cosmos). ~200 lines of inline logic extracted.

     Leverage: Medium — the Cosmos split is a latent correctness issue; the rest is a maintainability concern.

     ---
     3.3 Finding: createBatchProvider on BlockchainAdapter is over-abstracted — only NEAR deviates from the standard HashGroupedBatchProvider

     What exists:

     BlockchainAdapter.createBatchProvider has this signature (line 21-26):

     createBatchProvider: (
       rawDataQueries: RawDataQueries,
       db: KyselyDB,
       accountId: number,
       batchSize: number
     ) => IRawDataBatchProvider;

     Seven of the eight blockchain register.ts files return new HashGroupedBatchProvider(rawDataQueries, accountId, batchSize) and pass _db with an
     underscore because they don't use it.

     NEAR's register.ts:33-35 uses createNearRawDataQueries(db) to produce NearStreamBatchProvider.

     The process-service.ts:221-228 then calls adapter.createBatchProvider(this.rawDataQueries, this.db, accountId, RAW_DATA_HASH_BATCH_SIZE) for all
     blockchains, always passing db regardless.

     Why it's a problem:

     The db parameter exists on the interface solely for NEAR. Seven chains carry a dead _db? parameter in their factory closures. The abstraction hides
     the fact that "NEAR uses a different batch provider" behind a generic factory signature rather than making NEAR's special needs explicit.

     The AllAtOnceBatchProvider for exchanges is not on the ExchangeAdapter interface at all — it is constructed directly in process-service.ts:228. So the
      adapter-based batch provider abstraction is incomplete: blockchains go through the adapter, exchanges bypass it.

     What V2 should do:

     Remove createBatchProvider from BlockchainAdapter. In process-service.ts, choose the batch provider based on chain name or a simpler batchStrategy:
     'hash-grouped' | 'near-stream' property on the adapter:

     // V2 concept
     const batchProvider = adapter.batchStrategy === 'near-stream'
       ? new NearStreamBatchProvider(createNearRawDataQueries(this.db), accountId, batchSize)
       : new HashGroupedBatchProvider(this.rawDataQueries, accountId, batchSize);

     This removes the factory method from the interface, removes 7 identical factory closures, and makes NEAR's deviation explicit.

     Needs coverage:

     ┌──────────────────────────┬─────────────────────────┬─────────────────────────────────────────┐
     │    Current capability    │ Covered by replacement? │                  Notes                  │
     ├──────────────────────────┼─────────────────────────┼─────────────────────────────────────────┤
     │ HashGrouped for 7 chains │ Yes                     │ Direct construction, no factory         │
     ├──────────────────────────┼─────────────────────────┼─────────────────────────────────────────┤
     │ NearStream for NEAR      │ Yes                     │ Chosen by strategy flag                 │
     ├──────────────────────────┼─────────────────────────┼─────────────────────────────────────────┤
     │ Exchanges use AllAtOnce  │ Yes                     │ Already constructed directly; no change │
     ├──────────────────────────┼─────────────────────────┼─────────────────────────────────────────┤
     │ Testability              │ Yes / improved          │ Batch providers tested independently    │
     └──────────────────────────┴─────────────────────────┴─────────────────────────────────────────┘

     Surface: 8 register.ts factory closures eliminated, BlockchainAdapter interface simplified, process-service.ts gains ~5 lines of explicit strategy
     selection.

     Leverage: Medium — reduces interface surface, eliminates _db dead params in 7 files, makes NEAR's specialness visible.

     ---
     4. Data Layer

     The audit scope is the adapter concerns in the ingestion package, not the full data layer. Two adapter-specific observations follow.

     4.1 Finding: normalizeRawData in process-service.ts is a type-safety trapdoor between the adapter and processor

     What exists:

     process-service.ts:460-507 — normalizeRawData receives RawTransaction[] from the batch provider and returns unknown[] for the processor. For
     blockchain accounts it validates via NormalizedTransactionBaseSchema.safeParse, but returns the raw item.normalizedData (typed unknown) on success.
     For exchange accounts it constructs a { raw, normalized, eventId } package and returns that as unknown too.

     The processor then receives unknown[] and casts immediately: const normalizedTx = item as BitcoinTransaction. Every blockchain processor's
     processInternal opens with for (const item of normalizedData) { const normalizedTx = item as <ChainType> }.

     Why it's a problem:

     1. The Zod validation in normalizeRawData validates against NormalizedTransactionBaseSchema (a base schema), but each processor expects a
     chain-specific type (e.g. BitcoinTransaction, EvmTransaction). The validated base type is then cast to the richer chain-specific type without further
     validation. If a provider stores malformed normalized data that passes the base schema but fails the chain-specific schema, the error surfaces deep
     inside processor-utils.ts as a runtime exception.
     2. The unknown[] boundary between normalizeRawData and processor.process defeats TypeScript's guarantees. Each processor effectively trusts that the
     data it receives matches its expected type.
     3. For exchanges, the normalizedData fallback to providerData when normalized is empty (isEmpty) is a silent behavior change that different exchange
     processors may not be designed for.

     What V2 should do:

     Push the chain-specific schema validation into each processor's processInternal, or make ITransactionProcessor generic: ITransactionProcessor<T> with
     process(data: T[], context: ProcessingContext). The normalizeRawData step then validates against the chain-specific schema (each adapter provides its
     schema) before passing typed data to the processor.

     Needs coverage:

     ┌────────────────────────────┬─────────────────────────┬────────────────────────────────────────────┐
     │     Current capability     │ Covered by replacement? │                   Notes                    │
     ├────────────────────────────┼─────────────────────────┼────────────────────────────────────────────┤
     │ Base schema validation     │ Yes                     │ Absorbed into chain-specific schema        │
     ├────────────────────────────┼─────────────────────────┼────────────────────────────────────────────┤
     │ Exchange data packaging    │ Yes                     │ Exchange processor receives typed envelope │
     ├────────────────────────────┼─────────────────────────┼────────────────────────────────────────────┤
     │ Chain-specific type safety │ Yes / improved          │ Eliminates as ChainType cast               │
     └────────────────────────────┴─────────────────────────┴────────────────────────────────────────────┘

     Surface: process-service.ts:460-507, all 8 processInternal implementations that open with a type cast.

     Leverage: High — this is a correctness gap, not just a style issue. Malformed normalized data that passes the base schema produces unchecked casts.

     ---
     4.2 Finding: deriveAddressesFromXpub throws errors instead of returning Result

     What exists:

     bitcoin/register.ts:55-57 and cardano/register.ts:55-58:

     if (initResult.isErr()) {
       throw initResult.error;
     }

     The deriveAddressesFromXpub method on BlockchainAdapter is typed as Promise<DerivedAddress[]> — it can only signal failure by throwing, not by
     returning a Result.

     Why it's a problem:

     Every other operation in the ingestion layer uses Result<T, Error> for error propagation. Mixing throw into an otherwise throw-free codebase means the
      caller of deriveAddressesFromXpub must either wrap in try/catch or rely on an uncaught rejection. The import orchestrator (import-orchestrator.ts) or
      wherever xpub derivation is called must either know to try/catch this specific method or accept uncaught rejection propagation.

     CLAUDE.md states: "Never catch and suppress errors without logging" — but the converse is also true: using throws in an otherwise Result-typed
     codebase creates an inconsistent error contract.

     What V2 should do:

     Change deriveAddressesFromXpub to Promise<Result<DerivedAddress[], Error>> and convert the internal throw to return err(initResult.error).

     Needs coverage:

     ┌──────────────────────────────────────────┬─────────────────────────┬─────────────────────────────────────────────────┐
     │            Current capability            │ Covered by replacement? │                      Notes                      │
     ├──────────────────────────────────────────┼─────────────────────────┼─────────────────────────────────────────────────┤
     │ Error propagation on wallet init failure │ Yes                     │ err() returned, caller handles via Result chain │
     ├──────────────────────────────────────────┼─────────────────────────┼─────────────────────────────────────────────────┤
     │ Caller compatibility                     │ Yes                     │ Caller awaits and checks .isErr() as normal     │
     └──────────────────────────────────────────┴─────────────────────────┴─────────────────────────────────────────────────┘

     Surface: 2 register.ts files, BlockchainAdapter interface definition, xpub import code in import-orchestrator.ts.

     Leverage: High — correctness issue. A throw in a Result-typed codebase breaks the error model contract for a financial system.

     ---
     5. Toolchain & Infrastructure

     No material issues in scope (adapter concerns only). The streaming AsyncIterableIterator<Result<...>> pattern for importers is well-matched to Node.js
      native generators with no additional tooling overhead.

     ---
     6. File & Code Organization

     6.1 Finding: register.ts files do too many things — address validation, capability flags, and factory closures are distinct concerns

     What exists:

     Each register.ts file is an opaque closure-factory. For Bitcoin, a single 124-line register.ts contains:
     - 52 lines of address validation logic (should be address-utils.ts)
     - 7 lines of xpub check delegation
     - 22 lines of xpub derivation (should be xpub-utils.ts or inline in provider)
     - 8 lines of importer factory closure
     - 9 lines of batch provider factory closure
     - 8 lines of processor factory closure (with runtime guard)

     The file is the single most confusing entry point for a new contributor trying to understand "what does the Bitcoin adapter do?".

     What V2 should do:

     Each register.ts should be no more than 30 lines: it imports its pure utilities, constructs and calls registerBlockchain({...}) with references to
     those utilities, not inline implementations. Address validation → address-utils.ts. Xpub derivation → xpub-utils.ts. The factories → either simplified
      by findings 2.1 and 3.3 above, or one-liners calling existing classes.

     Surface: 8 register.ts files. Most pronounced for bitcoin (124 lines), cardano (90 lines), evm (52 lines).

     Leverage: Medium — DX and maintainability, not correctness.

     ---
     6.2 Finding: The ExchangeAdapter.createImporter factory has no parameters but some importers need credentials at construction time

     What exists:

     ExchangeAdapter.createImporter: () => IImporter — zero parameters.

     CoinbaseApiImporter and KrakenApiImporter take no constructor arguments and receive credentials through params: ImportParams in importStreaming. This
     is correct.

     KucoinCsvImporter similarly uses params.csvDirectory at streaming time.

     However, if an exchange importer ever needs to pre-validate credentials at construction time (e.g., to fail fast before an import session is created),
      the current zero-argument factory cannot accommodate it. The Coinbase importer already does a createCoinbaseClient(params.credentials) inside
     importStreaming, which means credential errors surface only after the import session has been created and must be cleaned up.

     Why it's a problem:

     Credential validation errors from the Coinbase client (line 35-39 of coinbase/importer.ts) yield an error from within the streaming generator, which
     causes import-service.ts to mark the import session as failed. This is correct behavior, but it means a credential typo creates a DB record that must
     be distinguished from a "real" import failure. A construction-time credential check could fail before the session is created.

     What V2 should do:

     Add an optional createImporter(credentials?: ExchangeCredentials): Result<IImporter, Error> variant for API-backed exchanges, or move credential
     validation earlier (into the orchestrator, before session creation). This is a minor change but eliminates a class of misleading "failed" import
     sessions.

     Surface: 3 exchange register.ts files, ExchangeAdapter interface.

     Leverage: Low — behavior is correct today; this is a UX improvement.

     ---
     7. Error Handling & Observability

     7.1 Finding: createProcessor returns Result<ITransactionProcessor, Error> but createImporter returns IImporter — asymmetric error contracts

     What exists:

     BlockchainAdapter.createImporter (line 20) returns IImporter — synchronous, cannot signal failure via Result.

     BlockchainAdapter.createProcessor (line 27-33) returns Result<ITransactionProcessor, Error> — can fail.

     The processor can fail at creation time (EVM, Solana, NEAR do: return err(new Error('TokenMetadataService is required'))) but the importer cannot. If
     an importer's constructor throws (which Bitcoin's, Cardano's, Substrate's, and Cosmos's all can, via throw new Error('Provider manager required')) the
      error bypasses the Result chain and propagates as an uncaught exception through setupImport in import-service.ts.

     import-service.ts:82-83:
     importer = adapter.createImporter(this.providerManager, params.providerName);
     This is wrapped in a try/catch at the executeStreamingImport call boundary — so the throw is caught, but it arrives as a raw exception rather than a
     typed Result<IImporter, Error>. The error message surfaced to the user is identical, but stack traces are lost in the getErrorMessage conversion.

     What V2 should do:

     Make createImporter return Result<IImporter, Error> on BlockchainAdapter. This aligns both factory methods and eliminates constructor throws from all
     importer classes (converting them to return err(...) in a factory function).

     Needs coverage:

     ┌──────────────────────────────┬─────────────────────────┬────────────────────────────────────────┐
     │      Current capability      │ Covered by replacement? │                 Notes                  │
     ├──────────────────────────────┼─────────────────────────┼────────────────────────────────────────┤
     │ Provider manager validation  │ Yes                     │ return err(...) instead of throw       │
     ├──────────────────────────────┼─────────────────────────┼────────────────────────────────────────┤
     │ Consistent error propagation │ Yes / improved          │ Full Result chain; no try/catch bypass │
     └──────────────────────────────┴─────────────────────────┴────────────────────────────────────────┘

     Surface: 8 blockchain register.ts files, BlockchainAdapter interface, import-service.ts setupImport method.

     Leverage: High — correctness/observability. A financial system should not mix throw-based and Result-based error paths.

     ---
     7.2 Finding: process-service.ts silently ignores the pendingCount error path, defaulting to 0

     What exists:

     process-service.ts:255-264:

     const pendingCountResult = await this.rawDataQueries.countPending(accountId);
     let pendingCount = 0;
     if (pendingCountResult.isOk()) {
       pendingCount = pendingCountResult.value;
     } else {
       this.logger.warn(
         { error: pendingCountResult.error, accountId },
         'Failed to query pending count, defaulting to 0'
       );
     }

     This is correct behavior — the pending count is only used for event progress reporting, not for correctness. The warning is present.

     Assessment: No issue — this is a correctly handled non-critical error. CLAUDE.md's "Use logger.warn() liberally for unexpected but recoverable
     conditions" is followed.

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
