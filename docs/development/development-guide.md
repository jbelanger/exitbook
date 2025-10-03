# Development Guide

A single reference for the Exitbook workspace: how the monorepo is organised, how the universal provider architecture works, how providers register and fail over, and how to configure the pipeline.

## Monorepo Layout

Exitbook is a pnpm workspace. Each workspace keeps code for a concrete domain so ownership and dependencies stay clear.

### Top Level

- `apps/cli` — user-facing CLI. Uses the import pipeline and services from `packages/*`.
- `packages/` — domain libraries that power the CLI and any future surfaces.
- `packages/shared` — cross-cutting helpers shared by all domains.
- `tools/` — reusable linting and TypeScript configs consumed across the workspace.

### Domain Packages

- `@exitbook/core` (`packages/core`) — canonical data contracts and validation schemas; no runtime coupling to other packages.
- `@exitbook/import` (`packages/import`) — blockchain import pipeline: API clients, mappers, processors, and the orchestration services that turn raw provider data into universal transactions.
- `@exitbook/data` (`packages/data`) — persistence layer: SQLite access, repositories, and data-oriented services consumed by higher layers.
- `@exitbook/balance` (`packages/balance`) — balance reconciliation logic that compares computed balances with live or historical data.

### Shared Packages

- `@exitbook/shared-utils` (`packages/shared/utils`) — HTTP client, masking helpers, decimal utilities, and general type guards.
- `@exitbook/shared-logger` (`packages/shared/logger`) — logging facade used by all workspace packages.
- `packages/shared/tsconfig` — base TS configs referenced by every workspace tsconfig.

### Notes

- Tests live next to their sources (`__tests__` folders) to keep implementation and coverage aligned.
- Provider packages self-register through decorators, so importing a provider module is enough to expose it to the registry.
- pnpm workspaces enforce dependency boundaries; add new domains under `apps/*` or `packages/*` and wire them through the workspace manifest.

## Universal Provider Architecture

This architecture powers the import pipeline for every supported blockchain. It separates concerns into the smallest useful pieces so data fetching, normalization, and persistence evolve independently.

### Design Principles

- **Resilience first:** Multiple providers per chain, health checks, and circuit breakers prevent a single API outage from stopping imports.
- **Self-discovery:** API clients and mappers register themselves via decorators; the registry exposes their metadata to config, tooling, and runtime services.
- **Two-stage ETL:** Importers only fetch and persist raw payloads; processors and mappers convert those payloads into universal transactions in a separate stage.
- **Configuration over code:** Defaults live with the provider implementation. JSON config files simply pick priorities, enablement, and overrides.

### Runtime Flow

1. The CLI (or service) calls `TransactionIngestionService`.
2. Stage 1 (`importFromSource`) asks the `BlockchainProviderManager` for a healthy provider. The chosen API client fetches raw data and stores it as JSON.
3. Stage 2 (`processRawDataToTransactions`) loads raw rows, picks the matching mapper via the registry, validates the payload with Zod, and emits normalized transactions.
4. Processed transactions flow to downstream storage and balance services.

### Key Components

- **Provider Registry** — maps provider names to metadata and factories. Supplies helper APIs (`createProvider`, `createDefaultConfig`, `getAvailable`, `validateConfig`).
- **BlockchainProviderManager** — uses registry metadata plus runtime health to route requests and manage failover.
- **API Clients** — thin wrappers around external HTTP/RPC APIs. Decorated with `@RegisterApiClient` so they self-publish capabilities, rate limits, and key requirements.
- **Raw Data Mappers** — provider-specific transformers registered with `@RegisterTransactionMapper(providerId)`. They validate raw payloads and produce canonical transaction objects (Solana, Bitcoin, etc.).
- **Processors** — chain-level business rules that interpret normalized transactions (fund-flow analysis, instruction shaping) before persisting.

### Blockchain Modules

Each chain lives under `packages/import/src/infrastructure/blockchains/<chain>` and follows the same layout:

- `register-apis.ts` / `register-mappers.ts` — import side-effect modules so decorators run during startup.
- `providers/<provider>/` — API client, mapper, types, tests, and provider-specific fixtures.
- `schemas.ts` and `types.ts` — chain-wide raw + normalized shapes (e.g., `solana/schemas.ts`, `solana/types.ts`).
- `transaction-importer.ts` / `transaction-processor.ts` — orchestrators that glue the chain’s provider output into the universal pipeline.

Convenience folders such as `evm/providers/alchemy/…` or `solana/helius/…` mirror the provider name from the registry metadata, keeping implementations easy to locate.

### Adding a Provider

1. Implement the API client and decorate it with metadata (name, blockchain, capabilities, rate limits, env var hints).
2. Implement the mapper with input/output schemas and transformation logic; register it with the provider ID.
3. Import both files in the chain’s `register-apis.ts` / `register-mappers.ts` so decorators run at startup.
4. Run `pnpm providers:sync --fix` and update configuration or environment variables as needed.

## Provider Registry

The provider registry keeps blockchain integrations discoverable, type-safe, and configuration-driven. Every API client and mapper publishes its metadata through decorators so runtime services can assemble the correct stack without hard-coded wiring.

### Registration Flow

