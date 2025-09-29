## Recommended Monorepo Structure: A Refined Blueprint

This document outlines the recommended monorepo structure for the `crypto-portfolio-platform`, designed to align precisely with the current codebase and the Universal Blockchain Provider & ETL Architecture. It emphasizes clear domain separation, explicit package dependencies, and an extensible foundation for future growth.

```
crypto-portfolio-platform/
├── apps/
│   ├── cli/                    # CLI tool for import, status, verify, export (primary focus)
│   ├── api/                    # Main API server (future/conceptual)
│   └── web/                    # Portfolio frontend (future/conceptual)
├── packages/
│   ├── core/                   # Core domain types, entities, and universal schemas
│   │   ├── src/
│   │   │   ├── types.ts              # Universal entities (Money, TransactionType, IUniversalAdapter, etc.)
│   │   │   └── validation/           # Zod schemas for universal data validation
│   │   │       └── universal-schemas.ts
│   │   └── package.json
│   │   └── tsconfig.json
│   ├── data/                   # Data access layer (persistence, repositories, services)
│   │   ├── src/
│   │   │   ├── storage/              # Database initialization & raw SQLite operations
│   │   │   │   └── database.ts
│   │   │   ├── repositories/         # High-level data access (Balance, ImportSession, RawData, Wallet)
│   │   │   │   ├── balance-repository.ts
│   │   │   │   ├── import-session-repository.ts
│   │   │   │   ├── raw-data-repository.ts
│   │   │   │   ├── wallet-repository.ts
│   │   │   │   └── index.ts
│   │   │   ├── services/             # Data-specific business logic (BalanceCalculation, TransactionLinking)
│   │   │   │   ├── balance-calculation-service.ts
│   │   │   │   ├── balance-service.ts
│   │   │   │   ├── transaction-linking-service.ts
│   │   │   │   └── wallet-service.ts
│   │   │   └── types/                # Database schema types, raw data types, import session types
│   │   │       ├── balance-types.ts      # NOTE: These are duplicated from @exitbook/balance
│   │   │       ├── database-types.ts
│   │   │       └── data-types.ts
│   │   └── package.json
│   │   └── tsconfig.json
│   ├── balance/                # Balance verification and management services
│   │   ├── src/
│   │   │   ├── services/             # Core balance verification logic
│   │   │   │   └── balance-verifier.ts
│   │   │   └── types/                # Balance verification types and interfaces
│   │   │       └── balance-types.ts
│   │   └── package.json
│   │   └── tsconfig.json
│   ├── import/                 # Cryptocurrency transaction ETL pipeline (Extract, Transform, Load)
│   │   ├── config/                   # Configuration files for providers
│   │   │   └── blockchain-explorers.json
│   │   ├── src/
│   │   │   ├── blockchains/          # Blockchain-specific API clients, mappers, importers, processors
│   │   │   │   ├── avalanche/            # Avalanche (Snowtrace)
│   │   │   │   │   ├── api/              # API clients (e.g., SnowtraceApiClient)
│   │   │   │   │   ├── mappers/          # Raw data mappers (e.g., SnowtraceMapper)
│   │   │   │   │   ├── transaction-importer.ts
│   │   │   │   │   ├── transaction-processor.ts
│   │   │   │   │   ├── schemas.ts
│   │   │   │   │   └── types.ts
│   │   │   │   ├── bitcoin/              # Bitcoin (Mempool, Blockstream, BlockCypher, Tatum)
│   │   │   │   │   ├── api/              # API clients (e.g., MempoolSpaceApiClient, BlockstreamApiClient)
│   │   │   │   │   ├── mappers/          # Raw data mappers (e.g., MempoolSpaceMapper)
│   │   │   │   │   ├── transaction-importer.ts
│   │   │   │   │   ├── transaction-processor.ts
│   │   │   │   │   ├── schemas.ts
│   │   │   │   │   └── types.ts
│   │   │   │   ├── ethereum/             # Ethereum (Alchemy, Moralis)
│   │   │   │   │   ├── api/              # API clients (e.g., AlchemyApiClient, MoralisApiClient)
│   │   │   │   │   ├── mappers/          # Raw data mappers (e.g., AlchemyMapper, MoralisMapper)
│   │   │   │   │   ├── transaction-importer.ts
│   │   │   │   │   ├── transaction-processor.ts
│   │   │   │   │   ├── schemas.ts
│   │   │   │   │   └── types.ts
│   │   │   │   ├── injective/            # Injective (Explorer, LCD)
│   │   │   │   │   ├── api/              # API clients (e.g., InjectiveExplorerApiClient, InjectiveLCDApiClient)
│   │   │   │   │   ├── mappers/          # Raw data mappers (e.g., InjectiveExplorerMapper)
│   │   │   │   │   ├── transaction-importer.ts
│   │   │   │   │   ├── transaction-processor.ts
│   │   │   │   │   ├── schemas.ts
│   │   │   │   │   └── types.ts
│   │   │   │   ├── polkadot/             # Polkadot (Subscan, Taostats)
│   │   │   │   │   ├── api/              # API clients (e.g., PolkadotApiClient, BittensorApiClient)
│   │   │   │   │   ├── mappers/          # Raw data mappers (e.g., SubstrateTransactionMapper)
│   │   │   │   │   ├── bittensor-transaction-importer.ts # Specific importer for Bittensor
│   │   │   │   │   ├── transaction-importer.ts
│   │   │   │   │   ├── transaction-processor.ts
│   │   │   │   │   ├── schemas.ts
│   │   │   │   │   └── types.ts
│   │   │   │   ├── solana/               # Solana (Helius, Solscan, SolanaRPC)
│   │   │   │   │   ├── clients/          # API clients (e.g., HeliusApiClient, SolscanApiClient)
│   │   │   │   │   ├── mappers/          # Raw data mappers (e.g., HeliusTransactionMapper)
│   │   │   │   │   ├── transaction-importer.ts
│   │   │   │   │   ├── transaction-processor.ts
│   │   │   │   │   ├── schemas.ts
│   │   │   │   │   └── types.ts
│   │   │   │   └── shared/               # Common blockchain types, provider manager, registry
│   │   │   │       ├── api/              # Base classes for API clients (e.g., TatumApiClientBase)
│   │   │   │       ├── blockchain-provider-manager.ts
│   │   │   │       ├── mappers/          # Base raw data mapper (BaseRawDataMapper)
│   │   │   │       ├── registry/         # Provider registration decorators & registry
│   │   │   │       └── types.ts
│   │   │   ├── exchanges/            # Exchange-specific adapters, importers, processors
│   │   │   │   ├── coinbase/             # Coinbase (CCXT adapter, API client, processor)
│   │   │   │   ├── kucoin/               # KuCoin (CSV adapter, processor)
│   │   │   │   ├── kraken/               # Kraken (CSV adapter, processor)
│   │   │   │   ├── ledgerlive/           # Ledger Live (CSV adapter, processor)
│   │   │   │   └── shared/               # Base adapter, CCXT types, error handler
│   │   │   │       ├── base-ccxt-adapter.ts
│   │   │   │       ├── base-csv-adapter.ts
│   │   │   │       ├── ccxt-types.ts
│   │   │   │       └── exchange-error-handler.ts
│   │   │   ├── shared/               # Common importer & processor interfaces, utilities
│   │   │   │   ├── adapters/             # Base adapter (BaseAdapter)
│   │   │   │   ├── importers/            # Base importer, importer factory
│   │   │   │   ├── processors/           # Base processor, processor factory, interfaces
│   │   │   │   ├── test-utils/           # Mock HTTP client for testing
│   │   │   │   └── types/                # Import results, exchange credentials, transaction note types
│   │   │   └── services/             # High-level ETL orchestration
│   │   │       └── ingestion-service.ts
│   │   └── package.json
│   │   └── tsconfig.json
│   ├── portfolio/              # (Future/Conceptual) Portfolio calculation and analytics
│   │   ├── src/                # (Future content)
│   │   └── package.json
│   │   └── tsconfig.json
│   ├── shared-logger/          # Structured logging package
│   │   ├── src/
│   │   │   └── logger.ts             # Logger implementation
│   │   └── package.json
│   │   └── tsconfig.json
│   ├── shared-utils/           # Common utilities and helper functions
│   │   ├── src/
│   │   │   ├── address-utils.ts      # Address masking, validation
│   │   │   ├── config.ts             # Config loading, DB initialization
│   │   │   ├── decimal-utils.ts      # Decimal.js utilities
│   │   │   ├── http-client.ts        # Centralized HTTP client with retry/rate-limit
│   │   │   ├── rate-limiter.ts       # Token bucket rate limiter
│   │   │   └── type-guards.ts        # Type-checking utilities
│   │   └── package.json
│   │   └── tsconfig.json
│   └── ui/                     # (Future/Conceptual) Shared UI components
│       ├── src/                # (Future content)
│       └── package.json
│       └── tsconfig.json
├── tools/
│   ├── eslint-config/          # Shared ESLint configuration
│   │   └── package.json
│   │   └── index.js
│   ├── tsconfig/               # Shared TypeScript configurations
│   │   └── package.json
│   │   └── tsconfig.json
│   └── scripts/                # (Future/Conceptual) Build & deployment scripts
└── docs/
    ├── api/                    # API documentation
    ├── architecture/           # Architecture documentation
    │   └── universal-blockchain-provider-architecture.md
    └── deployment/             # Deployment guides
```

