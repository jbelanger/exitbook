<!--
Sync Impact Report:
- Version change: 1.0.0 (initial constitution creation)
- New constitution based on development documentation analysis
- Principles derived from Universal Blockchain Provider & ETL Architecture
- Templates requiring updates: ✅ updated (first time creation)
- Follow-up TODOs: None
-->

# Crypto Portfolio Platform Constitution

## Core Principles

### I. Multi-Provider Resilience Architecture

Every external data source MUST have redundant providers with automatic failover. Circuit breaker patterns MUST protect against cascading failures. No single external API failure shall cause system-wide outages.

**Rationale:** Financial data systems require 99.8% uptime. The Universal Blockchain Provider Architecture eliminates single points of failure through intelligent provider selection, circuit breakers, and automated recovery mechanisms.

### II. Registry-Based Auto-Discovery

All providers and mappers MUST be self-describing through decorator-based registration. The system MUST auto-discover components without manual factory updates. Configuration MUST be separated from implementation metadata.

**Rationale:** The `@RegisterApiClient` and `@RegisterTransactionMapper` pattern ensures providers are self-contained, reduces merge conflicts, and eliminates "forgot to register" bugs. This creates a maintainable, extensible architecture.

### III. Two-Stage ETL Pipeline

Transaction import MUST follow explicit Extract-Transform-Load stages: Stage 1 (Import) stores raw data; Stage 2 (Process) transforms and validates. Raw data MUST be preserved for debugging and reprocessing.

**Rationale:** Separation of data fetching from transformation creates durable checkpoints. If transformation fails, raw data can be reprocessed without re-hitting rate-limited APIs. This pattern is essential for financial data integrity.

### IV. Financial Precision and Validation

All financial calculations MUST use Decimal.js for precision. Zod schemas MUST validate all external data inputs. Mathematical constraints MUST be enforced throughout the pipeline.

**Rationale:** JavaScript's floating-point arithmetic is unsuitable for financial calculations. Comprehensive validation at API boundaries prevents malformed data from corrupting the system and ensures audit-trail integrity.

### V. Domain-Driven Monorepo Structure

Packages MUST represent distinct domains with clear boundaries. Dependencies MUST flow from applications to domains, never between peer domains. Public APIs MUST be explicit through index.ts exports.

**Rationale:** The monorepo structure separates core entities, import/ETL processes, data persistence, and balance verification into cohesive packages. This enables parallel development and maintains architectural clarity.

## Resilience Requirements

### Circuit Breaker Implementation

- Three-state finite state machine (Closed/Open/Half-Open) MUST be implemented for all external providers
- Default thresholds: 3 failures trigger Open state, 5-minute recovery timeout
- Health monitoring MUST proactively detect provider status
- Request-scoped caching (30-second TTL) MUST prevent duplicate API calls

### Provider Management Standards

- Provider metadata MUST live with implementation code through decorators
- Configuration files MUST contain only user intent (enabled providers, priorities, overrides)
- Failover MUST be automatic and transparent to consuming applications
- Rate limiting MUST respect provider-specific constraints

## Development Workflow

### Package Development Rules

- Each package MUST be independently buildable and testable
- Internal imports MUST use public APIs only (through index.ts)
- Deep imports into package internals are FORBIDDEN
- Shared configurations MUST be centralized in tools/ packages

### Quality Gates

- TypeScript compilation MUST succeed with strict settings
- All external data MUST pass Zod schema validation
- Unit tests MUST achieve >90% coverage for critical financial logic
- Provider integration tests MUST validate external API contracts

## Governance

This constitution embodies the architectural principles learned from building production-grade cryptocurrency transaction import systems. It supersedes all other practices when conflicts arise.

All code reviews MUST verify compliance with multi-provider resilience patterns. Breaking changes to provider interfaces or ETL stages require architectural review. The registry pattern MUST be extended rather than circumvented when adding new capabilities.

**Version**: 1.0.0 | **Ratified**: 2025-01-26 | **Last Amended**: 2025-01-26
