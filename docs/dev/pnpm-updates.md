Recommended Update Strategy

Phase 1: Preparation & Analysis (Low Risk)

# 1. Check what's actually outdated

pnpm outdated -r --format table

# 2. Check for security vulnerabilities

pnpm audit

# 3. Identify breaking changes in key dependencies

# Focus on: zod (v4), typescript, vitest, ccxt, commander

Phase 2: Update in Layers (Gradual Approach)

Layer 1: Dev Tooling (Lowest Risk)

- TypeScript tooling: @typescript-eslint/\*, tsx, tsup
- Code quality: eslint, prettier, knip
- Testing: vitest, @vitest/\*
- Build/dev: husky, lint-staged

# Update these first - they don't affect runtime

pnpm update -r "@typescript-eslint/_" "@vitest/_" eslint prettier
pnpm build && pnpm lint && pnpm test

Layer 2: Shared Runtime Dependencies (Medium Risk)

- neverthrow (used everywhere)
- decimal.js (note: inconsistent versions - 10.6.0 vs 10.4.3)
- zod (v4.x - check if breaking from v3)

# Update one at a time, test thoroughly

pnpm update -r neverthrow
pnpm build && pnpm test

pnpm update -r decimal.js # Standardize on latest 10.x
pnpm build && pnpm test

Layer 3: Domain-Specific Dependencies (Highest Risk)

- ccxt (exchange APIs - frequent updates, check changelogs)
- @cardano-sdk/\* (blockchain providers)
- bitcoinjs-lib, @polkadot/\*
- commander (CLI - check for breaking changes)

# Update per package, not globally

pnpm --filter @exitbook/exchange-providers update ccxt
pnpm --filter @exitbook/exchange-providers test

pnpm --filter exitbook-cli update commander
pnpm test:e2e # Ensure CLI still works

Phase 3: Testing Strategy

For each layer:

# 1. Unit tests

pnpm test

# 2. E2E tests (requires .env)

pnpm test:e2e

# 3. Manual smoke tests

pnpm run dev list-blockchains
pnpm run dev import --exchange kraken --csv-dir <test-data>
pnpm run dev prices enrich

# 4. Check for runtime issues

pnpm build
pnpm start --help

Critical Considerations

1. Known Issues to Watch:

- Zod v4.x: Check if schemas need updates (breaking from v3)
- decimal.js: You have version mismatch (10.6.0 in blockchain-providers, 10.4.3 in ingestion)
- Commander v14: Check for CLI breaking changes from v13
- TypeScript 5.9: Currently latest, stick here unless 5.10+ has critical fixes

2. Package-Specific Risks:

- ccxt: Updates frequently, API changes common
- @cardano-sdk/\*: Coordinate versions together
- @polkadot/\*: Coordinate versions together
- libsodium-sumo: Has postinstall script (fix-libsodium.mjs)

3. Before Starting:

# Create a branch

git checkout -b chore/package-updates

# Snapshot current state

git add -A && git commit -m "Snapshot before updates"

# Document current versions

pnpm list -r --depth=0 > package-versions-before.txt

Recommended First Steps

1. Fix version inconsistencies immediately:

# Standardize decimal.js across monorepo

pnpm update -r decimal.js@^10.6.0

2. Update dev dependencies first:
   pnpm update -r --pattern "@vitest/_" --latest
   pnpm update -r --pattern "@typescript-eslint/_" --latest
   pnpm test

3. Check for security issues:
   pnpm audit

# Fix any critical/high issues immediately

Would you like me to start with any specific layer, or would you prefer I check for actual outdated packages and security issues
first?
