# Architecture

Exitbook is a cryptocurrency portfolio tracker that imports transaction histories from blockchains and exchanges, normalizes them into a universal format, and calculates cost-basis, balances, and tax reporting data.

These documents explain the design decisions behind the core systems — the _why_, not just the _what_. For behavioral specifications and data models, see [docs/specs/](../specs/).

## Documents

### [Streaming Import Pipeline](./import-pipeline.md)

How Exitbook imports transaction histories from diverse sources through a memory-bounded streaming pipeline with per-batch crash recovery and resume semantics.

### [Data Integrity & Processing](./data-integrity.md)

How the two-phase raw/derived architecture, multi-layered deduplication, runtime validation, and typed error propagation ensure financial-grade data correctness.

### [Provider Resilience](./provider-resilience.md)

How scored provider selection, functional circuit breakers, and persisted health state enable automatic failover between blockchain API providers.

### [Price Enrichment Pipeline](./price-enrichment.md)

How the multi-pass price inference pipeline extracts execution prices from trades, derives missing prices from swap ratios, and propagates prices across linked transactions.

## Reading Order

For a bottom-up understanding of the data flow:

1. **Import Pipeline** — how data enters the system
2. **Data Integrity** — how data is validated, stored, and reprocessed
3. **Provider Resilience** — how the system handles unreliable external APIs
4. **Price Enrichment** — how every movement gets a price for cost-basis calculation