## Key Domain Separation Strategy

This section details the primary packages and their responsibilities, highlighting the refined boundaries and internal structures.

### 1. **Core Domain (`@exitbook/core`)**

This package defines the universal language of the entire platform. It contains foundational types and interfaces that are agnostic to specific implementations, ensuring consistency across all domains.

- **Content:**
  - `types.ts`: Universal `Money` type (using `Decimal.js`), `TransactionType`, `TransactionStatus`, `IUniversalAdapter` (interface for all data sources), `UniversalTransaction`, `UniversalBalance`, `UniversalAdapterConfig`.
  - `validation/universal-schemas.ts`: Zod schemas for validating universal transaction and balance objects, critical for data integrity throughout the ETL pipeline.
- **Dependency Flow:** This package has **no runtime dependencies** on other internal packages. Other packages depend on `@exitbook/core` to consume its types and interfaces.

### 2. **Data Persistence (`@exitbook/data`)**

The data access layer, responsible for interacting with the SQLite database. It provides structured ways to store and retrieve application data.

- **Content:**
  - `storage/database.ts`: Handles direct SQLite operations, schema creation, migrations, and low-level queries.
  - `repositories/`: High-level abstractions for common data operations (e.g., `BalanceRepository`, `ImportSessionRepository`, `RawDataRepository`, `WalletRepository`). These encapsulate specific queries and table interactions.
  - `services/`: Data-specific business logic built on top of repositories (e.g., `BalanceCalculationService`, `TransactionLinkingService`, `WalletService`).
  - `types/`: Database row structures and interface definitions for stored entities.
