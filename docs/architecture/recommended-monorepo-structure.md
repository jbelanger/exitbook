## Recommended Monorepo Structure

```
crypto-portfolio-platform/
├── apps/
│   ├── api/                    # Main API server (NestJS)
│   ├── web/                    # Portfolio frontend (React/Next.js)
│   ├── cli/                    # CLI tool
│   └── admin/                  # Admin dashboard (optional)
├── packages/
│   ├── core/
│   │   ├── domain/            # Domain entities & business rules
│   │   ├── types/             # Shared TypeScript types
│   │   └── config/            # Configuration schemas
│   ├── import/
│   │   ├── blockchains/       # Blockchain-specific implementations
│   │   │   ├── bitcoin/       # Bitcoin adapter, providers & utilities
│   │   │   ├── ethereum/      # Ethereum adapter, providers & utilities
│   │   │   ├── avalanche/     # Avalanche adapter, providers & utilities
│   │   │   ├── solana/        # Solana adapter, providers & utilities
│   │   │   └── injective/     # Injective adapter, providers & utilities
│   │   ├── exchanges/         # Exchange adapters (CCXT, CSV, native)
│   │   ├── shared/            # Provider registry & shared utilities
│   │   ├── pipeline/          # Transaction processing pipeline
│   │   └── services/          # Import orchestration services
│   ├── portfolio/
│   │   ├── domain/            # Portfolio domain logic
│   │   ├── services/          # Portfolio calculations & analytics
│   │   ├── queries/           # Portfolio data queries
│   │   └── reports/           # Reporting & export functionality
│   ├── data/
│   │   ├── database/          # Database schemas & migrations
│   │   ├── repositories/      # Pure data access layer (CRUD operations)
│   │   ├── services/          # Domain services & business logic
│   │   └── cache/             # Redis & caching logic
│   ├── shared/
│   │   ├── auth/              # Authentication & authorization
│   │   ├── logger/            # Structured logging
│   │   ├── monitoring/        # Health checks & metrics
│   │   ├── validation/        # Input validation schemas
│   │   └── utils/             # Common utilities
│   └── ui/
│       ├── components/        # Shared React components
│       ├── charts/            # Portfolio visualization components
│       └── themes/            # Styling & themes
├── tools/
│   ├── eslint-config/         # Shared ESLint configuration
│   ├── tsconfig/              # TypeScript configurations
│   └── scripts/               # Build & deployment scripts
└── docs/
    ├── api/                   # API documentation
    ├── architecture/          # Architecture documentation
    └── deployment/            # Deployment guides
```

## Key Domain Separation Strategy

### 1. **Import Domain** (`packages/import/`)
Your existing sophisticated importer becomes a self-contained domain with blockchain-centric organization:

#### **Blockchain-Centric Structure**
Each blockchain is organized as a self-contained feature module:

```
packages/import/blockchains/bitcoin/
├── adapter.ts              # Bitcoin blockchain adapter
├── providers/
│   ├── mempool-space-provider.ts
│   ├── blockstream-provider.ts
│   ├── blockcypher-provider.ts
│   └── types.ts           # Bitcoin API response types
├── utils.ts               # Bitcoin-specific utilities
└── index.ts               # Public exports

packages/import/blockchains/ethereum/
├── adapter.ts              # Ethereum blockchain adapter  
├── providers/
│   ├── etherscan-provider.ts
│   ├── alchemy-provider.ts
│   ├── moralis-provider.ts
│   └── types.ts           # Ethereum API response types
├── utils.ts               # Ethereum-specific utilities
└── index.ts               # Public exports
```

#### **Import Services**
```typescript
// packages/import/services/transaction-importer.ts
export class TransactionImporter {
  async importFromExchanges(config: ExchangeImportConfig): Promise<ImportResult>
  async importFromBlockchain(config: BlockchainImportConfig): Promise<ImportResult>
  async verifyImportedData(importId: string): Promise<VerificationResult>
}

// packages/import/shared/provider-registry.ts
export class ProviderRegistry {
  // Your existing provider registry logic with circuit breakers
  // and multi-provider resilience
}
```

#### **Benefits of Blockchain-Centric Organization**
- **Feature Cohesion**: All Bitcoin-related code (adapter, providers, utils, types) lives together
- **Developer Experience**: Easy to find and modify blockchain-specific functionality
- **Clear Boundaries**: Each blockchain is a self-contained module with defined interfaces
- **Scalability**: Adding new blockchains follows a consistent, predictable pattern

