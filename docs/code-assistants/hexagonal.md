# Hexagonal Architecture — Project Specifics

Textbook hexagonal (ports & adapters).

## Hexagons

- `ingestion` — import, normalize raw data
- `accounting` — linking, pricing, cost basis, portfolio

## Shared kernel

- `core` — shared domain types only, no ports

## Ports

- Each hexagon has a `ports/` directory — the boundary contract, not an internal layer
- Vertical slices apply to domain internals; ports are the hexagon's edge, grouped together
- Each hexagon exposes ports via a dedicated `./ports` export — internals stay private:
  ```json
  { "exports": { ".": "./src/index.ts", "./ports": "./src/ports.ts" } }
  ```
- `data` imports from `@exitbook/ingestion/ports`, never from `@exitbook/ingestion`
- Ports are always interfaces, even with a single implementation

## Adapter

- `data` — persistence, depends on hexagon `/ports` exports + `core`

## Composition root

- `apps/cli` — wires `data` adapters into hexagon ports