- **Dependency Flow:** Depends on `@exitbook/core` for universal types and `decimal.js` for precision. It has `peerDependencies` on `@exitbook/balance`, `@exitbook/shared-logger`, `@exitbook/shared-utils` to resolve types and utilities.

### 3. **Balance Verification (`@exitbook/balance`)**

Dedicated to the logic of verifying calculated balances against live balances or historical snapshots.

- **Content:**
  - `services/balance-verifier.ts`: Contains the core logic for comparing balances, generating reports, and checking verification history. It uses `@exitbook/data`'s `BalanceService` to interact with stored data.
  - `types/balance-types.ts`: Interface definitions for balance comparisons, verification results, and snapshots.
- **Dependency Flow:** Depends on `@exitbook/core` and `@exitbook/data` (specifically `BalanceService` from `@exitbook/data`).

### 4. **Transaction ETL Pipeline (`@exitbook/import`)**

This is the most complex domain, encompassing the entire ETL process for fetching raw transaction data from various external sources (exchanges, blockchains) and transforming it into a canonical format.

- **Core Services (`src/services/`):**
  - `ingestion-service.ts`: The orchestrator of the entire ETL pipeline. It manages the two-stage process: `importFromSource` (extraction) and `processAndStore` (transformation/loading). It handles import session tracking, raw data storage, and error management.