### 2. **Portfolio Domain** (`packages/portfolio/`)
New portfolio functionality with clear boundaries:

```typescript
// packages/portfolio/domain/portfolio.ts
export class Portfolio {
  constructor(
    public readonly userId: string,
    private holdings: Map<string, Holding>,
    private transactions: Transaction[]
  ) {}

  calculateCurrentValue(prices: PriceMap): Money
  getPerformanceMetrics(timeframe: Timeframe): PerformanceMetrics
  generateReports(type: ReportType): Report
}

// packages/portfolio/services/portfolio-calculator.ts
export class PortfolioCalculator {
  calculateHoldings(transactions: Transaction[]): Holding[]
  calculateReturns(holdings: Holding[], prices: PriceMap): Returns
  calculateRisk(portfolio: Portfolio): RiskMetrics
}
```

### 3. **Shared Core** (`packages/core/`)
Common domain entities and types:

```typescript
// packages/core/domain/transaction.ts
export interface Transaction {
  id: string;
  type: TransactionType;
  symbol: string;
  amount: Money;
  timestamp: number;
  source: string;
  // ... your existing transaction structure
}

// packages/core/domain/money.ts
export class Money {
  // Your existing Money implementation with Decimal.js precision
}

// Example blockchain module usage
// packages/import/blockchains/bitcoin/index.ts
export { BitcoinAdapter } from './adapter.ts';
export { MempoolSpaceProvider, BlockstreamProvider } from './providers/index.ts';
export { BitcoinUtils } from './utils.ts';
export * from './providers/types.ts';

// Clean import pattern
import { BitcoinAdapter, MempoolSpaceProvider } from '@crypto/import/blockchains/bitcoin';
```

## Application Layer Structure

### **API Server** (`apps/api/`)
NestJS application with clear module separation:

```typescript
// apps/api/src/app.module.ts
@Module({
  imports: [
    // Domain modules
    ImportModule,      // Import-related endpoints
    PortfolioModule,   // Portfolio-related endpoints
    AuthModule,        // Authentication
    HealthModule,      // Health checks
  ],
})
export class AppModule {}

// apps/api/src/import/import.module.ts
@Module({
  imports: [ImportServiceModule], // From packages/import
  controllers: [ImportController],
  providers: [ImportService],
})
export class ImportModule {}

// apps/api/src/portfolio/portfolio.module.ts
@Module({
  imports: [PortfolioServiceModule], // From packages/portfolio
  controllers: [PortfolioController],
  providers: [PortfolioService],
})
export class PortfolioModule {}
```

### **CLI Tool** (`apps/cli/`)
Commander.js with domain-specific commands:

```typescript
// apps/cli/src/commands/import.ts
export class ImportCommand {
  @Command('import:exchange')
  async importExchange(
    @Option('exchange') exchange: string,
    @Option('config') config: string
  ) {
    const importer = new TransactionImporter();
    return importer.importFromExchanges(/* config */);
  }

  @Command('import:blockchain')
  async importBlockchain(
    @Option('blockchain') blockchain: string,
    @Option('addresses') addresses: string[]
  ) {
    const importer = new TransactionImporter();
    return importer.importFromBlockchain({
      blockchain,
      addresses,
      // Uses blockchain-specific adapter automatically
    });
  }
}

// apps/cli/src/commands/portfolio.ts
export class PortfolioCommand {
  @Command('portfolio:analyze')
  async analyzePortfolio(
    @Option('user') userId: string,
    @Option('timeframe') timeframe: string
  ) {
    const calculator = new PortfolioCalculator();
    return calculator.analyzePerformance(/* params */);
  }
}
```

### **Web Frontend** (`apps/web/`)
React/Next.js with feature-based organization:

```typescript
// apps/web/src/features/import/
├── components/
│   ├── ImportWizard.tsx
│   ├── ExchangeSelector.tsx
│   └── ImportProgress.tsx
├── hooks/
│   ├── useImportStatus.ts
│   └── useExchangeList.ts
└── pages/
    └── ImportPage.tsx

// apps/web/src/features/portfolio/
├── components/
│   ├── PortfolioDashboard.tsx
│   ├── HoldingsTable.tsx
│   └── PerformanceChart.tsx
├── hooks/
│   ├── usePortfolioData.ts
│   └── usePerformanceMetrics.ts
└── pages/
    └── PortfolioPage.tsx
```

