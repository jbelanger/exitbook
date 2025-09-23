# Universal Blockchain Provider & ETL Architecture: A Deep Dive

## 1. Executive Summary

This document provides a comprehensive overview of the Universal Blockchain Provider and ETL (Extract, Transform, Load) Architecture. This system is designed to provide a resilient, production-grade infrastructure for importing cryptocurrency transaction data. It fundamentally evolves our previous approach from a collection of brittle, single-point-of-failure services into a robust, extensible, and self-healing platform.

By abstracting data fetching from data transformation and implementing a sophisticated multi-provider resilience layer, this architecture eliminates systemic vulnerabilities and establishes a scalable foundation for reliable financial data operations.

## 2. Core Architectural Principles

The entire system is built upon a set of guiding principles that inform every design decision:

*   **Resilience and Redundancy:** No single external API failure should ever cause a system-wide outage for a blockchain. The system must degrade gracefully and recover automatically.
*   **Separation of Concerns:** The process of *fetching* raw data must be completely decoupled from the process of *transforming* it into a canonical format.
*   **Extensibility and Scalability:** Adding support for a new blockchain or a new API provider for an existing chain should be a straightforward, low-friction process with minimal changes to core logic.
*   **Auto-Discovery and Convention over Configuration:** The system should be "self-describing." New components should be automatically discovered by the system, minimizing the need for manual registration and reducing the risk of configuration errors.
*   **Intelligent, Dynamic Routing:** The system should dynamically select the best provider for a given task based on real-time health, performance, and capability data.

## 3. High-Level System Diagram: The Two-Stage ETL Pipeline

The architecture is orchestrated by the `TransactionIngestionService` and is divided into two distinct stages: **Import** (Extraction) and **Process** (Transformation & Load).

```
 ┌───────────────────────────────────────┐
 │      TransactionIngestionService      │  (Orchestrates the entire pipeline)
 └────────────┬───────────────────┬──────┘
              │ 1. importFromSource()   │ 2. processAndStore()
              ▼                         ▼
  +---------------------------+     +-------------------------------+
  |      STAGE 1: IMPORT      |     |      STAGE 2: PROCESS         |
  | (Extraction of Raw Data)  |     | (Transformation & Loading)    |
  +---------------------------+     +-------------------------------+
  | ┌───────────────────────┐ |     | ┌───────────────────────────┐ |
  | │       Importer        │ |     | │        Processor          │ |
  | │ (e.g., BitcoinImporter) │ |     | │ (e.g., BitcoinProcessor)  │ |
  | └──────────┬────────────┘ |     | └───────────┬───────────────┘ |
  |            │              |     |             │ Uses            |
  |            ▼              |     |             ▼                 |
  | ┌───────────────────────┐ |     | ┌───────────────────────────┐ |
  | │ BlockchainProviderMngr│ |     | │   TransactionMapperFactory  │ |
  | │(Failover, Circuit-Break)│ |     | └───────────┬───────────────┘ |
  | └──────────┬────────────┘ |     |             │ Creates         |
  |            │ Selects Best │     |             ▼                 |
  | ┌──────────┴────────────┐ |     | ┌───────────────────────────┐ |
  | │      API Clients      │ |     | │         Mappers           │ |
  | │ (Mempool, Blockstream)│ |     | │ (MempoolMapper, etc.)     │ |
  | └───────────────────────┘ |     | └───────────────────────────┘ |
  +-------------│-------------+     +---------------│---------------+
                ▼                                   ▼
┌─────────────────────────────────┐ ┌─────────────────────────────────┐
│ Database: StoredRawData Table   ├─▶ Database: StoredRawData Table   │ (Reads raw data)
│ (Stores raw, unprocessed JSON)  │ │ (Updates processing status)     │
└─────────────────────────────────┘ └─────────────────────────────────┘
                                      ┌─────────────────────────────────┐
                                      │ Database: Transactions Table    │ (Loads final data)
                                      └─────────────────────────────────┘
```

## 4. The ETL Pipeline in Detail

### Stage 1: Import (The "E" - Extraction)

The primary goal of this stage is to reliably fetch raw data from external sources and persist it.

#### Component: `Importer`
*   **Responsibility:** A high-level class responsible for managing the data import for a specific source (e.g., `BitcoinTransactionImporter`, `KucoinCsvImporter`).
*   **Function:** It validates input parameters (like a Bitcoin address) and then calls the `BlockchainProviderManager` to execute the necessary data fetching operations. It does *not* contain any logic for communicating with specific APIs.

#### Component: `BlockchainProviderManager`
This is the resilience engine of the architecture. It is a long-lived service that provides "resilience as a service" to all importers.

*   **Intelligent Provider Selection & Scoring:** Before every operation, the manager scores all available providers for a blockchain based on a weighted algorithm:
    *   **Health & Availability:** Is the provider healthy? Is its circuit breaker open? (Highest impact).
    *   **Performance:** What is its exponential moving average response time? (Fast providers are preferred).
    *   **Reliability:** What is its exponential moving average error rate and number of consecutive failures?
    *   **Configuration:** Does the configuration file give it a higher `priority`?
    *   **Capabilities:** Does it support the specific operation required?
