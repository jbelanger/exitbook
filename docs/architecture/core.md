V2 Architecture Audit — packages/core

     ---
     3. Pattern Re-evaluation

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
     5. Toolchain & Infrastructure
     ---
     6. File & Code Organization

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