- **Blockchain-Centric Structure (`src/blockchains/`):**
  Each blockchain is a self-contained feature module with a consistent internal structure:

  ```
  src/blockchains/bitcoin/
  ├── api/                      # Raw API client implementations (e.g., MempoolSpaceApiClient)
  ├── mappers/                  # Raw data mappers (e.g., MempoolSpaceMapper)
  ├── transaction-importer.ts   # High-level importer for Bitcoin
  ├── transaction-processor.ts  # High-level processor for Bitcoin
  ├── schemas.ts                # Zod schemas for raw API responses
  ├── types.ts                  # Raw API response types
  └── utils.ts                  # Bitcoin-specific utilities (xpub derivation, address validation)
  ```

  - **API Clients (`api/`):** Implementations of `BaseRegistryProvider` that handle direct communication with a specific blockchain API (e.g., Mempool.space, Alchemy). They are registered via `@RegisterApiClient` decorators.
  - **Importers (`transaction-importer.ts`):** Extend `BaseImporter`. Their role is to interact with the `BlockchainProviderManager` to fetch _raw data_ from the configured `API Clients`.
  - **Mappers (`mappers/`):** Extend `BaseRawDataMapper`. They contain the _provider-specific_ logic to validate and transform raw API responses into an intermediate `UniversalBlockchainTransaction` format. They are registered via `@RegisterTransactionMapper` decorators.
  - **Processors (`transaction-processor.ts`):** Extend `BaseProcessor`. Their role is to load raw data, dispatch to the correct `Mapper`, and then apply _blockchain-specific_ business logic (e.g., classify transaction types based on wallet ownership) to produce the final `UniversalTransaction`.

- **Exchange-Centric Structure (`src/exchanges/`):**
  Similar to `blockchains/`, but tailored for exchanges (CCXT, CSV, native APIs).

  ```
  src/exchanges/coinbase/
  ├── ccxt-adapter.ts           # CCXT-based adapter for Coinbase
  ├── importer.ts               # Importer for Coinbase
  ├── processor.ts              # Processor for Coinbase
  ├── schemas.ts                # Zod schemas for Coinbase raw data
  └── types.ts                  # Raw API response types
  ```

  - This section also contains `BaseCCXTAdapter`, `BaseCsvAdapter`, and `ExchangeErrorHandler` for common exchange logic.

- **Shared Infrastructure (`src/shared/`):**
  - `blockchain-provider-manager.ts`: The core resilience engine.
  - `registry/`: Contains `ProviderRegistry` (auto-discovery) and decorators (`@RegisterApiClient`, `@RegisterTransactionMapper`).
  - `importers/`: `BaseImporter` and `ImporterFactory`.
  - `processors/`: `BaseProcessor`, `ProcessorFactory`, `BaseRawDataMapper`, `TransactionMapperFactory`.
  - `types/`: Common interfaces for importers and processors.
- **Configuration (`config/blockchain-explorers.json`):** Defines which API clients are `defaultEnabled` for each blockchain and allows for `overrides` (priority, rate limits, `enabled` status) for specific providers.
- **Dependency Flow:** This package depends heavily on `@exitbook/core`, `@exitbook/data`, `@exitbook/shared-logger`, and `@exitbook/shared-utils`.

### 5. **Portfolio Domain (`@exitbook/portfolio`)** - (Future/Conceptual)

Currently, this package exists as a placeholder. In a future iteration, it would house all logic related to calculating, analyzing, and reporting on a user's cryptocurrency portfolio.

- **Content (Future):**
  - `domain/`: Core portfolio entities and value objects.
  - `services/`: Business logic for portfolio calculations, performance tracking, risk analysis.
  - `queries/`: Optimized data retrieval specific to portfolio views.
  - `reports/`: Functionality for generating various financial reports.
- **Dependency Flow (Future):** Would depend on `@exitbook/core` (for `Transaction`, `Money`), `@exitbook/data` (for accessing stored transactions/balances), `@exitbook/shared-logger`, `@exitbook/shared-utils`.

### 6. **Shared Logger (`@exitbook/shared-logger`)**

Provides a consistent and structured logging interface across the entire monorepo.

- **Content:**
  - `logger.ts`: Centralized `getLogger` function for uniform log output.
- **Dependency Flow:** Only depends on `node:util` (built-in). All other packages depend on `shared-logger` for logging.

### 7. **Shared Utilities (`@exitbook/shared-utils`)**

A collection of general-purpose utility functions and helper classes.

- **Content:**
  - `decimal-utils.ts`: Wraps `decimal.js` for precise financial calculations and conversions.
  - `http-client.ts`: A centralized HTTP client with built-in retry, timeout, and rate-limiting.
  - `rate-limiter.ts`: Generic token-bucket rate limiter implementation.
  - `config.ts`: Utilities for loading configuration files (e.g., `blockchain-explorers.json`) and initializing the database.
  - `type-guards.ts`: Helper functions for safe type checking.
  - `address-utils.ts`: Utilities for address formatting and masking.