*   **Automatic Failover:** It executes the operation on the highest-scoring provider. If that provider fails, it records the failure, re-scores the remaining providers, and transparently retries the operation on the next-best one.
*   **Circuit Breaker Pattern:** Each provider is wrapped in a `CircuitBreaker`. After 3 consecutive failures, the circuit "opens," and the manager will not send requests to that provider for 5 minutes, preventing the system from hammering a failing service. After the timeout, it enters a "half-open" state, allowing a single test request. A success closes the circuit; another failure resets the timer.
*   **Health Monitoring:** In the background, the manager periodically runs `isHealthy()` checks on all providers to proactively update their health status, allowing it to route around failing services even before a real request fails.
*   **Request-Scoped Caching:** Provides a 30-second in-memory cache to deduplicate identical API requests that might occur within a single, complex import session, reducing API usage and latency.

#### Component: Provider Ecosystem (API Clients & The Registry)

This is the most significant evolution from the old architecture. Providers are now self-describing and automatically discovered.

1.  **`@RegisterApiClient` Decorator:** Each `ApiClient` class (e.g., `MempoolSpaceApiClient`) is decorated with its complete metadata. This includes its name, the blockchain it serves, its capabilities (`supportedOperations`), default rate limits, and the environment variable for its API key.

    ```typescript
    // ../packages/import/src/blockchains/bitcoin/api/MempoolSpaceApiClient.ts
    @RegisterApiClient({
      blockchain: 'bitcoin',
      name: 'mempool.space',
      displayName: 'Mempool.space API',
      capabilities: {
        supportedOperations: ['getRawAddressTransactions', 'getAddressInfo'],
        // ...
      },
      // ...
    })
    export class MempoolSpaceApiClient extends BaseRegistryProvider { /* ... */ }
    ```
2.  **`ProviderRegistry`:** A global singleton that acts as a service locator. On application startup, it collects all classes annotated with `@RegisterApiClient`. The `BlockchainProviderManager` queries this registry to find out which providers are available for a given blockchain.
3.  **`BaseRegistryProvider`:** An abstract base class that all API Clients extend. It contains the boilerplate logic for reading metadata from the registry, initializing a logger, and configuring the `HttpClient` with the correct base URL, rate limits, and API key. This drastically reduces the code required to implement a new provider.

### Stage 2: Process (The "T" & "L" - Transformation and Load)

This stage is responsible for taking the raw, schemaless JSON data from Stage 1 and converting it into structured, canonical `UniversalTransaction` objects.

#### Component: `Processor`
*   **Responsibility:** Orchestrates the transformation for a specific blockchain (e.g., `BitcoinTransactionProcessor`). It contains the high-level business logic.
*   **Function:**
    1.  Loads the raw data records for an import session from the database.
    2.  For each record, it reads the `providerId` to determine which API it came from.
    3.  It uses the `TransactionMapperFactory` to create the correct `Mapper` for that provider.
    4.  It invokes the mapper to transform the raw JSON into a standardized `UniversalBlockchainTransaction` object. This is an intermediate format that is still blockchain-specific but structured.
    5.  It applies final business logic, such as classifying the transaction as a `deposit` or `withdrawal` by checking the `from` and `to` addresses against the user's known wallet addresses.
    6.  It saves the final, validated `UniversalTransaction` to the database.

#### Component: `Mapper`
*   **Responsibility:** Contains the precise, provider-specific logic to transform a raw JSON object from one specific API into the standardized `UniversalBlockchainTransaction` format.
*   **Function:**
    *   **Validation:** Every mapper defines a **Zod schema** for the raw data it expects. The first step of mapping is to validate the input. If validation fails, the transformation is aborted, preventing malformed data from corrupting the system and providing clear error logs.
    *   **Transformation:** It contains the "dirty" work of navigating the unique structure of a provider's API response, extracting fields, normalizing data types (e.g., converting satoshis to BTC), and mapping them to the fields of `UniversalBlockchainTransaction`.

This separation is key: the `Processor` knows the *business rules* of Bitcoin, while the `Mapper` knows the *data structure* of the Mempool.space API.

## 5. Configuration: `blockchain-explorers.json`

The system configuration is designed to be powerful yet intuitive, embracing the principle of "convention over configuration."

*   **Zero-Config Default:** If `config/blockchain-explorers.json` does not exist, or if a blockchain is not defined within it, the `BlockchainProviderManager` will fall back to the `ProviderRegistry`, discovering and enabling **all** registered providers for that chain with their default settings.
*   **`defaultEnabled`:** This array acts as a primary filter. Only providers listed here will be considered for a given blockchain. This allows you to easily enable or disable providers without deleting their override configurations.
*   **`overrides`:** This object allows you to customize the behavior of any provider. You can explicitly disable it (`"enabled": false`), change its `priority` in the selection algorithm, or fine-tune its `rateLimit` settings.

#### Annotated Example Configuration:

