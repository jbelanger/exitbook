# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Development Instructions

When working on this project, follow these guidelines:

- **Be 100% honest about your opinion** - Don't be a yes-man; provide genuine technical feedback
- **Ask for clarification when details are missing** - Before proceeding with any task, verify you have complete information; if not, stop and ask questions
- **Challenge problematic patterns** - Question ideas, instructions, or implementations that don't align with project principles or best practices
- **Follow industry best practices** - Structure code according to established software engineering standards
- **Avoid over-engineering from the start** - Keep initial implementations simple while designing for future evolution
- **Think ahead for scalability** - Leave room for growth without premature optimization
- **Apply Martin Fowler's refactoring principles** - Use his methodologies when restructuring or improving code

## Project Overview

**NESTJS PROJECT**: This is the `exitbook` branch - a complete rewrite implementation of ExitBook, a cryptocurrency transaction import and ledger system. This branch starts fresh with a new NestJS-based architecture implementing a double-entry ledger system with Universal Blockchain Provider Architecture.

**Current Status**: Foundation phase completed - NestJS monorepo structure implemented with complete database schema, Drizzle ORM integration, and core services scaffolding based on the architecture outlined in `docs/architecture/future-v2/project-strategy.md`.

## Essential Commands

**Note**: Most commands do not exist yet as this is a greenfield project. Current available commands:

### Development & Build

- `pnpm install` - Install dependencies (requires Node.js >= 22.0.0)
- `pnpm build` - Build all applications (NestJS)
- `pnpm build:api` - Build API application (NestJS)
- `pnpm build:cli` - Build CLI application (NestJS Commander)
- `pnpm start:api` - Start API server (requires database)
- `pnpm start:cli` - Run CLI application
- `pnpm start:dev` - Start in watch mode
- `pnpm start:debug` - Start with debug and watch
- `pnpm start:prod` - Start production build
- `pnpm clean` - Clean all build artifacts
- `pnpm db:generate` - Generate new Drizzle migration
- `pnpm db:migrate` - Run database migrations
- `pnpm db:studio` - Launch Drizzle Studio (database GUI)

### Testing & Quality

- `pnpm test` - Run unit tests (using Vitest)
- `pnpm test:unit` - Run unit tests
- `pnpm test:e2e` - Run end-to-end tests
- `pnpm test:watch` - Run tests in watch mode
- `pnpm test:coverage` - Run tests with coverage
- `pnpm test:ui` - Run tests with UI
- `pnpm typecheck` - Type checking
- `pnpm lint` - ESLint checking
- `pnpm lint:fix` - Auto-fix ESLint issues (including perfectionist sorting)
- `pnpm prettier` - Check formatting
- `pnpm prettier:fix` - Auto-fix formatting issues

### Future Commands (Not Yet Implemented)

The following commands are planned but not yet implemented:

- `pnpm status` - Show system status
- `pnpm import` - Import transactions
- `pnpm verify` - Balance verification
- `pnpm export` - Export transaction data

## Architecture

### Universal Blockchain Provider Architecture

The core innovation is a multi-provider resilience system that eliminates single points of failure:

```
┌─────────────────────────────────────┐
│     Blockchain Adapters             │  ← Existing code (minimal changes)
│  (Bitcoin, Ethereum, Injective)     │
├─────────────────────────────────────┤
│   Universal Provider Manager        │  ← Resilience layer
│  (Failover, Circuit Breaker, Cache) │
├─────────────────────────────────────┤
│      Individual Providers           │  ← Multiple API sources
│ (mempool.space, Etherscan, Alchemy) │
└─────────────────────────────────────┘
```

Key components:

- **Provider Manager**: Central orchestrator with intelligent failover
- **Circuit Breakers**: Protect against cascading failures (3 failures = open, 5 min recovery)
- **Request Caching**: 30-second cache for expensive operations
- **Health Monitoring**: Real-time provider status tracking

## Project Structure

Based on README.md, the intended structure is:

```
exitbook/
├── apps/
│   ├── api/        # REST API (NestJS)
│   └── cli/        # CLI application (NestJS Commander)
├── libs/
│   ├── core/       # Entities, types, validation
│   │   ├── value-objects/     # Domain value objects
│   │   │   └── money/         # Money VO with co-located errors
│   │   │       ├── money.vo.ts
│   │   │       ├── money.errors.ts
│   │   │       └── __tests__/
│   │   │           └── money.vo.test.ts
│   │   ├── aggregates/        # Domain aggregates
│   │   └── services/          # Domain services
│   ├── database/   # Drizzle ORM schema & repos
│   ├── ledger/     # Ledger & account services
│   ├── import/     # Importers & processors
│   ├── providers/  # Provider registry & managers
│   └── shared/     # Multiple focused packages:
│       ├── logger/     # @exitbook/shared-logger
│       ├── tsconfig/   # @exitbook/shared-tsconfig
│       └── utils/      # @exitbook/shared-utils
```

## Implementation Plan

### Node.js Version Requirements

- **Required**: Node.js >= 22.0.0 (according to package.json)
- **Package Manager**: pnpm >= 10.0.0 (packageManager: pnpm@10.6.2)

### Target Technologies

- **Framework**: NestJS (foundation implemented)
- **Database**: Drizzle ORM with PostgreSQL/SQLite support (schema implemented)
- **Architecture**: Double-entry ledger system with CQRS pattern
- **Testing**: Vitest (configured)
- **Linting**: ESLint + Prettier (configured)
- **TypeScript**: Dual configuration - ESM base (`tsconfig.json`) and CommonJS NestJS (`tsconfig.nest.json`)
- **Validation**: Manual validation for core domain, class-validator for NestJS DTOs

### Current State

**Foundation phase completed** - the project now has:

- Complete NestJS monorepo with 2 apps and 6 scoped libraries (@exitbook/\*)
- Full database schema with 7 tables, indexes, and foreign key constraints
- Drizzle ORM integration with migrations and seeding
- Development tooling configured (ESLint, Prettier, Husky, Vitest)
- TypeScript dual configuration (ESM base + CommonJS NestJS)
- Logger service with Pino, correlation tracking, and audit logging
- **Money value object implemented** with comprehensive test coverage
- Ready for core domain services implementation

This is a **greenfield project** - existing codebase on other branches provides domain knowledge to be reimplemented using NestJS architecture patterns.

## TypeScript Configuration Architecture

The monorepo uses a dual TypeScript configuration strategy to handle both ESM and CommonJS compatibility:

### Shared TypeScript Configs (@exitbook/shared-tsconfig)

- **`tsconfig.json`**: Base ESM configuration (NodeNext, for future ESM packages)
- **`tsconfig.nest.json`**: CommonJS configuration for NestJS compatibility (CommonJS, Node resolution)

### Usage Pattern

**For NestJS libraries/apps**: Extend `@exitbook/shared-tsconfig/tsconfig.nest.json`

```json
{
  "extends": "@exitbook/shared-tsconfig/tsconfig.nest.json",
  "compilerOptions": {
    "outDir": "./dist",
    "declaration": true
  }
}
```

**For future ESM packages**: Extend `@exitbook/shared-tsconfig/tsconfig.json`

**Key Rule**: NestJS ecosystem packages should always use the `nest.json` config to ensure CommonJS compatibility and avoid import/require conflicts.

## Development Workflow

### Current Phase: Foundation Completed ✅

1. `pnpm install` - Install dependencies
2. `pnpm build:api` - Build API (✅ working)
3. `pnpm db:generate` - Generate migrations (✅ working)
4. `pnpm typecheck` - Type checking (✅ mostly working)
5. `pnpm lint` - Check linting
6. `pnpm lint:fix` - Auto-fix ESLint issues (including perfectionist sorting)
7. `pnpm prettier:fix` - Fix formatting

### Next Steps (Implementation Plan)

The implementation follows the strategy outlined in `docs/architecture/future-v2/greenfield-project-strategy.md`:

**Phase 1: NestJS Project Setup & Database Foundation**

- Create NestJS monorepo with apps (api, cli) and libs
- Implement complete database schema with Drizzle ORM
- Set up typed configuration and health checks

