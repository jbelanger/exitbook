V2 Architecture Audit: CLI Links Command

     Scope

     This audit focuses on the links command implementation in apps/cli/src/features/links/ and apps/cli/src/ui/links/, evaluating what should
     change if this feature were rebuilt from scratch with no backward-compatibility constraints.

     ────────────────────────────────────────

     1. DEPENDENCY AUDIT

     ────────────────────────────────────────

     1.2 Manual JSON Output vs. Structured CLI Framework (oclif)

     What exists:
     - Hand-rolled OutputManager class in /apps/cli/src/features/shared/output.ts (187 lines)
     - Manual JSON response construction via createSuccessResponse() / createErrorResponse()
     - Dual-mode logic (isJsonMode() / isTextMode()) scattered across 7 command files
     - Custom error code mapping (exitCodeToErrorCode())
     - Deprecation notice on line 16: "For Ink-based commands, use displayCliError from cli-error.ts"

     Why it's a problem:
     - Every command implements mode-switching logic independently (45+ conditional checks across links commands)
     - JSON schema not validated or versioned
     - No standard for error response format across commands
     - OutputManager serves two masters: legacy non-Ink commands and Ink commands (causing confusion per deprecation note)
     - Manual process.exit() calls mixed with throw patterns

     What V2 should do:
     Use oclif as CLI framework. Provides:
     - Built-in --json flag handling
     - Standardized error handling with typed exit codes
     - Command lifecycle hooks (prerun, postrun)
     - Auto-generated help text
     - Plugin system for extensibility

     Needs coverage:
     ┌────────────────────────────┬─────────────────────────┬────────────────────────────────────────┐
     │     Current capability     │ Covered by replacement? │                 Notes                  │
     ├────────────────────────────┼─────────────────────────┼────────────────────────────────────────┤
     │ JSON/text mode switching   │ Yes                     │ oclif's --json flag                    │
     ├────────────────────────────┼─────────────────────────┼────────────────────────────────────────┤
     │ Spinner integration        │ Yes                     │ oclif-spinner plugin                   │
     ├────────────────────────────┼─────────────────────────┼────────────────────────────────────────┤
     │ Error formatting           │ Yes                     │ Built-in error handling                │
     ├────────────────────────────┼─────────────────────────┼────────────────────────────────────────┤
     │ Exit code mapping          │ Yes                     │ Standard error codes                   │
     ├────────────────────────────┼─────────────────────────┼────────────────────────────────────────┤
     │ @clack/prompts integration │ Partial                 │ Would need adapter                     │
     ├────────────────────────────┼─────────────────────────┼────────────────────────────────────────┤
     │ Ink TUI rendering          │ Yes                     │ Framework-agnostic                     │
     ├────────────────────────────┼─────────────────────────┼────────────────────────────────────────┤
     │ Logger configuration       │ No                      │ Custom concern, but simpler with hooks │
     └────────────────────────────┴─────────────────────────┴────────────────────────────────────────┘
     Surface: ~15 files across features/, ~800 lines affected

     Leverage: High
     - Eliminates 200+ lines of mode-switching boilerplate
     - Standardizes error handling across all commands
     - Reduces testing surface (oclif handles framework concerns)

     ────────────────────────────────────────

     1.4 Commander.js vs. oclif

     What exists:
     - Commander.js for CLI parsing (line 8 in links.ts)
     - Manual option parsing with Commander's .option() API
     - Manual validation via Zod schemas at CLI boundary (33 occurrences in schemas.ts)

     Why it's a problem:
     - Commander validation is declarative but Zod validation is imperative (duplication)
     - No typed options without manual type assertions
     - Help text manually constructed (lines 79-110 in links-view.ts)
     - Subcommands registered manually via functions (lines 20-27 in links.ts)

     What V2 should do:
     Use oclif (mentioned in 1.2). Provides:
     - TypeScript-first with full type inference
     - Declarative command structure
     - Automatic help generation
     - Built-in --json support
     - Better testing utilities

     Needs coverage:
     ┌─────────────────────┬─────────────────────────┬───────────────────────────────────────────┐
     │ Current capability  │ Covered by replacement? │                   Notes                   │
     ├─────────────────────┼─────────────────────────┼───────────────────────────────────────────┤
     │ Subcommand nesting  │ Yes                     │ Native to oclif                           │
     ├─────────────────────┼─────────────────────────┼───────────────────────────────────────────┤
     │ Option parsing      │ Yes                     │ With TypeScript types                     │
     ├─────────────────────┼─────────────────────────┼───────────────────────────────────────────┤
     │ Zod validation      │ Partial                 │ Would still use Zod for domain validation │
     ├─────────────────────┼─────────────────────────┼───────────────────────────────────────────┤
     │ Custom help text    │ Yes                     │ Markdown-based help                       │
     ├─────────────────────┼─────────────────────────┼───────────────────────────────────────────┤
     │ --json flag         │ Yes                     │ First-class support                       │
     ├─────────────────────┼─────────────────────────┼───────────────────────────────────────────┤
     │ Interactive prompts │ No                      │ Separate concern                          │
     └─────────────────────┴─────────────────────────┴───────────────────────────────────────────┘
     Surface: ~6 files (command registration), ~200 lines

     Leverage: High (when combined with 1.2)
     - TypeScript safety eliminates runtime type errors
     - Reduces boilerplate by 40%

     ────────────────────────────────────────

     2. ARCHITECTURAL SEAMS

     2.2 Handler Pattern Boilerplate

     What exists:
     - Each operation has a Handler class (LinksRunHandler, LinksConfirmHandler, LinksRejectHandler)
     - Handlers initialized with repository dependencies (constructor injection)
     - Handler.execute() always returns Result<T, Error>
     - 90 lines of setup boilerplate per handler (repository initialization, error handling)

     Why it's a problem:
     - Handler classes add indirection without providing unique value
     - Constructor DI forces manual wiring in every command file (lines 167-171 in links-run.ts)
     - Testing requires mocking constructor parameters
     - Each handler is only called once (no reuse justifying class overhead)

     What V2 should do:
     Replace Handler classes with simple async functions that accept dependencies as parameters:

     // Instead of:
     const handler = new LinksRunHandler(txRepo, linkRepo, overrideStore);
     const result = await handler.execute(params);

     // Use:
     const result = await runLinks(params, { txRepo, linkRepo, overrideStore });

     Needs coverage:
     ┌──────────────────────┬─────────────────────────┬─────────────────────────────────┐
     │  Current capability  │ Covered by replacement? │              Notes              │
     ├──────────────────────┼─────────────────────────┼─────────────────────────────────┤
     │ Dependency injection │ Yes                     │ Function parameters             │
     ├──────────────────────┼─────────────────────────┼─────────────────────────────────┤
     │ Result type return   │ Yes                     │ Same return signature           │
     ├──────────────────────┼─────────────────────────┼─────────────────────────────────┤
     │ Error handling       │ Yes                     │ Same error propagation          │
     ├──────────────────────┼─────────────────────────┼─────────────────────────────────┤
     │ State encapsulation  │ N/A                     │ No mutable state to encapsulate │
     ├──────────────────────┼─────────────────────────┼─────────────────────────────────┤
     │ Logging              │ Yes                     │ Accept logger as dependency     │
     └──────────────────────┴─────────────────────────┴─────────────────────────────────┘
     Surface: 3 handler files, ~500 lines

     Leverage: Medium
     - Reduces boilerplate by 30%
     - Simplifies testing (no constructor mocking)
     - Classes appropriate only if handlers had shared state (they don't)



     4. DATA LAYER

     4.1 Kysely Repository Pattern Appropriateness

     What exists:
     - TransactionRepository and TransactionLinkRepository used as dependency-injected classes
     - Simple CRUD operations: findById(), findAll(), createBulk(), deleteAll()
     - No complex queries or joins in links commands
     - Repository instances created per-command (lines 167-171 in links-run.ts)

     Why it's a problem:
     - Repository pattern adds indirection for simple queries
     - No query composition or reuse across commands
     - Kysely's type-safe query builder used only for simple selects
     - Creating repositories per-command creates overhead

     What V2 should do:
     For this feature's simple query patterns, use Kysely directly without repository wrapper:

     // Instead of repository indirection:
     const result = await linkRepo.findAll('suggested');

     // Use Kysely directly:
     const links = await db
       .selectFrom('transaction_links')
       .where('status', '=', 'suggested')
       .selectAll()
       .execute();

     Needs coverage:
     ┌─────────────────────┬─────────────────────────┬────────────────────────────────┐
     │ Current capability  │ Covered by replacement? │             Notes              │
     ├─────────────────────┼─────────────────────────┼────────────────────────────────┤
     │ findById()          │ Yes                     │ Direct Kysely query            │
     ├─────────────────────┼─────────────────────────┼────────────────────────────────┤
     │ findAll()           │ Yes                     │ Direct Kysely query            │
     ├─────────────────────┼─────────────────────────┼────────────────────────────────┤
     │ createBulk()        │ Yes                     │ Kysely insertInto() with array │
     ├─────────────────────┼─────────────────────────┼────────────────────────────────┤
     │ deleteAll()         │ Yes                     │ Kysely deleteFrom()            │
     ├─────────────────────┼─────────────────────────┼────────────────────────────────┤
     │ Error handling      │ Yes                     │ Try/catch around queries       │
     ├─────────────────────┼─────────────────────────┼────────────────────────────────┤
     │ Type safety         │ Yes                     │ Kysely's type inference        │
     ├─────────────────────┼─────────────────────────┼────────────────────────────────┤
     │ Transaction support │ Yes                     │ Kysely's transaction API       │
     └─────────────────────┴─────────────────────────┴────────────────────────────────┘
     Surface: 3 handler files, ~80 lines

     Leverage: Low
     - Reduces abstraction but doesn't eliminate complexity
     - Repository pattern valuable if queries become complex
     - Current simplicity suggests over-engineering

     ────────────────────────────────────────


     7. ERROR HANDLING & OBSERVABILITY

     7.2 Logger Configuration Scattered Across Commands

     What exists:
     - configureLogger() called in 4 different command files (lines 159-163 in links-run.ts, lines 152-156 in links-view.ts)
     - Different configurations per command (spinner mode, JSON mode, file mode)
     - Logger reset via resetLoggerContext() in 6 places
     - No centralized logging policy

     Why it's a problem:
     - Logger configuration duplicated across commands
     - Easy to forget resetLoggerContext() (memory leak risk)
     - Mode-specific configurations scattered

     What V2 should do:
     Centralize logger configuration in command lifecycle hooks (if using oclif) or middleware:

     // Command base class or middleware
     beforeEach((context) => {
       configureLogger({
         mode: context.flags.json ? 'json' : 'text',
         spinner: context.spinner,
         verbose: context.flags.verbose,
       });
     });

     afterEach(() => {
       resetLoggerContext();
     });

     Surface: 8 command files, ~50 lines

     Leverage: Medium
     - Eliminates duplication
     - Reduces risk of misconfiguration
     - Central policy easier to evolve
