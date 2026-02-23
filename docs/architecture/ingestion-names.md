---

     Naming Audit: packages/ingestion

     1. Domain Concepts & Ubiquitous Language

     1a. Domain Alignment

     ---
     [1a] Finding: ImportExecutor — misleading class name that obscures the actual role

     What exists:
     ImportExecutor is the name of the class in import-service.ts that handles the full lifecycle of a streaming import for a single account: creates an
     importer, manages the import session, saves raw batches, updates the cursor, and finalizes the session record.

     Why the current name hurts:
     Executor implies a thin command-dispatch layer — a thing that calls another thing. But this class owns three distinct concerns: importer instantiation
      (setupImport), streaming loop coordination (executeStreamingImport), and DB persistence (session + cursor writes). Developers reading
     ImportOrchestrator will see it delegates to ImportExecutor and reasonably assume ImportExecutor just triggers a function; they won't expect it to own
     persistence, crash recovery, and event emission. The mismatch causes a comprehension gap at every call-site.

     Proposed rename(s):
     - ImportExecutor → StreamingImportRunner
     - Alternative: AccountImportRunner (emphasizes it works per-account)
     - Alternative: ImportSessionRunner (emphasizes its DB session lifecycle role)

     Why this is better:
     StreamingImportRunner names what the class actually does — runs the streaming import pipeline for an account, including persistence. Runner is a
     well-understood pattern for "runs the full process end-to-end with side effects."

     Evidence:
     - /Users/joel/Dev/exitbook/packages/ingestion/src/features/import/import-service.ts — definition, owns setupImport, executeStreamingImport, cursor
     updates, session finalization
     - /Users/joel/Dev/exitbook/packages/ingestion/src/features/import/import-orchestrator.ts:31,49 — private importExecutor: ImportExecutor used via
     this.importExecutor.importFromSource(account)
     - /Users/joel/Dev/exitbook/packages/ingestion/src/features/import/__tests__/import-service.test.ts:16,129-201 — test file named import-service.test.ts
      but tests ImportExecutor

     Surface: ~5 files, ~15 call-sites/imports

     Risk: Low (internal class, not part of public package API export)

     Leverage: Medium

     ---
     [1a] Finding: TransactionProcessService — Service suffix on a class that does heavy orchestration, not just a service

     What exists:
     TransactionProcessService in process-service.ts is the main class for transforming raw DB rows into ProcessedTransaction objects. It creates batch
     providers, validates raw data (normalizeRawData), calls processors, saves results, marks rows as processed, and emits events — across all accounts.

     Why the current name hurts:
     Service connotes a thin, reusable helper. This class is an imperative orchestrator: it sequences DB reads, schema validation, processor delegation, DB
      writes, and event emission. The mismatch hides the fact that this class coordinates the entire processing pipeline. Also, when exported from
     index.ts, consumers see TransactionProcessService alongside ImportOrchestrator — the asymmetry (Orchestrator vs Service) suggests they are at
     different levels when they are peers.

     Proposed rename(s):
     - TransactionProcessService → TransactionProcessingPipeline
     - Alternative: RawDataProcessingService (makes the input explicit)
     - Alternative: IngestionProcessService (matches the package name)

     Why this is better:
     TransactionProcessingPipeline or the alternative preserves the Service convention the package uses while adding precision. The -ing suffix on
     Processing also reads differently from Process (a noun that sounds like it returns one process, not runs an entire pipeline).

     Evidence:
     - /Users/joel/Dev/exitbook/packages/ingestion/src/features/process/process-service.ts:40 — definition
     - /Users/joel/Dev/exitbook/packages/ingestion/src/index.ts:7 — exported as public API
     - /Users/joel/Dev/exitbook/apps/cli/src/features/process/process-service-factory.ts — instantiated by CLI

     Surface: ~6 files (including CLI)

     Risk: Medium (exported from package public API, CLI imports it — rename requires updates across two packages)

     Leverage: Medium

     ---
     [1b] Concept Collision: ProcessResult vs ProcessedTransaction — the word "process" does two jobs

     What exists:
     - ProcessResult (processors.ts) is the aggregate summary returned from TransactionProcessService methods: { errors, failed, processed }.
     - ProcessedTransaction (processors.ts) is the domain type for a single transformed transaction.
     - processInternal in BaseTransactionProcessor is the abstract method each processor implements.
     - TransactionProcessService.processAccountTransactions() returns ProcessResult.

     Why the current name hurts:
     ProcessResult as a name doesn't tell you what was processed. It reads like it could be the result of any processing step. At the call-site in
     processImportedSessions:
     const result = await this.processAccountTransactions(accountId);
     totalProcessed += result.value.processed;
     allErrors.push(...result.value.errors);
     result.value.processed and totalProcessed are counts, but ProcessResult and ProcessedTransaction share the same root word with completely different
     meanings.

     Proposed rename(s):
     - ProcessResult → BatchProcessingSummary or AccountProcessingResult

     Why this is better:
     Distinguishes the per-account summary clearly from the individual ProcessedTransaction. BatchProcessingSummary names the domain concept precisely: it
     summarizes how a batch run went.

     Evidence:
     - /Users/joel/Dev/exitbook/packages/ingestion/src/shared/types/processors.ts:5-8 — definition of ProcessResult
     - /Users/joel/Dev/exitbook/packages/ingestion/src/features/process/process-service.ts:63,148,207 — return type of all three public service methods
     - /Users/joel/Dev/exitbook/packages/ingestion/src/features/process/__tests__/process-service-utils.test.ts — test file

     Surface: ~4 files, ~12 occurrences

     Risk: Low (internal type, not in public export)

     Leverage: Medium

     ---
     [1b] Concept Collision: sourceName used both for exchange names and blockchain names

     What exists:
     ImportParams.sourceName, Account.sourceName, ImportExecutor.setupImport(), event emissions — all use the field sourceName for either the exchange
     identifier ('kraken', 'coinbase') or the blockchain identifier ('ethereum', 'bitcoin').

     Why the current name hurts:
     "Source" is already a namespace collision with ImportParams.sourceType (which distinguishes blockchain | exchange-api | exchange-csv). Readers must
     cross-reference sourceType to interpret what sourceName refers to. In the processor, getProcessor(sourceName, account.accountType, ...) — the
     sourceName reads like a generic concept when its actual value is either a blockchain or exchange key. The dual-role of the field creates confusion
     especially in logs that print both together.

     Proposed rename(s):
     - sourceName → sourceId (exchange or blockchain slug, used as a registry lookup key)

     Why this is better:
     sourceId signals that the value is an identifier used for lookup (matching how AdapterRegistry.getBlockchain(name) and getExchange(name) use it), not
     a human-readable display name.

     Evidence:
     - /Users/joel/Dev/exitbook/packages/ingestion/src/shared/types/importers.ts:10 — sourceName: string in ImportParams
     - /Users/joel/Dev/exitbook/packages/ingestion/src/features/import/import-service.ts:51,54,74 — read and used as registry key
     - /Users/joel/Dev/exitbook/packages/ingestion/src/features/process/process-service.ts:222-226 — const sourceName = account.sourceName; immediately
     lowercased for registry lookup
     - Events: import.started, import.completed, import.batch all carry sourceName

     Surface: ~15 files, ~40+ occurrences (spans into CLI, data, and events packages)

     Risk: High (database column source_name, serialized in events, present in public API types — migration requires DB + serialized field updates or an
     alias period)

     Leverage: Medium

     ---
     2. Types, Interfaces, Schemas, and Models

     [2a] Finding: RawTransactionWithMetadata — type name betrays its real purpose

     What exists:
     RawTransactionWithMetadata<TRaw> in strategies/grouping.ts is the type that wraps an exchange ledger entry with both its raw exchange-specific form
     and its normalized ExchangeLedgerEntry. It's used as the input type to CorrelatingExchangeProcessor and all exchange strategy functions.

     Why the current name hurts:
     The name says "raw transaction with metadata," but the struct contains:
     - raw: the full exchange-specific response object
     - normalized: the validated ExchangeLedgerEntry (the canonical form)
     - eventId: the dedup key
     - cursor: pagination state

     This isn't a "raw transaction" — it's a fully parsed, validated exchange ledger entry enriched with its original source data for processor use.
     Calling the canonical form the normalized field and naming the whole struct RawTransactionWithMetadata creates a naming inversion: the struct is
     described by its lowest-fidelity part.

     Proposed rename(s):
     - RawTransactionWithMetadata<TRaw> → EnrichedLedgerEntry<TRaw>
     - Alternative: LedgerEntryWithSource<TRaw> (emphasizes raw is the source context, normalized is the canonical form)
     - The companion schema RawTransactionWithMetadataSchema → EnrichedLedgerEntrySchema

     Why this is better:
     EnrichedLedgerEntry accurately describes the struct — it's a ledger entry (domain concept) that has been enriched with its raw source data for
     context. This is the same enrichment pattern used throughout the system.

     Evidence:
     - /Users/joel/Dev/exitbook/packages/ingestion/src/sources/exchanges/shared/strategies/grouping.ts:9-25 — definition
     - /Users/joel/Dev/exitbook/packages/ingestion/src/sources/exchanges/shared/correlating-exchange-processor.ts:36,50,63 — used as the processor's
     generic type and input array element type
     - /Users/joel/Dev/exitbook/packages/ingestion/src/sources/exchanges/shared/strategies/interpretation.ts:46 — InterpretationStrategy<TRaw> parameter
     type
     - /Users/joel/Dev/exitbook/packages/ingestion/src/shared/test-utils/entry-builders.ts:10,91 — wrapEntry() returns
     RawTransactionWithMetadata<ExchangeLedgerEntry>

     Surface: ~8 files, ~30 occurrences

     Risk: Low (internal type, not exported from package public API)

     Leverage: High

     ---
     [2a] Finding: RawTransactionGroup — misleading in context (NEAR-specific, contains normalized data)

     What exists:
     RawTransactionGroup in /near/types.ts holds a group of correlated NEAR data streams (transaction, receipts, balanceChanges, tokenTransfers) keyed by
     transaction hash. Despite the name Raw, the data is already normalized by the importer before storage.

     Why the current name hurts:
     The comment in the file explicitly states: "Normalized data from 4 API streams is stored (not raw)." Yet the struct is called RawTransactionGroup. The
      same prefix Raw is used across the codebase for actual raw provider payloads. This creates a false symmetry — a reader familiar with EVM's
     RawTransaction type will expect unprocessed API responses, but NEAR's RawTransactionGroup holds validated, normalized data.

     Proposed rename(s):
     - RawTransactionGroup → NearTransactionGroup
     - Alternative: NearCorrelationGroup (names the purpose — grouping data for correlation)

     Why this is better:
     NearTransactionGroup is scoped to its blockchain (no false parallelism with raw data types), and names what it holds: grouped NEAR transaction data
     awaiting correlation. NearCorrelationGroup is even more precise about purpose.

     Evidence:
     - /Users/joel/Dev/exitbook/packages/ingestion/src/sources/blockchains/near/types.ts:53 — definition, comment "Group of normalized transaction data"
     - /Users/joel/Dev/exitbook/packages/ingestion/src/sources/blockchains/near/processor-utils.ts:212,227,230,326,347 — used to build, validate, and
     correlate grouped data
     - /Users/joel/Dev/exitbook/packages/ingestion/src/sources/blockchains/near/__tests__/processor-utils.test.ts:34,198+ — 13+ test instantiations

     Surface: ~3 files, ~20 occurrences

     Risk: Low (internal, NEAR-only type)

     Leverage: Medium

     ---
     [2a] Finding: ProcessingContext — generic name for a blockchain-specific concept

     What exists:
     ProcessingContext in processors.ts has two fields:
     primaryAddress: string;    // Account's address
     userAddresses: string[];   // All user addresses on this blockchain
     This type is only meaningful for blockchain processors (not used by exchange processors in a meaningful way — exchange processInternal signatures take
      ProcessingContext but the context is unused).

     Why the current name hurts:
     ProcessingContext sounds universal. It doesn't signal that it's address-specific or blockchain-specific. When exchange processors declare
     processInternal(normalizedData: T[], context: ProcessingContext), the context parameter carries semantics irrelevant to exchanges. The name implies
     richer context (account info, timestamp, etc.) than is actually present.

     Proposed rename(s):
     - ProcessingContext → FundFlowContext
     - Alternative: AddressContext (very direct about what it contains)
     - Alternative: BlockchainProcessingContext (scoped to blockchain)

     Why this is better:
     FundFlowContext captures why this context exists — it provides the address information needed for fund flow direction analysis (determining inflows vs
      outflows relative to the user's address). This is the precise domain term used in all the FundFlow type names.

     Evidence:
     - /Users/joel/Dev/exitbook/packages/ingestion/src/shared/types/processors.ts:18-23 — definition, "Provides address information needed to determine
     transaction direction"
     - /Users/joel/Dev/exitbook/packages/ingestion/src/features/process/process-service.ts:283,418 — getProcessingContext() populates only addresses
     - /Users/joel/Dev/exitbook/packages/ingestion/src/sources/blockchains/bitcoin/processor-utils.ts:16 — analyzeBitcoinFundFlow(normalizedTx, context:
     ProcessingContext)
     - /Users/joel/Dev/exitbook/packages/ingestion/src/sources/exchanges/shared/correlating-exchange-processor.ts:52 — receives it but passes only context
     || { primaryAddress: '', userAddresses: [] }

     Surface: ~20 files, ~40 occurrences

     Risk: Medium (used in ITransactionProcessor.process() signature which is implemented in ~15 files)

     Leverage: High

     ---
     [2b] Finding: ProcessorDeps — "Deps" suffix hides the semantic role

     What exists:
     ProcessorDeps in blockchain-adapter.ts is the struct passed to BlockchainAdapter.createProcessor():
     interface ProcessorDeps {
       providerManager: BlockchainProviderManager;
       tokenMetadataService: ITokenMetadataService;
       scamDetectionService: IScamDetectionService | undefined;
       db: KyselyDB;
       accountId: number;
     }

     Why the current name hurts:
     Deps (dependencies) is a technical term describing how the data arrives, not what it is. The same information described semantically: it's the runtime
      context required by blockchain processors — provider access, metadata enrichment, scam detection, storage, and account scope. Mixing infrastructure
     concerns (db, providerManager) with domain concerns (accountId, scamDetectionService) under a single Deps label doesn't distinguish what each field
     does.

     Proposed rename(s):
     - ProcessorDeps → BlockchainProcessorContext
     - Alternative: ProcessorServices (if you want to keep the infrastructure framing)

     Why this is better:
     BlockchainProcessorContext is consistent with ProcessingContext (though see the rename proposal above) and mirrors the naming pattern used elsewhere.
     It scopes clearly to blockchain processors and signals "these are the services a processor needs at runtime."

     Evidence:
     - /Users/joel/Dev/exitbook/packages/ingestion/src/shared/types/blockchain-adapter.ts:16-22 — definition
     - /Users/joel/Dev/exitbook/packages/ingestion/src/sources/blockchains/evm/register.ts:25 — createProcessor: ({ providerManager, tokenMetadataService,
     scamDetectionService }) => new EvmTransactionProcessor(...)
     - /Users/joel/Dev/exitbook/packages/ingestion/src/sources/blockchains/bitcoin/register.ts:25 — createProcessor: ({ scamDetectionService }) => new
     BitcoinTransactionProcessor(...)
     - /Users/joel/Dev/exitbook/packages/ingestion/src/features/process/process-service.ts:462 — passed as inline object at call-site

     Surface: ~12 files (one register per blockchain + process-service.ts)

     Risk: Low (internal type)

     Leverage: Low–Medium

     ---
     [2a] Finding: BalanceCoverageSnapshot — confusing suffix for a config struct, not a snapshot

     What exists:
     BalanceCoverageSnapshot in balance-utils.ts is a struct with all-optional fields:
     interface BalanceCoverageSnapshot {
       failedAddressCount?: number | undefined;
       parsedAssetCount?: number | undefined;
       requestedAddressCount?: number | undefined;
       successfulAddressCount?: number | undefined;
       totalAssetCount?: number | undefined;
       failedAssetCount?: number | undefined;
     }
     It's an intermediate stats accumulator, not a temporal "snapshot."

     Why the current name hurts:
     Snapshot in domain-driven design means a point-in-time capture of entity state. This struct is really a coverage metrics bundle, not a snapshot of
     anything. It has nothing to do with UnifiedBalanceSnapshot (the actual balance snapshot type) yet shares the Snapshot suffix, creating confusion about
      which "snapshot" concept each represents.

     Proposed rename(s):
     - BalanceCoverageSnapshot → BalanceCoverageStats
     - Alternative: FetchCoverageMetrics

     Why this is better:
     BalanceCoverageStats accurately describes the content — statistics about how much coverage was achieved during balance fetching. Avoids false symmetry
      with UnifiedBalanceSnapshot.

     Evidence:
     - /Users/joel/Dev/exitbook/packages/ingestion/src/features/balances/balance-utils.ts:34 — definition
     - /Users/joel/Dev/exitbook/packages/ingestion/src/features/balances/balance-utils.ts:68 — used as field in UnifiedBalanceSnapshot.coverage

     Surface: ~2 files

     Risk: Low

     Leverage: Low

     ---
     [2c] Finding: currency field in BalanceComparison — deprecated but not removed

     What exists:
     interface BalanceComparison {
       currency: string; // Deprecated: use assetSymbol
       assetSymbol: string;
       ...
     }
     The compareBalances function explicitly sets: currency: assetSymbol, // Deprecated field.

     Why the current name hurts:
     A deprecated field on a live interface is dead weight that confuses new readers. The comment says "kept for backwards compatibility" but the type is
     internal to the ingestion package — not a serialized contract or cross-service API. If currency has no external consumers, it should simply be
     removed. If it does, the deprecation should be tracked in the public API boundary.

     Proposed rename(s):
     - Remove currency from BalanceComparison entirely (if no external consumers)
     - If needed at display boundary: explicitly document as display-only field and give it a clear role name

     Evidence:
     - /Users/joel/Dev/exitbook/packages/ingestion/src/features/balances/balance-verifier.types.ts:12 — definition with deprecation comment
     - /Users/joel/Dev/exitbook/packages/ingestion/src/features/balances/balance-verifier.ts:60 — assignment currency: assetSymbol

     Surface: ~2 files

     Risk: Medium (exported from package via index.ts — need to check CLI consumers)

     Leverage: Low (but hygiene improvement)

     ---
     3. Functions & Methods

     [3a] Finding: normalizeRawData — verb normalize misleads about what the function does

     What exists:
     TransactionProcessService.normalizeRawData() in process-service.ts does not normalize data. It:
     1. Extracts the normalizedData field from RawTransaction objects
     2. For exchanges, packages raw + normalized + eventId into a dataPackage object
     3. For blockchains, validates that normalizedData is non-empty and returns it

     The data has already been normalized by the importer; this function extracts and repackages it.

     Why the current name hurts:
     normalize implies transformation — making something consistent or conformant. But this function reads from an already-normalized field and assembles a
      wrapper. The confusingly similar normalizedRawDataItems local variable (in the same calling function) amplifies the contradiction: it suggests the
     items are both raw and normalized.

     Proposed rename(s):
     - normalizeRawData → extractProcessorInputs
     - Alternative: prepareProcessorInputs (emphasizes assembly for processors)
     - normalizedRawDataItems / normalizedRawDataItemsResult → processorInputs / processorInputsResult

     Why this is better:
     extractProcessorInputs says what the function does: extracts/assembles the data structures that processors receive. The Result wrapper communicates it
      can fail (empty blockchain data). This maps to the actual behavior and eliminates the false normalize implication.

     Evidence:
     - /Users/joel/Dev/exitbook/packages/ingestion/src/features/process/process-service.ts:479 — definition
     - /Users/joel/Dev/exitbook/packages/ingestion/src/features/process/process-service.ts:324 — call-site: const normalizedRawDataItemsResult =
     this.normalizeRawData(rawDataItems, account.accountType)
     - /Users/joel/Dev/exitbook/packages/ingestion/src/features/process/process-service.ts:336 — const normalizedRawDataItems =
     normalizedRawDataItemsResult.value

     Surface: ~1 file (private method), ~2 call-sites

     Risk: Low (private method)

     Leverage: Medium

     ---
     [3a] Finding: getProcessor — get prefix on a factory method that constructs objects

     What exists:
     TransactionProcessService.getProcessor() in process-service.ts (line 450) looks up the adapter from the registry and calls createProcessor() —
     returning a fresh ITransactionProcessor instance.

     Why the current name hurts:
     get* strongly implies retrieval from a cache or field. But this method performs registry lookup + object construction (calling
     adapterResult.value.createProcessor(...) with live dependencies). It's a factory, not a getter. The name invites a reader to assume there's a cached
     processor map when there isn't one — the processor is created fresh per call.

     Proposed rename(s):
     - getProcessor → createProcessorForAccount
     - Alternative: buildProcessor (common pattern for factory methods that assemble objects)

     Why this is better:
     createProcessorForAccount matches the createProcessor naming used on the adapter interfaces themselves, making the chain clear: registry → adapter →
     createProcessor. It also signals that a new object is constructed, not retrieved.

     Evidence:
     - /Users/joel/Dev/exitbook/packages/ingestion/src/features/process/process-service.ts:450 — definition, calls adapterResult.value.createProcessor(...)
     - /Users/joel/Dev/exitbook/packages/ingestion/src/features/process/process-service.ts:286 — const processorResult = this.getProcessor(sourceName,
     account.accountType, accountId)

     Surface: 1 file, 2 occurrences

     Risk: Low (private method)

     Leverage: Low

     ---
     [3a] Finding: setupImport — setup hides that this is a factory + param extraction

     What exists:
     ImportExecutor.setupImport() in import-service.ts (line 50) extracts ImportParams from an Account, looks up the adapter, and calls createImporter().
     It returns { importer, params }.

     Why the current name hurts:
     setup connotes initialization — configuring state. But this function doesn't set anything up; it creates an IImporter instance and assembles
     ImportParams. It's a factory + param builder.

     Proposed rename(s):
     - setupImport → createImporterAndParams
     - Alternative: buildImporter (if params are seen as an output detail)

     Why this is better:
     createImporterAndParams is explicit about the two outputs. The return value { importer, params } aligns with the name.

     Evidence:
     - /Users/joel/Dev/exitbook/packages/ingestion/src/features/import/import-service.ts:50 — definition
     - /Users/joel/Dev/exitbook/packages/ingestion/src/features/import/import-service.ts:39 — const setupResult = this.setupImport(account)

     Surface: 1 file, 2 occurrences

     Risk: Low (private method)

     Leverage: Low

     ---
     [3b] Finding: checkForIncompleteImports — name omits the guard / error semantics

     What exists:
     TransactionProcessService.checkForIncompleteImports() returns Result<void, Error> — it returns an error if any account has an incomplete import
     session. It reads as a simple check but its actual role is a blocking guard: processing is aborted if it returns err.

     Why the current name hurts:
     check sounds passive/informational. But this function's err path halts the entire processing pipeline. The name doesn't communicate the guard intent,
     making the call-sites:
     const activeImportsCheck = await this.checkForIncompleteImports([accountId]);
     if (activeImportsCheck.isErr()) return err(activeImportsCheck.error);
     read as mere validation when it's actually a critical integrity guard.

     Proposed rename(s):
     - checkForIncompleteImports → assertNoIncompleteImports
     - Alternative: guardAgainstIncompleteImports

     Why this is better:
     assertNoIncompleteImports communicates the invariant being enforced and signals that failure is an exceptional condition that aborts execution —
     matching the return err(...) call-site pattern.

     Evidence:
     - /Users/joel/Dev/exitbook/packages/ingestion/src/features/process/process-service.ts:570 — definition
     - /Users/joel/Dev/exitbook/packages/ingestion/src/features/process/process-service.ts:167,210 — called twice as a guard before processing

     Surface: 1 file, 3 occurrences

     Risk: Low (private method)

     Leverage: Low

     ---
     4. Variables, Parameters, and Local Names

     [4a] Finding: dataPackage — a low-signal name in normalizeRawData

     What exists:
     In process-service.ts:492:
     const dataPackage = {
       raw: item.providerData,
       normalized: normalizedData,
       eventId: item.eventId || '',
     };
     This is the exchange-processor input envelope — the same structure as RawTransactionWithMetadata (though built inline).

     Why the current name hurts:
     dataPackage is a generic technical placeholder. It conveys nothing about what's being packaged or why. A reader has to look at the fields to
     understand it's the exchange processor input format.

     Proposed rename(s):
     - dataPackage → processorInput (paired with processorInputs for the result array)
     - Alternative: ledgerEntryEnvelope (if you rename RawTransactionWithMetadata as proposed above)

     Evidence:
     - /Users/joel/Dev/exitbook/packages/ingestion/src/features/process/process-service.ts:492-497 — local variable

     Surface: 1 file, 1 occurrence

     Risk: Low

     Leverage: Low

     ---
     [4a] Finding: addressInfoCache — misleading — it caches a boolean, not address info

     What exists:
     In EvmTransactionProcessor:
     private readonly addressInfoCache = new Map<string, boolean>();
     Used in resolveIsContract() to cache whether an address is a contract (true) or EOA (false).

     Why the current name hurts:
     addressInfoCache sounds like it stores rich address information (balance, type, label). It only stores one bit: is-contract. The term Info is a
     low-signal word that hides the specific cached value.

     Proposed rename(s):
     - addressInfoCache → contractAddressCache or isContractCache

     Why this is better:
     isContractCache directly names what's cached — a boolean predicate result for each address.

     Evidence:
     - /Users/joel/Dev/exitbook/packages/ingestion/src/sources/blockchains/evm/processor.ts:40 — definition

     Surface: 1 file, ~2 occurrences

     Risk: Low

     Leverage: Low

     ---
     [4b] Finding: activeImportsCheck — confusing variable name for a Result<void, Error>

     What exists:
     const activeImportsCheck = await this.checkForIncompleteImports(accountIds);
     if (activeImportsCheck.isErr()) {
       return err(activeImportsCheck.error);
     }
     The variable is named after the function it calls (a common but poor pattern) rather than what it holds.

     Why the current name hurts:
     activeImportsCheck conflates what was done (a check) with what was returned (a Result). Since it's a Result<void, Error>, the variable holds either a
     success (safe to proceed) or a blocking error. The typical pattern for guard results in this codebase is to immediately check isErr() and return; the
     variable name adds no information over just inlining the call or naming it guardResult.

     Proposed rename(s):
     - activeImportsCheck → incompleteImportsGuard (matches the proposed rename of the method)
     - Or inline: const incompleteImportGuard = await this.assertNoIncompleteImports(accountIds)

     Evidence:
     - /Users/joel/Dev/exitbook/packages/ingestion/src/features/process/process-service.ts:167,210 — both call-sites

     Surface: 1 file, 2 occurrences

     Risk: Low

     Leverage: Low

     ---
     5. Files, Modules, and Directories

     [5a] Finding: import-service.ts — filename doesn't match the exported class ImportExecutor

     What exists:
     /packages/ingestion/src/features/import/import-service.ts exports ImportExecutor. The file is named import-service while the class is named
     ImportExecutor. The test file is import-service.test.ts.

     Why the current name hurts:
     File naming convention in this codebase is <class-name-kebab>.ts (e.g., import-orchestrator.ts exports ImportOrchestrator). The mismatch between
     import-service.ts and ImportExecutor breaks discoverability — searching for import-service finds the ImportExecutor implementation; searching for
     import-executor finds nothing. This is especially confusing because ImportOrchestrator delegates to ImportExecutor, both of which are in the import
     feature directory.

     Proposed rename(s):
     - import-service.ts → import-executor.ts
     - import-service.test.ts → import-executor.test.ts

     Why this is better:
     Aligns file naming with the exported symbol, consistent with how import-orchestrator.ts exports ImportOrchestrator.

     Evidence:
     - /Users/joel/Dev/exitbook/packages/ingestion/src/features/import/import-service.ts:19 — exports ImportExecutor
     - /Users/joel/Dev/exitbook/packages/ingestion/src/features/import/__tests__/import-service.test.ts — tests ImportExecutor
     - /Users/joel/Dev/exitbook/packages/ingestion/src/features/import/import-orchestrator.ts:17 — import { ImportExecutor } from './import-service.js'

     Surface: ~3 files + import path update

     Risk: Low (internal, non-exported file path)

     Leverage: Medium

     ---
     [5a] Finding: kucoin/utils.ts — a utility gravity file masking a specific validation concern

     What exists:
     /sources/exchanges/kucoin/utils.ts contains KuCoin CSV validation functions and result types. The module exports: ValidatedCsv* types,
     KuCoinCsvValidationResult, KuCoinCsvBatchValidationResult, and five validateKuCoin* functions, plus formatKuCoinValidationErrors.

     Why the current name hurts:
     The file name utils.ts doesn't tell you this is a validation module. It could contain any KuCoin utilities. A developer looking for "where is KuCoin
     CSV validation logic?" would not immediately gravitate to utils.ts when there is a schemas.ts next to it.

     Proposed rename(s):
     - kucoin/utils.ts → kucoin/csv-validation-utils.ts or kucoin/validation-utils.ts

     Why this is better:
     Names the specific concern (CSV validation) making it consistent with the adjacent csv-parser-utils.ts and processor-utils.ts naming pattern.

     Evidence:
     - /Users/joel/Dev/exitbook/packages/ingestion/src/sources/exchanges/kucoin/utils.ts — entire file is validation functions

     Surface: ~2 files (utils.ts + any importer that imports from it)

     Risk: Low

     Leverage: Low

     ---
     [5b] Finding: BlockchainAdapter re-exported as BlockchainConfig — a confusing alias

     What exists:
     In index.ts line 50:
     export {
       isUtxoAdapter,
       type BlockchainAdapter as BlockchainConfig,  // ← aliased on export
       type UtxoBlockchainAdapter,
     } from './shared/types/blockchain-adapter.js';
     Internally the type is BlockchainAdapter; externally it's published as BlockchainConfig.

     Why the current name hurts:
     BlockchainConfig implies static configuration (chain IDs, network parameters). But the interface defines behavior — createImporter, createProcessor,
     normalizeAddress. It is an adapter, not a config. Consumers of the package see BlockchainConfig and will misunderstand the abstraction boundary —
     they'll expect to pass it to configuration systems, not use it as a factory.

     Proposed rename(s):
     - Remove the alias: export BlockchainAdapter directly (aligns with the internal name)
     - Or if the rename is intentional for API stability: rename internally to BlockchainConfig with a rename ticket

     Why this is better:
     Eliminates the dual-naming that creates confusion at definition sites (BlockchainAdapter) and consumption sites (BlockchainConfig).

     Evidence:
     - /Users/joel/Dev/exitbook/packages/ingestion/src/index.ts:50 — the alias
     - /Users/joel/Dev/exitbook/packages/ingestion/src/shared/types/blockchain-adapter.ts:46 — internal name BlockchainAdapter
     - CLI imports this as BlockchainConfig

     Surface: ~3 files (index.ts + CLI consumers)

     Risk: Medium (public API of the package — CLI uses it under BlockchainConfig name)

     Leverage: Medium

     ---
     6. Cross-Package / Cross-Layer Consistency

     [6a] Finding: EvmFundFlow, SolanaFundFlow, CosmosFundFlow, etc. are parallel but not unified

     What exists:
     Each blockchain has its own FundFlow type:
     - EvmFundFlow (evm/types.ts)
     - SolanaFundFlow (solana/types.ts)
     - CosmosFundFlow (cosmos/types.ts)
     - CardanoFundFlow (cardano/types.ts)
     - SubstrateFundFlow (substrate/types.ts)
     - BitcoinFundFlow (bitcoin/types.ts)
     - XrpFundFlow (xrp/types.ts)
     - ExchangeFundFlow (exchanges/shared/types.ts)

     Why the current name hurts:
     This is intentional domain-specific typing, not a naming problem per se — each chain has different fields. However, the field naming across these
     structs is inconsistent:

     - EvmFundFlow.transactionCount — "number of correlated transactions"
     - SolanaFundFlow.transactionCount — "for compatibility (always 1 for Solana)" — misleading use of the field
     - BitcoinFundFlow uses isIncoming/isOutgoing booleans; CardanoFundFlow uses the same; but EvmFundFlow, SolanaFundFlow, CosmosFundFlow don't have these
      direction flags

     The ExchangeFundFlow.primary has { amount, assetSymbol } while EvmFundFlow.primary is an EvmMovement with { amount, asset, tokenAddress?,
     tokenDecimals? } — the primary concept is inconsistently shaped across the FundFlow family.

     Proposed rename(s):
     - SolanaFundFlow.transactionCount → SolanaFundFlow.instructionGroupCount or remove if always 1
     - Consistently use fromAddress?/toAddress? across all FundFlow types (already done in most)

     Evidence:
     - /Users/joel/Dev/exitbook/packages/ingestion/src/sources/blockchains/solana/types.ts:58 — transactionCount: number; // For compatibility (always 1
     for Solana)
     - /Users/joel/Dev/exitbook/packages/ingestion/src/sources/blockchains/evm/types.ts:39 — transactionCount means number of correlated API objects
     - /Users/joel/Dev/exitbook/packages/ingestion/src/sources/exchanges/shared/types.ts:10-33 — ExchangeFundFlow.primary has different shape

     Surface: ~2 files for the transactionCount rename

     Risk: Low

     Leverage: Low

     ---
     [6b] Finding: SelectionCriteria — a one-field interface used as a parameter wrapper

     What exists:
     export interface SelectionCriteria {
       nativeCurrency: Currency;
     }
     Used only in selectPrimaryEvmMovement(movements: EvmMovement[], criteria: SelectionCriteria).

     Why the current name hurts:
     SelectionCriteria sounds like it could contain multiple selection rules. It has exactly one field. The name is more generic than necessary for
     something that only carries nativeCurrency. The parameter could simply be typed as { nativeCurrency: Currency } inline, or the field promoted to a
     direct parameter.

     Proposed rename(s):
     - Inline the type: selectPrimaryEvmMovement(movements: EvmMovement[], nativeCurrency: Currency)
     - Or: SelectionCriteria → PrimaryMovementCriteria

     Evidence:
     - /Users/joel/Dev/exitbook/packages/ingestion/src/sources/blockchains/evm/processor-utils.ts:27-29 — definition and usage

     Surface: ~2 files

     Risk: Low

     Leverage: Low

     ---
     7. Naming Risk & Migration Priority

     [7a] High-Leverage Confusion: processInternal vs process vs processAccountTransactions vs processImportedSessions

     What exists:
     The processing pipeline uses four process* names at different levels:
     1. ITransactionProcessor.process() — the public interface method (validates input, delegates, post-processes)
     2. BaseTransactionProcessor.processInternal() — the abstract template method subclasses implement
     3. TransactionProcessService.processAccountTransactions() — processes one account's raw data
     4. TransactionProcessService.processImportedSessions() — processes accounts after an import

     Why the current name hurts:
     processInternal is the most confusing. It's an abstract protected method that each blockchain/exchange processor implements — but the name tells you
     nothing about what "internal" means relative to "external." The pattern is: process() calls processInternal(), but processInternal is the substantive
     implementation. Subclasses implement processInternal but the public API is process. The asymmetry in naming burden (Internal suffix on the important
     one) is the inverse of what you'd want.

     Proposed rename(s):
     - processInternal → transformNormalizedData (names what subclasses do: transform normalized input into ProcessedTransaction[])
     - Or: convertToTransactions (even more direct about the output)

     Why this is better:
     transformNormalizedData makes the template method's contract explicit: given validated T[], produce ProcessedTransaction[]. This eliminates the
     mystery of what "internal" means and aligns with the data flow direction (normalized input → processed output).

     Evidence:
     - /Users/joel/Dev/exitbook/packages/ingestion/src/features/process/base-transaction-processor.ts:38 — abstract definition
     - 10+ processor implementations: bitcoin, evm, cardano, solana, cosmos, substrate, near, xrp, correlating-exchange-processor, kucoin-csv-processor

     Surface: ~13 files, ~15 occurrences

     Risk: Low (internal abstract method, not part of ITransactionProcessor public interface)

     Leverage: High

     ---
     [7c] Churn Risk: ImportParams.sourceType: AccountType — schema leak into importers

     What exists:
     interface ImportParams {
       sourceType: AccountType;  // 'blockchain' | 'exchange-api' | 'exchange-csv'
       ...
     }
     AccountType is a DB/storage concept (the column type of accounts.account_type). It leaks into the import domain where the concept is "what kind of
     source is being imported from."

     Why the current name hurts:
     sourceType carrying AccountType means domain logic in importers and orchestrators reasons about DB-layer concepts. If AccountType ever gains a new
     variant, all import logic needs to handle it. The name sourceType is fine; the type AccountType being reused here is the leak.

     Proposed rename(s):
     - Create a distinct type alias: type ImportSourceType = 'blockchain' | 'exchange-api' | 'exchange-csv'
     - Keep sourceType: ImportSourceType in ImportParams

     Evidence:
     - /Users/joel/Dev/exitbook/packages/ingestion/src/shared/types/importers.ts:13 — sourceType: AccountType
     - /Users/joel/Dev/exitbook/packages/ingestion/src/features/import/import-service.ts:52 — read and branched on

     Surface: ~4 files

     Risk: Low (both types have identical values currently — this is a type-level improvement)

     Leverage: Low

     ---
     Rename Decision Summary

     Rank: 1
     Rename: processInternal → transformNormalizedData
     Dimension: 7a
     Leverage: High
     Risk: Low
     One-line Rationale: Template method name should say what subclasses implement, not where it sits in the call chain
     ────────────────────────────────────────
     Rank: 2
     Rename: RawTransactionWithMetadata<TRaw> → EnrichedLedgerEntry<TRaw>
     Dimension: 2a
     Leverage: High
     Risk: Low
     One-line Rationale: Struct is a validated ledger entry enriched with raw source, not a "raw" anything
     ────────────────────────────────────────
     Rank: 3
     Rename: ProcessingContext → FundFlowContext
     Dimension: 2a
     Leverage: High
     Risk: Medium
     One-line Rationale: The struct exists solely to provide address data for fund flow direction analysis
     ────────────────────────────────────────
     Rank: 4
     Rename: ImportExecutor + import-service.ts → StreamingImportRunner + import-runner.ts
     Dimension: 1a, 5a
     Leverage: Medium
     Risk: Low
     One-line Rationale: Class owns streaming, persistence, crash recovery — not mere execution dispatch
     ────────────────────────────────────────
     Rank: 5
     Rename: normalizeRawData → extractProcessorInputs
     Dimension: 3a
     Leverage: Medium
     Risk: Low
     One-line Rationale: Function extracts and repackages already-normalized data; it does not normalize
     ────────────────────────────────────────
     Rank: 6
     Rename: TransactionProcessService → RawDataProcessingPipeline
     Dimension: 1a
     Leverage: Medium
     Risk: Medium
     One-line Rationale: Class orchestrates a multi-step pipeline, not a thin service — public API export requires multi-package change
     ────────────────────────────────────────
     Rank: 7
     Rename: ProcessResult → AccountProcessingResult
     Dimension: 1b
     Leverage: Medium
     Risk: Low
     One-line Rationale: Distinguishes the per-account summary type from the ProcessedTransaction element type
     ────────────────────────────────────────
     Rank: 8
     Rename: BlockchainAdapter alias BlockchainConfig → remove alias, export as BlockchainAdapter
     Dimension: 5b
     Leverage: Medium
     Risk: Medium
     One-line Rationale: Config implies static data; this is a behavioral adapter with factory methods
     ────────────────────────────────────────
     Rank: 9
     Rename: RawTransactionGroup → NearTransactionGroup
     Dimension: 2a
     Leverage: Medium
     Risk: Low
     One-line Rationale: Contains normalized (not raw) data; scoped prefix prevents false parallelism with raw data types
     ────────────────────────────────────────
     Rank: 10
     Rename: checkForIncompleteImports → assertNoIncompleteImports
     Dimension: 3b
     Leverage: Low
     Risk: Low
     One-line Rationale: Guard method that aborts processing should read as an assertion, not a passive check
     ────────────────────────────────────────
     Rank: 11
     Rename: kucoin/utils.ts → kucoin/csv-validation-utils.ts
     Dimension: 5a
     Leverage: Low
     Risk: Low
     One-line Rationale: Entire file is validation logic; utils.ts is a gravity bucket
     ────────────────────────────────────────
     Rank: 12
     Rename: ProcessorDeps → BlockchainProcessorContext
     Dimension: 2b
     Leverage: Low
     Risk: Low
     One-line Rationale: Deps is a technical label; Context matches the pattern used across the package
     ────────────────────────────────────────
     Rank: 13
     Rename: SolanaFundFlow.transactionCount → remove or rename
     Dimension: 6a
     Leverage: Low
     Risk: Low
     One-line Rationale: Comment says "always 1 for Solana (compatibility)" — misleading compatibility shim
     ────────────────────────────────────────
     Rank: 14
     Rename: SelectionCriteria → inline nativeCurrency: Currency param
     Dimension: 6b
     Leverage: Low
     Risk: Low
     One-line Rationale: One-field wrapper interface; promotes the field directly

     ---
     Names That Should Stay

     These names are accurate, consistent, and domain-appropriate:

     - ImportOrchestrator — correctly names the role: coordinates user/account management and delegates to the execution layer.
     - AdapterRegistry — precise: a registry that stores and retrieves adapters by key.
     - BlockchainAdapter / ExchangeAdapter — clean adapter pattern naming (the as BlockchainConfig alias should be removed, but the internal name is
     excellent).
     - CorrelatingExchangeProcessor — accurately names the correlation behavior that groups related ledger entries.
     - ImportBatchResult — clear: a single batch's import output including raw transactions, stream type, cursor, and completion flag.
     - UtxoBlockchainAdapter / AccountBasedBlockchainAdapter — excellent: names the chain model with the correct domain terms (UTXO is universal blockchain
      vocabulary).
     - HashGroupedBatchProvider / AllAtOnceBatchProvider / NearStreamBatchProvider — each name explains the batching strategy precisely.
     - byCorrelationId / byTimestamp / noGrouping — grouping strategy singletons with exactly descriptive names.
     - standardAmounts / coinbaseGrossAmounts — interpretation strategy names that capture the semantic difference (net vs. gross amount accounting).
     - FundFlowContext.primaryAddress / userAddresses — field names are precise and well-commented.
     - BalanceVerificationResult — clear domain concept: the outcome of verifying calculated vs. live balances.
     - DerivedAddress — correct: an address derived from an xpub key via HD wallet derivation.
     - isUtxoAdapter() — excellent predicate name; reads naturally as a boolean question.
     - importFromXpub / importFromSource — verb-from-noun pattern is unambiguous about inputs and intent.
     - ExchangeFundFlow — parallel to blockchain FundFlow types, correctly scoped to exchange domain.
     - LedgerEntryInterpretation — names the result of interpreting one ledger entry's fund movements.
     - BalanceComparison — precise: one asset's calculated vs. live balance comparison record.
     - MovementWithContext — clear: a token movement enriched with the context needed for scam detection.