**Phase 2: Core Services & Domain Logic**

- Implement double-entry ledger services
- Create account and currency management
- Build Universal-to-Ledger transformation services

**Phase 3: Import Services**

- Port existing importer/processor logic as NestJS services
- Implement orchestration services
- Create provider registry system

**Phase 4: Applications**

- Build REST API application
- Create CLI application with Commander
- Add monitoring and metrics

## Domain-Driven Design Principles

### Core DDD Concepts

**Factory Method Pattern (CRITICAL):**

- **Private constructors + static factory methods** - All domain objects use this pattern
- **Invariant protection** - Objects can never exist in invalid states
- **Pattern**: `private constructor()` + `static create()` returning `Result<T, Error>`
- **Example**: Money value object uses `Money.fromDecimal()`, never `new Money()`

**Financial Domain Invariants:**

- **Double-entry ledger**: All transactions must balance (sum of entries = 0)
- **Currency consistency**: Money amounts must match account currencies
- **User ownership**: Users can only access their own financial data
- **Balance integrity**: Asset accounts cannot go negative without explicit liability accounts

**Error Handling Strategy:**

- **Domain layer**: neverthrow `Result<T, Error>` types, never throw exceptions
- **Application layer**: Convert Results to NestJS exceptions at API boundary
- **Explicit error types**: Each business rule has specific error classes
- **Composable**: Use `pipe()` and `Result.flatMap()` for operation chaining

**CQRS Application Layer:**

- **Commands**: Business operations (ImportTransaction, CreateAccount)
- **Queries**: Data retrieval (GetAccountBalance, GetTransactionHistory)
- **Handlers**: Separate command/query handlers using `@nestjs/cqrs`
- **Events**: Domain events for audit trail and cross-aggregate communication
- **Pattern**: Domain aggregates → Command/Query handlers → NestJS controllers

### Validation Strategy

**Dual-layer approach:**

- **Core Domain**: Manual validation for critical financial operations (performance + control)
  - Rigorous financial validation with complex business rules
  - Cryptocurrency precision (8 decimals BTC, 18 ETH)
  - Cross-field validation for currency relationships
- **API Layer**: class-validator for NestJS DTOs and HTTP requests
- **Use neverthrow Result types** - never throw exceptions in domain logic
- **Zod**: Reserved for non-critical validations and API boundaries

**Rationale**: Manual validation provides fine-grained control and performance for financial operations where correctness is critical.

## Folder Organization & Naming Conventions

### Domain-Driven Design Structure

**Value Objects**: Each value object gets its own subdirectory with co-located domain concepts:

```
libs/core/src/value-objects/
├── money/                    # Money domain concepts
│   ├── money.vo.ts          # Money Value Object
│   ├── money.errors.ts      # Money-specific errors
│   └── __tests__/           # Tests separated from source
│       └── money.vo.test.ts # Vitest unit tests
├── currency/                # Currency domain (future)
└── account-id/              # AccountId domain (future)
```

**Aggregates**: Similar structure for domain aggregates:

```
libs/core/src/aggregates/
├── user/
│   ├── user.aggregate.ts
│   ├── user.errors.ts
│   ├── account.entity.ts
│   └── __tests__/
│       ├── user.aggregate.test.ts
│       └── account.entity.test.ts
```

### Testing & File Organization

**Testing Strategy:**

- **Unit Tests**: Vitest for all services and business logic
- **Integration Tests**: Database operations and service interactions
- **E2E Tests**: Complete import workflows
- **Test Organization**: `__tests__/` folders with `.test.ts` files
- **NestJS integration**: Use `@nestjs/testing` with Vitest for dependency injection

**File Naming:**

- **Value Objects**: `*.vo.ts` (e.g., `money.vo.ts`)
- **Entities**: `*.entity.ts` (e.g., `account.entity.ts`)
- **Aggregates**: `*.aggregate.ts` (e.g., `user.aggregate.ts`)
- **Errors**: `*.errors.ts` (e.g., `money.errors.ts`)
- **Tests**: `*.test.ts` (e.g., `money.vo.test.ts`)
