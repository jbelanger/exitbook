/**
 * CLI Handler Wiring Contracts
 *
 * Every command in features/ follows one of three tiers.
 * This file exists so the pattern is greppable and self-documenting.
 *
 * -- Tier 1: DB-only ---------------------------------------------------
 *   new FooHandler(database)
 *   handler.execute(params) -> Result<T, Error>
 *   No factory. No cleanup. No abort.
 *   Examples: CostBasisHandler, ViewPricesHandler, LinksConfirmHandler
 *
 * -- Tier 2: Infrastructure ---------------------------------------------
 *   createFooHandler(ctx, database, ...) -> handler
 *   Factory registers ctx.onCleanup() -- command files NEVER do.
 *   handler.execute(params) -> Result<T, Error>
 *   handler.abort() -- registered via ctx.onAbort() in TUI mode only.
 *   Reference: import-handler.ts, process-handler.ts
 *
 * -- Tier 3: Inline -----------------------------------------------------
 *   No handler class. Direct service/query call in command file.
 *   For simple commands: clear, accounts view, transactions view, etc.
 */
import type { Result } from 'neverthrow';

/** Shape that Tier 2 handlers conform to. */
export interface InfrastructureHandler<TParams, TResult> {
  execute(params: TParams): Promise<Result<TResult, Error>>;
  abort(): void;
}
