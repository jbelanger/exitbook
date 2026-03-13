# exitbook — Project Memory

## Purpose

Cryptocurrency portfolio tracker. Imports from exchange CSVs/APIs and on-chain data, normalizes transactions, verifies balances, computes cost basis.

## Tech Stack

- **Runtime**: Node.js ≥24, pnpm ≥10.6.2, TypeScript 5.x (ESM)
- **Database**: SQLite via Kysely ORM; auto-migrated via `initializeDatabase()`
- **Validation**: Zod schemas (runtime); `exactOptionalPropertyTypes` enabled
- **Error handling**: custom Result (`Result<T, Error>`) and helpers resultDo, resultTry — no throws
- **Logging**: Custom logger via `@exitbook/logger` (`getLogger('component-name')`)
- **Math**: Decimal.js — use `.toFixed()` (not `.toString()`)
- **Testing**: Vitest
- **Linting/Formatting**: ESLint + Prettier + Husky

## Structure

See `structure.md` for details.

## Key Patterns

See `patterns.md` for details.

## Commands

See `suggested_commands.md` for all dev commands.
