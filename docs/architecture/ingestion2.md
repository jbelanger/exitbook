V2 Architecture Audit: @exitbook/ingestion

     Scope: packages/ingestion across all 7 analysis dimensions.
     Size: 168 TypeScript files, ~47,400 lines of source, 56 test files.

     ---
     1. Dependency Audit

     1a. Hand-rolled code duplicating a community package

     Finding: SHA-256 ID generation via node:crypto

     What exists:
     KucoinCsvImporter.generateEventId() in /packages/ingestion/src/sources/exchanges/kucoin/importer-csv.ts (lines 676-680) hand-rolls SHA-256 hashing for
      deterministic event IDs:
     private generateEventId(type: string, timestamp: string, currency: string, amount: string): string {
       const data = `${type}-${timestamp}-${currency}-${amount}`;
       return crypto.createHash('sha256').update(data).digest('hex').substring(0, 16);
     }

     This is fine as-is — Node's built-in crypto is the right call here. No third-party package needed. No material issue.

     Finding: Recursive CSV file collection

     KucoinCsvImporter.collectCsvFiles() (lines 591-622 in importer-csv.ts) implements a hand-rolled iterative DFS directory traversal with symlink-cycle
     protection. The glob package (already available through tooling) or Node 22's fs.glob() would handle this more expressively, but the current
     implementation is correct and simple. Low leverage issue.

     1b. Over-dependency

     No material issues found in direct package.json dependencies. The five internal workspace packages (@exitbook/*) and four external packages
     (csv-parse, decimal.js, neverthrow, zod) are all actively maintained and justified by real usage:

     - csv-parse: Used only via csv-parse/sync in csv-parser-utils.ts. Three callers only (parseCsvFile, validateCsvHeaders, getCsvHeaders). This is thin
     but correct.
     - decimal.js: Pervasively used for financial precision. Non-negotiable.
     - neverthrow: See Pattern Re-evaluation section below.
     - zod: Used heavily for both runtime validation and type inference.

     1c. Missing ecosystem leverage

     Finding: csv-parse/sync vs streaming parse for large CSV files

     What exists:
     parseCsvFile<T>() in csv-parser-utils.ts (lines 30-38) reads the entire file into memory then parses synchronously. The KucoinCsvImporter processes
     one file per yielded batch, so memory is bounded per-file. For the current exchanges this is acceptable. However, future CSV exports from high-volume
     accounts (e.g., thousands of trades) could hit memory pressure. csv-parse supports streaming parse that would integrate cleanly with the existing
     AsyncIterableIterator streaming contract.

     Needs coverage:

     ┌───────────────────────────────────┬─────────────────────────────┬─────────────────────────────────────────────┐
     │        Current capability         │ Covered by streaming parse? │                    Notes                    │
     ├───────────────────────────────────┼─────────────────────────────┼─────────────────────────────────────────────┤
     │ Parse CSV file into typed objects │ Yes                         │ csv-parse streaming API covers same feature │
     ├───────────────────────────────────┼─────────────────────────────┼─────────────────────────────────────────────┤
     │ BOM stripping                     │ Yes                         │ Handled by csv-parse option bom: true       │
     ├───────────────────────────────────┼─────────────────────────────┼─────────────────────────────────────────────┤
     │ Zod validation per-row            │ Yes                         │ Row-level validation already separate       │
     ├───────────────────────────────────┼─────────────────────────────┼─────────────────────────────────────────────┤
     │ Synchronous API for simplicity    │ No                          │ Would require async refactor                │
     └───────────────────────────────────┴─────────────────────────────┴─────────────────────────────────────────────┘

     Surface: 1 file (csv-parser-utils.ts), 3 callers

     Leverage: Low — current volumes don't justify the complexity.

     ---
     2. Architectural Seams

     2a. Package boundary fitness

     Finding: BalanceService belongs in ingestion but calls @exitbook/exchange-providers directly

     What exists:
     BalanceService in /packages/ingestion/src/features/balances/balance-service.ts (line 11) imports createExchangeClient from
     @exitbook/exchange-providers directly:
     import { createExchangeClient } from '@exitbook/exchange-providers';

     This creates a layering irregularity: the ingestion package both uses exchange providers through the AdapterRegistry abstraction (for import) AND
     bypasses the registry to call exchange providers directly (for balance verification). The adapter abstraction is not extended to cover balance
     fetching.

     Why it's a problem:
     Adding a new exchange requires changes in two places: AdapterRegistry (for import) and separately inside BalanceService (for balance checking). The
     seam is inconsistent — blockchain balance fetching goes through the provider manager, but exchange balance fetching uses a raw createExchangeClient
     call that is not adapter-aware.

     What V2 should do:
     Extend ExchangeAdapter to optionally expose a fetchLiveBalance factory, keeping the entire exchange interaction surface behind the adapter boundary.
     BalanceService would ask the registry for the adapter, then call adapter.fetchLiveBalance().

     Needs coverage:

     ┌──────────────────────────────────────┬─────────────────────────┬───────────────────────────────────────────────────┐
     │          Current capability          │ Covered by replacement? │                       Notes                       │
     ├──────────────────────────────────────┼─────────────────────────┼───────────────────────────────────────────────────┤
     │ Fetch live exchange balance          │ Yes                     │ Adapter factory wraps same client creation        │
     ├──────────────────────────────────────┼─────────────────────────┼───────────────────────────────────────────────────┤
     │ Credentials forwarding               │ Yes                     │ Adapter factory receives credentials at call time │
     ├──────────────────────────────────────┼─────────────────────────┼───────────────────────────────────────────────────┤
     │ Exchange-specific balance shapes     │ Yes                     │ Each adapter's fetchLiveBalance normalizes        │
     ├──────────────────────────────────────┼─────────────────────────┼───────────────────────────────────────────────────┤
     │ CSV-only exchanges (no live balance) │ Yes                     │ Adapter can return undefined for fetchLiveBalance │
     └──────────────────────────────────────┴─────────────────────────┴───────────────────────────────────────────────────┘

     Surface: balance-service.ts, balance-utils.ts — ~2 files, ~5 call-sites.

     Leverage: Medium.

     2b. Dependency graph direction

     Finding: process-service.ts contains a hardcoded NEAR special case

     What exists:
     TransactionProcessService.createBatchProvider() (lines 240-254 in process-service.ts) has a runtime string check for NEAR:
     if (sourceType === 'blockchain' && sourceName.toLowerCase() === 'near') {
       const nearRawDataQueries = createNearRawDataQueries(this.db);
       return new NearStreamBatchProvider(nearRawDataQueries, accountId, RAW_DATA_HASH_BATCH_SIZE);
     }

     This also directly imports createNearRawDataQueries from @exitbook/data. The process service orchestrator has knowledge of a specific blockchain's
     internals. This is an inversion — the orchestrator should not need to know that NEAR requires a different batch strategy.

     Why it's a problem:
     Any future blockchain requiring custom batch correlation logic would require modifying the central TransactionProcessService rather than registering a
      custom batch strategy in its adapter. This contradicts the open/closed principle that the rest of the adapter system follows.

     What V2 should do:
     BlockchainAdapter should expose an optional createBatchProvider(rawDataQueries, accountId, db) factory. The HashGroupedBatchProvider becomes the
     default. NEAR's adapter returns a NearStreamBatchProvider. The TransactionProcessService calls adapter.createBatchProvider?.() ??
     defaultBatchProvider.

     Needs coverage:

     ┌───────────────────────────────┬─────────────────────────┬──────────────────────────────────────────────────────┐
     │      Current capability       │ Covered by replacement? │                        Notes                         │
     ├───────────────────────────────┼─────────────────────────┼──────────────────────────────────────────────────────┤
     │ NEAR multi-stream correlation │ Yes                     │ NearStreamBatchProvider still used, moved to adapter │
     ├───────────────────────────────┼─────────────────────────┼──────────────────────────────────────────────────────┤
     │ Default hash-grouped batching │ Yes                     │ Returned as fallback by base                         │
     ├───────────────────────────────┼─────────────────────────┼──────────────────────────────────────────────────────┤
     │ Exchange all-at-once batching │ Yes                     │ ExchangeAdapter already separate                     │
     └───────────────────────────────┴─────────────────────────┴──────────────────────────────────────────────────────┘

     Surface: process-service.ts (1 site), near/register.ts (1 addition).

     Leverage: Medium.

     2c. Domain concept placement

     Finding: Token metadata enrichment is a processor concern but the interface leaks into the base class

     What exists:
     BaseTransactionProcessor in base-transaction-processor.ts (lines 19-28) takes ITokenMetadataService and IScamDetectionService as optional constructor
     parameters. But not all processors use token metadata (e.g., Bitcoin, XRP, exchange processors). The base class carries dependencies that many
     subclasses don't need.

     The EvmTransactionProcessor also has a class-level addressInfoCache (Map<string, boolean>) at line 40. This cache is a per-processor-instance concern
     that gets rebuilt on every reprocess run. It doesn't persist across imports and doesn't use the token-metadata DB cache already available.

     Why it's a problem:
     The BaseTransactionProcessor constructor signature forces all processors (blockchain and exchange) to declare a dependency on metadata services they
     may not use. Exchange processors that extend CorrelatingExchangeProcessor -> BaseTransactionProcessor carry these optional parameters through the
     entire chain even though they're unused.

     What V2 should do:
     Move ITokenMetadataService and IScamDetectionService out of the base class entirely. Processors that need them receive them through a typed
     ProcessorDeps struct (which already exists as ProcessorDeps in blockchain-adapter.ts). The base class provides only the validation pipeline
     (inputSchema, process(), postProcessTransactions()).

     Needs coverage:

     ┌───────────────────────────────────┬─────────────────────────┬──────────────────────────────────────────────────────┐
     │        Current capability         │ Covered by replacement? │                        Notes                         │
     ├───────────────────────────────────┼─────────────────────────┼──────────────────────────────────────────────────────┤
     │ Token metadata enrichment         │ Yes                     │ EVM/Solana processors receive deps via ProcessorDeps │
     ├───────────────────────────────────┼─────────────────────────┼──────────────────────────────────────────────────────┤
     │ Scam detection                    │ Yes                     │ Same — scam service in ProcessorDeps                 │
     ├───────────────────────────────────┼─────────────────────────┼──────────────────────────────────────────────────────┤
     │ Exchange processors (no metadata) │ Yes                     │ Constructor no longer requires the params            │
     └───────────────────────────────────┴─────────────────────────┴──────────────────────────────────────────────────────┘

     Surface: base-transaction-processor.ts, all 10 processor files that extend it.

     Leverage: Low-Medium — current approach works; this is a clarity improvement.

     ---
     3. Pattern Re-evaluation

     3a. Result types — okAsync/errAsync in async processInternal methods

     What exists:
     All blockchain and exchange processors return okAsync(transactions) or errAsync(...) from processInternal() which is typed as async ...
     Promise<Result<T, E>>:
     // evm/processor.ts:306
     return okAsync(transactions);

     // correlating-exchange-processor.ts:160
     return okAsync(transactions);

     This is a minor semantic inaccuracy: okAsync() returns a ResultAsync<T, E>, which is PromiseLike<Result<T,E>>. Inside an async method, await-ing it is
      unnecessary and it resolves correctly. However, it adds confusion — readers unfamiliar with neverthrow may wonder why ResultAsync is returned from an
      async function typed as Promise<Result<T, E>>. The correct call is ok(transactions) since we're already in an async context.

     Why it's a problem:
     Not a correctness bug (CLAUDE.md already documents this correctly). But it's a semantic mismatch that appears across 10+ processor files and creates
     noise when reading process flow. New contributors may copy the pattern unnecessarily.

     What V2 should do:
     Replace okAsync/errAsync with ok/err inside all async processInternal bodies. The outer async provides the Promise wrapping.

     Surface: 12 processor files, ~20 call-sites.

     Leverage: Low — correctness issue only in code clarity, not behavior.

     3b. Result types — try/catch wrapping in service classes

     What exists:
     Service classes (TransactionProcessService, BalanceService, AccountService, ImportOrchestrator) extensively mix the Result pattern with top-level
     try/catch blocks. process-service.ts alone has 3 try/catch blocks wrapping logic that internally uses Result chains:
     try {
       // ... uses isOk()/isErr() throughout ...
     } catch (error) {
       return err(new Error(`Unexpected error ...`));
     }

     balance-service.ts similarly has 5 try/catch blocks.

     Why it's a problem:
     The dual error boundary (Result + try/catch) creates ambiguity about which failure mode is expected vs unexpected. The catch blocks exist to handle
     thrown exceptions (e.g., from awaited Promises that weren't wrapped in Result). If the Result discipline were consistent, the try/catch shells would
     be unnecessary except at the true imperative boundary. Currently the outer catch is a safety net for incomplete Result coverage inside the method
     body.

     What V2 should do:
     Within service methods, all async calls should return Result types. Remove outer try/catch shells and replace them with proper Result propagation. Any
      truly unexpected thrown exception at the outermost shell (CLI handler) should be caught once at that boundary.

     Surface: 6 service files, ~31 try blocks across the package.

     Leverage: Medium — reduces error path confusion, improves testability.

     3c. Pattern interaction — normalizeRawData as a type-unsafe bridge

     What exists:
     TransactionProcessService.normalizeRawData() (lines 479-517 in process-service.ts) is a private method that converts RawTransaction[] to unknown[]
     before handing off to processors:
     private normalizeRawData(rawDataItems: RawTransaction[], sourceType: string): Result<unknown[], Error> {

     For exchange items it wraps raw+normalized into { raw, normalized, eventId } packages. For blockchain items it just extracts item.normalizedData. The
     method uses Object.keys(...) empty-check on unknown values with unsafe casts:
     const isEmpty = !normalizedData || Object.keys(normalizedData as Record<string, never>).length === 0;

     This is the only place in the hot path where type safety is explicitly abandoned.

     Why it's a problem:
     1. The exchange data-package structure ({ raw, normalized, eventId }) is constructed in the process service but the schema for it
     (RawTransactionWithMetadataSchema) lives in the exchange strategies. The service is constructing a typed object but not validating it against the
     schema at construction time.
     2. The blockchain path does no wrapping but still returns unknown[]. The actual type safety is deferred entirely to each processor's inputSchema.
     3. The isEmpty check via Object.keys(normalizedData as ...) is a potential runtime failure if normalizedData is a primitive.

     What V2 should do:
     Move the data packaging into each importer/adapter. The RawTransactionInput stored in the DB should already encode whether it's exchange or
     blockchain. Processors should receive a typed envelope from the adapter's factory, not a runtime-assembled package in the orchestrator. This makes the
      exchange package construction type-checked at the point it's defined.

     Surface: process-service.ts (the normalizeRawData method), ~100 lines.

     Leverage: Medium.

     3d. Strategy pattern — composition is good, but the processInternal signature is inconsistent

     What exists:
     ITransactionProcessor.process() (in processors.ts line 39) accepts FundFlowContext:
     process(normalizedData: unknown[], context: FundFlowContext): Promise<Result<ProcessedTransaction[], string>>;

     But CorrelatingExchangeProcessor.processInternal() ignores the context parameter entirely — exchange processors have no concept of a primary address.
     The BaseTransactionProcessor.process() method (line 57) provides a default empty context { primaryAddress: '', userAddresses: [] } for calls that
     don't supply one.

     Why it's a problem:
     FundFlowContext is a blockchain-specific concept. Its presence in the ITransactionProcessor interface forces every exchange processor to acknowledge
     (and silently ignore) it. The interface is not truly shared — it has a blockchain-shaped hole.

     What V2 should do:
     Either:
     1. Remove FundFlowContext from the ITransactionProcessor interface and have blockchain processors receive it through their adapter factory (closing
     over it in the created processor), OR
     2. Split ITransactionProcessor into IBlockchainProcessor and IExchangeProcessor with distinct signatures.

     Option 1 is simpler and requires the adapter's createProcessor to close over the FundFlowContext rather than passing it through the process service.
     Option 2 makes the type system accurately reflect the actual domain split.

     Needs coverage:

     ┌─────────────────────────────────────┬──────────────────────┬────────────────────────────────────────────────────────┐
     │         Current capability          │ Covered by option 1? │                         Notes                          │
     ├─────────────────────────────────────┼──────────────────────┼────────────────────────────────────────────────────────┤
     │ Blockchain fund flow context        │ Yes                  │ Closed over in createProcessor factory                 │
     ├─────────────────────────────────────┼──────────────────────┼────────────────────────────────────────────────────────┤
     │ Exchange processing (no context)    │ Yes                  │ Processor simply doesn't receive it                    │
     ├─────────────────────────────────────┼──────────────────────┼────────────────────────────────────────────────────────┤
     │ Uniform process() call from service │ Yes                  │ Service calls processor.process(data) — no context arg │
     └─────────────────────────────────────┴──────────────────────┴────────────────────────────────────────────────────────┘

     Surface: processors.ts, base-transaction-processor.ts, all 10+ processor files, process-service.ts.

     Leverage: Medium — API clarity improvement with meaningful type safety gain.

     ---
     4. Data Layer

     4a. ORM / query builder fit

     Not audited at the package level — Kysely is used in @exitbook/data. The ingestion package treats KyselyDB as an opaque type passed to processors. The
      one direct Kysely reference is the db field in ProcessorDeps used by the EVM processor for address info caching — though the actual cache is an
     in-memory Map, not a DB query.

     Finding: db: KyselyDB in ProcessorDeps is unused outside NEAR-adjacent code

     The ProcessorDeps interface (in blockchain-adapter.ts) includes db: KyselyDB. Examining the EVM processor — the only consumer of ProcessorDeps.db via
     the scam detection path — the db parameter is not actually used in the EVM processor body. The TokenMetadataService receives its own DB queries via
     its constructor, not through ProcessorDeps.db.

     After tracing all callers of createProcessor, db is passed but only the NEAR-adjacent batch provider uses createNearRawDataQueries(db) — but that is
     called from the process service, not from within createProcessor. The db field in ProcessorDeps appears to be vestigial or intended for a future use
     case.

     Surface: blockchain-adapter.ts, process-service.ts, all blockchain register.ts files (~9 files).

     Leverage: Low — cleanup opportunity, not a correctness issue.

     4b. Schema strategy

     The ingestion package correctly defers all schema migrations to @exitbook/data. No issues found.

     4c. Storage architecture

     No issues specific to ingestion. The package correctly uses rawDataQueries, transactionQueries, etc. as dependency-injected interfaces.

     ---
     5. Toolchain & Infrastructure

     No toolchain issues specific to ingestion — it inherits from the monorepo root. Build is tsc --noEmit (type-check only, no bundling), which is correct
      for a pure source package. Tests run via Vitest.

     ---
     6. File & Code Organization

     6a. Directory structure clarity

     The vertical slice structure (features/, sources/blockchains/, sources/exchanges/) is clean and well-executed. Each blockchain has an identically
     shaped directory: importer.ts, processor.ts, processor-utils.ts, address-utils.ts, types.ts, register.ts. This consistency is excellent.

     Finding: process-service-utils.ts is a near-empty module

     /packages/ingestion/src/features/process/process-service-utils.ts (12 lines) exports a single function extractUniqueAccountIds that is only referenced
      by its own test file and not by process-service.ts (despite being in the same directory). The function is covered by tests but not actually called in
      production code.

     export function extractUniqueAccountIds(rawData: RawTransaction[]): number[] {
       return [...new Set(rawData.map((item) => item.accountId))];
     }

     Surface: 1 file, 1 function, 0 production callers.

     Leverage: Low — dead code to remove.

     6b. Naming conventions

     Finding: ImportExecutor is not exported from index.ts but is a meaningful public concept

     The split between ImportOrchestrator (public) and ImportExecutor (private, not exported) is documented and intentional. However the naming is slightly
      misleading — "Executor" implies a lower-level primitive, while "Orchestrator" implies higher-level coordination. The executor does the core streaming
      + crash recovery work; the orchestrator does user/account setup. Consider: ImportCoordinator (user/account lifecycle) and ImportRunner (streaming
     execution). This is a naming suggestion, not a correctness issue.

     Finding: normalizeRawData vs normalizedData field naming

     In process-service.ts, normalizeRawData() is a method that transforms RawTransaction[] items into unknown[]. But the source field on each
     RawTransaction is called normalizedData. This overloading of "normalize" creates ambiguity — is the method re-normalizing already-normalized data, or
     transforming it into a processing envelope? A clearer name: packageRawDataForProcessing().

     Finding: AllAtOnceBatchProvider name implies a strategy but has no shared strategy interface consumers

     The three batch providers (AllAtOnceBatchProvider, HashGroupedBatchProvider, NearStreamBatchProvider) all implement IRawDataBatchProvider. The
     "AllAtOnce" name is fine but "HashGrouped" names an implementation detail (grouping by hash) rather than the intention (memory-bounded blockchain
     correlation). Rename suggestion: HashCorrelatedBatchProvider.

     6c. Module size

     Files over 400 LOC with multiple concerns:

     - balance-service.ts — 675 lines. Contains: balance verification orchestration, scam exclusion logic, coverage calculation, persistence, and 8 private
      helper methods. This is a service class doing too much.
     - process-service.ts — 609 lines. Contains: batch provider selection, account processing loop, normalization, saving, marking, incomplete-import
     guard.
     - evm/processor-utils.ts — 664 lines. Contains: fund flow analysis, operation classification, movement consolidation, address matching. This is
     intentionally the EVM core logic — appropriate for a pure-function module.
     - evm/processor.ts — 450 lines. The processor body is large but cohesive.
     - kucoin/importer-csv.ts — 703 lines. The large switch statement (lines 150-516) handles 20+ file types with duplicate boilerplate for "not
     implemented" cases.

     Finding: BalanceService is doing too much

     BalanceService.verifyBalance() is 130 lines and calls 7 private methods covering:
     1. Account fetching
     2. Exchange vs blockchain dispatch
     3. Live balance fetching
     4. DB balance calculation
     5. Scam exclusion collection
     6. Coverage calculation
     7. Balance comparison
     8. Persistence of results

     Why it's a problem:
     The scam exclusion logic (collectExcludedAssetInfo, subtractExcludedAmounts, removeAssetsById, removeAssetMetadata) is a complete mini-domain — 80
     lines — that doesn't need to live inside the service class. The coverage calculation (buildVerificationCoverage) is another pure function embedded in
     the class.

     What V2 should do:
     Extract collectExcludedAssetInfo, subtractExcludedAmounts, and buildVerificationCoverage into balance-utils.ts as pure exported functions, keeping the
      service class as a thin orchestration shell.

     Surface: balance-service.ts — ~200 lines relocatable.

     Leverage: Low — maintainability improvement.

     Finding: KuCoin CSV importer switch is 400 lines of near-identical boilerplate

     KucoinCsvImporter.processFileAsBatch() (lines 141-538 in importer-csv.ts) has 20+ switch cases, most of which are variations of:
     case 'not_implemented_xyz': {
       const recordCount = await this.countCsvRecords(filePath);
       if (recordCount > 0) {
         this.logger.warn(`Skipping ${recordCount} ... (not yet implemented)`);
       } else {
         this.logger.info(`No records found in ... file: ${fileName}`);
       }
       return ok({ rawTransactions: [], ..., isComplete: true });
     }

     Approximately 300 of the 400 switch lines are repetitive "not implemented" scaffolding.

     What V2 should do:
     Collapse all not_implemented_* cases into a single handler that reads the not_implemented_ prefix and generates the appropriate warning. This would
     reduce the switch to ~100 lines.

     Surface: kucoin/importer-csv.ts — ~300 lines collapsible.

     Leverage: Low-Medium — maintainability/readability.

     ---
     7. Error Handling & Observability

     7a. Error strategy fitness

     The neverthrow Result pattern is well-applied throughout the import and process pipelines. The IImporter.importStreaming() using
     AsyncIterableIterator<Result<ImportBatchResult, Error>> is an excellent choice — it composes streaming with error typing cleanly.

     Finding: Import warnings that force failure are semantically incorrect

     What exists:
     In ImportExecutor.executeStreamingImport() (lines 265-292), if any batch produces warnings, the import session is finalized with status 'failed' even
     though all data was successfully saved:
     if (allWarnings.length > 0) {
       const warningMessage = `Import completed with ${allWarnings.length} warning(s) and was marked as failed...`;
       const finalizeResult = await this.importSessionQueries.finalize(importSessionId, 'failed', ...);
       return err(new Error(warningMessage));
     }

     The comment in events.ts documents this: "Warnings currently force import to fail to prevent partial processing."

     Why it's a problem:
     A warning that causes a "failed" session status will prevent subsequent reprocess from running (the incomplete-import guard in
     TransactionProcessService.checkForIncompleteImports() blocks processing for non-completed sessions). The data is saved but processing is permanently
     blocked unless the user manually re-runs the import. This is a real usability issue — a minor provider warning permanently blocks processing.

     The status 'failed' is semantically wrong for "completed with caveats." The existing session status enum would benefit from a
     'completed_with_warnings' state.

     What V2 should do:
     Add 'completed_with_warnings' to the session status. The incomplete-import guard should treat 'completed_with_warnings' as processable. This separates
      "import never finished" from "import finished but had non-fatal issues."

     Needs coverage:

     ┌──────────────────────────────────────────────┬─────────────────────────┬──────────────────────────────────────────────┐
     │              Current capability              │ Covered by replacement? │                    Notes                     │
     ├──────────────────────────────────────────────┼─────────────────────────┼──────────────────────────────────────────────┤
     │ Block processing of truly incomplete imports │ Yes                     │ Only 'started' and 'failed' block processing │
     ├──────────────────────────────────────────────┼─────────────────────────┼──────────────────────────────────────────────┤
     │ Surfacing warning details to user            │ Yes                     │ error_message field retains warning summary  │
     ├──────────────────────────────────────────────┼─────────────────────────┼──────────────────────────────────────────────┤
     │ Prevent silent data loss                     │ Yes                     │ Warnings still logged and emitted as events  │
     └──────────────────────────────────────────────┴─────────────────────────┴──────────────────────────────────────────────┘

     Surface: import-service.ts (1 site), process-service.ts (guard logic), schema in @exitbook/data.

     Leverage: High — this is a correctness/usability issue, not aesthetic.

     7b. Silent failure paths

     Finding: cursorUpdateResult failure is logged as warn but not propagated

     In ImportExecutor.executeStreamingImport() (lines 234-237):
     const cursorUpdateResult = await this.accountQueries.updateCursor(account.id, batch.streamType, batch.cursor);
     if (cursorUpdateResult.isErr()) {
       this.logger.warn(`Failed to update cursor for ${batch.streamType}: ${cursorUpdateResult.error.message}`);
     }

     A cursor update failure means crash recovery loses its position. If the import then crashes, the next run will re-fetch data from the beginning of
     that stream type. This is tolerable (deduplication catches it) but the severity is logged as warn when it could cause significant re-import work.

     Surface: 1 call-site in import-service.ts.

     Leverage: Low — logged, not silent, but severity understated.

     Finding: persistVerificationResults failure is swallowed in BalanceService

     In balance-service.ts (lines 167-179):
     if (persistResult.isErr()) {
       logger.warn(`Failed to persist verification results: ${persistResult.error.message}`);
       // Don't fail the whole operation if persistence fails
     }

     This is a deliberate design choice (the comment justifies it), and the warning is logged. The verification result is still returned to the caller.
     This is acceptable behavior but worth noting as an eventual consistency gap — the account's stored verification state may be stale after a persistence
      failure.

     Leverage: Low — intentional, documented.

     7c. Observability readiness

     Finding: Three RESERVED event types are defined but never emitted

     In events.ts (lines 209-277), three ProcessEvent variants are defined as RESERVED:
     - process.batch (line 215)
     - process.group.processing (line 249)
     - process.skipped (line 272)

     These are dead schema surface. The process.batch.started and process.batch.completed events ARE emitted and cover the batch lifecycle. The
     process.group.processing event would be valuable for observability (knowing which tx hash is being correlated) but is not implemented.

     What V2 should do:
     Either implement the RESERVED events or remove them. Dead schema in a discriminated union adds noise to consumers (CLI dashboard, future API).

     Surface: events.ts — 3 unused event types.

     Leverage: Low — cleanup.

     Finding: No structured correlation ID between import and process events

     When an import session runs followed by processing, the events from both phases share an accountId but there is no shared sessionId in process events.
      A debugging session trying to correlate "which processing run corresponds to which import" must match by accountId and temporal proximity. Adding
     sessionId to process events would make traces self-documenting.

     Surface: events.ts (ProcessEvent types), process-service.ts (emit sites).

     Leverage: Medium for observability.

     ---
     V2 Decision Summary

     Rank: 1
     Change: Add 'completed_with_warnings' session status; relax incomplete-import guard to allow processing
     Dimension: 7a
     Leverage: High
     One-line Rationale: Import warnings permanently block processing — this is a data-accessibility correctness issue
     ────────────────────────────────────────
     Rank: 2
     Change: Move NEAR batch provider selection into BlockchainAdapter via optional factory
     Dimension: 2b
     Leverage: Medium
     One-line Rationale: Eliminates the one hardcoded blockchain name in the central process orchestrator
     ────────────────────────────────────────
     Rank: 3
     Change: Remove FundFlowContext from ITransactionProcessor interface; close over it in adapter factory
     Dimension: 3d
     Leverage: Medium
     One-line Rationale: Blockchain-specific concept bleeds into the exchange processor interface, creating a false shared API
     ────────────────────────────────────────
     Rank: 4
     Change: Extend ExchangeAdapter with optional fetchLiveBalance factory; remove direct createExchangeClient call from BalanceService
     Dimension: 2a
     Leverage: Medium
     One-line Rationale: Inconsistent abstraction: import uses registry, balance-check bypasses it
     ────────────────────────────────────────
     Rank: 5
     Change: Replace outer try/catch shells in service classes with full Result propagation
     Dimension: 3b
     Leverage: Medium
     One-line Rationale: Dual error boundary (Result + catch) obscures which failures are expected vs programmer bugs
     ────────────────────────────────────────
     Rank: 6
     Change: Move normalizeRawData data-packaging logic into adapter/importer layer; deliver typed envelopes
     Dimension: 3c
     Leverage: Medium
     One-line Rationale: The only type-unsafe bridge in the hot processing path — unknown[] should be eliminated
     ────────────────────────────────────────
     Rank: 7
     Change: Add sessionId to ProcessEvent types
     Dimension: 7c
     Leverage: Medium
     One-line Rationale: Enables causality tracing between import and processing phases
     ────────────────────────────────────────
     Rank: 8
     Change: Remove dead db: KyselyDB from ProcessorDeps if unused
     Dimension: 4a
     Leverage: Low
     One-line Rationale: Vestigial dependency misleads readers about what processors can do
     ────────────────────────────────────────
     Rank: 9
     Change: Collapse KuCoin not_implemented_* switch cases into a single handler
     Dimension: 6c
     Leverage: Low
     One-line Rationale: ~300 lines of copy-paste boilerplate; easy to collapse without behavior change
     ────────────────────────────────────────
     Rank: 10
     Change: Extract BalanceService scam-exclusion and coverage helpers to balance-utils.ts
     Dimension: 6c
     Leverage: Low
     One-line Rationale: 675-line service; pure functions don't belong inside the class
     ────────────────────────────────────────
     Rank: 11
     Change: Remove or implement RESERVED ProcessEvent types
     Dimension: 7c
     Leverage: Low
     One-line Rationale: Dead schema in discriminated union adds noise for event consumers
     ────────────────────────────────────────
     Rank: 12
     Change: Delete process-service-utils.ts (extractUniqueAccountIds has no production caller)
     Dimension: 6a
     Leverage: Low
     One-line Rationale: Dead code confirmed by grep — 0 production call-sites
     ────────────────────────────────────────
     Rank: 13
     Change: Replace okAsync/errAsync with ok/err inside async processInternal bodies
     Dimension: 3a
     Leverage: Low
     One-line Rationale: Semantic mismatch creates reader confusion; no behavioral difference

     ---
     What V2 Keeps

     The following patterns and tools in the ingestion package earned their place and should carry forward unchanged:

     Streaming iterator protocol (AsyncIterableIterator<Result<ImportBatchResult, Error>>) — This is a genuinely excellent interface. It composably handles
      backpressure, crash recovery via per-batch cursor persistence, and memory boundedness. All importers implementing it is the right call.

     Vertical slice structure — sources/blockchains/<chain>/ and sources/exchanges/<exchange>/ with consistent internal shapes (importer, processor,
     processor-utils, address-utils, register, types) is highly readable and extensible. Adding a new blockchain requires touching exactly one known-shape
     directory.

     AdapterRegistry pattern — A simple, immutable map with fail-fast duplicate detection. It avoids service locator anti-patterns while providing dynamic
     dispatch. The buildMap helper is minimal and effective.

     BaseTransactionProcessor<T> with inputSchema — The abstract base that validates unknown[] against a typed schema before calling processInternal(T[])
     eliminates an entire class of runtime type errors at the processor boundary. This is a significant DX and correctness win.

     Strategy composition in CorrelatingExchangeProcessor — GroupingStrategy + InterpretationStrategy compose cleanly. The three grouping strategies
     (byCorrelationId, byTimestamp, noGrouping) and two interpretation strategies (standardAmounts, coinbaseGrossAmounts) cover the real variation between
     exchanges without requiring subclassing for every new exchange.

     FundFlowContext + userAddresses for internal transfer detection — Passing all known user addresses for a blockchain into the processor enables correct
      fund flow classification (detecting user-to-user transfers as self-transfers rather than deposits/withdrawals). This is a domain insight that should
     persist.

     Crash recovery via per-batch cursor persistence — The ImportExecutor.executeStreamingImport() cursor update after every batch is a correct and
     important design. It bounds re-work on crash to a single batch, not the entire import.

     Pure function extraction into *-utils.ts modules — evm/processor-utils.ts, balance-calculator.ts, scam-detection-utils.ts,
     correlating-exchange-processor-utils.ts all follow the functional core pattern correctly. They are pure functions with no side effects, making them
     independently testable and verifiable.

     Scam detection as a pluggable IScamDetectionService — The multi-tier detection (professional flag → pattern matching → heuristics) is well-organized,
     and the interface allows future replacement or augmentation without touching processor code.
