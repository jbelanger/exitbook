# Contributing to exitbook

Thanks for your interest in contributing!

## Licensing

exitbook is licensed under the [GNU Affero General Public License v3.0](LICENSE) (AGPL-3.0), with a commercial license available for proprietary use.

By submitting a pull request or otherwise contributing code, you certify that:

1. The contribution is your original work and you have the right to submit it.
2. You grant Joel Belanger a perpetual, worldwide, non-exclusive, royalty-free license to use, reproduce, modify, and distribute your contribution under any license terms, including proprietary ones.
3. You understand that your contribution will be made available under the AGPL-3.0 license.

This is a lightweight [Developer Certificate of Origin (DCO)](https://developercertificate.org/) — no signature required.

## Getting Started

### 1. Install and build

Requirements: Node.js ≥ 24, pnpm ≥ 10.6.2

```bash
git clone https://github.com/jbelanger/exitbook.git
cd exitbook
node --version   # must be >= 24 — use `nvm use` if you have nvm
pnpm install
pnpm build       # type-checks all packages and bundles the CLI
```

### 2. Run a key-free command

```bash
pnpm run dev blockchains view   # lists every supported blockchain — no API keys needed
pnpm run dev --help             # full command reference
```

### 3. Run unit tests

```bash
pnpm test                                                         # all packages
pnpm vitest run packages/accounting                               # single package
pnpm vitest run packages/ingestion/src/sources/exchanges/kucoin   # single folder
```

### 4. Run e2e tests

Local-safe e2e (CLI workflow harness, live flows skipped unless `LIVE_TESTS=1`):

```bash
pnpm test:e2e
```

Live network e2e (real provider/exchange calls):

```bash
pnpm test:e2e:live
# Or a single file:
LIVE_TESTS=1 pnpm vitest run --config vitest.e2e.live.config.ts packages/blockchain-providers/src/blockchains/bitcoin
```

Copy `.env.example` to `.env` and add required provider keys before running live e2e.

---

## Adding a New Exchange Adapter

1. **Exchange client (API):** `packages/exchange-providers/src/exchanges/<exchange>/`
   — ccxt-based client + Zod schemas; export from `packages/exchange-providers/src/index.ts`

2. **Importer + Processor:** `packages/ingestion/src/sources/exchanges/<exchange>/`
   — `importer.ts` (implements `IImporter`), `processor.ts` (outputs `UniversalTransaction`), `schemas.ts`, `types.ts`

3. **Register:** Create `register.ts` exporting an `ExchangeAdapter` object, then add it to `packages/ingestion/src/sources/exchanges/index.ts`.

4. **Tests:** Add `__tests__/` with unit tests for the processor. Use helpers from `packages/ingestion/src/shared/test-utils/`.

## Adding a New Blockchain

1. **Provider:** `packages/blockchain-providers/src/blockchains/<blockchain>/providers/<provider>/`
   — API client extending `BaseApiClient`, mapper utils, Zod schemas
   — Add factory to `packages/blockchain-providers/src/blockchains/<blockchain>/register-apis.ts`

2. **Importer + Processor:** `packages/ingestion/src/sources/blockchains/<blockchain>/`
   — Same structure as exchanges; register in `packages/ingestion/src/sources/blockchains/index.ts`

3. **Chain config:** If multi-chain, add entries to `<blockchain>-chains.json`.

See `docs/architecture/import-pipeline.md` for the full pipeline design.

---

## Code Conventions (summary)

- **Error handling:** all fallible functions return `Result<T, Error>` (neverthrow). No throws in business logic; no silent suppression.
- **Schemas:** Zod for runtime validation. Core schemas in `packages/core/src/schemas/`.
- **Logging:** `import { getLogger } from '@exitbook/logger'` — pass structured context as first arg when relevant.
- **Decimals:** `import { Decimal } from 'decimal.js'` — use `.toFixed()` for strings, never `.toString()`.
- **Vertical slices:** keep importer, processor, schemas, and tests together in one feature folder.

Full architecture notes in `docs/architecture/`.

---

## Submitting Changes

**Open an issue before writing any code.** PRs without a linked, acknowledged issue will be closed without review. This protects your time and ensures alignment before you invest effort.

- Keep PRs focused — one concern per PR
- Run `pnpm build && pnpm test` before submitting
- Follow existing code conventions (vertical slices, Result types, no silent errors)
- Fill out the PR template fully — incomplete submissions will be closed

## Spam & Bot PRs

PRs that reference issues that were not opened by a human, claim bounties that were never announced, or include unsolicited deliverable artifacts will be closed and reported immediately.
