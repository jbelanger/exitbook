# API Providers Extraction Plan

**Date:** 2025-10-03
**Status:** Design Complete - Ready for Implementation

---

## Overview

Extract API client implementations from `@exitbook/import` into a single dedicated package. This enables API providers to be used independently of the import domain and reduces package coupling.

---

## Current Structure

```
packages/import/src/infrastructure/
├── blockchains/
│   ├── bitcoin/ (5 providers)
│   ├── evm/ (5 providers)
│   ├── solana/ (3 providers)
│   ├── cosmos/ (1 provider)
│   ├── substrate/ (2 providers)
│   └── shared/
│       ├── api/blockchain-api-client.ts
│       ├── registry/
│       ├── blockchain-provider-manager.ts
│       └── processors/
└── exchanges/
    ├── coinbase/
    ├── kucoin/
    ├── kraken/
    └── ledgerlive/
```

**Total:** 17 blockchain API clients, 4 exchange adapters, ~160 infrastructure files

---

## Target Structure

```
packages/
├── providers/                       # NEW - Single unified package
│   ├── core/
│   │   ├── blockchain/
│   │   │   ├── base-client.ts
│   │   │   ├── provider-manager.ts
│   │   │   ├── registry/
│   │   │   └── types.ts
│   │   └── exchange/
│   │       └── base-client.ts
│   ├── blockchain/
│   │   ├── bitcoin/
│   │   │   ├── mempool-space/
│   │   │   │   ├── api-client.ts
│   │   │   │   ├── schemas.ts
│   │   │   │   ├── types.ts
│   │   │   │   └── mapper.ts
│   │   │   └── [4 more providers]
│   │   ├── evm/
│   │   ├── solana/
│   │   ├── cosmos/
│   │   └── substrate/
│   └── exchange/
│       ├── coinbase/
│       ├── kucoin/
│       ├── kraken/
│       └── shared/
│
└── import/                              # EXISTING (slimmed)
    └── infrastructure/
        └── blockchains/
            └── bitcoin/
                ├── importer.ts
                ├── processor.ts
                └── utils.ts
```

---

## What Gets Extracted to `@exitbook/providers`

### Core Infrastructure (`core/`)

- `BlockchainApiClient` base class
- `BlockchainProviderManager` (failover orchestration)
- `ProviderRegistry` system
- `@RegisterApiClient` decorator
- Provider types: `ProviderOperation`, `ProviderConfig`, `ProviderCapabilities`

### Blockchain Providers (`blockchain/`)

- All `*.api-client.ts` files
- All `*.mapper.ts` files (provider-specific)
- All `*.schemas.ts` files (both raw API and normalized)
- All `*.types.ts` files (both raw API and normalized)
- Provider-specific tests

### Exchange Providers (`exchange/`)

- Exchange API clients
- CSV parsers and shared utilities

### Stays in `@exitbook/import`

- `importer.ts` - Orchestration logic
- `processor.ts` - UniversalTransaction creation
- `utils.ts` - Domain utilities (xpub derivation, fund flow analysis)
- Import session management
- Transaction repository logic

---

## Key Architectural Decision

**Mappers move with API clients** because:

1. They are provider-specific (one mapper per API client)
2. They transform raw API data to normalized blockchain format
3. The normalized format (`BitcoinTransaction`) is not import-domain specific - it's a canonical blockchain representation
4. Keeping mappers with API clients makes the API provider package complete and self-contained

**The processor stays in import** because:

1. It transforms normalized blockchain data → `UniversalTransaction`
2. It contains import-domain logic (fund flow analysis, classification)
3. It uses `ImportSessionMetadata` for multi-address wallets

---

## Data Flow After Extraction

```
┌─────────────────────────────────────────────────────────────┐
│ @exitbook/providers                                     │
│ ┌─────────────┐      ┌────────────┐      ┌──────────────┐ │
│ │ API Client  │  →   │   Mapper   │  →   │ Normalized   │ │
│ │             │      │            │      │ Blockchain   │ │
│ │ Raw API     │      │ Raw → Norm │      │ Data         │ │
│ └─────────────┘      └────────────┘      └──────────────┘ │
└─────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────┐
│ @exitbook/import                                            │
│ ┌──────────────┐      ┌────────────┐      ┌──────────────┐│
│ │  Importer    │  →   │ Processor  │  →   │ Universal    ││
│ │              │      │            │      │ Transaction  ││
│ │ Orchestrate  │      │ Norm → Uni │      │              ││
│ └──────────────┘      └────────────┘      └──────────────┘│
└─────────────────────────────────────────────────────────────┘
```