- **Dependency Flow:** Depends on `@exitbook/core` (for `RateLimitConfig`, `ServiceError`), `decimal.js`, and `sqlite3`. Other packages depend on `shared-utils` for common helpers.

---

## Application Layer Structure

### **CLI Tool (`apps/cli`)**

The primary user-facing application for interacting with the platform's core functionality.

- **Content:**
  - `index.ts`: The main entry point, using `commander.js` to define commands (`import`, `verify`, `status`, `export`). It directly instantiates and uses services from `@exitbook/import`, `@exitbook/balance`, `@exitbook/data`.
- **Dependency Flow:** Directly depends on `@exitbook/balance`, `@exitbook/core`, `@exitbook/data`, `@exitbook/import`, `@exitbook/shared-logger`, `@exitbook/shared-utils`.

### **API Server (`apps/api`)** - (Future/Conceptual)

This application would expose the platform's capabilities via a RESTful API.

- **Content (Future):**
  - NestJS modules for `ImportModule`, `PortfolioModule`, `AuthModule`, etc., exposing endpoints that call services from `@exitbook/import`, `@exitbook/portfolio`, `@exitbook/data`.
- **Dependency Flow (Future):** Would depend on `@exitbook/import`, `@exitbook/portfolio`, `@exitbook/data`, `@exitbook/shared-logger`, `@exitbook/shared-utils`, `@exitbook/core`.

### **Web Frontend (`apps/web`)** - (Future/Conceptual)

This application would provide a rich, interactive user interface for managing portfolios.

- **Content (Future):**
  - React/Next.js components and pages organized by feature (e.g., `features/import/`, `features/portfolio/`).
- **Dependency Flow (Future):** Would primarily depend on `@exitbook/core` (for types) and potentially a future `@exitbook/ui` package for shared UI components, consuming data via the `apps/api` endpoints.

---

## Package Dependencies Strategy

### **Dependency Flow (Explicit)**

```mermaid
graph TD
    A[apps/cli] --> B[@exitbook/balance]
    A --> C[@exitbook/core]
    A --> D[@exitbook/data]
    A --> E[@exitbook/import]
    A --> F[@exitbook/shared-logger]
    A --> G[@exitbook/shared-utils]

    E --> C
    E --> D
    E --> F
    E --> G
    subgraph import_internal [packages/import internal]
        E_BC[blockchains/*] --> C
        E_BC --> F
        E_BC --> G
        E_EX[exchanges/*] --> C
        E_EX --> F
        E_EX --> G
        E_SH[shared/*] --> C
        E_SH --> F
        E_SH --> G
    end

    D --> C
    D --> B_peer(B (peer))
    D --> F_peer(F (peer))
    D --> G_peer(G (peer))

    B --> C
    B --> D

    F --> Node_Util(Node:util)

    G --> C
    G --> F
    G --> DecimalJS(decimal.js)
    G --> SQLite3(sqlite3)

    Portfolio[@exitbook/portfolio (Future)] --> C
    Portfolio --> D
    Portfolio --> F
    Portfolio --> G

    UI[@exitbook/ui (Future)] --> C
```

### **Internal Import Structure (Guiding Principles)**

- **Public API (index.ts):** Each package's `src/index.ts` should be its public API, exporting only what other packages need.
  - `import { BalanceVerifier } from '@exitbook/balance';` (Good)
  - `import { MempoolSpaceApiClient } from '@exitbook/import/src/blockchains/bitcoin/api/MempoolSpaceApiClient.ts';` (Bad - deep import, breaks encapsulation)
- **Internal Cohesion:** Modules within a package should be self-contained and expose minimal interfaces to other modules within the same package.

### **`package.json` Workspace Structure**

The monorepo leverages `pnpm` workspaces for efficient dependency management.

```json
{
  "name": "crypto-portfolio-platform",
  "version": "0.1.0",
  "private": true,
  "workspaces": ["apps/*", "packages/*", "tools/*"],
  "scripts": {
    "build": "pnpm -r build",
    "clean": "pnpm -r clean",
    "test": "pnpm -r test",
    "lint": "pnpm -r lint",
    "prettier": "pnpm -r prettier",
    "prettier:fix": "pnpm -r prettier:fix",
    "typecheck": "pnpm -r typecheck",
    "cli:dev": "pnpm --filter cli dev",
    "cli:import": "pnpm --filter cli import",
    "cli:verify": "pnpm --filter cli verify",
    "cli:status": "pnpm --filter cli status"
    // ... future app scripts
  }
}
```

