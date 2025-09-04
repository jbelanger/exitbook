# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

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

### Data Architecture

- **Double-entry ledger** for balance-safe accounting
- **CQRS pattern** with focused handlers
- **Drizzle ORM** with PostgreSQL/SQLite
- **Local-first security** approach

## Project Structure

Based on README.md, the intended structure is:

```
exitbook/
├── apps/
│   ├── api/        # REST API (NestJS)
│   └── cli/        # CLI application (NestJS Commander)
├── libs/
│   ├── core/       # Entities, types, validation
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
- **Architecture**: Double-entry ledger system (ready for implementation)
- **Testing**: Vitest (configured)
- **Linting**: ESLint + Prettier (configured)
- **TypeScript**: Dual configuration - ESM base (`tsconfig.json`) and CommonJS NestJS (`tsconfig.nest.json`)

### Current State

- **✅ Complete NestJS monorepo structure** with 2 apps and 6 scoped libraries
- **✅ Full database schema implemented** with 7 tables, indexes, and foreign key constraints
- **✅ Drizzle ORM integration** with migrations and database services
- **✅ Currency management** with automatic seeding of default cryptocurrencies
- **✅ Development tooling** configured (ESLint, Prettier, Husky, Vitest)
- **✅ TypeScript configuration** with proper path mapping for monorepo and CommonJS/ESM compatibility
- **✅ Logger service** implementing NestJS LoggerService interface with Pino, correlation tracking, and audit logging
- **⏳ Core services scaffolding** (ledger, account, import services) - ready for implementation

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

### Testing Strategy

- **Unit Tests**: Vitest for all services and business logic
- **Integration Tests**: Database operations and service interactions
- **E2E Tests**: Complete import workflows

### Current State

This is a **greenfield project** implementing a complete NestJS architecture. **Foundation phase completed** - the project now has:

- Complete database schema with proper relationships and indexes
- Working NestJS monorepo with scoped packages (@exitbook/\*)
- **Granular shared packages**: @exitbook/shared-logger, @exitbook/shared-tsconfig, @exitbook/shared-utils
- Drizzle ORM integration with migrations and seeding
- TypeScript compilation and build system with proper CommonJS output for NestJS compatibility
- Logger service implementing NestJS LoggerService interface
- Ready for core service implementation

The existing codebase on other branches provides domain knowledge and business logic to be reimplemented using the new NestJS architecture patterns.