- `@RegisterApiClient()` wraps each API client class and pushes a factory plus metadata into the registry as soon as the module is imported.
- `@RegisterTransactionMapper(providerId)` associates raw-data mappers with the same provider identifier so processors can discover transformation logic alongside clients.
- Metadata contains the canonical provider name, blockchain, default base URL, rate limits, retries, timeout, capability flags, and the recommended API key environment variable.
- Multi-chain providers use the `supportedChains` field (array or per-chain `baseUrl` map) so the same client can service EVM variants or other networks.

### Registry APIs

- `createProvider(blockchain, name, config)` instantiates the requested client after merging metadata with runtime overrides.
- `createDefaultConfig(blockchain, name)` returns a ready-to-use config object for tests or tooling.
- `getAvailable(blockchain)` and `getAllProviders()` surface the discoverable providers along with their capabilities and defaults.
- `validateConfig(config)` cross-checks workspace configuration to ensure only registered providers appear in `defaultEnabled`, `explorers`, or `overrides` sections.

### Configuration & Tooling

- Provider metadata lives with the implementation, while JSON configuration only expresses priority, enablement, and overrides.
- CLI helpers (`pnpm providers:list`, `pnpm providers:sync`, `pnpm providers:validate`) rely on the same registry API to surface metadata and catch drift between code and config.

Keep provider modules small: define metadata, register the API client, register the mapper, and the registry takes care of discovery, validation, and instantiation.

## Provider Resilience: Circuit Breakers

The import pipeline never talks to a blockchain API directly. Every request goes through `BlockchainProviderManager`, and that manager guards each provider with its own circuit breaker. The goal is simple: if a provider starts failing, stop wasting time on it and move to the next option.

### Why We Use One

- **Protect the pipeline:** Without a breaker the manager would keep calling the same broken API, burning the retry budget and blocking worker threads until timeouts.
- **Fast failover:** As soon as the breaker is open the manager immediately picks the next provider in priority order, so imports keep flowing.
- **Automatic recovery:** After a cool-down period the breaker lets a single probe request through. If the provider is healthy again it rejoins the rotation automatically.

Think of it like a power strip: repeated sparks from one socket trip the breaker, cutting power until it is safe to try again.

### The Three States

1. **Closed** – Normal traffic. Every success keeps the breaker closed. Every failure increments an internal counter.
2. **Open** – Reached after `maxFailures` consecutive errors (default 3). In this state the manager refuses to call that provider and instantly tries the next one.
3. **Half-open** – After `recoveryTimeoutMs` (default 5 minutes) the breaker allows exactly one request to test the provider. Success resets the counter and switches back to **Closed**. Failure snaps it back to **Open** and the timer starts over.

These defaults live in `CircuitBreaker` (`packages/import/src/infrastructure/blockchains/shared/utils/circuit-breaker.ts`). Expose new knobs in configuration only if production behaviour shows the need.

### How Providers Use It

- `BlockchainProviderManager` creates one breaker per provider name and caches it in memory.
- Before making a call it checks the breaker:
  - `open` → skip provider immediately.
  - `half-open` → log the probe and try once.
- After the call it records success or failure so the breaker can update its state.
- Provider health metrics mirror the breaker state, which makes it easy to inspect in logs or debugging sessions.

### Troubleshooting Tips

- **Provider seems stuck in Open:** wait for the recovery timeout or restart the service to reset breakers (they are in-memory).
- **Breaker trips too quickly:** investigate real error responses first; if the API is noisy consider raising `maxFailures` in code.
- **Breaker never opens:** ensure the API client rethrows errors so the manager can see the failure.

With circuit breakers in place the failover system behaves predictably, even when multiple blockchain APIs hiccup during high traffic periods.

## Provider Configuration

The import pipeline works out of the box: if `packages/import/config/blockchain-explorers.json` is missing, every registered provider uses its built-in defaults. Create the file when you need explicit control over priorities, enablement, or rate limits.

### File Shape

```json
{
  "<blockchain>": {
    "defaultEnabled": ["provider-name"],
    "overrides": {
      "provider-name": {
        "priority": 1,
        "enabled": true,
        "timeout": 20000,
        "retries": 3,
        "rateLimit": { "requestsPerSecond": 5, "burstLimit": 10 }
      }
    }
  }
}
```

- `<blockchain>` — lowercase chain id (`bitcoin`, `ethereum`, `solana`, …).
- `defaultEnabled` — the providers the manager is allowed to use. Order does not set priority.
- `overrides` — optional tweaks per provider. Lower `priority` runs first; omit to use default metadata values.

### Environment Variables

Provider metadata declares the recommended API-key env var (e.g., `SOLANA_HELIUS_API_KEY`). The client reads it automatically; never embed secrets in JSON. Configure keys in the repo-root `.env` used by pnpm scripts.

### Tooling

All scripts live under `@exitbook/import`.

- `pnpm providers:list` — show every registered provider and its metadata.
- `pnpm providers:sync --fix` — ensure the config file contains all known providers for each chain; keeps `defaultEnabled` fresh.
- `pnpm providers:validate` — check for typos and unknown names in the JSON.

### Minimal Examples

```json
{
  "bitcoin": {
    "defaultEnabled": ["mempool.space", "blockstream.info"],
    "overrides": {
      "mempool.space": { "priority": 1 },
      "blockstream.info": { "priority": 2 }
    }
  },
  "solana": {
    "defaultEnabled": ["helius"],
    "overrides": {}
  }
}
```

This keeps Solana locked to Helius while Bitcoin fails over from Mempool to Blockstream automatically.

Remember: configuration only adjusts intent. Provider defaults (base URL, rate limit, retry strategy) stay close to the implementation inside each API client.