---

## Dependencies After Extraction

```
@exitbook/providers
  (single package - no internal splits)
  ↑
@exitbook/import
  (depends on: providers)
```

**No circular dependencies.** The `@exitbook/providers` package never imports from `@exitbook/import`.

---

## Package Exports

```json
{
  "name": "@exitbook/providers",
  "exports": {
    ".": "./src/index.ts",
    "./core/*": "./src/core/*",
    "./blockchain/*": "./src/blockchain/*",
    "./exchange/*": "./src/exchange/*"
  }
}
```

---

## Migration Steps

### Phase 1: Create Package Structure

1. Create `packages/providers/`
2. Create subdirectories: `core/`, `blockchain/`, `exchange/`
3. Set up package.json with exports

### Phase 2: Move Core Infrastructure

1. Move `BlockchainApiClient`, `BlockchainProviderManager` to `core/blockchain/`
2. Move registry system to `core/blockchain/registry/`
3. Move types to `core/blockchain/types.ts`
4. Update imports in existing code
5. Verify tests pass

### Phase 3: Extract Bitcoin (Proof of Concept)

1. Create `packages/providers/blockchain/bitcoin/`
2. Move all 5 Bitcoin providers (API clients + mappers + schemas + types)
3. Update Bitcoin importer to import from new package
4. Update Bitcoin processor to receive normalized data from new package
5. Verify CLI works end-to-end
6. Run all tests

### Phase 4: Extract Remaining Blockchains

- EVM (5 providers)
- Solana (3 providers)
- Cosmos (1 provider)
- Substrate (2 providers)

### Phase 5: Extract Exchanges

- Coinbase, KuCoin, Kraken, Ledger Live

### Phase 6: Cleanup

- Remove old files from import package
- Update documentation
- Update build scripts
- Update root index.ts with proper exports

---

## Configuration

**Configuration stays in CLI app** (`apps/cli/config/blockchain-explorers.json`)

The `@exitbook/providers` package is configuration-agnostic. The CLI passes config at runtime:

```typescript
const config = loadConfig('./config/blockchain-explorers.json');
const providerManager = new BlockchainProviderManager(config);
const importer = new BitcoinImporter(providerManager);
```

---

## Import Path Changes

### Before

```typescript
// In Bitcoin importer
import { BlockchainApiClient } from '../shared/api/blockchain-api-client.ts';
import { MempoolSpaceMapper } from './mempool-space/mempool-space.mapper.ts';
```

### After

```typescript
// In Bitcoin importer
import { BlockchainApiClient } from '@exitbook/providers/core/blockchain';
import { MempoolSpaceMapper } from '@exitbook/providers/blockchain/bitcoin/mempool-space';
```

---

## Benefits

1. **Single Dependency:** Import package only depends on one new package
2. **Modularity:** API providers usable outside import context
3. **Smaller Import Package:** ~60% reduction in size (from ~160 to ~65 files)
4. **Independent Versioning:** API provider updates don't force import releases
5. **Clear Boundaries:** Data fetching vs domain logic separation
6. **Future Expansion:** Add new provider operations without touching import
7. **Simpler Management:** One package to version and publish

---

## Risks & Mitigations

| Risk                                 | Mitigation                                                             |
| ------------------------------------ | ---------------------------------------------------------------------- |
| Large single package                 | Still smaller than current import package; clear internal organization |
| Cross-package development complexity | Use pnpm workspace tools, good docs                                    |
| Version compatibility issues         | Use workspace protocol: `workspace:*`                                  |

---

## Success Criteria

- [ ] All API clients moved to `@exitbook/providers`
- [ ] All mappers moved with their API clients
- [ ] No circular dependencies
- [ ] All tests passing
- [ ] CLI commands work end-to-end
- [ ] Import package ~60% smaller
- [ ] Single, well-organized providers package

---

## Next Steps

1. Review and approve this plan
2. Create `packages/providers/` with core structure
3. Move core infrastructure (base classes, registry, manager)
4. Extract Bitcoin providers (proof of concept)
5. Iterate on remaining blockchains
6. Extract exchanges
7. Cleanup and documentation
