---
skillId: update-deps
name: Update Dependencies
description: Comprehensive pnpm dependency update strategy for the exitbook monorepo with layered risk management
version: 1.0.0
---

# Instructions

When the user requests dependency updates (e.g., "update to latest", "update dependencies"), follow this structured, risk-managed approach.

## Phase 1: Preparation & Analysis

Always start by gathering information:

1. **Check outdated packages:**

   ```bash
   pnpm outdated -r --format table
   ```

2. **Security audit:**

   ```bash
   pnpm audit
   ```

3. **Create safety branch:**

   ```bash
   git checkout -b chore/package-updates
   git add -A && git commit -m "Snapshot before updates"
   ```

4. **Document current state:**

   ```bash
   pnpm list -r --depth=0 > package-versions-before.txt
   ```

5. **Identify breaking changes** in key dependencies:
   - zod (v4 breaking from v3)
   - typescript
   - vitest
   - ccxt (frequent changes)
   - commander (CLI breaking changes)

## Phase 2: Update in Risk Layers

### Layer 1: Dev Tooling (Lowest Risk)

Update tooling that doesn't affect runtime:

- TypeScript tooling: `@typescript-eslint/*`, `tsx`, `tsup`
- Code quality: `eslint`, `prettier`, `knip`
- Testing: `vitest`, `@vitest/*`
- Build/dev: `husky`, `lint-staged`

```bash
pnpm update -r "@typescript-eslint/*" "@vitest/*" eslint prettier
pnpm build && pnpm lint && pnpm test
```

### Layer 2: Shared Runtime Dependencies (Medium Risk)

Update one at a time, test after each:

- `neverthrow` (used everywhere)
- `decimal.js` (check for version inconsistencies first)
- `zod` (v4.x - verify breaking changes)

```bash
pnpm update -r neverthrow
pnpm build && pnpm test

pnpm update -r decimal.js
pnpm build && pnpm test
```

### Layer 3: Domain-Specific Dependencies (Highest Risk)

Update per package, not globally:

- `ccxt` (exchange APIs)
- `@cardano-sdk/*` (coordinate versions together)
- `bitcoinjs-lib`, `@polkadot/*`
- `commander` (CLI)

```bash
pnpm --filter @exitbook/exchange-providers update ccxt
pnpm --filter @exitbook/exchange-providers test

pnpm --filter exitbook-cli update commander
pnpm test:e2e
```

## Phase 3: Testing Strategy

After each layer:

1. **Unit tests:**

   ```bash
   pnpm test
   ```

2. **E2E tests (requires .env):**

   ```bash
   pnpm test:e2e
   ```

3. **Manual smoke tests:**

   ```bash
   pnpm run dev list-blockchains
   pnpm run dev import --exchange kraken --csv-dir <test-data>
   pnpm run dev prices enrich
   ```

4. **Build verification:**
   ```bash
   pnpm build
   pnpm start --help
   ```

## Critical Considerations

### Known Issues to Watch

- **Zod v4.x:** Breaking changes from v3 - check schemas need updates
- **decimal.js:** Watch for version mismatches across workspace (e.g., 10.6.0 vs 10.4.3)
- **Commander v14:** Breaking changes from v13 - test CLI thoroughly
- **TypeScript:** Stick with 5.9 unless critical fixes in newer versions

### Package-Specific Risks

- **ccxt:** Frequent updates, API changes common - read changelog
- **@cardano-sdk/\*:** Coordinate versions together (update all or none)
- **@polkadot/\*:** Coordinate versions together
- **libsodium-sumo:** Has postinstall script (fix-libsodium.mjs)

### Fix Version Inconsistencies First

Before other updates, standardize versions:

```bash
# Example: Standardize decimal.js across monorepo
pnpm update -r decimal.js@^10.6.0
```

## Execution Guidelines

1. **Present the plan** before executing - show what will be updated in each layer
2. **Stop on failures** - don't continue to next layer if tests fail
3. **Commit per layer** - create commits after each successful layer update
4. **Report breaking changes** - immediately flag any breaking changes found
5. **Security first** - fix critical/high security issues immediately, regardless of layer

## Examples

**Example 1: Full update request**

```
User: "Update all dependencies to latest"

Response:
1. Run preparation steps (audit, outdated check)
2. Present layered plan with specific packages per layer
3. Execute Layer 1 (dev tools)
4. Test and commit
5. Execute Layer 2 (shared runtime)
6. Test and commit
7. Execute Layer 3 (domain-specific)
8. Test and commit
9. Final smoke tests
```

**Example 2: Targeted update**

```
User: "Update vitest to latest"

Response:
1. Check current vitest version and what's available
2. Update vitest and related @vitest/* packages
3. Run pnpm build && pnpm test
4. Report results
```

**Example 3: Security-focused**

```
User: "Fix security vulnerabilities"

Response:
1. Run pnpm audit
2. Identify critical/high issues
3. Update affected packages (may skip layer approach for security)
4. Test thoroughly
5. Report on fixed vulnerabilities
```

# Notes

- Always use `pnpm update -r` for workspace-wide updates
- Use `--filter` for package-specific updates
- Use `--latest` flag carefully - it ignores semver ranges in package.json
- Create commits between layers for easy rollback
- Document any breaking changes or manual fixes needed
