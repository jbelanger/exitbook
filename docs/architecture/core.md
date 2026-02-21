V2 Architecture Audit — packages/core

     ---
     2. Architectural Seams

     [2a] Finding: TransactionTypeSchema is a dead export

     What exists:
     /Users/joel/Dev/exitbook/packages/core/src/schemas/universal-transaction.ts lines 9–27 exports TransactionTypeSchema, an enum with 16 values (trade, deposit, withdrawal, order,
     ledger, transfer, fee, staking_deposit, staking_withdrawal, staking_reward, governance_deposit, governance_refund, internal_transfer, proxy, multisig, utility_batch, unknown).

     export const TransactionTypeSchema = z.enum([
       'trade', 'deposit', 'withdrawal', 'order', 'ledger', 'transfer', 'fee',
       'staking_deposit', 'staking_withdrawal', 'staking_reward',
       'governance_deposit', 'governance_refund', 'internal_transfer',
       'proxy', 'multisig', 'utility_batch', 'unknown',
     ]);

     Why it's a problem:
     No consumer outside packages/core/ imports TransactionTypeSchema or the inferred TransactionType type. The schema is not referenced by UniversalTransactionSchema or any other
     schema in core. It appears to be a remnant of an earlier classification approach that was replaced by the operation.category / operation.type two-axis model. It adds surface
     area to the public API that misleads readers into thinking it is active.

     What V2 should do:
     Delete TransactionTypeSchema and its associated type alias entirely. It is not used.

     Needs coverage:
     Not applicable — this is a deletion, not a replacement. Zero consumers would be affected.

     Surface: 1 file in core. 0 external call-sites.

     Leverage: Low (correctness: none; DX: minor, removes misleading API surface)

     ---
     [2b] Finding: UniversalBalanceSchema is exported but unused outside core

     What exists:
     /Users/joel/Dev/exitbook/packages/core/src/schemas/universal-transaction.ts lines 286–298 exports UniversalBalanceSchema and an implicit UniversalBalance type.

     Why it's a problem:
     Zero files outside packages/core/ import UniversalBalanceSchema or UniversalBalance. The type is a generic balance shape (currency, free, total, used) that does not align with
     how actual balances flow through @exitbook/ingestion — which uses its own BalanceComparison and BalanceVerificationResult types defined locally. Placement in the universal
     transaction schema file is also incongruous.

     What V2 should do:
     Delete the export, or move it to where it is actually used if a future consumer is identified. It does not belong in the transaction schema.

     Needs coverage: Not applicable (deletion).

     Surface: 1 file in core. 0 external call-sites.

     Leverage: Low

     ---
     [2c] Finding: DataImportParams schema is exported but has zero consumers

     What exists:
     /Users/joel/Dev/exitbook/packages/core/src/schemas/import-session.ts lines 16–21 and types/import-session.ts re-export DataImportParams and DataImportParamsSchema.

     Why it's a problem:
     No package outside packages/core/ imports DataImportParams or DataImportParamsSchema. This is command-parameter data that belongs in the CLI feature or ingestion layer, not in
     the shared domain contract.

     What V2 should do:
     Move to apps/cli/ or remove. Core should not carry CLI-specific parameter shapes.

     Needs coverage: Not applicable (relocation).

     Surface: 0 external call-sites.

     Leverage: Low

     ---
     [2d] Finding: BalanceVerification, BalanceVerificationStatus, and BalanceCommandStatus are CLI command concerns living in core

     What exists:
     /Users/joel/Dev/exitbook/packages/core/src/schemas/import-session.ts defines BalanceVerificationSchema, BalanceVerificationStatusSchema, BalanceCommandStatusSchema, and
     VerificationMetadataSchema.

     - BalanceCommandStatus is used by one call-site: packages/ingestion/src/features/balances/balance-verifier.types.ts:23.
     - BalanceVerification and VerificationMetadata are embedded in the AccountSchema (via account.ts) to persist the last verification result in the account record. This is what
     justifies their presence in core.

     Why it's a problem:
     BalanceCommandStatus ('success' | 'warning' | 'failed') is a presentation-layer concept (it maps to a CLI exit status), not a domain entity. Keeping it in core bleeds
     command-layer concerns into the domain boundary.

     What V2 should do:
     Move BalanceCommandStatus and its schema to packages/ingestion (where it is consumed). Keep BalanceVerification and VerificationMetadata in core since they are stored in
     Account.

     Needs coverage:

     ┌────────────────────────────────┬────────────────────────┬─────────────────────────────────────────────────────────┐
     │       Current capability       │ Covered by relocation? │                          Notes                          │
     ├────────────────────────────────┼────────────────────────┼─────────────────────────────────────────────────────────┤
     │ Type for command result status │ Yes                    │ Moved to ingestion, re-exported if needed               │
     ├────────────────────────────────┼────────────────────────┼─────────────────────────────────────────────────────────┤
     │ Stored in Account record       │ Not affected           │ Only BalanceVerification is stored; status is ephemeral │
     └────────────────────────────────┴────────────────────────┴─────────────────────────────────────────────────────────┘

     Surface: 1 schema file, 1 type file, 1 external consumer. Trivial relocation.

     Leverage: Low

     ---
     [2e] Finding: OperationClassification is defined three times with divergent shapes

     What exists:
     Three separate definitions exist:

     1. packages/core/src/types/universal-transaction.ts:29 — { operation: { category, type }, notes? } (nested)
     2. packages/ingestion/src/sources/blockchains/near/processor-utils.ts:206 — { category, type } (flat, no operation wrapper, no notes)
     3. packages/ingestion/src/sources/exchanges/shared/correlating-exchange-processor-utils.ts:13 — { operation: { category, type }, notes? } (same shape as core)

     The near processor (definition 2) uses its flat local type internally, then adapts it to the core nested shape in processor.ts lines 549–552:
     operation: {
       category: classification.category,
       type: classification.type,
     },

     Why it's a problem:
     The flat near type is structurally incompatible with the core type. The near processor's determineNearOperation function returns the flat { category, type } which the processor
     then manually re-wraps. This is a silent shape mismatch: TypeScript accepts both because it structurally matches the local type, not the core type. If a processor author returns
      the local near type directly into a ProcessedTransaction.operation field (which expects { category: OperationCategory, type: OperationType }), TypeScript will catch it — but
     the indirection makes this harder to see.

     The exchange definition is identical to the core definition and adds no value as a separate declaration.

     What V2 should do:
     Delete definitions 2 and 3. All processor return types should use OperationClassification from @exitbook/core directly. The near processor's local type should be eliminated in
     favor of the core type (the flat fields it currently returns can be adapted at the return site instead of mid-function).

     Needs coverage:

     ┌────────────────────────────────────────────────┬───────────────────────┬─────────────────────────────────────────┐
     │               Current capability               │ Covered by core type? │                  Notes                  │
     ├────────────────────────────────────────────────┼───────────────────────┼─────────────────────────────────────────┤
     │ Flat { category, type } return from near utils │ Partial               │ Near utils must return the wrapped form │
     ├────────────────────────────────────────────────┼───────────────────────┼─────────────────────────────────────────┤
     │ notes optional field                           │ Yes                   │ Core type includes it                   │
     ├────────────────────────────────────────────────┼───────────────────────┼─────────────────────────────────────────┤
     │ Structural typing in processors                │ Yes                   │ Core type is the single contract        │
     └────────────────────────────────────────────────┴───────────────────────┴─────────────────────────────────────────┘

     Surface: 3 definition sites. The near processor's utility functions (~3) must change their return type. The exchange definition is a straight deletion.

     Leverage: Medium (prevents future shape drift; DX improvement)

     ---
     [2f] Finding: TransactionWithId interface is declared but has no consumers

     What exists:
     /Users/joel/Dev/exitbook/packages/core/src/types/cursor.ts:13-15:
     export interface TransactionWithId {
       id: string;
     }

     Why it's a problem:
     TransactionWithId is not imported by any file outside packages/core/. It was presumably intended as a base interface for cursor extraction, but nothing uses it.

     What V2 should do:
     Delete it.

     Surface: 1 definition, 0 consumers.

     Leverage: Low

     ---
     3. Pattern Re-evaluation

     [3a] Finding: The types/ directory is a redundant indirection layer

     What exists:
     The package has a schemas/ directory (Zod schemas + inferred types) and a parallel types/ directory that is almost entirely re-export shims:

     - types/import-session.ts (15 lines): pure re-export of types from schemas/import-session.js
     - types/raw-transaction.ts (5 lines): pure re-export
     - types/token-metadata.ts (5 lines): pure re-export
     - types/transaction-link.ts (10 lines): pure re-export

     The only types/ files with real content:
     - types/currency.ts (178 lines): Currency class — no schema counterpart
     - types/cursor.ts (45 lines): two type guards + two type aliases — genuine runtime logic
     - types/universal-transaction.ts (42 lines): OperationClassification interface + type aliases from schemas

     Why it's a problem:
     The types/ subdirectory implies a structural distinction ("types are here, schemas are there") but the distinction is not consistently observed. Schemas already export their
     inferred types at declaration. The re-export shims add a file hop with zero benefit and mislead contributors about where to look. The index.ts barrel exports both schemas/* and
     types/*, so consumers see everything via the package root anyway.

     What V2 should do:
     Collapse the types/ re-export shims into the schemas themselves (the schemas already export export type Foo = z.infer<...>). Retain types/currency.ts as src/currency.ts (or keep
      in types/ if the directory is kept), and absorb types/cursor.ts guards into utils/cursor-utils.ts. The OperationClassification interface in types/universal-transaction.ts
     should live in schemas/universal-transaction.ts alongside the schemas it depends on.

     Needs coverage:

     ┌────────────────────────────────────────┬───────────────────────────────┬──────────────────────────────────────────────────┐
     │           Current capability           │ Covered without types/ shims? │                      Notes                       │
     ├────────────────────────────────────────┼───────────────────────────────┼──────────────────────────────────────────────────┤
     │ Type-only imports from core            │ Yes                           │ Schemas already export type Foo                  │
     ├────────────────────────────────────────┼───────────────────────────────┼──────────────────────────────────────────────────┤
     │ Single import path for all consumers   │ Yes                           │ All come through @exitbook/core barrel           │
     ├────────────────────────────────────────┼───────────────────────────────┼──────────────────────────────────────────────────┤
     │ Separation of runtime vs type concerns │ Partial                       │ Currency and cursor guards genuinely need a home │
     └────────────────────────────────────────┴───────────────────────────────┴──────────────────────────────────────────────────┘

     Surface: 7 files in types/ (4 are pure shims, 3 have substance). Zero external consumers reference specific sub-paths.

     Leverage: Medium (DX: reduces cognitive overhead of two-directory layout; reduces files to maintain)

     ---
     [3b] Finding: parseDecimal silently swallows invalid input, which is a financial accuracy risk

     What exists:
     /Users/joel/Dev/exitbook/packages/core/src/utils/decimal-utils.ts:41-45:
     export function parseDecimal(value: string | number | Decimal | undefined | null): Decimal {
       const result = { value: new Decimal('0') };
       tryParseDecimal(value, result);
       return result.value;
     }

     And tryParseDecimal returns false (without setting result.value) for invalid inputs, so parseDecimal('invalid') silently returns Decimal(0). This is documented in tests:
     it('should return zero for invalid strings', () => {
       expect(parseDecimal('invalid').isZero()).toBe(true);

     parseDecimal is imported 132 times across the codebase — the single most-used export from @exitbook/core.

     Why it's a problem:
     This is a financial system where an invalid amount string silently becoming 0 could corrupt cost-basis calculations, balance totals, or fee computations without any error
     signal. The behavior is explicitly tested and documented, so it is intentional — but the intent conflicts with the CLAUDE.md directive: "Never make silent assumptions or apply
     defaults for unexpected behavior." When called from inside Zod transformations (as in schemas/money.ts:19), Zod will surface a validation error if the input fails the z.union
     predicate before reaching parseDecimal. But parseDecimal is also called directly in processor utilities, where there is no upstream validator.

     What V2 should do:
     Split the function into two explicit variants with unambiguous names:

     - parseDecimalOrZero(value) — current behavior, for intentional zero-default contexts (e.g., database reads of nullable columns)
     - parseDecimalOrThrow(value) — throws for invalid input, for use in processors where a bad amount string means corrupt data

     This does not require changing the call-site count but does require reviewing each of the 132 call-sites to choose the correct variant.

     Needs coverage:

     ┌────────────────────────────────────────────┬───────────────────────────┬────────────────────────────────────────┐
     │             Current capability             │ Covered by renamed split? │                 Notes                  │
     ├────────────────────────────────────────────┼───────────────────────────┼────────────────────────────────────────┤
     │ Zero-default for undefined/null (DB reads) │ Yes                       │ parseDecimalOrZero                     │
     ├────────────────────────────────────────────┼───────────────────────────┼────────────────────────────────────────┤
     │ Parse Decimal/string/number                │ Yes                       │ Both variants                          │
     ├────────────────────────────────────────────┼───────────────────────────┼────────────────────────────────────────┤
     │ Silent corruption vector                   │ No longer present         │ parseDecimalOrThrow at processor sites │
     └────────────────────────────────────────────┴───────────────────────────┴────────────────────────────────────────┘

     Surface: 132 call-sites. Not all need to change — only those in processors/business logic where zero-default is semantically wrong.

     Leverage: High (correctness in a financial domain — the silent zero can corrupt calculations)

     ---
     [3c] Finding: wrapError discards the context string when the input is already an Error

     What exists:
     /Users/joel/Dev/exitbook/packages/core/src/utils/type-guard-utils.ts:33-36:
     export function wrapError<T = never>(error: unknown, context: string): Result<T, Error> {
       const message = getErrorMessage(error);
       return err(error instanceof Error ? error : new Error(`${context}: ${message}`));
     }

     When called with an existing Error instance, it returns that error unchanged — the context string is lost. This means:

     wrapError(new Error('DB constraint violated'), 'Failed to save transaction')
     // Returns: Error('DB constraint violated')  -- context is dropped

     This is used 159 times across the codebase.

     Why it's a problem:
     The caller-supplied context is the whole point of wrapError. Dropping it for Error inputs means the error message hitting logs lacks the callsite's framing. When the error
     originates deep in Kysely or a network library, the original message alone is insufficient to diagnose which operation failed. The test file (type-guard-utils.test.ts:103-111)
     explicitly documents and asserts this "preserve original error" behavior, indicating it was intentional — but in practice it removes debugging context.

     What V2 should do:
     Use Error.cause (Node.js 16.9+, TypeScript 4.6+) to wrap:
     return err(new Error(context, { cause: error instanceof Error ? error : new Error(String(error)) }));
     This preserves both the context and the causal chain. Pino's logger will serialize cause in structured output. All 159 call-sites are already calling wrapError with a meaningful
      context string — the fix is purely in the implementation.

     Needs coverage:

     ┌─────────────────────────────┬─────────────────────────┬──────────────────────────────────────┐
     │     Current capability      │ Covered by Error.cause? │                Notes                 │
     ├─────────────────────────────┼─────────────────────────┼──────────────────────────────────────┤
     │ Returns Result<T, Error>    │ Yes                     │ Same return type                     │
     ├─────────────────────────────┼─────────────────────────┼──────────────────────────────────────┤
     │ Preserves original error    │ Yes                     │ As .cause                            │
     ├─────────────────────────────┼─────────────────────────┼──────────────────────────────────────┤
     │ Includes context in message │ Yes                     │ Context is now the top-level message │
     ├─────────────────────────────┼─────────────────────────┼──────────────────────────────────────┤
     │ Pino log serialization      │ Yes                     │ Pino serializes cause by default     │
     └─────────────────────────────┴─────────────────────────┴──────────────────────────────────────┘

     Surface: 1 function definition. 159 call-sites unaffected at the call level; logging output changes.

     Leverage: High (observability — all errors lose diagnostic context today)

     ---
     [3d] Finding: Currency class throws in create() instead of returning a Result

     What exists:
     /Users/joel/Dev/exitbook/packages/core/src/types/currency.ts:113-121:
     static create(code: string): Currency {
       const normalized = code.toUpperCase().trim();
       if (normalized.length === 0) {
         throw new Error('Currency code cannot be empty');
       }
       return new Currency(normalized);
     }

     Currency.create() is called 72 times across the monorepo. The throwing constructor is used within the Zod CurrencySchema transformer (which catches Zod-level errors), but is
     also called directly in accounting logic such as lot-matcher.ts:189 and price-calculation-utils.ts:68 — neither of which is inside a try/catch.

     Why it's a problem:
     The project's own CLAUDE.md pattern is Result<T, Error> for fallible functions. Currency.create() is fallible (empty string input) and is called directly in business logic paths
      without error handling. If an empty assetSymbol makes it through to Currency.create(), it throws and unwinds a Result chain — a silent failure path in the financial core.

     The Zod schema (CurrencySchema) already handles the Zod boundary correctly. The direct call-sites in accounting code are exposed.

     What V2 should do:
     Either:
     a) Change Currency.create() to return Result<Currency, Error> and update the 72 call-sites, or
     b) Add a Currency.tryCreate() variant returning Result<Currency, Error> for direct use in accounting logic, keeping the throwing create() for schema-internal use only (where Zod
      captures exceptions).

     Option (b) is the lower-risk V2 change since it does not require touching the Zod schema internals.

     Needs coverage:

     ┌──────────────────────────────────┬──────────────────────────────────────┬──────────────────────────────────────────┐
     │        Current capability        │ Covered by Result-returning variant? │                  Notes                   │
     ├──────────────────────────────────┼──────────────────────────────────────┼──────────────────────────────────────────┤
     │ Normalize to uppercase           │ Yes                                  │ Same normalization                       │
     ├──────────────────────────────────┼──────────────────────────────────────┼──────────────────────────────────────────┤
     │ Reject empty string              │ Yes                                  │ Returns err(...) instead of throwing     │
     ├──────────────────────────────────┼──────────────────────────────────────┼──────────────────────────────────────────┤
     │ Works inside Zod transform       │ Yes                                  │ Zod's .transform() catches thrown errors │
     ├──────────────────────────────────┼──────────────────────────────────────┼──────────────────────────────────────────┤
     │ Used in accounting Result chains │ Yes                                  │ Can now chain with .andThen()            │
     └──────────────────────────────────┴──────────────────────────────────────┴──────────────────────────────────────────┘

     Surface: 72 call-sites. Most are in accounting (.isFiat(), .isFiatOrStablecoin() checks) and would benefit from the andThen chain.

     Leverage: Medium (correctness; aligns with project error pattern)

     ---
     4. Data Layer

     Not applicable to packages/core. Core contains no database access, no ORM usage, and no migration code. It is a pure domain-types package.

     ---
     5. Toolchain & Infrastructure

     [5a] Finding: Core has no build output — it ships raw TypeScript source

     What exists:
     package.json:
     "main": "src/index.ts",
     "types": "src/index.ts"
     tsconfig.json:
     "allowImportingTsExtensions": true,
     "noEmit": true

     Core is a pure TypeScript source package consumed by tsx at runtime. There is no compiled output. Import paths within core use .js extensions (NodeNext module resolution
     convention), which is correct for the workspace setup.

     Why this is not a problem (for now):
     The workspace uses tsx --env-file-if-exists which handles .ts → runtime execution without a build step. The noEmit: true + source distribution approach works because all
     consumers are in the same monorepo and also run under tsx. This is a conscious DX choice documented in the project structure.

     What changes if the project grows:
     If core is ever published or consumed outside this monorepo, the noEmit + source-ship pattern breaks immediately. V2 should keep this in mind but it is not a problem today.

     No material issues found for the current scope.

     ---
     [5b] No CI/toolchain issues specific to core

     The tsconfig.json extends the shared base with exactOptionalPropertyTypes, strict, noUncheckedIndexedAccess, and noPropertyAccessFromIndexSignature. These are all active and
     appropriate.

     ---
     6. File & Code Organization

     [6a] Finding: The schemas/ and types/ split creates a misleading two-layer directory structure

     This is addressed in Finding 3a above. The structural recommendation is the same: collapse the pure re-export shims, making schemas/ the canonical home for both Zod schemas and
     their inferred types.

     ---
     [6b] Finding: schemas/import-session.ts is a conceptual catch-all for unrelated concerns

     What exists:
     /Users/joel/Dev/exitbook/packages/core/src/schemas/import-session.ts contains:
     - Import session lifecycle (appropriate)
     - Balance verification results (embedded in accounts — defensible)
     - Balance discrepancies (stored in accounts — defensible)
     - BalanceCommandStatus (CLI output status — should be in ingestion)
     - DataImportParams (CLI command parameters — should be in CLI or ingestion)
     - SourceParams (used only to build VerificationMetadata stored in accounts)

     Why it's a problem:
     The file bundles domain persistence models (ImportSession) with command-result types (BalanceCommandStatus) and CLI parameter shapes (DataImportParams). This makes it difficult
     to understand which concepts are domain contracts versus presentation artifacts.

     What V2 should do:
     Split into:
     - schemas/import-session.ts — ImportSession, ImportSessionStatus, SourceType only
     - schemas/balance-verification.ts — BalanceVerification, VerificationMetadata, BalanceVerificationStatus, BalanceDiscrepancy (retained in core since they are stored in Account)
     - Move BalanceCommandStatus and DataImportParams out of core entirely

     Needs coverage:

     ┌────────────────────────────────────────────┬───────────────────┬──────────────────────────────────┐
     │             Current capability             │ Covered by split? │              Notes               │
     ├────────────────────────────────────────────┼───────────────────┼──────────────────────────────────┤
     │ All schemas accessible from @exitbook/core │ Yes               │ Barrel re-exports both files     │
     ├────────────────────────────────────────────┼───────────────────┼──────────────────────────────────┤
     │ VerificationMetadata in AccountSchema      │ Yes               │ account.ts imports from new file │
     └────────────────────────────────────────────┴───────────────────┴──────────────────────────────────┘

     Surface: 1 file split into 2. All downstream imports via the barrel are unaffected.

     Leverage: Low (organizational clarity only)

     ---
     [6c] Finding: money.ts is the wrong home for DateSchema and IntegerStringSchema

     What exists:
     /Users/joel/Dev/exitbook/packages/core/src/schemas/money.ts contains:
     - DecimalSchema — appropriate (money-related)
     - DecimalStringSchema — appropriate
     - MoneySchema — appropriate
     - CurrencySchema — appropriate
     - DateSchema — unrelated to money; general utility
     - IntegerStringSchema — unrelated to money; provider API utility

     Why it's a problem:
     DateSchema and IntegerStringSchema are not monetary concepts. DateSchema is imported by raw-transaction.ts, token-metadata.ts, and transaction-link.ts via money.js — all
     non-monetary schemas. IntegerStringSchema is used only by blockchain-providers for block number fields. Importing from money.js to get a date schema is semantically misleading.

     What V2 should do:
     Move DateSchema and IntegerStringSchema to a schemas/primitives.ts file. Re-export from the barrel as before. All existing from './money.js' imports in other schema files become
      from './primitives.js'.

     Needs coverage:

     ┌─────────────────────────────────────────────┬───────────────────────────┬────────────────────────────────────────┐
     │             Current capability              │ Covered by primitives.ts? │                 Notes                  │
     ├─────────────────────────────────────────────┼───────────────────────────┼────────────────────────────────────────┤
     │ DateSchema available to all schemas         │ Yes                       │ Re-exported from barrel                │
     ├─────────────────────────────────────────────┼───────────────────────────┼────────────────────────────────────────┤
     │ IntegerStringSchema in blockchain-providers │ Yes                       │ Via core barrel, unchanged import path │
     └─────────────────────────────────────────────┴───────────────────────────┴────────────────────────────────────────┘

     Surface: 4 internal schema files that import DateSchema from money.js. 1 external call-site (routescan.schemas.ts) that imports IntegerStringSchema. All use the package root; no
      path changes needed at the consumer level.

     Leverage: Low (clarity)

     ---
     7. Error Handling & Observability

     [7a] Finding: wrapError drops diagnostic context (addressed in 3c above)

     See Finding 3c. The same behavioral issue applies here — the dropped context string directly impacts log quality when diagnosing production issues. wrapError is the
     error-observation integration point between neverthrow and Pino logging. Fixing it with Error.cause would make every error in the system carry a breadcrumb trail.

     ---
     [7b] Finding: parseDecimal is a silent failure path (addressed in 3b above)

     See Finding 3b. The silent-zero fallback is the most significant observability risk in core.

     ---
     [7c] Finding: assetId validation predicates in schemas are not exported as utilities

     What exists:
     Two predicate functions in universal-transaction.ts (lines 70-79):
     function hasNoUnknownTokenRef(assetId: string): boolean { ... }
     function hasValidBlockchainAssetIdFormat(assetId: string): boolean { ... }

     These are function (not export function). They are used as .refine() callbacks in both AssetMovementSchema and FeeMovementSchema.

     Why it is not a critical problem but is worth noting:
     The same validation logic exists in parseAssetId in asset-id-utils.ts, which is the builder/parser module. If a third location needs to validate an assetId without going through
      Zod, these predicates must be re-derived. The duplication is small (two functions, ~15 lines) but the semantic overlap with parseAssetId means there are two representations of
     "what makes a valid assetId."

     What V2 should do:
     Export hasNoUnknownTokenRef and hasValidBlockchainAssetIdFormat from asset-id-utils.ts (or inline their logic into parseAssetId returning structured errors). The Zod refinements
      can then call the exported utilities, creating a single authoritative source.

     Surface: 2 functions, used in 2 schema refinements. Low risk change.

     Leverage: Low

     ---
     [7d] Observability readiness

     The package contains no logging calls (appropriate for a types package). Pino is not a dependency and should not be. The domain types are clean. wrapError is the only
     observability-adjacent code, and its flaw is noted in Finding 3c.

     There is no structured tracing in core (none expected — it is a library package).

     ---
     V2 Decision Summary

     Rank: 1
     Change: parseDecimal should throw (not return 0) for invalid inputs in processor contexts; rename to make intent explicit
     Dimension: 3b / 7b
     Leverage: High
     One-line Rationale: Silent zero-default on bad amount data can corrupt financial calculations in a system where accuracy is critical
     ────────────────────────────────────────
     Rank: 2
     Change: Fix wrapError to use Error.cause so context is never dropped
     Dimension: 3c / 7a
     Leverage: High
     One-line Rationale: 159 call-sites currently lose their diagnostic context string when wrapping an existing Error, making production debugging harder
     ────────────────────────────────────────
     Rank: 3
     Change: Delete the types/ re-export shims; consolidate types directly into schemas/ files
     Dimension: 3a / 6a
     Leverage: Medium
     One-line Rationale: Four files that do nothing but re-export create a misleading two-layer structure and add navigation overhead
     ────────────────────────────────────────
     Rank: 4
     Change: Consolidate OperationClassification to one definition in core; delete the near and exchange duplicates
     Dimension: 2e
     Leverage: Medium
     One-line Rationale: Three divergent definitions (one with a flat shape incompatible with the core contract) risk shape drift across processors
     ────────────────────────────────────────
     Rank: 5
     Change: Change Currency.create() or add Currency.tryCreate() to return Result<Currency, Error>
     Dimension: 3d
     Leverage: Medium
     One-line Rationale: 72 direct call-sites in accounting logic bypass the Result error model; an empty assetSymbol throws and unwinds a Result chain
     ────────────────────────────────────────
     Rank: 6
     Change: Delete TransactionTypeSchema
     Dimension: 2a
     Leverage: Low
     One-line Rationale: Zero consumers; a 16-value enum that duplicates the operation.category / operation.type model is dead API surface
     ────────────────────────────────────────
     Rank: 7
     Change: Delete UniversalBalanceSchema and TransactionWithId
     Dimension: 2b / 2f
     Leverage: Low
     One-line Rationale: Both are exported with zero external consumers
     ────────────────────────────────────────
     Rank: 8
     Change: Move BalanceCommandStatus and DataImportParams out of core
     Dimension: 2d / 2c
     Leverage: Low
     One-line Rationale: CLI/command concerns in the domain boundary; zero or one consumers each
     ────────────────────────────────────────
     Rank: 9
     Change: Split schemas/import-session.ts and move DateSchema/IntegerStringSchema out of money.ts
     Dimension: 6b / 6c
     Leverage: Low
     One-line Rationale: Organizational clarity; no behavioral change
     ────────────────────────────────────────
     Rank: 10
     Change: Export assetId validation predicates from asset-id-utils.ts
     Dimension: 7c
     Leverage: Low
     One-line Rationale: Eliminates the single duplication between schema refinements and the parse utility

     ---
     What V2 keeps

     The following patterns and tools in packages/core are well-chosen and should carry forward unchanged:

     decimal.js for all arithmetic. The configuration in decimal-utils.ts (28-digit precision, ROUND_HALF_UP, high exponent limits) is correct for cryptocurrency amounts. The
     Decimal.set() global configuration at module load is a pragmatic pattern that works for a single-process CLI.

     Zod as the schema and validation layer. The discriminated-union cursors, refinements on movements (netAmount <= grossAmount), and the hasAccountingImpact cross-field validation
     all leverage Zod expressively. The schema-then-infer-type pattern (type Foo = z.infer<typeof FooSchema>) is correct and should remain the canonical approach.

     neverthrow for Result types. The codebase uses ok/err/Result consistently. Only asset-id-utils.ts and type-guard-utils.ts use it directly in core, but the 452 total import lines
      across the monorepo show it is the project's pervasive error model. It is the right choice for a CLI domain with no exception boundaries to catch at.

     The Currency value object. The closed-constructor, static create() pattern, and isFiat() / isStablecoin() / isFiatOrStablecoin() methods are used in 15+ accounting call-sites
     and carry real business logic (the stablecoin set is used for price derivation). The encapsulation is appropriate.

     The assetId string format and builder utilities. The blockchain:<chain>:<ref> / exchange:<exchange>:<code> / fiat:<code> namespace format is a sound, collision-free identity
     scheme. The builder functions with Result returns and the colon-split parser in asset-id-utils.ts are clean and well-tested.

     The FeeMovementSchema comment block. The 50-line prose comment explaining scope × settlement semantics and their downstream accounting implications (lines 117–171 of
     universal-transaction.ts) is one of the most valuable pieces of documentation in the codebase. It encodes institutional knowledge that would otherwise exist only in the heads of
      contributors. Keep it.

     The tsconfig strictness settings. exactOptionalPropertyTypes, noUncheckedIndexedAccess, and verbatimModuleSyntax are the right settings for a financial domain package. They
     prevent a class of type-narrowing bugs that show up in less strict projects.