```json
{
  "bitcoin": {
    // Only these three providers will be used for Bitcoin.
    "defaultEnabled": ["mempool.space", "blockstream.info", "blockchain.com"],
    "overrides": {
      // Give mempool.space the highest priority.
      "mempool.space": {
        "priority": 1
      },
      // Tatum is registered but not in defaultEnabled, so it's disabled.
      // This override explicitly confirms its disabled state.
      "tatum": {
        "enabled": false
      }
    }
  }
}
```

The included helper scripts (`pnpm run providers:list`, `pnpm run providers:sync --fix`) make managing this file simple by introspecting the `ProviderRegistry`.

## 6. A Practical Walkthrough: Adding a New Provider

This architecture makes adding a new provider highly procedural. Let's walk through adding a hypothetical "Blockchair" API provider for Bitcoin.

1.  **Create the API Client (`BlockchairApiClient.ts`):**
    *   Location: `../packages/import/src/blockchains/bitcoin/api/`
    *   Create the `BlockchairApiClient` class, extending `BaseRegistryProvider`.
    *   Add the `@RegisterApiClient` decorator, filling in all metadata: `name: 'blockchair'`, `blockchain: 'bitcoin'`, `displayName`, `capabilities`, `defaultConfig` (with rate limits), and `apiKeyEnvVar` if needed.
    *   Implement the `execute` method to handle provider-specific logic for operations like `getRawAddressTransactions`.
    *   Implement the `isHealthy` method to ping a simple Blockchair status endpoint.

2.  **Create the Mapper (`BlockchairMapper.ts`):**
    *   Location: `../packages/import/src/blockchains/bitcoin/mappers/`
    *   Create the `BlockchairMapper` class, extending `BaseRawDataMapper<BlockchairRawTransaction>`.
    *   Define a Zod schema (`BlockchairTransactionSchema`) that validates the raw JSON response from Blockchair's API.
    *   Implement the `mapInternal` method. This is where you'll write the logic to convert a validated `BlockchairRawTransaction` object into a `UniversalBlockchainTransaction`.
    *   Add the `@RegisterTransactionMapper('blockchair')` decorator.

3.  **Register the New Modules:**
    *   In `../packages/import/src/blockchains/bitcoin/api/index.ts`, add the line: `import './BlockchairApiClient.ts';`.
    *   In `../packages/import/src/blockchains/bitcoin/mappers/index.ts`, add the line: `import './BlockchairMapper.ts';`.
    *   This ensures the decorators are executed at startup.

4.  **Update Configuration:**
    *   Run `pnpm run providers:sync --fix`.
    *   The script will detect the new "blockchair" provider from the registry and automatically add it to the `defaultEnabled` array for Bitcoin in `blockchain-explorers.json`.
    *   You can then manually edit the file to set a custom `priority` or other overrides for Blockchair.

5.  **Set API Key:**
    *   If Blockchair requires an API key, set the corresponding environment variable (e.g., `BLOCKCHAIR_API_KEY`) in your `.env` file.

The system is now fully capable of using Blockchair as a data source for Bitcoin, and it will automatically be included in the failover, health monitoring, and intelligent routing logic.

## 7. Key Design Decisions and Trade-offs

*   **Why Decorators for Registration?**
    *   **Instead of:** Manual registration lists or factory files that need to be updated for every new provider.
    *   **Reasoning:** Decorators decentralize registration. A provider is completely self-contained in its own file. This reduces merge conflicts and eliminates the "I forgot to add it to the list" class of bugs. The system discovers components rather than being explicitly told about them.

*   **Why Separate Import and Process Stages?**
    *   **Instead of:** A single, monolithic process that fetches and transforms data in one step.
    *   **Reasoning:** Resilience and Debuggability. By storing the raw data first, we create a durable checkpoint. If a transformation logic error occurs (the "Process" stage fails), we can fix the code and re-process the already-fetched raw data without having to hit the external APIs again. This is crucial when dealing with rate-limited or paid APIs.

*   **Why a Discriminated Union for `ProviderOperationParams`?**
    *   **Instead of:** A generic `params: Record<string, any>` object.
    *   **Reasoning:** Type Safety. Using a discriminated union on the `type` field allows TypeScript to provide strong type-checking and autocompletion for the parameters of each specific operation (e.g., if `type` is `'getRawAddressTransactions'`, TypeScript knows that an `address` property must exist). This prevents runtime errors and improves the developer experience.

## 8. Conclusion

The Universal Blockchain Provider & ETL Architecture is a robust, resilient, and highly extensible system that elevates our data import capabilities to a production-grade standard. It successfully solves the initial problem of single-point-of-failure dependencies while introducing a clean, maintainable structure for future growth.

**Key Achievements:**

*   **100% Redundancy:** Every blockchain can leverage multiple, independent API providers.
*   **Automated Resilience:** The system automatically routes around failing services and heals itself as providers recover, requiring zero manual intervention.
*   **Enhanced Maintainability:** The clear separation of concerns and the auto-discovery registry make adding, removing, or debugging components a straightforward process.
*   **Future-Proof Foundation:** The architecture is not tied to any specific blockchain or API design. It provides a universal pattern for integrating any future data source with minimal friction.