## Package Dependencies Strategy

### **Dependency Flow**
```
apps/api     → packages/import, packages/portfolio, packages/data
apps/web     → packages/ui, packages/core/types
apps/cli     → packages/import, packages/portfolio, packages/core

packages/import              → packages/core, packages/data, packages/shared
  └── blockchains/bitcoin    → packages/core, packages/shared
  └── blockchains/ethereum   → packages/core, packages/shared
  └── exchanges              → packages/core, packages/shared
  └── shared                 → packages/core

packages/portfolio → packages/core, packages/data, packages/shared
packages/data      → packages/core
packages/shared    → packages/core
```

### **Internal Import Structure**
Each blockchain module is self-contained with clean exports:

```typescript
// ✅ Good - Import from blockchain module
import { BitcoinAdapter, BitcoinUtils } from '@crypto/import/blockchains/bitcoin';

// ✅ Good - Import shared registry
import { ProviderRegistry } from '@crypto/import/shared';

// ❌ Avoid - Deep imports into internal structure
import { MempoolSpaceProvider } from '@crypto/import/blockchains/bitcoin/providers/mempool-space-provider';
```

### **Package.json Workspace Structure**
```json
{
  "name": "crypto-portfolio-platform",
  "workspaces": [
    "apps/*",
    "packages/*",
    "tools/*"
  ],
  "scripts": {
    "dev:api": "pnpm --filter api dev",
    "dev:web": "pnpm --filter web dev",
    "build": "pnpm -r build",
    "test": "pnpm -r test",
    "import:exchange": "pnpm --filter cli run import:exchange",
    "portfolio:analyze": "pnpm --filter cli run portfolio:analyze"
  }
}
```

## Inter-Domain Communication

### **Event-Driven Architecture**
Implement domain events for loose coupling:

```typescript
// packages/core/events/domain-events.ts
export interface TransactionImportCompleted {
  type: 'TransactionImportCompleted';
  importId: string;
  userId: string;
  transactionCount: number;
  timestamp: number;
}

// packages/portfolio/event-handlers/import-completed.handler.ts
@EventHandler(TransactionImportCompleted)
export class ImportCompletedHandler {
  async handle(event: TransactionImportCompleted) {
    // Trigger portfolio recalculation
    await this.portfolioService.recalculatePortfolio(event.userId);
  }
}
```

### **Shared Database with Domain Boundaries**
```sql
-- Import domain tables
transactions
import_logs
provider_health

-- Portfolio domain tables  
portfolios
holdings
performance_snapshots

-- Shared tables
users
wallet_addresses
exchange_info
```

## Development Workflow

### **Independent Development**
```bash
# Work on import features
pnpm --filter @crypto/import dev
pnpm --filter @crypto/import test

# Work on portfolio features  
pnpm --filter @crypto/portfolio dev
pnpm --filter @crypto/portfolio test

# Full stack development
pnpm dev:api &
pnpm dev:web &
```

### **Deployment Strategy**
```bash
# Deploy API with both domains
pnpm --filter api build
pnpm --filter api deploy

# Deploy CLI tool
pnpm --filter cli build
pnpm --filter cli package

# Deploy frontend
pnpm --filter web build
pnpm --filter web deploy
```

## Benefits of This Structure

### **Domain-Level Benefits**
1. **Clear Domain Boundaries** - Import and portfolio logic completely separated
2. **Reusable Packages** - CLI and API can share the same business logic
3. **Independent Scaling** - Each domain can evolve independently
4. **Testing Isolation** - Domain-specific testing strategies
5. **Team Organization** - Different teams can own different packages
6. **Deployment Flexibility** - Can deploy domains separately if needed

### **Blockchain-Centric Benefits**
7. **Feature Cohesion** - All blockchain-related code grouped together (adapter + providers + utilities)
8. **Developer Productivity** - Easy to find and modify blockchain-specific functionality
9. **Consistent Patterns** - Each blockchain follows the same organizational structure
10. **Type Safety** - Provider-specific API types are co-located with their implementations
11. **Reduced Context Switching** - Working on Bitcoin features doesn't require jumping between distant folders
12. **Self-Documenting** - Clear directory structure makes the codebase architecture obvious
13. **Plugin-like Architecture** - Easy to add/remove blockchain support by adding/removing directories