## Inter-Domain Communication (Conceptual)

While direct event bus implementation wasn't explicitly present in the provided code, the clear domain separation lends itself well to an event-driven architecture for loose coupling.

### **Event-Driven Patterns**

- **Events:** Define immutable event contracts in `@exitbook/core` (or a dedicated `events` package).
  ```typescript
  // packages/core/events/domain-events.ts (Conceptual)
  export interface TransactionImportCompleted {
    type: 'TransactionImportCompleted';
    importSessionId: number;
    sourceId: string;
    transactionCount: number;
    timestamp: number;
  }
  ```
- **Handlers:** Domains listen for relevant events and react.
  ```typescript
  // packages/portfolio/src/event-handlers/import-completed.handler.ts (Conceptual)
  // Listens for TransactionImportCompleted to trigger portfolio recalculations.
  ```

### **Shared Database with Domain Boundaries**

The single SQLite database serves as the persistent store, but tables logically belong to specific domains.

```sql
-- Import Domain Tables (Managed by @exitbook/data via @exitbook/import)
import_sessions             # Tracks ETL sessions
external_transaction_data   # Raw data fetched from external sources
transactions                # Final, universal transactions after processing

-- Balance Domain Tables (Managed by @exitbook/data via @exitbook/balance)
balance_snapshots           # Point-in-time snapshots for comparison
balance_verifications       # Historical verification results

-- Wallet Domain Tables (Managed by @exitbook/data)
wallet_addresses            # User-managed wallet addresses for linking transactions

-- Other Shared Tables (Conceptual)
users                       # User authentication and profile data
exchange_info               # Configuration details for exchanges
```

## Development Workflow

### **Independent Package Development**

Developers can focus on specific packages without interference.

```bash
# Work on the 'import' package
pnpm --filter @exitbook/import dev
pnpm --filter @exitbook/import test

# Work on the 'data' package
pnpm --filter @exitbook/data dev
pnpm --filter @exitbook/data test
```

### **Integrated Application Development**

CLI development involves running the CLI app, which pulls in its dependent packages.

```bash
# Run the CLI in development mode
pnpm cli:dev
# Execute a specific CLI command
pnpm cli:import --exchange kraken --csv-dir ./data/kraken
```

## Benefits of This Structure

### **Monorepo & Domain-Level Benefits**

1.  **Clear Domain Boundaries:** Import, Data, Balance, and Core are distinct, reducing cognitive load and improving code organization.
2.  **Code Reusability:** Core logic and utilities are shared via internal packages, eliminating duplication.
3.  **Independent Evolution:** Each package can be developed, tested, and versioned (internally) with minimal impact on others.
4.  **Testing Isolation:** Focused testing strategies per package, leading to faster and more reliable test suites.
5.  **Team Organization:** Facilitates parallel development by different teams or individuals.
6.  **Consistency:** Shared `eslint-config` and `tsconfig` enforce coding standards and best practices across the entire monorepo.

### **Blockchain-Centric & ETL Benefits**

7.  **Feature Cohesion:** All blockchain-related logic (API clients, mappers, importers, processors, schemas, types, utils) for a given chain lives together in `packages/import/src/blockchains/<chain-name>/`.
8.  **Resilience & Failover:** The `BlockchainProviderManager` centralizes and automates the multi-provider, circuit-breaker, and caching logic, making all import operations robust by default.
9.  **Clear ETL Stages:** The `TransactionIngestionService` explicitly defines "Import" (Extraction) and "Process" (Transformation & Load) stages, ensuring raw data is saved before transformation, which is critical for debugging and retries.
10. **Extensibility via Registry:** The decorator-based `ProviderRegistry` and `TransactionMapperFactory` enable seamless, auto-discovered integration of new API clients and their mappers without modifying central factory code.
11. **Type Safety & Validation:** Zod schemas are integrated at critical points (API client input/output, raw data validation, universal transaction validation) to ensure data integrity.
12. **Self-Documenting:** The well-defined directory structure, coupled with the registry pattern, inherently communicates the system's architecture and capabilities.
