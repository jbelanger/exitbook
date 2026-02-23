# exitbook — Development Commands

## Core Workflow

```bash
pnpm install              # Install workspace deps
pnpm build                # Type check + bundle all packages
pnpm test                 # Full test suite (loads .env)
pnpm test:e2e             # E2E tests (requires API keys in .env)
pnpm lint                 # ESLint across all packages
pnpm prettier:fix         # Format all files
```

## Targeted Testing

```bash
pnpm vitest run <file>                                          # Single test file
pnpm vitest run --config vitest.e2e.config.ts <file>           # Single E2E test
pnpm --filter @exitbook/blockchain-providers test               # Package-scoped test
pnpm vitest run packages/blockchain-providers/src/blockchains/bitcoin
```

## CLI (via tsx + .env)

```bash
# Import
pnpm run dev import --exchange kraken --csv-dir ./exports/kraken
pnpm run dev import --exchange kraken --api-key KEY --api-secret SECRET
pnpm run dev import --blockchain bitcoin --address bc1q...

# Processing
pnpm run dev reprocess                  # Clear derived data, reprocess all raw
pnpm run dev prices enrich              # 4-stage price pipeline

# Viewing
pnpm run dev blockchains view
pnpm run dev accounts
pnpm run dev transactions
pnpm run dev balance
pnpm run dev cost-basis
pnpm run dev portfolio
pnpm run dev links
pnpm run dev providers
pnpm run dev --help
```

## Provider Management

```bash
pnpm blockchain-providers:list      # List providers + metadata
pnpm blockchain-providers:validate  # Validate registrations
pnpm providers:sync                 # Sync provider configs
```

## When Task is Complete

1. `pnpm build` — ensures type correctness across all packages
2. `pnpm test` — run affected tests
3. `pnpm lint` — check for lint errors
4. `pnpm prettier:fix` — format code
