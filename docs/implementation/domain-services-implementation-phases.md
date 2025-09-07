# Domain Services & Business Logic Engines - Implementation Strategy

**Date**: 2025-09-04  
**Status**: Implementation Planning  
**Scope**: Phase-by-phase implementation of domain services outlined in project strategy

## Executive Summary

This document outlines a comprehensive 6-phase implementation strategy for the Domain Services & Business Logic Engines. Each phase builds upon the previous one, delivering incremental business value while maintaining architectural integrity.

**Total Estimated Timeline**: 16-20 weeks  
**Complexity**: High (Financial domain with regulatory requirements)  
**Risk Level**: Medium-High (Tax calculations, security, performance)

## Phase Overview

| Phase | Focus Area                      | Duration  | Business Value | Technical Risk |
| ----- | ------------------------------- | --------- | -------------- | -------------- |
| 1     | Service Interfaces & Foundation | 2-3 weeks | Low            | Low            |
| 2     | Portfolio Valuation Services    | 3-4 weeks | High           | Medium         |
| 3     | Tax Calculation Engine          | 4-5 weeks | Very High      | High           |
| 4     | Advanced Transaction Handling   | 2-3 weeks | Medium         | Medium         |
| 5     | Data Integrity & User Control   | 3-4 weeks | High           | Medium         |
| 6     | System & Security Integration   | 2-3 weeks | Medium         | High           |

---

## Phase 1: Service Interfaces & Foundation

**Duration**: 2-3 weeks  
**Priority**: Critical (Enables parallel development)  
**Business Value**: Low (Infrastructure)  
**Technical Risk**: Low

### Objectives

- Define all service contracts and interfaces
- Expand existing domain enums for DeFi/NFT support
- Establish domain events infrastructure
- Create mock implementations for testing

### Detailed Implementation Plan

#### 1.1 Service Interface Contracts (Week 1)

**Price Provider Interfaces**

```typescript
// libs/providers/src/pricing/price-provider.interface.ts
export const IHistoricalPriceProvider = Symbol('IHistoricalPriceProvider');
export const IRealTimePriceProvider = Symbol('IRealTimePriceProvider');

export interface IHistoricalPriceProvider {
  fetchPrice(
    baseAsset: string,
    quoteAsset: string,
    timestamp: Date,
    options?: PriceProviderOptions
  ): Promise<Result<PriceResponse, PriceProviderError>>;

  isAvailable(baseAsset: string, quoteAsset: string): Promise<boolean>;
  getSupportedPairs(): Promise<string[]>;
  getProviderStatus(): Promise<ProviderHealthStatus>;
}

export interface IRealTimePriceProvider {
  fetchPrices(
    baseAssets: string[],
    quoteAsset: string
  ): Promise<Result<Map<string, PriceResponse>, PriceProviderError>>;

  subscribeToUpdates(pairs: TradingPair[], callback: (updates: PriceUpdate[]) => void): Promise<Subscription>;
}

interface PriceProviderOptions {
  allowApproximateTimestamp?: boolean;
  maxAgeMinutes?: number;
  fallbackToNearest?: boolean;
  requiredConfidence?: number; // 0-1 scale
}

interface PriceResponse {
  price: Money;
  timestamp: Date;
  confidence: number;
  source: string;
  approximated: boolean;
}
```

**Portfolio Services Interfaces**

```typescript
// libs/core/src/services/portfolio-valuation.interface.ts
export const IPortfolioValuationService = Symbol('IPortfolioValuationService');

export interface IPortfolioValuationService {
  calculatePortfolioSnapshot(
    userId: string,
    baseCurrency: string,
    options?: PortfolioOptions
  ): Promise<Result<PortfolioSnapshot, PortfolioError>>;

  calculateAssetAllocation(userId: string): Promise<Result<AssetAllocation[], PortfolioError>>;
  calculatePerformanceMetrics(userId: string, period: TimePeriod): Promise<Result<PerformanceMetrics, PortfolioError>>;
}

interface PortfolioOptions {
  includeSmallBalances?: boolean;
  minBalanceThreshold?: Money;
  asOfTimestamp?: Date;
}
```

**Tax Calculation Interfaces**

```typescript
// libs/core/src/services/cost-basis-engine.interface.ts
export const ICostBasisEngine = Symbol('ICostBasisEngine');

export interface ICostBasisEngine {
  calculateRealizedGains(
    userId: string,
    disposalEvent: DisposalEvent,
    accountingMethod: AccountingMethod
  ): Promise<Result<RealizedGainsResult, TaxCalculationError>>;

  generateTaxReport(
    userId: string,
    taxYear: number,
    reportFormat: TaxReportFormat
  ): Promise<Result<TaxReport, TaxCalculationError>>;
}

export enum AccountingMethod {
  FIFO = 'FIFO',
  LIFO = 'LIFO',
  HIFO = 'HIFO',
  SPECIFIC_ID = 'SPECIFIC_ID',
}
```

#### 1.2 Domain Enum Expansions (Week 1)

**Enhanced AccountType Enum**

```typescript
// libs/core/src/aggregates/account/account.aggregate.ts
export enum AccountType {
  // Existing asset types
  ASSET_WALLET = 'ASSET_WALLET',
  ASSET_EXCHANGE = 'ASSET_EXCHANGE',
  ASSET_DEFI_LP = 'ASSET_DEFI_LP',

  // New DeFi & NFT asset types
  ASSET_NFT_WALLET = 'ASSET_NFT_WALLET',
  ASSET_NFT_COLLECTION = 'ASSET_NFT_COLLECTION',
  ASSET_LP_TOKEN = 'ASSET_LP_TOKEN',
  ASSET_YIELD_BEARING = 'ASSET_YIELD_BEARING',
  ASSET_DERIVATIVE = 'ASSET_DERIVATIVE',

  // Enhanced income types
  INCOME_STAKING = 'INCOME_STAKING',
  INCOME_MINING = 'INCOME_MINING',
  INCOME_TRADING = 'INCOME_TRADING',
  INCOME_AIRDROP = 'INCOME_AIRDROP',
  INCOME_LP_FEES = 'INCOME_LP_FEES',
  INCOME_YIELD_FARMING = 'INCOME_YIELD_FARMING',
  INCOME_LIQUIDITY_REWARDS = 'INCOME_LIQUIDITY_REWARDS',
  INCOME_REFERRAL = 'INCOME_REFERRAL',

  // Enhanced expense types
  EXPENSE_FEES_GAS = 'EXPENSE_FEES_GAS',
  EXPENSE_FEES_TRADE = 'EXPENSE_FEES_TRADE',
  EXPENSE_FEES_NETWORK = 'EXPENSE_FEES_NETWORK',
  EXPENSE_SLIPPAGE = 'EXPENSE_SLIPPAGE',
  EXPENSE_MEV = 'EXPENSE_MEV',
  EXPENSE_BRIDGE_FEES = 'EXPENSE_BRIDGE_FEES',

  // Liability types
  LIABILITY_LOAN = 'LIABILITY_LOAN',
  LIABILITY_FLASH_LOAN = 'LIABILITY_FLASH_LOAN',
  LIABILITY_BORROWING = 'LIABILITY_BORROWING',

  // Equity types
  EQUITY_OPENING_BALANCE = 'EQUITY_OPENING_BALANCE',
  EQUITY_MANUAL_ADJUSTMENT = 'EQUITY_MANUAL_ADJUSTMENT',
}
```

**New EntryType Enum**

```typescript
// libs/database/src/schema/ledger.ts
export const entryTypeEnum = pgEnum('entry_type', [
  // Basic transaction types
  'TRADE',
  'DEPOSIT',
  'WITHDRAWAL',
  'FEE',
  'REWARD',
  'TRANSFER',

  // DeFi-specific types
  'SWAP',
  'ADD_LIQUIDITY',
  'REMOVE_LIQUIDITY',
  'STAKE',
  'UNSTAKE',
  'BORROW',
  'REPAY',
  'LIQUIDATION',

  // NFT types
  'NFT_MINT',
  'NFT_BURN',
  'NFT_TRANSFER',

  // Advanced types
  'BRIDGE',
  'YIELD_HARVEST',
  'GOVERNANCE_VOTE',
  'FLASHLOAN',
]);
```

#### 1.3 Domain Events Infrastructure (Week 2)

**Base Domain Event Classes**

```typescript
// libs/core/src/events/base-domain-event.ts
export abstract class DomainEvent {
  public readonly eventId: string;
  public readonly eventType: string;
  public readonly aggregateId: string;
  public readonly userId: string;
  public readonly occurredAt: Date;
  public readonly version: number;

  protected constructor(aggregateId: string, userId: string, eventType: string, version: number = 1) {
    this.eventId = crypto.randomUUID();
    this.aggregateId = aggregateId;
    this.userId = userId;
    this.eventType = eventType;
    this.occurredAt = new Date();
    this.version = version;
  }

  abstract getEventData(): Record<string, unknown>;
}
```

**Portfolio-Specific Events**

```typescript
// libs/core/src/events/portfolio-events.ts
export class AssetAcquired extends DomainEvent {
  constructor(
    public readonly transactionId: string,
    public readonly userId: string,
    public readonly asset: AssetId,
    public readonly quantity: Money,
    public readonly costBasis: Money,
    public readonly acquisitionMethod: 'PURCHASE' | 'REWARD' | 'AIRDROP' | 'MINING'
  ) {
    super(transactionId, userId, 'AssetAcquired');
  }

  getEventData() {
    return {
      asset: this.asset,
      quantity: this.quantity.value.toString(),
      costBasis: this.costBasis.value.toString(),
      acquisitionMethod: this.acquisitionMethod,
    };
  }
}

export class AssetDisposed extends DomainEvent {
  constructor(
    public readonly transactionId: string,
    public readonly userId: string,
    public readonly asset: AssetId,
    public readonly quantity: Money,
    public readonly disposalMethod: 'SALE' | 'TRADE' | 'SPEND'
  ) {
    super(transactionId, userId, 'AssetDisposed');
  }

  getEventData() {
    return {
      asset: this.asset,
      quantity: this.quantity.value.toString(),
      disposalMethod: this.disposalMethod,
    };
  }
}
```

#### 1.4 Mock Implementations (Week 2-3)

**Mock Price Provider**

```typescript
// libs/providers/src/pricing/mock-price-provider.ts
@Injectable()
export class MockPriceProvider implements IHistoricalPriceProvider, IRealTimePriceProvider {
  private readonly mockPrices = new Map<string, Money>();

  constructor() {
    // Initialize with common crypto prices
    this.mockPrices.set('BTC-USD', Money.fromDecimal(45000, 'USD', 2).unwrap());
    this.mockPrices.set('ETH-USD', Money.fromDecimal(3000, 'USD', 2).unwrap());
    this.mockPrices.set('USDC-USD', Money.fromDecimal(1, 'USD', 2).unwrap());
  }

  async fetchPrice(
    baseAsset: string,
    quoteAsset: string,
    timestamp: Date,
    options?: PriceProviderOptions
  ): Promise<Result<PriceResponse, PriceProviderError>> {
    const pair = `${baseAsset}-${quoteAsset}`;
    const mockPrice = this.mockPrices.get(pair);

    if (!mockPrice) {
      return err(new PriceNotFoundError(baseAsset, quoteAsset, timestamp));
    }

    // Add some realistic variance
    const variance = 0.02; // 2% variance
    const multiplier = 1 + (Math.random() - 0.5) * variance;
    const adjustedPrice = mockPrice.multiply(multiplier.toString()).unwrap();

    return ok({
      price: adjustedPrice,
      timestamp,
      confidence: 0.95,
      source: 'mock-provider',
      approximated: false,
    });
  }

  async fetchPrices(
    baseAssets: string[],
    quoteAsset: string
  ): Promise<Result<Map<string, PriceResponse>, PriceProviderError>> {
    const results = new Map<string, PriceResponse>();

    for (const asset of baseAssets) {
      const priceResult = await this.fetchPrice(asset, quoteAsset, new Date());
      if (priceResult.isOk()) {
        results.set(asset, priceResult.value);
      }
    }

    return ok(results);
  }

  async isAvailable(baseAsset: string, quoteAsset: string): Promise<boolean> {
    return this.mockPrices.has(`${baseAsset}-${quoteAsset}`);
  }

  async getSupportedPairs(): Promise<string[]> {
    return Array.from(this.mockPrices.keys());
  }

  async getProviderStatus(): Promise<ProviderHealthStatus> {
    return {
      isHealthy: true,
      lastUpdated: new Date(),
      responseTimeMs: 50,
      errorRate: 0,
    };
  }
}
```

### Success Criteria Phase 1

- [ ] All service interfaces defined and documented
- [ ] Enhanced enums implemented and tested
- [ ] Domain events infrastructure working
- [ ] Mock implementations pass basic tests
- [ ] NestJS dependency injection configured for all interfaces
- [ ] Integration tests demonstrate interface contracts work

### Dependencies & Blockers

- **None** - This phase is foundational and has no external dependencies
- **Risk**: Over-engineering interfaces before understanding requirements

---

## Phase 2: Portfolio Valuation Services

**Duration**: 3-4 weeks  
**Priority**: High (First major business value delivery)  
**Business Value**: High (Core user-facing feature)  
**Technical Risk**: Medium (Price provider integration, performance)

### Objectives

- Implement real-time portfolio valuation service
- Create balance calculation and aggregation engine
- Build portfolio snapshot generation
- Establish performance benchmarks for large portfolios
- Deliver first user-facing financial insights

### Phase 2 Dependencies

- ✅ Phase 1: Service interfaces and mock price provider
- ⚠️ External: Real price provider integration (CoinGecko/CoinMarketCap API)
- ⚠️ Database: Portfolio snapshot caching strategy

### Detailed Implementation Plan

#### 2.1 Enhanced Balance Calculation Service (Week 1)

**Current State**: Basic `BalanceCalculatorService` exists but lacks aggregation and multi-currency support

**Enhanced Implementation**:

```typescript
// libs/core/src/services/enhanced-balance-calculator.service.ts
@Injectable()
export class EnhancedBalanceCalculatorService {
  constructor(
    private readonly entryRepository: IEntryRepository,
    private readonly accountRepository: IAccountRepository,
    private readonly currencyRepository: ICurrencyRepository,
    private readonly logger: LoggerService
  ) {}

  /**
   * Calculate all asset balances for a user across all accounts
   */
  async calculateAllBalances(
    userId: string,
    options?: BalanceCalculationOptions
  ): Promise<Result<AssetBalance[], BalanceCalculationError>> {
    const startTime = Date.now();

    try {
      // Get all user accounts
      const accountsResult = await this.accountRepository.findByUserId(userId);
      if (accountsResult.isErr()) {
        return err(new BalanceCalculationError('Failed to fetch user accounts', accountsResult.error));
      }

      // Calculate balances for each asset
      const balancePromises = this.groupAccountsByCurrency(accountsResult.value).map(([currency, accounts]) =>
        this.calculateAssetBalance(userId, currency, accounts, options)
      );

      const balanceResults = await Promise.all(balancePromises);
      const failures = balanceResults.filter(result => result.isErr());

      if (failures.length > 0) {
        this.logger.warn(`Failed to calculate ${failures.length} asset balances for user ${userId}`);
      }

      const successfulBalances = balanceResults
        .filter(result => result.isOk())
        .map(result => result.value)
        .filter(balance => !balance.totalQuantity.isZero() || options?.includeZeroBalances);

      const duration = Date.now() - startTime;
      this.logger.log(`Calculated ${successfulBalances.length} balances for user ${userId} in ${duration}ms`);

      return ok(successfulBalances);
    } catch (error) {
      return err(new BalanceCalculationError('Unexpected error in balance calculation', error));
    }
  }

  /**
   * Calculate balance for a specific asset across all user accounts
   */
  async calculateAssetBalance(
    userId: string,
    currencyTicker: string,
    accounts: Account[],
    options?: BalanceCalculationOptions
  ): Promise<Result<AssetBalance, BalanceCalculationError>> {
    // Get currency metadata for proper decimal handling
    const currencyResult = await this.currencyRepository.findByTicker(currencyTicker);
    if (currencyResult.isErr()) {
      return err(new BalanceCalculationError(`Currency ${currencyTicker} not found`));
    }

    const currency = currencyResult.value;
    const asOfTimestamp = options?.asOfTimestamp || new Date();

    // Calculate balance for each account
    const accountBalances = await Promise.all(
      accounts.map(account => this.calculateAccountBalance(account, asOfTimestamp))
    );

    const successfulBalances = accountBalances.filter(result => result.isOk()).map(result => result.value);

    if (successfulBalances.length === 0) {
      return ok(this.createZeroBalance(currency, accounts));
    }

    // Aggregate across all accounts
    const totalQuantity = successfulBalances.reduce(
      (sum, balance) => sum.add(balance.quantity).unwrap(),
      Money.zero(currencyTicker, currency.decimals).unwrap()
    );

    const assetBalance: AssetBalance = {
      asset: {
        ticker: currencyTicker,
        name: currency.name,
        decimals: currency.decimals,
        assetClass: currency.assetClass,
      },
      totalQuantity,
      accountBreakdown: successfulBalances,
      lastUpdated: new Date(),
    };

    return ok(assetBalance);
  }

  private async calculateAccountBalance(
    account: Account,
    asOfTimestamp: Date
  ): Promise<Result<AccountBalance, BalanceCalculationError>> {
    // Reuse existing balance calculation but with timestamp filtering
    const entriesResult = await this.entryRepository.findByAccountAndDateRange(
      account.id!,
      new Date(0), // From beginning
      asOfTimestamp
    );

    if (entriesResult.isErr()) {
      return err(new BalanceCalculationError(`Failed to fetch entries for account ${account.id}`));
    }

    const entries = entriesResult.value;
    let balance = Money.zero(account.currencyTicker, 8).unwrap(); // TODO: Get decimals from currency

    for (const entry of entries) {
      if (entry.direction === 'CREDIT') {
        balance = balance.add(entry.amount).unwrap();
      } else {
        balance = balance.subtract(entry.amount).unwrap();
      }
    }

    return ok({
      account: {
        id: account.id!,
        name: account.name,
        type: account.type,
        source: account.source,
      },
      quantity: balance,
      lastTransactionDate: entries.length > 0 ? entries[entries.length - 1].createdAt : null,
    });
  }

  private groupAccountsByCurrency(accounts: Account[]): [string, Account[]][] {
    const grouped = new Map<string, Account[]>();

    for (const account of accounts) {
      if (!grouped.has(account.currencyTicker)) {
        grouped.set(account.currencyTicker, []);
      }
      grouped.get(account.currencyTicker)!.push(account);
    }

    return Array.from(grouped.entries());
  }

  private createZeroBalance(currency: any, accounts: Account[]): AssetBalance {
    const zeroQuantity = Money.zero(currency.ticker, currency.decimals).unwrap();

    return {
      asset: {
        ticker: currency.ticker,
        name: currency.name,
        decimals: currency.decimals,
        assetClass: currency.assetClass,
      },
      totalQuantity: zeroQuantity,
      accountBreakdown: accounts.map(account => ({
        account: {
          id: account.id!,
          name: account.name,
          type: account.type,
          source: account.source,
        },
        quantity: zeroQuantity,
        lastTransactionDate: null,
      })),
      lastUpdated: new Date(),
    };
  }
}

// Supporting types
interface BalanceCalculationOptions {
  asOfTimestamp?: Date;
  includeZeroBalances?: boolean;
  excludeAccountTypes?: AccountType[];
}

interface AssetBalance {
  asset: AssetInfo;
  totalQuantity: Money;
  accountBreakdown: AccountBalance[];
  lastUpdated: Date;
}

interface AccountBalance {
  account: {
    id: number;
    name: string;
    type: AccountType;
    source: string;
  };
  quantity: Money;
  lastTransactionDate: Date | null;
}
```

#### 2.2 Portfolio Valuation Service Implementation (Week 2)

**Core Portfolio Valuation Logic**:

```typescript
// libs/core/src/services/portfolio-valuation.service.ts
@Injectable()
export class PortfolioValuationService implements IPortfolioValuationService {
  private readonly CACHE_TTL_MINUTES = 5; // Cache portfolio snapshots for 5 minutes

  constructor(
    private readonly balanceCalculator: EnhancedBalanceCalculatorService,
    private readonly realTimePriceProvider: IRealTimePriceProvider,
    private readonly portfolioCache: IPortfolioCache,
    private readonly logger: LoggerService
  ) {}

  async calculatePortfolioSnapshot(
    userId: string,
    baseCurrency: string = 'USD',
    options?: PortfolioOptions
  ): Promise<Result<PortfolioSnapshot, PortfolioError>> {
    const startTime = Date.now();

    try {
      // Check cache first (for real-time price data, short cache is acceptable)
      const cacheKey = this.generateCacheKey(userId, baseCurrency, options);
      const cachedSnapshot = await this.portfolioCache.get(cacheKey);

      if (cachedSnapshot && this.isCacheValid(cachedSnapshot, this.CACHE_TTL_MINUTES)) {
        this.logger.log(`Portfolio snapshot cache hit for user ${userId}`);
        return ok(cachedSnapshot);
      }

      // Calculate fresh snapshot
      const snapshotResult = await this.calculateFreshSnapshot(userId, baseCurrency, options);

      if (snapshotResult.isOk()) {
        // Cache the result
        await this.portfolioCache.set(cacheKey, snapshotResult.value, this.CACHE_TTL_MINUTES * 60);

        const duration = Date.now() - startTime;
        this.logger.log(`Generated fresh portfolio snapshot for user ${userId} in ${duration}ms`);
      }

      return snapshotResult;
    } catch (error) {
      return err(new PortfolioError('Failed to calculate portfolio snapshot', error));
    }
  }

  private async calculateFreshSnapshot(
    userId: string,
    baseCurrency: string,
    options?: PortfolioOptions
  ): Promise<Result<PortfolioSnapshot, PortfolioError>> {
    // Step 1: Get all asset balances
    const balancesResult = await this.balanceCalculator.calculateAllBalances(userId, {
      asOfTimestamp: options?.asOfTimestamp,
      includeZeroBalances: false,
    });

    if (balancesResult.isErr()) {
      return err(new PortfolioError('Failed to calculate asset balances', balancesResult.error));
    }

    const assetBalances = balancesResult.value;

    // Filter small balances if requested
    const filteredBalances =
      options?.includeSmallBalances === false
        ? this.filterSmallBalances(assetBalances, options.minBalanceThreshold)
        : assetBalances;

    if (filteredBalances.length === 0) {
      return ok(this.createEmptyPortfolio(baseCurrency));
    }

    // Step 2: Get current prices for all assets
    const assetTickers = filteredBalances.map(balance => balance.asset.ticker);
    const pricesResult = await this.realTimePriceProvider.fetchPrices(assetTickers, baseCurrency);

    if (pricesResult.isErr()) {
      return err(new PortfolioError('Failed to fetch current prices', pricesResult.error));
    }

    const prices = pricesResult.value;

    // Step 3: Calculate holdings with valuations
    const holdings: Holding[] = [];
    let totalValue = Money.zero(baseCurrency, 2).unwrap(); // Assume 2 decimals for fiat

    for (const assetBalance of filteredBalances) {
      const priceResponse = prices.get(assetBalance.asset.ticker);

      if (!priceResponse) {
        this.logger.warn(`No price found for ${assetBalance.asset.ticker}, excluding from portfolio`);
        continue;
      }

      // Calculate current value
      const currentValue = this.calculateAssetValue(assetBalance.totalQuantity, priceResponse.price, baseCurrency);

      if (currentValue.isErr()) {
        this.logger.warn(`Failed to calculate value for ${assetBalance.asset.ticker}: ${currentValue.error.message}`);
        continue;
      }

      const holding: Holding = {
        asset: assetBalance.asset,
        quantity: assetBalance.totalQuantity,
        currentPrice: priceResponse.price,
        currentValue: currentValue.value,
        // Note: costBasis and unrealizedGain will be calculated in Phase 3 (Tax Engine)
        costBasis: Money.zero(baseCurrency, 2).unwrap(),
        unrealizedGain: Money.zero(baseCurrency, 2).unwrap(),
        gainLossPercentage: 0,
        priceConfidence: priceResponse.confidence,
        lastPriceUpdate: priceResponse.timestamp,
      };

      holdings.push(holding);
      totalValue = totalValue.add(currentValue.value).unwrap();
    }

    // Sort holdings by value (largest first)
    holdings.sort((a, b) => {
      const comparison = b.currentValue.compare(a.currentValue);
      return comparison.isOk() ? comparison.value : 0;
    });

    const portfolioSnapshot: PortfolioSnapshot = {
      totalValue,
      totalCostBasis: Money.zero(baseCurrency, 2).unwrap(), // Phase 3
      totalUnrealizedGain: Money.zero(baseCurrency, 2).unwrap(), // Phase 3
      holdings,
      asOfTimestamp: new Date(),
      baseCurrency,
      metadata: {
        totalAssets: holdings.length,
        averagePriceConfidence: this.calculateAverageConfidence(holdings),
        cacheGenerated: true,
      },
    };

    return ok(portfolioSnapshot);
  }

  private calculateAssetValue(quantity: Money, price: Money, baseCurrency: string): Result<Money, PortfolioError> {
    // Handle unit conversion: quantity (asset units) * price (baseCurrency per asset unit)
    const valueResult = quantity.multiply(price.toFixedString());

    if (valueResult.isErr()) {
      return err(new PortfolioError(`Failed to calculate value: ${valueResult.error.message}`));
    }

    // Convert result to base currency with appropriate decimals
    return Money.fromDecimal(valueResult.value.toDecimal(), baseCurrency, 2);
  }

  private filterSmallBalances(balances: AssetBalance[], minThreshold?: Money): AssetBalance[] {
    if (!minThreshold) {
      return balances;
    }

    // Note: This filtering logic will be enhanced in Phase 3 when we have cost basis
    // For now, we can't filter by USD value without price data
    return balances;
  }

  private calculateAverageConfidence(holdings: Holding[]): number {
    if (holdings.length === 0) return 1.0;

    const totalConfidence = holdings.reduce((sum, holding) => sum + holding.priceConfidence, 0);
    return totalConfidence / holdings.length;
  }

  private createEmptyPortfolio(baseCurrency: string): PortfolioSnapshot {
    return {
      totalValue: Money.zero(baseCurrency, 2).unwrap(),
      totalCostBasis: Money.zero(baseCurrency, 2).unwrap(),
      totalUnrealizedGain: Money.zero(baseCurrency, 2).unwrap(),
      holdings: [],
      asOfTimestamp: new Date(),
      baseCurrency,
      metadata: {
        totalAssets: 0,
        averagePriceConfidence: 1.0,
        cacheGenerated: true,
      },
    };
  }

  private generateCacheKey(userId: string, baseCurrency: string, options?: PortfolioOptions): string {
    const optionsHash = options ? JSON.stringify(options) : '';
    return `portfolio:${userId}:${baseCurrency}:${optionsHash}`;
  }

  private isCacheValid(snapshot: PortfolioSnapshot, maxAgeMinutes: number): boolean {
    const maxAge = maxAgeMinutes * 60 * 1000; // Convert to milliseconds
    const age = Date.now() - snapshot.asOfTimestamp.getTime();
    return age < maxAge;
  }
}
```

#### 2.3 CQRS Query Handlers (Week 3)

**Portfolio Query Handlers**:

```typescript
// libs/core/src/queries/handlers/get-portfolio-snapshot.handler.ts
@QueryHandler(GetPortfolioSnapshotQuery)
export class GetPortfolioSnapshotHandler implements IQueryHandler<GetPortfolioSnapshotQuery> {
  constructor(
    private readonly portfolioService: IPortfolioValuationService,
    private readonly logger: LoggerService
  ) {}

  async execute(query: GetPortfolioSnapshotQuery): Promise<PortfolioSnapshotDto> {
    const { userId, baseCurrency, options } = query;

    this.logger.log(`Executing portfolio snapshot query for user ${userId}`);

    const result = await this.portfolioService.calculatePortfolioSnapshot(userId, baseCurrency, options);

    if (result.isErr()) {
      throw new PortfolioCalculationException(
        `Failed to calculate portfolio snapshot: ${result.error.message}`,
        result.error
      );
    }

    // Convert domain object to DTO
    return this.mapToDto(result.value);
  }

  private mapToDto(snapshot: PortfolioSnapshot): PortfolioSnapshotDto {
    return {
      totalValue: this.mapMoneyToDto(snapshot.totalValue),
      totalCostBasis: this.mapMoneyToDto(snapshot.totalCostBasis),
      totalUnrealizedGain: this.mapMoneyToDto(snapshot.totalUnrealizedGain),
      holdings: snapshot.holdings.map(holding => ({
        asset: {
          ticker: holding.asset.ticker,
          name: holding.asset.name,
          assetClass: holding.asset.assetClass,
        },
        quantity: this.mapMoneyToDto(holding.quantity),
        currentPrice: this.mapMoneyToDto(holding.currentPrice),
        currentValue: this.mapMoneyToDto(holding.currentValue),
        costBasis: this.mapMoneyToDto(holding.costBasis),
        unrealizedGain: this.mapMoneyToDto(holding.unrealizedGain),
        gainLossPercentage: holding.gainLossPercentage,
        priceConfidence: holding.priceConfidence,
        lastPriceUpdate: holding.lastPriceUpdate.toISOString(),
      })),
      asOfTimestamp: snapshot.asOfTimestamp.toISOString(),
      baseCurrency: snapshot.baseCurrency,
      metadata: snapshot.metadata,
    };
  }

  private mapMoneyToDto(money: Money): MoneyDto {
    return {
      amount: money.toFixedString(),
      currency: money.currency,
      formatted: money.toString(),
      rawValue: money.value.toString(),
    };
  }
}

// Query definition
export class GetPortfolioSnapshotQuery {
  constructor(
    public readonly userId: string,
    public readonly baseCurrency: string = 'USD',
    public readonly options?: PortfolioOptions
  ) {}
}
```

#### 2.4 Real Price Provider Integration (Week 3-4)

**CoinGecko Price Provider Implementation**:

```typescript
// libs/providers/src/pricing/coingecko-price-provider.ts
@Injectable()
export class CoinGeckoPriceProvider implements IRealTimePriceProvider, IHistoricalPriceProvider {
  private readonly BASE_URL = 'https://api.coingecko.com/api/v3';
  private readonly RATE_LIMIT_MS = 1000; // 1 second between requests (free tier)
  private lastRequestTime = 0;

  constructor(
    private readonly httpService: HttpService,
    private readonly logger: LoggerService,
    private readonly configService: ConfigService
  ) {}

  async fetchPrices(
    baseAssets: string[],
    quoteAsset: string
  ): Promise<Result<Map<string, PriceResponse>, PriceProviderError>> {
    try {
      await this.enforceRateLimit();

      // Map crypto tickers to CoinGecko IDs
      const coinGeckoIds = await this.mapTickersToIds(baseAssets);
      const idsQuery = Array.from(coinGeckoIds.values()).join(',');
      const quoteCurrency = quoteAsset.toLowerCase();

      const url = `${this.BASE_URL}/simple/price`;
      const params = {
        ids: idsQuery,
        vs_currencies: quoteCurrency,
        include_last_updated_at: true,
      };

      const response = await this.httpService.get(url, { params }).toPromise();

      if (!response || !response.data) {
        return err(new PriceProviderError('Invalid response from CoinGecko API'));
      }

      const prices = new Map<string, PriceResponse>();
      const now = new Date();

      for (const [ticker, coinGeckoId] of coinGeckoIds.entries()) {
        const priceData = response.data[coinGeckoId];

        if (!priceData || !priceData[quoteCurrency]) {
          this.logger.warn(`No price data for ${ticker} (${coinGeckoId})`);
          continue;
        }

        const priceValue = priceData[quoteCurrency];
        const lastUpdated = priceData.last_updated_at ? new Date(priceData.last_updated_at * 1000) : now;

        const money = Money.fromDecimal(priceValue, quoteAsset, 2);
        if (money.isErr()) {
          this.logger.warn(`Invalid price value for ${ticker}: ${priceValue}`);
          continue;
        }

        prices.set(ticker, {
          price: money.value,
          timestamp: lastUpdated,
          confidence: this.calculateConfidence(lastUpdated),
          source: 'coingecko',
          approximated: false,
        });
      }

      return ok(prices);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return err(new PriceProviderError(`CoinGecko API error: ${message}`, error));
    }
  }

  async fetchPrice(
    baseAsset: string,
    quoteAsset: string,
    timestamp: Date,
    options?: PriceProviderOptions
  ): Promise<Result<PriceResponse, PriceProviderError>> {
    try {
      await this.enforceRateLimit();

      const coinGeckoId = await this.getTickerId(baseAsset);
      if (!coinGeckoId) {
        return err(new PriceNotFoundError(baseAsset, quoteAsset, timestamp));
      }

      // For historical data, use different endpoint
      const dateStr = timestamp.toISOString().split('T')[0]; // YYYY-MM-DD format
      const url = `${this.BASE_URL}/coins/${coinGeckoId}/history`;
      const params = {
        date: dateStr,
        vs_currency: quoteAsset.toLowerCase(),
      };

      const response = await this.httpService.get(url, { params }).toPromise();

      if (!response?.data?.market_data?.current_price) {
        return err(new PriceNotFoundError(baseAsset, quoteAsset, timestamp));
      }

      const priceValue = response.data.market_data.current_price[quoteAsset.toLowerCase()];
      if (!priceValue) {
        return err(new PriceNotFoundError(baseAsset, quoteAsset, timestamp));
      }

      const money = Money.fromDecimal(priceValue, quoteAsset, 2);
      if (money.isErr()) {
        return err(new PriceProviderError(`Invalid price value: ${priceValue}`));
      }

      return ok({
        price: money.value,
        timestamp,
        confidence: this.calculateHistoricalConfidence(timestamp),
        source: 'coingecko-historical',
        approximated: true, // Historical data is inherently approximated
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      return err(new PriceProviderError(`CoinGecko historical API error: ${message}`, error));
    }
  }

  private async mapTickersToIds(tickers: string[]): Promise<Map<string, string>> {
    // This would typically be cached or use a lookup table
    // For MVP, we'll use common mappings
    const mapping = new Map<string, string>([
      ['BTC', 'bitcoin'],
      ['ETH', 'ethereum'],
      ['USDC', 'usd-coin'],
      ['USDT', 'tether'],
      ['BNB', 'binancecoin'],
      // Add more as needed
    ]);

    return new Map(tickers.filter(ticker => mapping.has(ticker)).map(ticker => [ticker, mapping.get(ticker)!]));
  }

  private async getTickerId(ticker: string): Promise<string | null> {
    const mapping = await this.mapTickersToIds([ticker]);
    return mapping.get(ticker) || null;
  }

  private calculateConfidence(lastUpdated: Date): number {
    const ageMinutes = (Date.now() - lastUpdated.getTime()) / (1000 * 60);

    if (ageMinutes < 5) return 1.0;
    if (ageMinutes < 15) return 0.9;
    if (ageMinutes < 60) return 0.8;
    return 0.7;
  }

  private calculateHistoricalConfidence(requestedDate: Date): number {
    const ageMillis = Date.now() - requestedDate.getTime();
    const ageDays = ageMillis / (1000 * 60 * 60 * 24);

    if (ageDays < 30) return 0.9;
    if (ageDays < 365) return 0.8;
    return 0.7;
  }

  private async enforceRateLimit(): Promise<void> {
    const timeSinceLastRequest = Date.now() - this.lastRequestTime;
    if (timeSinceLastRequest < this.RATE_LIMIT_MS) {
      const waitTime = this.RATE_LIMIT_MS - timeSinceLastRequest;
      await new Promise(resolve => setTimeout(resolve, waitTime));
    }
    this.lastRequestTime = Date.now();
  }

  async isAvailable(baseAsset: string, quoteAsset: string): Promise<boolean> {
    const tickerId = await this.getTickerId(baseAsset);
    return tickerId !== null;
  }

  async getSupportedPairs(): Promise<string[]> {
    // Return commonly supported pairs
    return ['BTC-USD', 'ETH-USD', 'USDC-USD', 'USDT-USD', 'BNB-USD'];
  }

  async getProviderStatus(): Promise<ProviderHealthStatus> {
    try {
      // Simple health check by fetching BTC price
      const result = await this.fetchPrices(['BTC'], 'USD');

      return {
        isHealthy: result.isOk(),
        lastUpdated: new Date(),
        responseTimeMs: 0, // Would measure actual response time
        errorRate: result.isOk() ? 0 : 1,
      };
    } catch {
      return {
        isHealthy: false,
        lastUpdated: new Date(),
        responseTimeMs: -1,
        errorRate: 1,
      };
    }
  }
}
```

### Success Criteria Phase 2

- [ ] Enhanced balance calculation working for multi-account users
- [ ] Portfolio valuation service generating accurate snapshots
- [ ] Real-time price integration functional (CoinGecko)
- [ ] CQRS query handlers returning properly formatted DTOs
- [ ] Performance benchmarks established (<2s for 50 assets)
- [ ] Caching strategy implemented and tested
- [ ] Error handling for price provider failures

### Dependencies & Blockers

- **External API**: CoinGecko API rate limits and reliability
- **Performance**: Database query optimization for large portfolios
- **Caching**: Redis or in-memory caching solution for portfolio snapshots

### Risk Mitigation

- **Price Provider Failures**: Implement circuit breaker pattern
- **Performance Issues**: Add database indexes, implement query pagination
- **Rate Limiting**: Implement intelligent batching and caching strategies

---

## Phase 3: Tax Calculation Engine

**Duration**: 4-5 weeks  
**Priority**: Very High (Core differentiating feature)  
**Business Value**: Very High (Primary user need for crypto portfolios)  
**Technical Risk**: High (Complex financial calculations, regulatory compliance)

### Objectives

- Implement TaxLot aggregate with proper DDD boundaries
- Build cost basis calculation engine (FIFO, LIFO, HIFO)
- Create realized gains/losses tracking
- Generate tax-compliant capital gains reports
- Establish audit trail for all tax calculations

### Phase 3 Dependencies

- ✅ Phase 1: Domain events infrastructure
- ✅ Phase 2: Portfolio valuation and price providers
- ⚠️ External: Historical price data for cost basis calculations
- ⚠️ Regulatory: Tax jurisdiction compliance requirements

### Detailed Implementation Plan

#### 3.1 TaxLot Aggregate Design (Week 1)

**Corrected TaxLot Aggregate** (addressing design flaws from analysis):

```typescript
// libs/core/src/aggregates/tax-lot/tax-lot.aggregate.ts
export class TaxLot extends AggregateRoot {
  private constructor(
    private readonly _id: TaxLotId,
    private readonly _userId: UserId,
    private readonly _assetSymbol: string,
    private readonly _acquisitionTransaction: TransactionReference,
    private readonly _acquisitionDate: Date,
    private readonly _originalQuantity: Money,
    private _remainingQuantity: Money,
    private readonly _costBasisSnapshot: CostBasisSnapshot,
    private _status: TaxLotStatus,
    private readonly _acquisitionMethod: AcquisitionMethod,
    private readonly _createdAt: Date,
    private _updatedAt: Date
  ) {
    super();
  }

  static create(data: CreateTaxLotData): Result<TaxLot, TaxLotError> {
    // Validate creation data
    const validation = TaxLot.validateCreateData(data);
    if (validation.isErr()) {
      return err(validation.error);
    }

    // Generate unique lot ID
    const lotId = TaxLotId.generate();

    // Create immutable cost basis snapshot
    const costBasisSnapshot = CostBasisSnapshot.create(
      data.costBasisAmount,
      data.costBasisCurrency,
      data.exchangeRate,
      data.priceSource,
      data.acquisitionDate
    );

    const now = new Date();
    const taxLot = new TaxLot(
      lotId,
      data.userId,
      data.assetSymbol.toUpperCase(),
      data.acquisitionTransaction,
      data.acquisitionDate,
      data.originalQuantity,
      data.originalQuantity, // Initially, remaining = original
      costBasisSnapshot,
      TaxLotStatus.OPEN,
      data.acquisitionMethod,
      now,
      now
    );

    // Emit domain event for audit trail and cross-aggregate coordination
    taxLot.addDomainEvent(
      new TaxLotCreated({
        lotId: lotId.value,
        userId: data.userId.value,
        assetSymbol: data.assetSymbol,
        originalQuantity: data.originalQuantity,
        costBasisSnapshot,
        acquisitionMethod: data.acquisitionMethod,
        acquisitionDate: data.acquisitionDate,
      })
    );

    return ok(taxLot);
  }

  /**
   * Consume quantity from this lot (FIFO/LIFO/HIFO disposal logic)
   * Returns realized gain/loss calculation
   */
  consume(
    disposalQuantity: Money,
    disposalPrice: Money,
    disposalDate: Date,
    disposalTransaction: TransactionReference
  ): Result<LotConsumptionResult, TaxLotError> {
    // Validate consumption
    if (this._status !== TaxLotStatus.OPEN) {
      return err(new TaxLotNotAvailableError(this._id.value, this._status));
    }

    if (disposalQuantity.isGreaterThan(this._remainingQuantity).unwrap()) {
      return err(new InsufficientLotQuantityError(this._id.value, disposalQuantity, this._remainingQuantity));
    }

    if (!disposalQuantity.currency === this._assetSymbol) {
      return err(new CurrencyMismatchError(disposalQuantity.currency, this._assetSymbol));
    }

    // Calculate consumed portion of cost basis
    const consumptionRatio = this.calculateConsumptionRatio(disposalQuantity);
    const consumedCostBasis = this._costBasisSnapshot.calculatePortionValue(consumptionRatio);

    // Calculate realized gain/loss
    const disposalValue = disposalQuantity.multiply(disposalPrice.toFixedString()).unwrap();
    const realizedGainLoss = disposalValue.subtract(consumedCostBasis).unwrap();

    // Update remaining quantity
    const newRemainingQuantity = this._remainingQuantity.subtract(disposalQuantity).unwrap();
    this._remainingQuantity = newRemainingQuantity;

    // Update status if fully consumed
    if (this._remainingQuantity.isZero()) {
      this._status = TaxLotStatus.DEPLETED;
    }

    this._updatedAt = new Date();

    // Create consumption result
    const consumptionResult = LotConsumptionResult.create({
      lotId: this._id,
      consumedQuantity: disposalQuantity,
      consumedCostBasis,
      disposalValue,
      realizedGainLoss,
      holdingPeriod: this.calculateHoldingPeriod(disposalDate),
      isLongTerm: this.isLongTermHolding(disposalDate),
      disposalDate,
      disposalTransaction,
    });

    // Emit domain event
    this.addDomainEvent(
      new TaxLotConsumed({
        lotId: this._id.value,
        userId: this._userId.value,
        assetSymbol: this._assetSymbol,
        consumedQuantity: disposalQuantity,
        remainingQuantity: this._remainingQuantity,
        realizedGainLoss,
        disposalDate,
        isLongTerm: this.isLongTermHolding(disposalDate),
        consumptionResult,
      })
    );

    return ok(consumptionResult);
  }

  /**
   * Check if this lot can satisfy a disposal quantity
   */
  canSatisfyDisposal(quantity: Money): boolean {
    return this._status === TaxLotStatus.OPEN && this._remainingQuantity.isGreaterThanOrEqual(quantity).unwrap();
  }

  private calculateConsumptionRatio(consumedQuantity: Money): number {
    const ratio = consumedQuantity.toDecimal() / this._originalQuantity.toDecimal();
    return Math.min(ratio, 1.0); // Cap at 100%
  }

  private calculateHoldingPeriod(disposalDate: Date): HoldingPeriod {
    const holdingDays = Math.floor((disposalDate.getTime() - this._acquisitionDate.getTime()) / (1000 * 60 * 60 * 24));

    return HoldingPeriod.create(holdingDays);
  }

  private isLongTermHolding(disposalDate: Date): boolean {
    const holdingPeriod = this.calculateHoldingPeriod(disposalDate);
    return holdingPeriod.days >= 365; // US tax code: 1 year for long-term
  }

  private static validateCreateData(data: CreateTaxLotData): Result<void, TaxLotError> {
    if (data.originalQuantity.isNegative() || data.originalQuantity.isZero()) {
      return err(new InvalidTaxLotQuantityError(data.originalQuantity));
    }

    if (data.costBasisAmount.isNegative()) {
      return err(new InvalidCostBasisError(data.costBasisAmount));
    }

    if (data.acquisitionDate > new Date()) {
      return err(new FutureAcquisitionDateError(data.acquisitionDate));
    }

    return ok();
  }

  // Getters
  get id(): TaxLotId {
    return this._id;
  }
  get userId(): UserId {
    return this._userId;
  }
  get assetSymbol(): string {
    return this._assetSymbol;
  }
  get acquisitionDate(): Date {
    return this._acquisitionDate;
  }
  get originalQuantity(): Money {
    return this._originalQuantity;
  }
  get remainingQuantity(): Money {
    return this._remainingQuantity;
  }
  get costBasisSnapshot(): CostBasisSnapshot {
    return this._costBasisSnapshot;
  }
  get status(): TaxLotStatus {
    return this._status;
  }
  get acquisitionMethod(): AcquisitionMethod {
    return this._acquisitionMethod;
  }

  /**
   * Get current cost basis per unit
   */
  getCostBasisPerUnit(): Money {
    if (this._remainingQuantity.isZero()) {
      return Money.zero(this._costBasisSnapshot.currency, 2).unwrap();
    }

    const totalCostBasis = this._costBasisSnapshot.totalValue;
    const remainingRatio = this._remainingQuantity.toDecimal() / this._originalQuantity.toDecimal();
    const remainingCostBasis = totalCostBasis.multiply(remainingRatio.toString()).unwrap();

    return remainingCostBasis.divide(this._remainingQuantity.toFixedString()).unwrap();
  }

  /**
   * Required by AggregateRoot
   */
  getId(): string {
    return this._id.value;
  }
}

// Supporting value objects and enums
export enum TaxLotStatus {
  OPEN = 'OPEN',
  DEPLETED = 'DEPLETED',
  TRANSFERRED = 'TRANSFERRED', // For non-taxable transfers
}

export enum AcquisitionMethod {
  PURCHASE = 'PURCHASE',
  MINING = 'MINING',
  STAKING = 'STAKING',
  AIRDROP = 'AIRDROP',
  FORK = 'FORK',
  GIFT = 'GIFT',
  INHERITANCE = 'INHERITANCE',
}

export class TaxLotId {
  private constructor(private readonly _value: string) {}

  static generate(): TaxLotId {
    return new TaxLotId(`lot_${crypto.randomUUID()}`);
  }

  static fromString(value: string): Result<TaxLotId, TaxLotError> {
    if (!value || !value.startsWith('lot_')) {
      return err(new InvalidTaxLotIdError(value));
    }
    return ok(new TaxLotId(value));
  }

  get value(): string {
    return this._value;
  }
}

export class CostBasisSnapshot {
  private constructor(
    private readonly _totalValue: Money,
    private readonly _currency: string,
    private readonly _exchangeRate: number | null,
    private readonly _priceSource: string,
    private readonly _snapshotDate: Date
  ) {}

  static create(
    amount: Money,
    currency: string,
    exchangeRate: number | null,
    priceSource: string,
    snapshotDate: Date
  ): CostBasisSnapshot {
    return new CostBasisSnapshot(amount, currency, exchangeRate, priceSource, snapshotDate);
  }

  calculatePortionValue(ratio: number): Money {
    return this._totalValue.multiply(ratio.toString()).unwrap();
  }

  get totalValue(): Money {
    return this._totalValue;
  }
  get currency(): string {
    return this._currency;
  }
  get exchangeRate(): number | null {
    return this._exchangeRate;
  }
  get priceSource(): string {
    return this._priceSource;
  }
  get snapshotDate(): Date {
    return this._snapshotDate;
  }
}

export class HoldingPeriod {
  private constructor(private readonly _days: number) {}

  static create(days: number): HoldingPeriod {
    return new HoldingPeriod(Math.max(0, Math.floor(days)));
  }

  get days(): number {
    return this._days;
  }
  get isLongTerm(): boolean {
    return this._days >= 365;
  }
  get years(): number {
    return this._days / 365;
  }
}
```

**TaxLot Database Schema** (corrected from analysis):

```typescript
// libs/database/src/schema/tax-lots.ts
import { index, integer, pgEnum, pgTable, serial, timestamp, varchar, bigint } from 'drizzle-orm/pg-core';
import { users } from './users';

export const taxLotStatusEnum = pgEnum('tax_lot_status', ['OPEN', 'DEPLETED', 'TRANSFERRED']);
export const acquisitionMethodEnum = pgEnum('acquisition_method', [
  'PURCHASE',
  'MINING',
  'STAKING',
  'AIRDROP',
  'FORK',
  'GIFT',
  'INHERITANCE',
]);

export const taxLots = pgTable(
  'tax_lots',
  {
    id: serial('id').primaryKey(),
    lotId: varchar('lot_id', { length: 64 }).unique().notNull(),
    userId: varchar('user_id', { length: 64 })
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),

    // Asset information
    assetSymbol: varchar('asset_symbol', { length: 20 }).notNull(),

    // Acquisition transaction reference (domain ID, not FK)
    acquisitionTransactionId: varchar('acquisition_transaction_id', { length: 255 }).notNull(),
    acquisitionDate: timestamp('acquisition_date', { withTimezone: true }).notNull(),
    acquisitionMethod: acquisitionMethodEnum('acquisition_method').notNull(),

    // Quantity tracking
    originalQuantity: bigint('original_quantity', { mode: 'bigint' }).notNull(),
    remainingQuantity: bigint('remaining_quantity', { mode: 'bigint' }).notNull(),

    // Immutable cost basis snapshot
    costBasisAmount: bigint('cost_basis_amount', { mode: 'bigint' }).notNull(),
    costBasisCurrency: varchar('cost_basis_currency', { length: 10 }).notNull(),
    exchangeRate: bigint('exchange_rate', { mode: 'bigint' }), // For non-USD cost basis
    priceSource: varchar('price_source', { length: 50 }).notNull(),

    // Status and metadata
    status: taxLotStatusEnum('status').default('OPEN').notNull(),

    // Timestamps
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  table => ({
    // Performance indexes for tax calculations
    userAssetStatusIdx: index('idx_tax_lots_user_asset_status').on(table.userId, table.assetSymbol, table.status),
    userAcquisitionDateIdx: index('idx_tax_lots_user_date').on(table.userId, table.acquisitionDate),
    assetSymbolIdx: index('idx_tax_lots_asset').on(table.assetSymbol),
  })
);

// Lot consumption tracking for audit trail
export const lotConsumptions = pgTable(
  'lot_consumptions',
  {
    id: serial('id').primaryKey(),
    lotId: varchar('lot_id', { length: 64 })
      .references(() => taxLots.lotId, { onDelete: 'restrict' })
      .notNull(),

    // Disposal information
    disposalTransactionId: varchar('disposal_transaction_id', { length: 255 }).notNull(),
    disposalDate: timestamp('disposal_date', { withTimezone: true }).notNull(),

    // Quantities and values
    consumedQuantity: bigint('consumed_quantity', { mode: 'bigint' }).notNull(),
    consumedCostBasis: bigint('consumed_cost_basis', { mode: 'bigint' }).notNull(),
    disposalValue: bigint('disposal_value', { mode: 'bigint' }).notNull(),
    realizedGainLoss: bigint('realized_gain_loss', { mode: 'bigint' }).notNull(),

    // Tax calculation fields
    holdingPeriodDays: integer('holding_period_days').notNull(),
    isLongTerm: boolean('is_long_term').notNull(),

    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  table => ({
    lotIdIdx: index('idx_lot_consumptions_lot').on(table.lotId),
    disposalDateIdx: index('idx_lot_consumptions_date').on(table.disposalDate),
  })
);

export type TaxLot = InferSelectModel<typeof taxLots>;
export type LotConsumption = InferSelectModel<typeof lotConsumptions>;
```

#### 3.2 Cost Basis Engine Implementation (Week 2)

**Core Cost Basis Calculation Service**:

```typescript
// libs/core/src/services/cost-basis-engine.service.ts
@Injectable()
export class CostBasisEngineService implements ICostBasisEngine {
  constructor(
    private readonly taxLotRepository: ITaxLotRepository,
    private readonly historicalPriceProvider: IHistoricalPriceProvider,
    private readonly userSettingsService: IUserSettingsService,
    private readonly logger: LoggerService
  ) {}

  async calculateRealizedGains(
    userId: string,
    disposalEvent: DisposalEvent,
    accountingMethod?: AccountingMethod
  ): Promise<Result<RealizedGainsResult, TaxCalculationError>> {
    try {
      const startTime = Date.now();

      // Get user's preferred accounting method if not specified
      const method = accountingMethod || (await this.getUserAccountingMethod(userId));

      // Get available tax lots for the asset
      const lotsResult = await this.taxLotRepository.findAvailableLots(
        userId,
        disposalEvent.assetSymbol,
        disposalEvent.disposalDate
      );

      if (lotsResult.isErr()) {
        return err(new TaxCalculationError('Failed to fetch tax lots', lotsResult.error));
      }

      const availableLots = lotsResult.value;

      // Check if we have enough quantity to satisfy the disposal
      const totalAvailable = availableLots.reduce(
        (sum, lot) => sum.add(lot.remainingQuantity).unwrap(),
        Money.zero(disposalEvent.assetSymbol, 8).unwrap()
      );

      if (totalAvailable.isLessThan(disposalEvent.quantity).unwrap()) {
        return err(
          new InsufficientAssetQuantityError(disposalEvent.assetSymbol, disposalEvent.quantity, totalAvailable)
        );
      }

      // Sort lots according to accounting method
      const sortedLots = this.sortLotsByAccountingMethod(availableLots, method);

      // Perform lot consumption
      const consumptionResults = await this.consumeLots(sortedLots, disposalEvent, method);

      if (consumptionResults.isErr()) {
        return err(consumptionResults.error);
      }

      // Aggregate results
      const realizedGainsResult = this.aggregateConsumptionResults(consumptionResults.value, disposalEvent, method);

      const duration = Date.now() - startTime;
      this.logger.log(
        `Calculated realized gains for ${disposalEvent.quantity} ${disposalEvent.assetSymbol} in ${duration}ms`
      );

      return ok(realizedGainsResult);
    } catch (error) {
      return err(new TaxCalculationError('Unexpected error in realized gains calculation', error));
    }
  }

  private async consumeLots(
    sortedLots: TaxLot[],
    disposalEvent: DisposalEvent,
    method: AccountingMethod
  ): Promise<Result<LotConsumptionResult[], TaxCalculationError>> {
    const consumptionResults: LotConsumptionResult[] = [];
    let remainingToDispose = disposalEvent.quantity;

    for (const lot of sortedLots) {
      if (remainingToDispose.isZero()) {
        break;
      }

      // Calculate how much to consume from this lot
      const quantityToConsume = remainingToDispose.isLessThanOrEqual(lot.remainingQuantity).unwrap()
        ? remainingToDispose
        : lot.remainingQuantity;

      // Get disposal price at the time of disposal
      const disposalPrice = await this.getDisposalPrice(
        disposalEvent.assetSymbol,
        disposalEvent.baseCurrency,
        disposalEvent.disposalDate
      );

      if (disposalPrice.isErr()) {
        return err(new TaxCalculationError(`Failed to get disposal price: ${disposalPrice.error.message}`));
      }

      // Consume from the lot
      const consumptionResult = lot.consume(
        quantityToConsume,
        disposalPrice.value,
        disposalEvent.disposalDate,
        disposalEvent.disposalTransaction
      );

      if (consumptionResult.isErr()) {
        return err(new TaxCalculationError(`Failed to consume lot: ${consumptionResult.error.message}`));
      }

      consumptionResults.push(consumptionResult.value);
      remainingToDispose = remainingToDispose.subtract(quantityToConsume).unwrap();

      // Persist the updated lot
      await this.taxLotRepository.save(lot);
    }

    return ok(consumptionResults);
  }

  private sortLotsByAccountingMethod(lots: TaxLot[], method: AccountingMethod): TaxLot[] {
    switch (method) {
      case AccountingMethod.FIFO:
        return [...lots].sort((a, b) => a.acquisitionDate.getTime() - b.acquisitionDate.getTime());

      case AccountingMethod.LIFO:
        return [...lots].sort((a, b) => b.acquisitionDate.getTime() - a.acquisitionDate.getTime());

      case AccountingMethod.HIFO:
        return [...lots].sort((a, b) => {
          const aCostBasis = a.getCostBasisPerUnit().toDecimal();
          const bCostBasis = b.getCostBasisPerUnit().toDecimal();
          return bCostBasis - aCostBasis; // Highest cost first
        });

      case AccountingMethod.SPECIFIC_ID:
        // For specific ID, lots should already be pre-selected
        // This is more complex and would require UI selection
        return lots;

      default:
        return lots;
    }
  }

  private aggregateConsumptionResults(
    consumptions: LotConsumptionResult[],
    disposalEvent: DisposalEvent,
    method: AccountingMethod
  ): RealizedGainsResult {
    let totalCostBasis = Money.zero(disposalEvent.baseCurrency, 2).unwrap();
    let totalRealizedGain = Money.zero(disposalEvent.baseCurrency, 2).unwrap();
    let totalShortTerm = Money.zero(disposalEvent.baseCurrency, 2).unwrap();
    let totalLongTerm = Money.zero(disposalEvent.baseCurrency, 2).unwrap();

    for (const consumption of consumptions) {
      totalCostBasis = totalCostBasis.add(consumption.consumedCostBasis).unwrap();
      totalRealizedGain = totalRealizedGain.add(consumption.realizedGainLoss).unwrap();

      if (consumption.isLongTerm) {
        totalLongTerm = totalLongTerm.add(consumption.realizedGainLoss).unwrap();
      } else {
        totalShortTerm = totalShortTerm.add(consumption.realizedGainLoss).unwrap();
      }
    }

    const totalDisposalValue = totalCostBasis.add(totalRealizedGain).unwrap();

    return RealizedGainsResult.create({
      disposalEvent,
      accountingMethod: method,
      totalQuantityDisposed: disposalEvent.quantity,
      totalCostBasis,
      totalDisposalValue,
      totalRealizedGain,
      shortTermGain: totalShortTerm,
      longTermGain: totalLongTerm,
      lotConsumptions: consumptions,
      calculatedAt: new Date(),
    });
  }

  private async getDisposalPrice(
    assetSymbol: string,
    baseCurrency: string,
    disposalDate: Date
  ): Promise<Result<Money, PriceProviderError>> {
    return this.historicalPriceProvider.fetchPrice(assetSymbol, baseCurrency, disposalDate, {
      allowApproximateTimestamp: true,
      maxAgeMinutes: 60, // Allow 1-hour approximation
      fallbackToNearest: true,
    });
  }

  private async getUserAccountingMethod(userId: string): Promise<AccountingMethod> {
    try {
      const settings = await this.userSettingsService.getTaxSettings(userId);
      return settings?.accountingMethod || AccountingMethod.FIFO; // Default to FIFO
    } catch {
      return AccountingMethod.FIFO;
    }
  }

  async generateTaxReport(
    userId: string,
    taxYear: number,
    reportFormat: TaxReportFormat
  ): Promise<Result<TaxReport, TaxCalculationError>> {
    try {
      // Get all lot consumptions for the tax year
      const consumptionsResult = await this.taxLotRepository.findConsumptionsByYear(userId, taxYear);

      if (consumptionsResult.isErr()) {
        return err(new TaxCalculationError('Failed to fetch lot consumptions', consumptionsResult.error));
      }

      const consumptions = consumptionsResult.value;

      // Aggregate by term (short vs long)
      const shortTermTransactions: TaxReportTransaction[] = [];
      const longTermTransactions: TaxReportTransaction[] = [];

      for (const consumption of consumptions) {
        const transaction: TaxReportTransaction = {
          date: consumption.disposalDate,
          asset: consumption.assetSymbol,
          quantity: consumption.consumedQuantity,
          acquisitionDate: consumption.acquisitionDate,
          costBasis: consumption.consumedCostBasis,
          proceeds: consumption.disposalValue,
          gainLoss: consumption.realizedGainLoss,
          holdingPeriod: consumption.holdingPeriod,
        };

        if (consumption.isLongTerm) {
          longTermTransactions.push(transaction);
        } else {
          shortTermTransactions.push(transaction);
        }
      }

      // Calculate totals
      const shortTermTotal = this.calculateTotalGainLoss(shortTermTransactions);
      const longTermTotal = this.calculateTotalGainLoss(longTermTransactions);

      const taxReport = TaxReport.create({
        userId,
        taxYear,
        reportFormat,
        shortTermTransactions,
        longTermTransactions,
        shortTermTotal,
        longTermTotal,
        generatedAt: new Date(),
      });

      return ok(taxReport);
    } catch (error) {
      return err(new TaxCalculationError('Failed to generate tax report', error));
    }
  }

  private calculateTotalGainLoss(transactions: TaxReportTransaction[]): Money {
    if (transactions.length === 0) {
      return Money.zero('USD', 2).unwrap();
    }

    return transactions.reduce(
      (total, transaction) => total.add(transaction.gainLoss).unwrap(),
      Money.zero(transactions[0].gainLoss.currency, 2).unwrap()
    );
  }
}

// Supporting types
export interface DisposalEvent {
  assetSymbol: string;
  quantity: Money;
  disposalDate: Date;
  baseCurrency: string;
  disposalTransaction: TransactionReference;
  disposalType: 'SALE' | 'TRADE' | 'SPEND';
}

export class RealizedGainsResult {
  private constructor(
    public readonly disposalEvent: DisposalEvent,
    public readonly accountingMethod: AccountingMethod,
    public readonly totalQuantityDisposed: Money,
    public readonly totalCostBasis: Money,
    public readonly totalDisposalValue: Money,
    public readonly totalRealizedGain: Money,
    public readonly shortTermGain: Money,
    public readonly longTermGain: Money,
    public readonly lotConsumptions: LotConsumptionResult[],
    public readonly calculatedAt: Date
  ) {}

  static create(data: {
    disposalEvent: DisposalEvent;
    accountingMethod: AccountingMethod;
    totalQuantityDisposed: Money;
    totalCostBasis: Money;
    totalDisposalValue: Money;
    totalRealizedGain: Money;
    shortTermGain: Money;
    longTermGain: Money;
    lotConsumptions: LotConsumptionResult[];
    calculatedAt: Date;
  }): RealizedGainsResult {
    return new RealizedGainsResult(
      data.disposalEvent,
      data.accountingMethod,
      data.totalQuantityDisposed,
      data.totalCostBasis,
      data.totalDisposalValue,
      data.totalRealizedGain,
      data.shortTermGain,
      data.longTermGain,
      data.lotConsumptions,
      data.calculatedAt
    );
  }

  get effectiveTaxRate(): number {
    // Simplified calculation - real implementation would consider user's tax bracket
    const shortTermRate = 0.35; // Ordinary income tax rate
    const longTermRate = 0.15; // Long-term capital gains rate

    const shortTermTax = this.shortTermGain.multiply(shortTermRate.toString()).unwrap();
    const longTermTax = this.longTermGain.multiply(longTermRate.toString()).unwrap();
    const totalTax = shortTermTax.add(longTermTax).unwrap();

    if (this.totalRealizedGain.isZero()) {
      return 0;
    }

    return totalTax.toDecimal() / this.totalRealizedGain.toDecimal();
  }
}
```

#### 3.3 Tax Lot Event Handlers (Week 2-3)

**Domain Event Handlers for Tax Lot Creation**:

```typescript
// libs/core/src/events/handlers/asset-acquired.handler.ts
@EventHandler(AssetAcquired)
export class AssetAcquiredHandler implements IEventHandler<AssetAcquired> {
  constructor(
    private readonly taxLotRepository: ITaxLotRepository,
    private readonly historicalPriceProvider: IHistoricalPriceProvider,
    private readonly logger: LoggerService
  ) {}

  async handle(event: AssetAcquired): Promise<void> {
    try {
      this.logger.log(`Processing asset acquisition: ${event.quantity} ${event.asset} for user ${event.userId}`);

      // Get historical price for cost basis calculation
      const costBasisPrice = await this.getCostBasisPrice(event.asset, event.costBasis.currency, event.acquisitionDate);

      if (costBasisPrice.isErr()) {
        this.logger.error(`Failed to get cost basis price for ${event.asset}: ${costBasisPrice.error.message}`);
        return;
      }

      // Create tax lot
      const taxLotData: CreateTaxLotData = {
        userId: UserId.fromString(event.userId).unwrap(),
        assetSymbol: event.asset,
        acquisitionTransaction: TransactionReference.fromId(event.transactionId),
        acquisitionDate: event.acquisitionDate,
        originalQuantity: event.quantity,
        costBasisAmount: event.costBasis,
        costBasisCurrency: event.costBasis.currency,
        exchangeRate: null, // TODO: Handle non-USD cost basis
        priceSource: costBasisPrice.value.source,
        acquisitionMethod: this.mapAcquisitionMethod(event.acquisitionMethod),
      };

      const taxLotResult = TaxLot.create(taxLotData);

      if (taxLotResult.isErr()) {
        this.logger.error(`Failed to create tax lot: ${taxLotResult.error.message}`);
        return;
      }

      // Save tax lot
      const saveResult = await this.taxLotRepository.save(taxLotResult.value);

      if (saveResult.isErr()) {
        this.logger.error(`Failed to save tax lot: ${saveResult.error.message}`);
        return;
      }

      this.logger.log(`Created tax lot for ${event.quantity} ${event.asset} acquired on ${event.acquisitionDate}`);
    } catch (error) {
      this.logger.error(`Error processing asset acquisition event: ${error.message}`, error);
    }
  }

  private async getCostBasisPrice(
    asset: string,
    baseCurrency: string,
    acquisitionDate: Date
  ): Promise<Result<PriceResponse, PriceProviderError>> {
    // For purchases, we already know the cost basis from the transaction
    // For rewards/airdrops, we need to fetch historical price
    return this.historicalPriceProvider.fetchPrice(asset, baseCurrency, acquisitionDate, {
      allowApproximateTimestamp: true,
      maxAgeMinutes: 24 * 60, // Allow 24-hour approximation for historical data
    });
  }

  private mapAcquisitionMethod(method: string): AcquisitionMethod {
    switch (method.toUpperCase()) {
      case 'PURCHASE':
        return AcquisitionMethod.PURCHASE;
      case 'MINING':
        return AcquisitionMethod.MINING;
      case 'STAKING':
        return AcquisitionMethod.STAKING;
      case 'AIRDROP':
        return AcquisitionMethod.AIRDROP;
      case 'FORK':
        return AcquisitionMethod.FORK;
      default:
        return AcquisitionMethod.PURCHASE;
    }
  }
}

// Handler for disposal events
@EventHandler(AssetDisposed)
export class AssetDisposedHandler implements IEventHandler<AssetDisposed> {
  constructor(
    private readonly costBasisEngine: ICostBasisEngine,
    private readonly realizedGainsRepository: IRealizedGainsRepository,
    private readonly logger: LoggerService
  ) {}

  async handle(event: AssetDisposed): Promise<void> {
    try {
      this.logger.log(`Processing asset disposal: ${event.quantity} ${event.asset} for user ${event.userId}`);

      // Create disposal event
      const disposalEvent: DisposalEvent = {
        assetSymbol: event.asset,
        quantity: event.quantity,
        disposalDate: event.disposalDate,
        baseCurrency: 'USD', // TODO: Get from user preferences
        disposalTransaction: TransactionReference.fromId(event.transactionId),
        disposalType: this.mapDisposalMethod(event.disposalMethod),
      };

      // Calculate realized gains using cost basis engine
      const gainsResult = await this.costBasisEngine.calculateRealizedGains(event.userId, disposalEvent);

      if (gainsResult.isErr()) {
        this.logger.error(`Failed to calculate realized gains: ${gainsResult.error.message}`);
        return;
      }

      // Save realized gains record
      const saveResult = await this.realizedGainsRepository.save(gainsResult.value);

      if (saveResult.isErr()) {
        this.logger.error(`Failed to save realized gains: ${saveResult.error.message}`);
        return;
      }

      this.logger.log(
        `Calculated realized gains: ${gainsResult.value.totalRealizedGain} for ${event.quantity} ${event.asset}`
      );
    } catch (error) {
      this.logger.error(`Error processing asset disposal event: ${error.message}`, error);
    }
  }

  private mapDisposalMethod(method: string): 'SALE' | 'TRADE' | 'SPEND' {
    switch (method.toUpperCase()) {
      case 'TRADE':
        return 'TRADE';
      case 'SPEND':
        return 'SPEND';
      default:
        return 'SALE';
    }
  }
}
```

#### 3.4 Enhanced Portfolio Valuation with Cost Basis (Week 3-4)

**Updated Portfolio Service with Cost Basis Integration**:

```typescript
// libs/core/src/services/enhanced-portfolio-valuation.service.ts
@Injectable()
export class EnhancedPortfolioValuationService extends PortfolioValuationService {
  constructor(
    balanceCalculator: EnhancedBalanceCalculatorService,
    realTimePriceProvider: IRealTimePriceProvider,
    portfolioCache: IPortfolioCache,
    private readonly taxLotRepository: ITaxLotRepository,
    logger: LoggerService
  ) {
    super(balanceCalculator, realTimePriceProvider, portfolioCache, logger);
  }

  async calculatePortfolioSnapshot(
    userId: string,
    baseCurrency: string = 'USD',
    options?: PortfolioOptions
  ): Promise<Result<PortfolioSnapshot, PortfolioError>> {
    // Get base portfolio snapshot from parent
    const baseSnapshotResult = await super.calculatePortfolioSnapshot(userId, baseCurrency, options);

    if (baseSnapshotResult.isErr()) {
      return baseSnapshotResult;
    }

    const baseSnapshot = baseSnapshotResult.value;

    // Enhance with cost basis information
    const enhancedHoldings = await this.enhanceHoldingsWithCostBasis(userId, baseSnapshot.holdings, baseCurrency);

    // Calculate total cost basis and unrealized gains
    let totalCostBasis = Money.zero(baseCurrency, 2).unwrap();
    let totalUnrealizedGain = Money.zero(baseCurrency, 2).unwrap();

    for (const holding of enhancedHoldings) {
      totalCostBasis = totalCostBasis.add(holding.costBasis).unwrap();
      totalUnrealizedGain = totalUnrealizedGain.add(holding.unrealizedGain).unwrap();
    }

    const enhancedSnapshot: PortfolioSnapshot = {
      ...baseSnapshot,
      totalCostBasis,
      totalUnrealizedGain,
      holdings: enhancedHoldings,
      metadata: {
        ...baseSnapshot.metadata,
        hasCostBasisData: true,
        costBasisCalculatedAt: new Date(),
      },
    };

    return ok(enhancedSnapshot);
  }

  private async enhanceHoldingsWithCostBasis(
    userId: string,
    holdings: Holding[],
    baseCurrency: string
  ): Promise<Holding[]> {
    const enhancedHoldings: Holding[] = [];

    for (const holding of holdings) {
      // Get tax lots for this asset
      const lotsResult = await this.taxLotRepository.findAvailableLots(userId, holding.asset.ticker, new Date());

      if (lotsResult.isErr()) {
        // If we can't get cost basis, use original holding
        enhancedHoldings.push(holding);
        continue;
      }

      const lots = lotsResult.value;

      // Calculate total cost basis from all lots
      let totalCostBasis = Money.zero(baseCurrency, 2).unwrap();

      for (const lot of lots) {
        // Convert lot's cost basis to base currency if needed
        const lotCostBasis = await this.convertToBaseCurrency(lot.costBasisSnapshot.totalValue, baseCurrency);

        if (lotCostBasis.isOk()) {
          // Calculate remaining cost basis for this lot
          const remainingRatio = lot.remainingQuantity.toDecimal() / lot.originalQuantity.toDecimal();
          const remainingCostBasis = lotCostBasis.value.multiply(remainingRatio.toString()).unwrap();
          totalCostBasis = totalCostBasis.add(remainingCostBasis).unwrap();
        }
      }

      // Calculate unrealized gain/loss
      const unrealizedGain = holding.currentValue.subtract(totalCostBasis).unwrap();

      // Calculate gain/loss percentage
      let gainLossPercentage = 0;
      if (!totalCostBasis.isZero()) {
        gainLossPercentage = (unrealizedGain.toDecimal() / totalCostBasis.toDecimal()) * 100;
      }

      const enhancedHolding: Holding = {
        ...holding,
        costBasis: totalCostBasis,
        unrealizedGain,
        gainLossPercentage,
      };

      enhancedHoldings.push(enhancedHolding);
    }

    return enhancedHoldings;
  }

  private async convertToBaseCurrency(amount: Money, baseCurrency: string): Promise<Result<Money, PortfolioError>> {
    if (amount.currency === baseCurrency) {
      return ok(amount);
    }

    // For simplicity, assume 1:1 conversion for now
    // In production, would use currency exchange rates
    return Money.fromDecimal(amount.toDecimal(), baseCurrency, 2);
  }
}
```

### Success Criteria Phase 3

- [ ] TaxLot aggregate properly designed with domain boundaries
- [ ] Cost basis engine calculating accurate FIFO/LIFO/HIFO results
- [ ] Domain events creating tax lots automatically on asset acquisition
- [ ] Realized gains calculations working for disposals
- [ ] Portfolio service enhanced with cost basis and unrealized gains
- [ ] Tax reports generating accurate capital gains data
- [ ] Complete audit trail for all tax calculations
- [ ] Performance benchmarks for large portfolios (1000+ transactions)

### Dependencies & Blockers

- **Historical Price Data**: Reliable source for cost basis calculations
- **Tax Compliance**: Legal review of tax calculation logic
- **Performance**: Database optimization for complex tax lot queries
- **User Settings**: Accounting method preferences and tax jurisdictions

### Risk Mitigation

- **Calculation Accuracy**: Extensive test coverage with known scenarios
- **Regulatory Compliance**: Professional tax software comparison testing
- **Performance**: Implement background processing for complex calculations
- **Audit Trail**: Complete transaction logging for regulatory requirements

---

## Phase 4: Advanced Transaction Handling

**Duration**: 2-3 weeks  
**Priority**: Medium (DeFi/NFT ecosystem support)  
**Business Value**: Medium (Enables advanced crypto users)  
**Technical Risk**: Medium (Complex DeFi protocols, evolving standards)

### Objectives

- Implement transaction classification service for DeFi protocols
- Create NFT and LP token modeling strategies
- Build rule-based transaction pattern recognition
- Enhance account types for advanced DeFi operations
- Support complex multi-step DeFi transactions

### Phase 4 Dependencies

- ✅ Phase 1: Enhanced account type enums
- ✅ Phase 3: Tax lot creation for complex acquisition types
- ⚠️ External: DeFi protocol contract mappings and signatures
- ⚠️ Data: Enhanced transaction metadata for classification

### Detailed Implementation Plan

#### 4.1 Transaction Classification Engine (Week 1)

**Rule-Based Transaction Classifier**:

```typescript
// libs/core/src/services/transaction-classifier.service.ts
@Injectable()
export class TransactionClassifierService {
  private readonly classificationRules = new Map<string, ClassificationRule[]>();

  constructor(
    private readonly contractRegistry: IContractRegistry,
    private readonly logger: LoggerService
  ) {
    this.initializeClassificationRules();
  }

  /**
   * Classify a raw blockchain transaction into business-meaningful categories
   */
  async classifyTransaction(
    rawTransaction: RawBlockchainTransaction
  ): Promise<Result<ClassifiedTransaction, ClassificationError>> {
    try {
      // Extract transaction features for classification
      const features = await this.extractTransactionFeatures(rawTransaction);

      // Apply classification rules in priority order
      const classificationResult = await this.applyClassificationRules(features, rawTransaction);

      if (classificationResult.isErr()) {
        return err(classificationResult.error);
      }

      const classification = classificationResult.value;

      // Enhance with additional metadata
      const enhancedClassification = await this.enhanceClassification(classification, rawTransaction, features);

      this.logger.log(`Classified transaction ${rawTransaction.hash} as ${classification.type}`);

      return ok(enhancedClassification);
    } catch (error) {
      return err(new ClassificationError(`Failed to classify transaction: ${error.message}`));
    }
  }

  /**
   * Batch classify multiple transactions with optimization
   */
  async classifyTransactions(
    rawTransactions: RawBlockchainTransaction[]
  ): Promise<Result<ClassifiedTransaction[], ClassificationError>> {
    const results: ClassifiedTransaction[] = [];
    const errors: ClassificationError[] = [];

    // Group transactions by contract address for batch processing
    const transactionsByContract = this.groupTransactionsByContract(rawTransactions);

    for (const [contractAddress, transactions] of transactionsByContract) {
      // Get contract information once per batch
      const contractInfo = await this.contractRegistry.getContractInfo(contractAddress);

      for (const transaction of transactions) {
        const classificationResult = await this.classifyTransaction(transaction);

        if (classificationResult.isOk()) {
          results.push(classificationResult.value);
        } else {
          errors.push(classificationResult.error);
        }
      }
    }

    if (errors.length > 0) {
      this.logger.warn(`Failed to classify ${errors.length} transactions`);
    }

    return ok(results);
  }

  private async extractTransactionFeatures(rawTransaction: RawBlockchainTransaction): Promise<TransactionFeatures> {
    const features: TransactionFeatures = {
      contractAddress: rawTransaction.to?.toLowerCase(),
      methodSignature: rawTransaction.input?.slice(0, 10), // First 4 bytes
      tokenTransfers: await this.extractTokenTransfers(rawTransaction),
      ethValue: rawTransaction.value,
      gasUsed: rawTransaction.gasUsed,
      logTopics: rawTransaction.logs?.map(log => log.topics).flat() || [],
      timestamp: rawTransaction.timestamp,
    };

    return features;
  }

  private async applyClassificationRules(
    features: TransactionFeatures,
    rawTransaction: RawBlockchainTransaction
  ): Promise<Result<TransactionClassification, ClassificationError>> {
    // Check contract-specific rules first (highest priority)
    if (features.contractAddress) {
      const contractRules = this.classificationRules.get(features.contractAddress);
      if (contractRules) {
        for (const rule of contractRules) {
          const matchResult = await rule.matches(features, rawTransaction);
          if (matchResult.isOk() && matchResult.value) {
            return ok(rule.classify(features, rawTransaction));
          }
        }
      }
    }

    // Apply method signature rules (medium priority)
    if (features.methodSignature) {
      const methodRules = this.classificationRules.get(features.methodSignature);
      if (methodRules) {
        for (const rule of methodRules) {
          const matchResult = await rule.matches(features, rawTransaction);
          if (matchResult.isOk() && matchResult.value) {
            return ok(rule.classify(features, rawTransaction));
          }
        }
      }
    }

    // Apply general pattern rules (lowest priority)
    const generalRules = this.classificationRules.get('*');
    if (generalRules) {
      for (const rule of generalRules) {
        const matchResult = await rule.matches(features, rawTransaction);
        if (matchResult.isOk() && matchResult.value) {
          return ok(rule.classify(features, rawTransaction));
        }
      }
    }

    // Default classification for unrecognized transactions
    return ok(this.createDefaultClassification(features, rawTransaction));
  }

  private initializeClassificationRules(): void {
    // Uniswap V2/V3 Rules
    this.addClassificationRule(
      '0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D', // Uniswap V2 Router
      new UniswapV2SwapRule()
    );

    this.addClassificationRule(
      '0xE592427A0AEce92De3Edee1F18E0157C05861564', // Uniswap V3 Router
      new UniswapV3SwapRule()
    );

    // Method signature rules
    this.addClassificationRule(
      '0x38ed1739', // swapExactTokensForTokens
      new GenericSwapRule('DEX_SWAP', 'Token swap via DEX')
    );

    this.addClassificationRule(
      '0xe8e33700', // addLiquidity
      new LiquidityAddRule()
    );

    this.addClassificationRule(
      '0xbaa2abde', // removeLiquidity
      new LiquidityRemoveRule()
    );

    // Aave Protocol Rules
    this.addClassificationRule(
      '0x7d2768dE32b0b80b7a3454c06BdAc94A69DDc7A9', // Aave V2 LendingPool
      new AaveLendingRule()
    );

    // Compound Protocol Rules
    this.addClassificationRule(
      '0x3d9819210A31b4961b30EF54bE2aeD79B9c9Cd3B', // Compound Comptroller
      new CompoundRule()
    );

    // NFT Marketplace Rules (OpenSea, LooksRare, etc.)
    this.addClassificationRule(
      '0x7Be8076f4EA4A4AD08075C2508e481d6C946D12b', // OpenSea
      new NFTTradeRule('OPENSEA')
    );

    this.addClassificationRule(
      '0x59728544B08AB483533076417FbBB2fD0B17CE3a', // LooksRare
      new NFTTradeRule('LOOKSRARE')
    );

    // Staking Rules (ETH 2.0, protocols)
    this.addClassificationRule(
      '0x00000000219ab540356cBB839Cbe05303d7705Fa', // ETH 2.0 Deposit
      new ETH2StakingRule()
    );

    // General pattern rules
    this.addClassificationRule('*', new ERC20TransferRule());
    this.addClassificationRule('*', new ETHTransferRule());
    this.addClassificationRule('*', new ContractCreationRule());
  }

  private addClassificationRule(identifier: string, rule: ClassificationRule): void {
    if (!this.classificationRules.has(identifier)) {
      this.classificationRules.set(identifier, []);
    }
    this.classificationRules.get(identifier)!.push(rule);
  }

  private async extractTokenTransfers(rawTransaction: RawBlockchainTransaction): Promise<TokenTransfer[]> {
    const transfers: TokenTransfer[] = [];

    if (!rawTransaction.logs) return transfers;

    const transferTopic = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef'; // Transfer(address,address,uint256)

    for (const log of rawTransaction.logs) {
      if (log.topics[0] === transferTopic && log.topics.length >= 3) {
        transfers.push({
          contractAddress: log.address,
          from: `0x${log.topics[1].slice(26)}`, // Remove padding
          to: `0x${log.topics[2].slice(26)}`, // Remove padding
          value: BigInt(log.data),
          tokenSymbol: await this.getTokenSymbol(log.address),
        });
      }
    }

    return transfers;
  }

  private async getTokenSymbol(contractAddress: string): Promise<string> {
    // This would query the contract or use a token registry
    // For now, return a placeholder
    return 'UNKNOWN';
  }

  private createDefaultClassification(
    features: TransactionFeatures,
    rawTransaction: RawBlockchainTransaction
  ): TransactionClassification {
    // Default classification logic based on basic transaction properties
    if (features.tokenTransfers.length > 0) {
      return {
        type: 'TOKEN_TRANSFER',
        subType: 'ERC20_TRANSFER',
        confidence: 0.7,
        description: 'Token transfer transaction',
        involvedAssets: features.tokenTransfers.map(t => t.tokenSymbol),
        metadata: {
          tokenTransfers: features.tokenTransfers,
        },
      };
    }

    if (rawTransaction.value && BigInt(rawTransaction.value) > 0n) {
      return {
        type: 'ETH_TRANSFER',
        subType: 'NATIVE_TRANSFER',
        confidence: 0.9,
        description: 'ETH transfer',
        involvedAssets: ['ETH'],
        metadata: {
          ethValue: rawTransaction.value,
        },
      };
    }

    return {
      type: 'UNKNOWN',
      subType: 'UNCLASSIFIED',
      confidence: 0.1,
      description: 'Unrecognized transaction type',
      involvedAssets: [],
      metadata: {},
    };
  }

  private groupTransactionsByContract(
    transactions: RawBlockchainTransaction[]
  ): Map<string, RawBlockchainTransaction[]> {
    const grouped = new Map<string, RawBlockchainTransaction[]>();

    for (const tx of transactions) {
      const key = tx.to?.toLowerCase() || 'no-contract';
      if (!grouped.has(key)) {
        grouped.set(key, []);
      }
      grouped.get(key)!.push(tx);
    }

    return grouped;
  }

  private async enhanceClassification(
    classification: TransactionClassification,
    rawTransaction: RawBlockchainTransaction,
    features: TransactionFeatures
  ): Promise<ClassifiedTransaction> {
    // Add protocol information if available
    const protocolInfo = await this.identifyProtocol(features.contractAddress);

    return {
      ...classification,
      transactionHash: rawTransaction.hash,
      blockNumber: rawTransaction.blockNumber,
      timestamp: rawTransaction.timestamp,
      gasUsed: rawTransaction.gasUsed,
      protocolInfo,
      rawTransaction,
    };
  }

  private async identifyProtocol(contractAddress?: string): Promise<ProtocolInfo | null> {
    if (!contractAddress) return null;

    const contractInfo = await this.contractRegistry.getContractInfo(contractAddress);
    if (!contractInfo) return null;

    return {
      name: contractInfo.protocolName,
      version: contractInfo.version,
      category: contractInfo.category,
      website: contractInfo.website,
    };
  }
}

// Supporting types and interfaces
export interface TransactionFeatures {
  contractAddress?: string;
  methodSignature?: string;
  tokenTransfers: TokenTransfer[];
  ethValue?: string;
  gasUsed?: number;
  logTopics: string[];
  timestamp: Date;
}

export interface TokenTransfer {
  contractAddress: string;
  from: string;
  to: string;
  value: bigint;
  tokenSymbol: string;
}

export interface TransactionClassification {
  type: string;
  subType: string;
  confidence: number; // 0-1 scale
  description: string;
  involvedAssets: string[];
  metadata: Record<string, any>;
}

export interface ClassifiedTransaction extends TransactionClassification {
  transactionHash: string;
  blockNumber: number;
  timestamp: Date;
  gasUsed?: number;
  protocolInfo?: ProtocolInfo | null;
  rawTransaction: RawBlockchainTransaction;
}

export interface ProtocolInfo {
  name: string;
  version?: string;
  category: 'DEX' | 'LENDING' | 'NFT_MARKETPLACE' | 'STAKING' | 'BRIDGE' | 'OTHER';
  website?: string;
}

// Classification rule interface
export abstract class ClassificationRule {
  abstract matches(
    features: TransactionFeatures,
    rawTransaction: RawBlockchainTransaction
  ): Promise<Result<boolean, ClassificationError>>;

  abstract classify(features: TransactionFeatures, rawTransaction: RawBlockchainTransaction): TransactionClassification;
}
```

#### 4.2 Specific DeFi Classification Rules (Week 1-2)

**Uniswap V2/V3 Classification Rules**:

```typescript
// libs/core/src/services/classification-rules/uniswap-rules.ts
export class UniswapV2SwapRule extends ClassificationRule {
  async matches(
    features: TransactionFeatures,
    rawTransaction: RawBlockchainTransaction
  ): Promise<Result<boolean, ClassificationError>> {
    // Check for Uniswap V2 swap signatures
    const swapSignatures = [
      '0x38ed1739', // swapExactTokensForTokens
      '0x8803dbee', // swapTokensForExactTokens
      '0x7ff36ab5', // swapExactETHForTokens
      '0x18cbafe5', // swapTokensForExactETH
    ];

    const isSwap = swapSignatures.includes(features.methodSignature || '');
    const hasTokenTransfers = features.tokenTransfers.length >= 2;

    return ok(isSwap && hasTokenTransfers);
  }

  classify(features: TransactionFeatures, rawTransaction: RawBlockchainTransaction): TransactionClassification {
    const inputToken = this.identifyInputToken(features);
    const outputToken = this.identifyOutputToken(features);

    return {
      type: 'DEX_SWAP',
      subType: 'UNISWAP_V2',
      confidence: 0.95,
      description: `Uniswap V2 swap: ${inputToken.symbol} → ${outputToken.symbol}`,
      involvedAssets: [inputToken.symbol, outputToken.symbol],
      metadata: {
        protocol: 'Uniswap V2',
        inputToken,
        outputToken,
        slippage: this.calculateSlippage(features),
      },
    };
  }

  private identifyInputToken(features: TransactionFeatures): TokenInfo {
    // Logic to identify input token from token transfers
    const transfers = features.tokenTransfers;
    const inputTransfer = transfers.find(t => t.from.toLowerCase() === rawTransaction.from?.toLowerCase());

    return {
      address: inputTransfer?.contractAddress || 'ETH',
      symbol: inputTransfer?.tokenSymbol || 'ETH',
      amount: inputTransfer?.value.toString() || '0',
    };
  }

  private identifyOutputToken(features: TransactionFeatures): TokenInfo {
    // Logic to identify output token from token transfers
    const transfers = features.tokenTransfers;
    const outputTransfer = transfers.find(t => t.to.toLowerCase() === rawTransaction.from?.toLowerCase());

    return {
      address: outputTransfer?.contractAddress || 'ETH',
      symbol: outputTransfer?.tokenSymbol || 'ETH',
      amount: outputTransfer?.value.toString() || '0',
    };
  }

  private calculateSlippage(features: TransactionFeatures): number {
    // Simplified slippage calculation
    // In practice, would need expected vs actual amounts
    return 0.5; // 0.5% default
  }
}

export class LiquidityAddRule extends ClassificationRule {
  async matches(
    features: TransactionFeatures,
    rawTransaction: RawBlockchainTransaction
  ): Promise<Result<boolean, ClassificationError>> {
    const addLiquiditySignatures = [
      '0xe8e33700', // addLiquidity
      '0xf305d719', // addLiquidityETH
    ];

    const isAddLiquidity = addLiquiditySignatures.includes(features.methodSignature || '');
    const hasLPTokenMint = features.tokenTransfers.some(
      t => t.to.toLowerCase() === rawTransaction.from?.toLowerCase() && this.isLPToken(t.contractAddress)
    );

    return ok(isAddLiquidity && hasLPTokenMint);
  }

  classify(features: TransactionFeatures, rawTransaction: RawBlockchainTransaction): TransactionClassification {
    const lpToken = this.identifyLPToken(features);
    const providedTokens = this.identifyProvidedTokens(features);

    return {
      type: 'LIQUIDITY_ADD',
      subType: 'UNISWAP_V2_ADD',
      confidence: 0.9,
      description: `Add liquidity to ${providedTokens.map(t => t.symbol).join('/')} pool`,
      involvedAssets: [...providedTokens.map(t => t.symbol), lpToken.symbol],
      metadata: {
        protocol: 'Uniswap V2',
        lpToken,
        providedTokens,
        poolAddress: lpToken.address,
      },
    };
  }

  private isLPToken(contractAddress: string): boolean {
    // Logic to identify LP tokens (could be from registry or contract analysis)
    // For now, simplified check
    return true; // Placeholder
  }

  private identifyLPToken(features: TransactionFeatures): TokenInfo {
    const lpTransfer = features.tokenTransfers.find(
      t => t.to.toLowerCase() === rawTransaction.from?.toLowerCase() && this.isLPToken(t.contractAddress)
    );

    return {
      address: lpTransfer?.contractAddress || '',
      symbol: lpTransfer?.tokenSymbol || 'LP',
      amount: lpTransfer?.value.toString() || '0',
    };
  }

  private identifyProvidedTokens(features: TransactionFeatures): TokenInfo[] {
    return features.tokenTransfers
      .filter(t => t.from.toLowerCase() === rawTransaction.from?.toLowerCase())
      .filter(t => !this.isLPToken(t.contractAddress))
      .map(t => ({
        address: t.contractAddress,
        symbol: t.tokenSymbol,
        amount: t.value.toString(),
      }));
  }
}
```

**NFT Classification Rules**:

```typescript
// libs/core/src/services/classification-rules/nft-rules.ts
export class NFTTradeRule extends ClassificationRule {
  constructor(private readonly marketplace: string) {
    super();
  }

  async matches(
    features: TransactionFeatures,
    rawTransaction: RawBlockchainTransaction
  ): Promise<Result<boolean, ClassificationError>> {
    const nftTransferTopic = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
    const hasNFTTransfer = features.logTopics.includes(nftTransferTopic);
    const hasPayment =
      features.tokenTransfers.length > 0 || (rawTransaction.value && BigInt(rawTransaction.value) > 0n);

    return ok(hasNFTTransfer && hasPayment);
  }

  classify(features: TransactionFeatures, rawTransaction: RawBlockchainTransaction): TransactionClassification {
    const nftInfo = this.identifyNFTTransfer(features, rawTransaction);
    const paymentInfo = this.identifyPayment(features, rawTransaction);

    return {
      type: 'NFT_TRADE',
      subType: `${this.marketplace}_PURCHASE`,
      confidence: 0.85,
      description: `NFT purchase on ${this.marketplace}: ${nftInfo.collectionName} #${nftInfo.tokenId}`,
      involvedAssets: [nftInfo.collectionSymbol, paymentInfo.paymentToken],
      metadata: {
        marketplace: this.marketplace,
        nft: nftInfo,
        payment: paymentInfo,
        tradeType: this.identifyTradeType(features, rawTransaction),
      },
    };
  }

  private identifyNFTTransfer(features: TransactionFeatures, rawTransaction: RawBlockchainTransaction): NFTInfo {
    // Parse NFT transfer from logs
    const transferLogs =
      rawTransaction.logs?.filter(
        log => log.topics[0] === '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef'
      ) || [];

    const nftTransfer = transferLogs.find(
      log => log.topics.length === 4 // ERC-721 has 3 indexed topics + event signature
    );

    if (!nftTransfer) {
      return {
        contractAddress: '',
        collectionName: 'Unknown NFT',
        collectionSymbol: 'NFT',
        tokenId: '0',
      };
    }

    return {
      contractAddress: nftTransfer.address,
      collectionName: this.getCollectionName(nftTransfer.address),
      collectionSymbol: this.getCollectionSymbol(nftTransfer.address),
      tokenId: BigInt(nftTransfer.topics[3]).toString(),
    };
  }

  private identifyPayment(features: TransactionFeatures, rawTransaction: RawBlockchainTransaction): PaymentInfo {
    // Check for ETH payment
    if (rawTransaction.value && BigInt(rawTransaction.value) > 0n) {
      return {
        paymentToken: 'ETH',
        amount: rawTransaction.value,
        paymentMethod: 'NATIVE_ETH',
      };
    }

    // Check for ERC-20 payment (WETH, USDC, etc.)
    const paymentTransfer = features.tokenTransfers.find(
      t => t.from.toLowerCase() === rawTransaction.from?.toLowerCase()
    );

    if (paymentTransfer) {
      return {
        paymentToken: paymentTransfer.tokenSymbol,
        amount: paymentTransfer.value.toString(),
        paymentMethod: 'ERC20_TOKEN',
      };
    }

    return {
      paymentToken: 'UNKNOWN',
      amount: '0',
      paymentMethod: 'UNKNOWN',
    };
  }

  private identifyTradeType(
    features: TransactionFeatures,
    rawTransaction: RawBlockchainTransaction
  ): 'PURCHASE' | 'SALE' | 'AUCTION' | 'OFFER_ACCEPTED' {
    // Simplified logic - would need marketplace-specific analysis
    return 'PURCHASE';
  }

  private getCollectionName(contractAddress: string): string {
    // Would query contract or use NFT metadata service
    return 'Unknown Collection';
  }

  private getCollectionSymbol(contractAddress: string): string {
    // Would query contract symbol
    return 'NFT';
  }
}

// Supporting interfaces
interface NFTInfo {
  contractAddress: string;
  collectionName: string;
  collectionSymbol: string;
  tokenId: string;
}

interface PaymentInfo {
  paymentToken: string;
  amount: string;
  paymentMethod: 'NATIVE_ETH' | 'ERC20_TOKEN' | 'UNKNOWN';
}

interface TokenInfo {
  address: string;
  symbol: string;
  amount: string;
}
```

#### 4.3 NFT and LP Token Modeling (Week 2)

**NFT Currency Modeling Strategy**:

```typescript
// libs/core/src/aggregates/currency/nft-currency.aggregate.ts
export class NFTCurrency extends Currency {
  private constructor(
    id: number | undefined,
    ticker: string,
    name: string,
    decimals: number,
    assetClass: AssetClass,
    network: string,
    contractAddress: string,
    isNative: boolean,
    private readonly _collectionAddress: string,
    private readonly _tokenId: string,
    private readonly _collectionName: string,
    private readonly _tokenStandard: NFTStandard,
    private readonly _metadata: NFTMetadata,
    createdAt: Date,
    updatedAt: Date
  ) {
    super(id, ticker, name, decimals, assetClass, network, contractAddress, isNative, createdAt, updatedAt);
  }

  static createNFT(data: CreateNFTCurrencyData): Result<NFTCurrency, CurrencyError> {
    // NFTs always have 0 decimals (they are indivisible)
    if (data.decimals !== 0) {
      return err(new InvalidDecimalsError('NFTs must have 0 decimals'));
    }

    // Create unique ticker: COLLECTION_SYMBOL-TOKEN_ID
    const ticker = `${data.collectionSymbol}-${data.tokenId}`;
    const name = `${data.collectionName} #${data.tokenId}`;

    const now = new Date();
    const nftCurrency = new NFTCurrency(
      undefined,
      ticker,
      name,
      0, // NFTs are indivisible
      AssetClass.NFT,
      data.network,
      data.collectionAddress,
      false, // NFTs are never native currency
      data.collectionAddress,
      data.tokenId,
      data.collectionName,
      data.tokenStandard,
      data.metadata,
      now,
      now
    );

    return ok(nftCurrency);
  }

  // NFT-specific getters
  get collectionAddress(): string {
    return this._collectionAddress;
  }
  get tokenId(): string {
    return this._tokenId;
  }
  get collectionName(): string {
    return this._collectionName;
  }
  get tokenStandard(): NFTStandard {
    return this._tokenStandard;
  }
  get metadata(): NFTMetadata {
    return this._metadata;
  }

  /**
   * Generate unique identifier for this specific NFT
   */
  getUniqueIdentifier(): string {
    return `${this._collectionAddress}-${this._tokenId}`;
  }

  /**
   * Check if this NFT belongs to the same collection as another
   */
  isSameCollection(other: NFTCurrency): boolean {
    return this._collectionAddress.toLowerCase() === other._collectionAddress.toLowerCase();
  }
}

export enum NFTStandard {
  ERC721 = 'ERC721',
  ERC1155 = 'ERC1155',
}

export interface NFTMetadata {
  imageUrl?: string;
  description?: string;
  attributes?: NFTAttribute[];
  externalUrl?: string;
  animationUrl?: string;
}

export interface NFTAttribute {
  traitType: string;
  value: string | number;
  displayType?: 'boost_number' | 'boost_percentage' | 'number' | 'date';
}

export interface CreateNFTCurrencyData {
  collectionAddress: string;
  tokenId: string;
  collectionName: string;
  collectionSymbol: string;
  network: string;
  tokenStandard: NFTStandard;
  metadata: NFTMetadata;
  decimals: 0; // Always 0 for NFTs
}
```

**LP Token Modeling Strategy**:

```typescript
// libs/core/src/aggregates/currency/lp-token-currency.aggregate.ts
export class LPTokenCurrency extends Currency {
  private constructor(
    id: number | undefined,
    ticker: string,
    name: string,
    decimals: number,
    assetClass: AssetClass,
    network: string,
    contractAddress: string,
    isNative: boolean,
    private readonly _poolAddress: string,
    private readonly _underlyingTokens: UnderlyingToken[],
    private readonly _protocol: string,
    private readonly _poolType: PoolType,
    private readonly _feeRate: number,
    createdAt: Date,
    updatedAt: Date
  ) {
    super(id, ticker, name, decimals, assetClass, network, contractAddress, isNative, createdAt, updatedAt);
  }

  static createLPToken(data: CreateLPTokenData): Result<LPTokenCurrency, CurrencyError> {
    // Validate underlying tokens
    if (data.underlyingTokens.length < 2) {
      return err(new InvalidLPTokenError('LP tokens must have at least 2 underlying tokens'));
    }

    // Create descriptive ticker: PROTOCOL-TOKEN1/TOKEN2-LP
    const tokenSymbols = data.underlyingTokens.map(t => t.symbol).join('/');
    const ticker = `${data.protocol.toUpperCase()}-${tokenSymbols}-LP`;
    const name = `${data.protocol} ${tokenSymbols} LP Token`;

    const now = new Date();
    const lpToken = new LPTokenCurrency(
      undefined,
      ticker,
      name,
      18, // Most LP tokens have 18 decimals
      AssetClass.LP_TOKEN,
      data.network,
      data.poolAddress,
      false,
      data.poolAddress,
      data.underlyingTokens,
      data.protocol,
      data.poolType,
      data.feeRate,
      now,
      now
    );

    return ok(lpToken);
  }

  // LP Token specific getters
  get poolAddress(): string {
    return this._poolAddress;
  }
  get underlyingTokens(): UnderlyingToken[] {
    return [...this._underlyingTokens];
  }
  get protocol(): string {
    return this._protocol;
  }
  get poolType(): PoolType {
    return this._poolType;
  }
  get feeRate(): number {
    return this._feeRate;
  }

  /**
   * Calculate the theoretical value of LP tokens based on underlying reserves
   */
  async calculateLPTokenValue(
    lpTokenQuantity: Money,
    underlyingReserves: Map<string, Money>,
    priceProvider: IRealTimePriceProvider
  ): Promise<Result<Money, LPTokenError>> {
    try {
      // Get total supply of LP tokens
      const totalSupply = await this.getTotalSupply();

      // Calculate share of pool
      const sharePercentage = lpTokenQuantity.toDecimal() / totalSupply;

      // Calculate value of underlying tokens
      let totalValue = Money.zero('USD', 2).unwrap();

      for (const underlyingToken of this._underlyingTokens) {
        const reserve = underlyingReserves.get(underlyingToken.symbol);
        if (!reserve) continue;

        const userShare = reserve.multiply(sharePercentage.toString()).unwrap();
        const priceResult = await priceProvider.fetchPrices([underlyingToken.symbol], 'USD');

        if (priceResult.isOk()) {
          const prices = priceResult.value;
          const tokenPrice = prices.get(underlyingToken.symbol);
          if (tokenPrice) {
            const tokenValue = userShare.multiply(tokenPrice.price.toFixedString()).unwrap();
            totalValue = totalValue.add(tokenValue).unwrap();
          }
        }
      }

      return ok(totalValue);
    } catch (error) {
      return err(new LPTokenError(`Failed to calculate LP token value: ${error.message}`));
    }
  }

  private async getTotalSupply(): Promise<number> {
    // Would query the contract's totalSupply() method
    // Placeholder implementation
    return 1000000; // 1M LP tokens
  }
}

export enum PoolType {
  CONSTANT_PRODUCT = 'CONSTANT_PRODUCT', // Uniswap V2 style (x * y = k)
  CONCENTRATED_LIQUIDITY = 'CONCENTRATED_LIQUIDITY', // Uniswap V3 style
  STABLE_SWAP = 'STABLE_SWAP', // Curve style (for similar assets)
  WEIGHTED = 'WEIGHTED', // Balancer style (different weights)
}

export interface UnderlyingToken {
  symbol: string;
  address: string;
  weight?: number; // For weighted pools (Balancer)
}

export interface CreateLPTokenData {
  poolAddress: string;
  underlyingTokens: UnderlyingToken[];
  protocol: string;
  poolType: PoolType;
  feeRate: number; // Fee rate as percentage (e.g., 0.3 for 0.3%)
  network: string;
}
```

#### 4.4 Enhanced Account Type Integration (Week 3)

**Updated Account Creation with DeFi Support**:

```typescript
// libs/core/src/services/enhanced-account-creation.service.ts
@Injectable()
export class EnhancedAccountCreationService {
  constructor(
    private readonly currencyRepository: ICurrencyRepository,
    private readonly accountRepository: IAccountRepository,
    private readonly nftMetadataService: INFTMetadataService
  ) {}

  /**
   * Create account with automatic type detection based on currency
   */
  async createAccountWithTypeDetection(
    data: CreateAccountWithDetectionData
  ): Promise<Result<Account, AccountCreationError>> {
    // Get currency information
    const currencyResult = await this.currencyRepository.findByTicker(data.currencyTicker);
    if (currencyResult.isErr()) {
      return err(new CurrencyNotFoundError(data.currencyTicker));
    }

    const currency = currencyResult.value;

    // Determine appropriate account type based on currency and source
    const accountType = await this.determineAccountType(currency, data.source, data.metadata);

    // Create account with determined type
    const accountData: CreateAccountData = {
      ...data,
      type: accountType,
    };

    const accountResult = Account.create(accountData);
    if (accountResult.isErr()) {
      return err(new AccountCreationError('Failed to create account', accountResult.error));
    }

    // Save account
    const saveResult = await this.accountRepository.save(accountResult.value);
    if (saveResult.isErr()) {
      return err(new AccountCreationError('Failed to save account', saveResult.error));
    }

    return ok(accountResult.value);
  }

  private async determineAccountType(
    currency: Currency,
    source: string,
    metadata?: Record<string, unknown>
  ): Promise<AccountType> {
    // NFT-specific logic
    if (currency.assetClass === AssetClass.NFT) {
      return AccountType.ASSET_NFT_WALLET;
    }

    // LP Token-specific logic
    if (currency.assetClass === AssetClass.LP_TOKEN) {
      return AccountType.ASSET_DEFI_LP;
    }

    // Source-based detection
    if (this.isExchangeSource(source)) {
      return AccountType.ASSET_EXCHANGE;
    }

    if (this.isStakingSource(source)) {
      // Could be further refined based on metadata
      return AccountType.ASSET_WALLET; // Staked assets are still wallet-held
    }

    if (this.isDeFiProtocol(source)) {
      return this.getDeFiAccountType(source, currency, metadata);
    }

    // Default to wallet for unknown sources
    return AccountType.ASSET_WALLET;
  }

  private isExchangeSource(source: string): boolean {
    const exchanges = ['binance', 'coinbase', 'kraken', 'bybit', 'okx', 'huobi', 'kucoin', 'gate', 'bitget', 'mexc'];
    return exchanges.includes(source.toLowerCase());
  }

  private isStakingSource(source: string): boolean {
    const stakingSources = ['eth2', 'beacon-chain', 'rocketpool', 'lido', 'stakewise'];
    return stakingSources.includes(source.toLowerCase());
  }

  private isDeFiProtocol(source: string): boolean {
    const defiProtocols = [
      'uniswap',
      'sushiswap',
      'curve',
      'balancer',
      'aave',
      'compound',
      'makerdao',
      'yearn',
      'convex',
      'frax',
    ];
    return defiProtocols.includes(source.toLowerCase());
  }

  private getDeFiAccountType(source: string, currency: Currency, metadata?: Record<string, unknown>): AccountType {
    const protocol = source.toLowerCase();

    // Lending protocols
    if (['aave', 'compound'].includes(protocol)) {
      return metadata?.borrowed === true ? AccountType.LIABILITY_BORROWING : AccountType.ASSET_YIELD_BEARING;
    }

    // DEX protocols
    if (['uniswap', 'sushiswap', 'curve', 'balancer'].includes(protocol)) {
      return currency.assetClass === AssetClass.LP_TOKEN ? AccountType.ASSET_DEFI_LP : AccountType.ASSET_WALLET;
    }

    // Yield farming protocols
    if (['yearn', 'convex'].includes(protocol)) {
      return AccountType.ASSET_YIELD_BEARING;
    }

    // Default DeFi account type
    return AccountType.ASSET_WALLET;
  }
}

export interface CreateAccountWithDetectionData {
  userId: string;
  name: string;
  currencyTicker: string;
  source: string;
  identifier?: string;
  metadata?: Record<string, unknown>;
}
```

### Success Criteria Phase 4

- [ ] Transaction classifier correctly identifying major DeFi protocols (90%+ accuracy)
- [ ] NFT and LP token currency models working with proper valuation
- [ ] Enhanced account types properly assigned based on transaction classification
- [ ] Support for complex multi-step DeFi transactions (swaps, liquidity provision)
- [ ] Integration with tax lot creation for DeFi acquisition events
- [ ] Performance optimization for batch transaction classification

### Dependencies & Blockers

- **Contract Registry**: Database of known DeFi protocol contracts and signatures
- **Token Metadata**: External services for NFT and token information
- **Protocol Updates**: Keeping up with new DeFi protocols and contract changes
- **Gas Optimization**: Efficient contract calls for metadata retrieval

### Risk Mitigation

- **Classification Accuracy**: Extensive testing with known transaction samples
- **Protocol Evolution**: Modular rule system for easy updates
- **Performance**: Batch processing and caching for contract metadata
- **Maintenance**: Automated monitoring for classification rule performance

---

## Phase 5: Data Integrity & User Control

**Duration**: 3-4 weeks  
**Priority**: High (User trust and data accuracy)  
**Business Value**: High (User confidence and professional features)  
**Technical Risk**: Medium (External API reliability, data reconciliation complexity)

### Objectives

- Implement reconciliation service for balance verification
- Build manual transaction creation and correction system
- Create immutable audit trail for all modifications
- Develop data import/export capabilities
- Establish user data ownership and portability

### Phase 5 Dependencies

- ✅ Phase 2: Portfolio valuation and balance calculation
- ✅ Phase 3: Tax lot management for corrections
- ⚠️ External: Exchange/wallet API integrations for live balance fetching
- ⚠️ Security: API key management for reconciliation services

### Detailed Implementation Plan

#### 5.1 Reconciliation Service Implementation (Week 1-2)

**Core Reconciliation Engine**:

```typescript
// libs/core/src/services/reconciliation.service.ts
@Injectable()
export class ReconciliationService {
  constructor(
    private readonly balanceCalculator: EnhancedBalanceCalculatorService,
    private readonly externalBalanceFetcher: IExternalBalanceFetcher,
    private readonly credentialsService: ICredentialsService,
    private readonly reconciliationRepository: IReconciliationRepository,
    private readonly logger: LoggerService
  ) {}

  /**
   * Perform comprehensive reconciliation for a user across all sources
   */
  async performFullReconciliation(
    userId: string,
    options?: ReconciliationOptions
  ): Promise<Result<ReconciliationReport, ReconciliationError>> {
    const startTime = Date.now();

    try {
      this.logger.log(`Starting full reconciliation for user ${userId}`);

      // Get all user accounts
      const accountsResult = await this.getReconciliationAccounts(userId);
      if (accountsResult.isErr()) {
        return err(accountsResult.error);
      }

      const accounts = accountsResult.value;

      // Group accounts by source for batch processing
      const accountsBySource = this.groupAccountsBySource(accounts);

      // Perform reconciliation for each source
      const sourceReconciliations: SourceReconciliation[] = [];

      for (const [source, sourceAccounts] of accountsBySource) {
        const sourceReconciliation = await this.reconcileSource(userId, source, sourceAccounts, options);

        if (sourceReconciliation.isOk()) {
          sourceReconciliations.push(sourceReconciliation.value);
        } else {
          this.logger.warn(`Failed to reconcile source ${source}: ${sourceReconciliation.error.message}`);
        }
      }

      // Aggregate results
      const report = this.aggregateReconciliationResults(userId, sourceReconciliations, Date.now() - startTime);

      // Save reconciliation report
      await this.reconciliationRepository.saveReport(report);

      this.logger.log(`Completed reconciliation for user ${userId} in ${Date.now() - startTime}ms`);

      return ok(report);
    } catch (error) {
      return err(new ReconciliationError(`Reconciliation failed: ${error.message}`));
    }
  }

  /**
   * Reconcile balances for a specific source (exchange, wallet, etc.)
   */
  private async reconcileSource(
    userId: string,
    source: string,
    accounts: ReconciliationAccount[],
    options?: ReconciliationOptions
  ): Promise<Result<SourceReconciliation, ReconciliationError>> {
    try {
      // Calculate internal balances
      const internalBalances = await this.calculateInternalBalances(userId, accounts);

      // Fetch external balances
      const externalBalancesResult = await this.fetchExternalBalances(userId, source, accounts);
      if (externalBalancesResult.isErr()) {
        return err(externalBalancesResult.error);
      }

      const externalBalances = externalBalancesResult.value;

      // Compare balances and identify discrepancies
      const discrepancies = this.identifyDiscrepancies(
        internalBalances,
        externalBalances,
        options?.toleranceThreshold || 0.001 // 0.1% default tolerance
      );

      // Categorize discrepancies by severity
      const { critical, warnings, minor } = this.categorizeDiscrepancies(discrepancies);

      const sourceReconciliation: SourceReconciliation = {
        source,
        timestamp: new Date(),
        totalAssets: accounts.length,
        matchedAssets: accounts.length - discrepancies.length,
        discrepancies,
        criticalDiscrepancies: critical,
        warningDiscrepancies: warnings,
        minorDiscrepancies: minor,
        overallStatus: critical.length > 0 ? 'CRITICAL' : warnings.length > 0 ? 'WARNING' : 'MATCHED',
        externalBalancesFetched: externalBalances.size,
        fetchDurationMs: 0, // Would be tracked from actual fetch
      };

      return ok(sourceReconciliation);
    } catch (error) {
      return err(new ReconciliationError(`Source reconciliation failed for ${source}: ${error.message}`));
    }
  }

  private async fetchExternalBalances(
    userId: string,
    source: string,
    accounts: ReconciliationAccount[]
  ): Promise<Result<Map<string, Money>, ReconciliationError>> {
    // Get credentials for this source
    const credentialsResult = await this.credentialsService.getCredentialHandle(userId, source);
    if (credentialsResult.isErr()) {
      return err(new ReconciliationError(`No credentials found for source ${source}`));
    }

    const credentialHandle = credentialsResult.value;

    // Use credentials service's secure execution pattern
    return this.credentialsService.executeWithCredentials(credentialHandle, async credentials => {
      return this.externalBalanceFetcher.fetchBalances(source, credentials, accounts);
    });
  }

  private calculateInternalBalances(userId: string, accounts: ReconciliationAccount[]): Promise<Map<string, Money>> {
    const balancePromises = accounts.map(async account => {
      const balanceResult = await this.balanceCalculator.calculateAssetBalance(
        userId,
        account.currencyTicker,
        [account],
        { asOfTimestamp: new Date() }
      );

      if (balanceResult.isOk()) {
        return [account.currencyTicker, balanceResult.value.totalQuantity] as [string, Money];
      }

      return [account.currencyTicker, Money.zero(account.currencyTicker, 8).unwrap()] as [string, Money];
    });

    return Promise.all(balancePromises).then(results => new Map(results));
  }

  private identifyDiscrepancies(
    internalBalances: Map<string, Money>,
    externalBalances: Map<string, Money>,
    toleranceThreshold: number
  ): BalanceDiscrepancy[] {
    const discrepancies: BalanceDiscrepancy[] = [];

    // Check all internal balances against external
    for (const [asset, internalBalance] of internalBalances) {
      const externalBalance = externalBalances.get(asset);

      if (!externalBalance) {
        // Missing external balance
        discrepancies.push({
          asset,
          internalBalance,
          externalBalance: Money.zero(asset, internalBalance.scale).unwrap(),
          discrepancyAmount: internalBalance,
          discrepancyPercentage: 100,
          type: 'MISSING_EXTERNAL',
          severity: internalBalance.isZero() ? 'MINOR' : 'CRITICAL',
        });
        continue;
      }

      // Calculate discrepancy
      const discrepancyAmount = internalBalance.subtract(externalBalance).unwrap().abs();
      const discrepancyPercentage = this.calculateDiscrepancyPercentage(internalBalance, externalBalance);

      if (discrepancyPercentage > toleranceThreshold) {
        discrepancies.push({
          asset,
          internalBalance,
          externalBalance,
          discrepancyAmount,
          discrepancyPercentage,
          type: 'BALANCE_MISMATCH',
          severity: this.determineSeverity(discrepancyPercentage),
        });
      }
    }

    // Check for external balances not in internal records
    for (const [asset, externalBalance] of externalBalances) {
      if (!internalBalances.has(asset) && !externalBalance.isZero()) {
        discrepancies.push({
          asset,
          internalBalance: Money.zero(asset, externalBalance.scale).unwrap(),
          externalBalance,
          discrepancyAmount: externalBalance,
          discrepancyPercentage: 100,
          type: 'MISSING_INTERNAL',
          severity: 'WARNING', // New assets are usually warnings, not critical
        });
      }
    }

    return discrepancies;
  }

  private calculateDiscrepancyPercentage(internal: Money, external: Money): number {
    if (internal.isZero() && external.isZero()) {
      return 0;
    }

    if (internal.isZero() || external.isZero()) {
      return 100;
    }

    const difference = internal.subtract(external).unwrap().abs();
    const average = internal.add(external).unwrap().divide('2').unwrap();

    return (difference.toDecimal() / average.toDecimal()) * 100;
  }

  private determineSeverity(discrepancyPercentage: number): 'MINOR' | 'WARNING' | 'CRITICAL' {
    if (discrepancyPercentage > 10) return 'CRITICAL'; // >10% difference
    if (discrepancyPercentage > 1) return 'WARNING'; // >1% difference
    return 'MINOR'; // <1% difference
  }

  private categorizeDiscrepancies(discrepancies: BalanceDiscrepancy[]): {
    critical: BalanceDiscrepancy[];
    warnings: BalanceDiscrepancy[];
    minor: BalanceDiscrepancy[];
  } {
    return {
      critical: discrepancies.filter(d => d.severity === 'CRITICAL'),
      warnings: discrepancies.filter(d => d.severity === 'WARNING'),
      minor: discrepancies.filter(d => d.severity === 'MINOR'),
    };
  }

  private aggregateReconciliationResults(
    userId: string,
    sourceReconciliations: SourceReconciliation[],
    durationMs: number
  ): ReconciliationReport {
    const totalDiscrepancies = sourceReconciliations.reduce((sum, source) => sum + source.discrepancies.length, 0);

    const criticalCount = sourceReconciliations.reduce((sum, source) => sum + source.criticalDiscrepancies.length, 0);

    const warningCount = sourceReconciliations.reduce((sum, source) => sum + source.warningDiscrepancies.length, 0);

    const overallStatus: ReconciliationStatus =
      criticalCount > 0 ? 'CRITICAL' : warningCount > 0 ? 'WARNING' : 'MATCHED';

    return {
      id: crypto.randomUUID(),
      userId,
      timestamp: new Date(),
      overallStatus,
      sourceReconciliations,
      summary: {
        totalSources: sourceReconciliations.length,
        totalAssets: sourceReconciliations.reduce((sum, s) => sum + s.totalAssets, 0),
        totalDiscrepancies,
        criticalDiscrepancies: criticalCount,
        warningDiscrepancies: warningCount,
        minorDiscrepancies: totalDiscrepancies - criticalCount - warningCount,
      },
      durationMs,
    };
  }

  private groupAccountsBySource(accounts: ReconciliationAccount[]): Map<string, ReconciliationAccount[]> {
    const grouped = new Map<string, ReconciliationAccount[]>();

    for (const account of accounts) {
      if (!grouped.has(account.source)) {
        grouped.set(account.source, []);
      }
      grouped.get(account.source)!.push(account);
    }

    return grouped;
  }

  private async getReconciliationAccounts(
    userId: string
  ): Promise<Result<ReconciliationAccount[], ReconciliationError>> {
    // This would fetch accounts from the account repository
    // and transform them into ReconciliationAccount format
    // Placeholder implementation
    return ok([]);
  }
}

// Supporting types and interfaces
export interface ReconciliationOptions {
  toleranceThreshold?: number; // Percentage threshold for discrepancies
  excludeSmallBalances?: boolean;
  minBalanceThreshold?: Money;
  sourcesToInclude?: string[];
  sourcesToExclude?: string[];
}

export interface ReconciliationAccount {
  id: number;
  currencyTicker: string;
  source: string;
  name: string;
}

export interface BalanceDiscrepancy {
  asset: string;
  internalBalance: Money;
  externalBalance: Money;
  discrepancyAmount: Money;
  discrepancyPercentage: number;
  type: 'BALANCE_MISMATCH' | 'MISSING_EXTERNAL' | 'MISSING_INTERNAL';
  severity: 'MINOR' | 'WARNING' | 'CRITICAL';
}

export interface SourceReconciliation {
  source: string;
  timestamp: Date;
  totalAssets: number;
  matchedAssets: number;
  discrepancies: BalanceDiscrepancy[];
  criticalDiscrepancies: BalanceDiscrepancy[];
  warningDiscrepancies: BalanceDiscrepancy[];
  minorDiscrepancies: BalanceDiscrepancy[];
  overallStatus: ReconciliationStatus;
  externalBalancesFetched: number;
  fetchDurationMs: number;
}

export interface ReconciliationReport {
  id: string;
  userId: string;
  timestamp: Date;
  overallStatus: ReconciliationStatus;
  sourceReconciliations: SourceReconciliation[];
  summary: {
    totalSources: number;
    totalAssets: number;
    totalDiscrepancies: number;
    criticalDiscrepancies: number;
    warningDiscrepancies: number;
    minorDiscrepancies: number;
  };
  durationMs: number;
}

export type ReconciliationStatus = 'MATCHED' | 'WARNING' | 'CRITICAL';
```

**External Balance Fetcher Implementation**:

```typescript
// libs/providers/src/external-balance/external-balance-fetcher.service.ts
@Injectable()
export class ExternalBalanceFetcherService implements IExternalBalanceFetcher {
  constructor(
    private readonly httpService: HttpService,
    private readonly logger: LoggerService
  ) {}

  async fetchBalances(
    source: string,
    credentials: DecryptedCredentials,
    accounts: ReconciliationAccount[]
  ): Promise<Result<Map<string, Money>, ExternalBalanceError>> {
    const fetcher = this.getFetcherForSource(source);

    if (!fetcher) {
      return err(new UnsupportedSourceError(source));
    }

    try {
      return await fetcher.fetchBalances(credentials, accounts);
    } catch (error) {
      return err(new ExternalBalanceError(`Failed to fetch balances from ${source}: ${error.message}`));
    }
  }

  private getFetcherForSource(source: string): ISourceBalanceFetcher | null {
    switch (source.toLowerCase()) {
      case 'binance':
        return new BinanceBalanceFetcher(this.httpService, this.logger);
      case 'coinbase':
        return new CoinbaseBalanceFetcher(this.httpService, this.logger);
      case 'ethereum':
        return new EthereumWalletFetcher(this.httpService, this.logger);
      case 'bitcoin':
        return new BitcoinWalletFetcher(this.httpService, this.logger);
      default:
        return null;
    }
  }
}

// Example implementation for Binance
export class BinanceBalanceFetcher implements ISourceBalanceFetcher {
  private readonly BASE_URL = 'https://api.binance.com/api/v3';

  constructor(
    private readonly httpService: HttpService,
    private readonly logger: LoggerService
  ) {}

  async fetchBalances(
    credentials: DecryptedCredentials,
    accounts: ReconciliationAccount[]
  ): Promise<Result<Map<string, Money>, ExternalBalanceError>> {
    try {
      // Create signed request to Binance API
      const timestamp = Date.now();
      const queryString = `timestamp=${timestamp}`;
      const signature = this.createSignature(queryString, credentials.apiSecret);

      const url = `${this.BASE_URL}/account?${queryString}&signature=${signature}`;
      const headers = {
        'X-MBX-APIKEY': credentials.apiKey,
      };

      const response = await this.httpService.get(url, { headers }).toPromise();

      if (!response?.data?.balances) {
        return err(new ExternalBalanceError('Invalid response from Binance API'));
      }

      const balances = new Map<string, Money>();

      for (const balance of response.data.balances) {
        const asset = balance.asset;
        const free = parseFloat(balance.free);
        const locked = parseFloat(balance.locked);
        const total = free + locked;

        if (total > 0) {
          const money = Money.fromDecimal(total, asset, 8); // Assuming 8 decimals
          if (money.isOk()) {
            balances.set(asset, money.value);
          }
        }
      }

      return ok(balances);
    } catch (error) {
      return err(new ExternalBalanceError(`Binance API error: ${error.message}`));
    }
  }

  private createSignature(queryString: string, secretKey: string): string {
    const crypto = require('crypto');
    return crypto.createHmac('sha256', secretKey).update(queryString).digest('hex');
  }
}

export interface ISourceBalanceFetcher {
  fetchBalances(
    credentials: DecryptedCredentials,
    accounts: ReconciliationAccount[]
  ): Promise<Result<Map<string, Money>, ExternalBalanceError>>;
}

export interface DecryptedCredentials {
  apiKey: string;
  apiSecret: string;
  passphrase?: string; // For some exchanges
}
```

#### 5.2 Manual Transaction System (Week 2-3)

**Manual Transaction Creation Commands**:

```typescript
// libs/core/src/commands/manual-transaction.commands.ts
export class CreateManualTransactionCommand {
  constructor(
    public readonly userId: string,
    public readonly description: string,
    public readonly transactionDate: Date,
    public readonly entries: CreateManualEntryData[],
    public readonly source: string = 'manual',
    public readonly metadata?: Record<string, unknown>
  ) {}
}

export class ReverseTransactionCommand {
  constructor(
    public readonly userId: string,
    public readonly originalTransactionId: number,
    public readonly reverseReason: string,
    public readonly reverseDate: Date = new Date()
  ) {}
}

export interface CreateManualEntryData {
  accountId: number;
  direction: 'CREDIT' | 'DEBIT';
  amount: Money;
  entryType: string;
  description?: string;
}

// Command Handlers
@CommandHandler(CreateManualTransactionCommand)
export class CreateManualTransactionHandler implements ICommandHandler<CreateManualTransactionCommand> {
  constructor(
    private readonly transactionRepository: ITransactionRepository,
    private readonly accountRepository: IAccountRepository,
    private readonly transactionValidator: TransactionValidatorService,
    private readonly auditLogger: IAuditLogger,
    private readonly eventBus: EventBus
  ) {}

  async execute(command: CreateManualTransactionCommand): Promise<ManualTransactionResult> {
    try {
      // Validate user has access to all referenced accounts
      const accountValidation = await this.validateAccountAccess(command.userId, command.entries);
      if (accountValidation.isErr()) {
        throw new ManualTransactionException(accountValidation.error.message);
      }

      // Create ledger transaction
      const transactionData: CreateLedgerTransactionData = {
        userId: command.userId,
        description: `[MANUAL] ${command.description}`,
        transactionDate: command.transactionDate,
        source: command.source,
        externalId: `manual_${Date.now()}_${crypto.randomUUID()}`,
        entries: command.entries,
      };

      const transactionResult = LedgerTransaction.create(transactionData);
      if (transactionResult.isErr()) {
        throw new ManualTransactionException(`Failed to create transaction: ${transactionResult.error.message}`);
      }

      const transaction = transactionResult.value;

      // Perform validation
      const validationResult = await this.transactionValidator.validateTransaction(command.userId, transaction);
      if (validationResult.isErr()) {
        throw new ManualTransactionException(`Transaction validation failed: ${validationResult.error.message}`);
      }

      const validation = validationResult.value;
      if (!validation.isValid) {
        throw new ManualTransactionException(
          `Transaction is invalid: ${validation.errors.map(e => e.message).join(', ')}`
        );
      }

      // Save transaction
      const saveResult = await this.transactionRepository.save(transaction);
      if (saveResult.isErr()) {
        throw new ManualTransactionException(`Failed to save transaction: ${saveResult.error.message}`);
      }

      // Create audit log entry
      await this.auditLogger.logManualTransaction({
        userId: command.userId,
        transactionId: transaction.id!,
        action: 'CREATE_MANUAL_TRANSACTION',
        description: command.description,
        entries: command.entries,
        timestamp: new Date(),
      });

      // Emit domain events for downstream processing (tax lots, etc.)
      this.emitTransactionEvents(transaction, command.userId);

      return {
        transactionId: transaction.id!,
        success: true,
        message: 'Manual transaction created successfully',
        warnings: validation.warnings,
      };
    } catch (error) {
      await this.auditLogger.logManualTransactionError({
        userId: command.userId,
        action: 'CREATE_MANUAL_TRANSACTION_FAILED',
        error: error.message,
        command,
        timestamp: new Date(),
      });

      throw error;
    }
  }

  private async validateAccountAccess(
    userId: string,
    entries: CreateManualEntryData[]
  ): Promise<Result<void, ManualTransactionError>> {
    const accountIds = entries.map(e => e.accountId);

    for (const accountId of accountIds) {
      const accountResult = await this.accountRepository.findByIdAndUserId(accountId, userId);
      if (accountResult.isErr()) {
        return err(new AccountAccessError(accountId, userId));
      }
    }

    return ok();
  }

  private emitTransactionEvents(transaction: LedgerTransaction, userId: string): void {
    // Emit events for asset acquisitions and disposals
    for (const entry of transaction.entries) {
      if (entry.direction === 'CREDIT' && this.isAssetAcquisition(entry)) {
        this.eventBus.publish(
          new AssetAcquired(
            transaction.id!.toString(),
            userId,
            entry.amount.currency,
            entry.amount,
            entry.amount, // For manual entries, cost basis = amount
            transaction.transactionDate,
            'PURCHASE' // Default acquisition method for manual entries
          )
        );
      }

      if (entry.direction === 'DEBIT' && this.isAssetDisposal(entry)) {
        this.eventBus.publish(
          new AssetDisposed(
            transaction.id!.toString(),
            userId,
            entry.amount.currency,
            entry.amount,
            transaction.transactionDate,
            'SALE' // Default disposal method for manual entries
          )
        );
      }
    }
  }

  private isAssetAcquisition(entry: any): boolean {
    // Logic to determine if this entry represents an asset acquisition
    return ['TRADE', 'DEPOSIT', 'REWARD', 'STAKING', 'AIRDROP', 'MINING'].includes(entry.entryType);
  }

  private isAssetDisposal(entry: any): boolean {
    // Logic to determine if this entry represents an asset disposal
    return ['TRADE', 'WITHDRAWAL', 'FEE'].includes(entry.entryType);
  }
}

@CommandHandler(ReverseTransactionCommand)
export class ReverseTransactionHandler implements ICommandHandler<ReverseTransactionCommand> {
  constructor(
    private readonly transactionRepository: ITransactionRepository,
    private readonly auditLogger: IAuditLogger,
    private readonly eventBus: EventBus
  ) {}

  async execute(command: ReverseTransactionCommand): Promise<TransactionReversalResult> {
    try {
      // Get the original transaction
      const originalResult = await this.transactionRepository.findByIdAndUserId(
        command.originalTransactionId,
        command.userId
      );

      if (originalResult.isErr()) {
        throw new TransactionReversalException('Original transaction not found');
      }

      const originalTransaction = originalResult.value;

      // Check if transaction is already reversed
      const existingReversalResult = await this.transactionRepository.findReversalTransaction(
        command.originalTransactionId
      );

      if (existingReversalResult.isOk()) {
        throw new TransactionReversalException('Transaction has already been reversed');
      }

      // Create reversal transaction with opposing entries
      const reversalEntries = this.createReversalEntries(originalTransaction);

      const reversalData: CreateLedgerTransactionData = {
        userId: command.userId,
        description: `[REVERSAL] ${command.reverseReason} (Original: ${originalTransaction.description})`,
        transactionDate: command.reverseDate,
        source: 'manual_reversal',
        externalId: `reversal_${originalTransaction.id}_${Date.now()}`,
        entries: reversalEntries,
      };

      const reversalResult = LedgerTransaction.create(reversalData);
      if (reversalResult.isErr()) {
        throw new TransactionReversalException(`Failed to create reversal: ${reversalResult.error.message}`);
      }

      const reversalTransaction = reversalResult.value;

      // Save reversal transaction
      const saveResult = await this.transactionRepository.save(reversalTransaction);
      if (saveResult.isErr()) {
        throw new TransactionReversalException(`Failed to save reversal: ${saveResult.error.message}`);
      }

      // Link original and reversal transactions
      await this.transactionRepository.linkReversalTransaction(command.originalTransactionId, reversalTransaction.id!);

      // Create audit log
      await this.auditLogger.logTransactionReversal({
        userId: command.userId,
        originalTransactionId: command.originalTransactionId,
        reversalTransactionId: reversalTransaction.id!,
        reason: command.reverseReason,
        timestamp: new Date(),
      });

      return {
        originalTransactionId: command.originalTransactionId,
        reversalTransactionId: reversalTransaction.id!,
        success: true,
        message: 'Transaction reversed successfully',
      };
    } catch (error) {
      await this.auditLogger.logTransactionReversalError({
        userId: command.userId,
        originalTransactionId: command.originalTransactionId,
        error: error.message,
        timestamp: new Date(),
      });

      throw error;
    }
  }

  private createReversalEntries(originalTransaction: LedgerTransaction): CreateManualEntryData[] {
    return originalTransaction.entries.map(entry => ({
      accountId: entry.accountId,
      direction: entry.direction === 'CREDIT' ? 'DEBIT' : 'CREDIT', // Flip direction
      amount: entry.amount,
      entryType: `REVERSE_${entry.entryType}`,
      description: `Reversal of ${entry.entryType}`,
    }));
  }
}

// Result types
export interface ManualTransactionResult {
  transactionId: number;
  success: boolean;
  message: string;
  warnings: string[];
}

export interface TransactionReversalResult {
  originalTransactionId: number;
  reversalTransactionId: number;
  success: boolean;
  message: string;
}
```

#### 5.3 Data Import/Export System (Week 3)

**Comprehensive Data Export Service**:

```typescript
// libs/core/src/services/data-export.service.ts
@Injectable()
export class DataExportService {
  constructor(
    private readonly transactionRepository: ITransactionRepository,
    private readonly accountRepository: IAccountRepository,
    private readonly taxLotRepository: ITaxLotRepository,
    private readonly reconciliationRepository: IReconciliationRepository,
    private readonly logger: LoggerService
  ) {}

  /**
   * Export all user data in a structured format
   */
  async exportUserData(userId: string, options?: DataExportOptions): Promise<Result<UserDataExport, DataExportError>> {
    try {
      const startTime = Date.now();

      this.logger.log(`Starting data export for user ${userId}`);

      // Export all data categories
      const [accounts, transactions, taxLots, reconciliations] = await Promise.all([
        this.exportAccounts(userId),
        this.exportTransactions(userId, options?.dateRange),
        this.exportTaxLots(userId),
        this.exportReconciliations(userId, options?.includePeriod),
      ]);

      // Calculate export statistics
      const statistics = this.calculateExportStatistics(accounts, transactions, taxLots, reconciliations);

      const userDataExport: UserDataExport = {
        exportId: crypto.randomUUID(),
        userId,
        exportDate: new Date(),
        exportVersion: '1.0',
        statistics,
        accounts,
        transactions,
        taxLots,
        reconciliations,
        metadata: {
          exportDurationMs: Date.now() - startTime,
          exportOptions: options,
          dataIntegrityHash: this.calculateDataIntegrityHash(accounts, transactions, taxLots),
        },
      };

      this.logger.log(`Completed data export for user ${userId} in ${Date.now() - startTime}ms`);

      return ok(userDataExport);
    } catch (error) {
      return err(new DataExportError(`Data export failed: ${error.message}`));
    }
  }

  /**
   * Export data in various formats (JSON, CSV, Excel)
   */
  async exportUserDataAsFormat(
    userId: string,
    format: ExportFormat,
    options?: DataExportOptions
  ): Promise<Result<ExportBuffer, DataExportError>> {
    const dataResult = await this.exportUserData(userId, options);
    if (dataResult.isErr()) {
      return err(dataResult.error);
    }

    const data = dataResult.value;

    switch (format) {
      case 'JSON':
        return this.exportAsJSON(data);
      case 'CSV':
        return this.exportAsCSV(data);
      case 'EXCEL':
        return this.exportAsExcel(data);
      default:
        return err(new UnsupportedFormatError(format));
    }
  }

  private async exportTransactions(userId: string, dateRange?: DateRange): Promise<TransactionExport[]> {
    const transactionsResult = await this.transactionRepository.findByUserId(
      userId,
      dateRange?.startDate,
      dateRange?.endDate
    );

    if (transactionsResult.isErr()) {
      this.logger.warn(`Failed to export transactions for user ${userId}`);
      return [];
    }

    return transactionsResult.value.map(transaction => ({
      id: transaction.id!,
      externalId: transaction.externalId,
      description: transaction.description,
      transactionDate: transaction.transactionDate,
      source: transaction.source,
      entries: transaction.entries.map(entry => ({
        direction: entry.direction,
        amount: entry.amount.toFixedString(),
        currency: entry.amount.currency,
        entryType: entry.entryType,
        accountName: entry.accountName || 'Unknown',
      })),
      createdAt: transaction.createdAt,
    }));
  }

  private async exportTaxLots(userId: string): Promise<TaxLotExport[]> {
    const taxLotsResult = await this.taxLotRepository.findByUserId(userId);

    if (taxLotsResult.isErr()) {
      this.logger.warn(`Failed to export tax lots for user ${userId}`);
      return [];
    }

    return taxLotsResult.value.map(lot => ({
      id: lot.id.value,
      assetSymbol: lot.assetSymbol,
      acquisitionDate: lot.acquisitionDate,
      acquisitionMethod: lot.acquisitionMethod,
      originalQuantity: lot.originalQuantity.toFixedString(),
      remainingQuantity: lot.remainingQuantity.toFixedString(),
      costBasis: lot.costBasisSnapshot.totalValue.toFixedString(),
      costBasisCurrency: lot.costBasisSnapshot.currency,
      status: lot.status,
      createdAt: lot.createdAt,
    }));
  }

  private exportAsCSV(data: UserDataExport): Result<ExportBuffer, DataExportError> {
    try {
      // Create multiple CSV files for different data types
      const csvFiles: { [key: string]: string } = {};

      // Transactions CSV
      const transactionHeaders = [
        'ID',
        'External ID',
        'Description',
        'Date',
        'Source',
        'Direction',
        'Amount',
        'Currency',
        'Entry Type',
        'Account',
      ];
      const transactionRows = data.transactions.flatMap(tx =>
        tx.entries.map(entry => [
          tx.id,
          tx.externalId,
          tx.description,
          tx.transactionDate.toISOString(),
          tx.source,
          entry.direction,
          entry.amount,
          entry.currency,
          entry.entryType,
          entry.accountName,
        ])
      );

      csvFiles['transactions.csv'] = this.arrayToCSV([transactionHeaders, ...transactionRows]);

      // Tax Lots CSV
      const taxLotHeaders = [
        'ID',
        'Asset',
        'Acquisition Date',
        'Method',
        'Original Quantity',
        'Remaining Quantity',
        'Cost Basis',
        'Status',
      ];
      const taxLotRows = data.taxLots.map(lot => [
        lot.id,
        lot.assetSymbol,
        lot.acquisitionDate.toISOString(),
        lot.acquisitionMethod,
        lot.originalQuantity,
        lot.remainingQuantity,
        lot.costBasis,
        lot.status,
      ]);

      csvFiles['tax_lots.csv'] = this.arrayToCSV([taxLotHeaders, ...taxLotRows]);

      // Create ZIP file containing all CSVs
      const zipBuffer = this.createZipFromFiles(csvFiles);

      return ok({
        buffer: zipBuffer,
        mimeType: 'application/zip',
        filename: `exitbook_export_${data.userId}_${data.exportDate.toISOString().split('T')[0]}.zip`,
      });
    } catch (error) {
      return err(new DataExportError(`CSV export failed: ${error.message}`));
    }
  }

  private exportAsJSON(data: UserDataExport): Result<ExportBuffer, DataExportError> {
    try {
      const jsonString = JSON.stringify(data, null, 2);
      const buffer = Buffer.from(jsonString, 'utf-8');

      return ok({
        buffer,
        mimeType: 'application/json',
        filename: `exitbook_export_${data.userId}_${data.exportDate.toISOString().split('T')[0]}.json`,
      });
    } catch (error) {
      return err(new DataExportError(`JSON export failed: ${error.message}`));
    }
  }

  private arrayToCSV(array: any[][]): string {
    return array
      .map(row =>
        row
          .map(field => (typeof field === 'string' && field.includes(',') ? `"${field.replace(/"/g, '""')}"` : field))
          .join(',')
      )
      .join('\n');
  }

  private createZipFromFiles(files: { [key: string]: string }): Buffer {
    // This would use a ZIP library like JSZip
    // Placeholder implementation
    return Buffer.from('ZIP file content');
  }

  private calculateDataIntegrityHash(accounts: any[], transactions: any[], taxLots: any[]): string {
    const crypto = require('crypto');
    const dataString = JSON.stringify({ accounts, transactions, taxLots });
    return crypto.createHash('sha256').update(dataString).digest('hex');
  }
}

// Supporting types
export interface DataExportOptions {
  dateRange?: DateRange;
  includePeriod?: number; // months
  includeReconciliations?: boolean;
  includeAuditLogs?: boolean;
}

export interface DateRange {
  startDate: Date;
  endDate: Date;
}

export type ExportFormat = 'JSON' | 'CSV' | 'EXCEL';

export interface ExportBuffer {
  buffer: Buffer;
  mimeType: string;
  filename: string;
}

export interface UserDataExport {
  exportId: string;
  userId: string;
  exportDate: Date;
  exportVersion: string;
  statistics: ExportStatistics;
  accounts: AccountExport[];
  transactions: TransactionExport[];
  taxLots: TaxLotExport[];
  reconciliations: ReconciliationExport[];
  metadata: {
    exportDurationMs: number;
    exportOptions?: DataExportOptions;
    dataIntegrityHash: string;
  };
}

export interface ExportStatistics {
  totalAccounts: number;
  totalTransactions: number;
  totalTaxLots: number;
  totalReconciliations: number;
  dateRange: {
    earliestTransaction: Date;
    latestTransaction: Date;
  };
}
```

#### 5.4 Audit Trail System (Week 3-4)

**Comprehensive Audit Logging**:

```typescript
// libs/core/src/services/audit-logger.service.ts
@Injectable()
export class AuditLoggerService implements IAuditLogger {
  constructor(
    private readonly auditRepository: IAuditRepository,
    private readonly logger: LoggerService
  ) {}

  async logManualTransaction(event: ManualTransactionAuditEvent): Promise<void> {
    const auditEntry = this.createAuditEntry(
      event.userId,
      'MANUAL_TRANSACTION',
      'CREATE',
      {
        transactionId: event.transactionId,
        description: event.description,
        entriesCount: event.entries.length,
        totalAmount: this.calculateTotalAmount(event.entries),
      },
      event.timestamp
    );

    await this.saveAuditEntry(auditEntry);
  }

  async logTransactionReversal(event: TransactionReversalAuditEvent): Promise<void> {
    const auditEntry = this.createAuditEntry(
      event.userId,
      'TRANSACTION',
      'REVERSE',
      {
        originalTransactionId: event.originalTransactionId,
        reversalTransactionId: event.reversalTransactionId,
        reason: event.reason,
      },
      event.timestamp
    );

    await this.saveAuditEntry(auditEntry);
  }

  async logDataExport(event: DataExportAuditEvent): Promise<void> {
    const auditEntry = this.createAuditEntry(
      event.userId,
      'DATA',
      'EXPORT',
      {
        exportId: event.exportId,
        format: event.format,
        recordsExported: event.recordsExported,
        exportSizeBytes: event.exportSizeBytes,
      },
      event.timestamp
    );

    await this.saveAuditEntry(auditEntry);
  }

  async logReconciliation(event: ReconciliationAuditEvent): Promise<void> {
    const auditEntry = this.createAuditEntry(
      event.userId,
      'RECONCILIATION',
      'PERFORM',
      {
        reconciliationId: event.reconciliationId,
        sourcesReconciled: event.sourcesReconciled,
        discrepanciesFound: event.discrepanciesFound,
        criticalIssues: event.criticalIssues,
      },
      event.timestamp
    );

    await this.saveAuditEntry(auditEntry);
  }

  async logTaxCalculation(event: TaxCalculationAuditEvent): Promise<void> {
    const auditEntry = this.createAuditEntry(
      event.userId,
      'TAX_CALCULATION',
      'CALCULATE',
      {
        disposalTransactionId: event.disposalTransactionId,
        assetSymbol: event.assetSymbol,
        quantityDisposed: event.quantityDisposed,
        accountingMethod: event.accountingMethod,
        realizedGain: event.realizedGain,
        taxLotsConsumed: event.taxLotsConsumed,
      },
      event.timestamp
    );

    await this.saveAuditEntry(auditEntry);
  }

  async queryAuditLog(userId: string, filters: AuditLogFilters): Promise<Result<AuditLogEntry[], AuditLogError>> {
    try {
      const entries = await this.auditRepository.findByUserAndFilters(userId, filters);
      return ok(entries);
    } catch (error) {
      return err(new AuditLogError(`Failed to query audit log: ${error.message}`));
    }
  }

  private createAuditEntry(
    userId: string,
    entityType: string,
    action: string,
    details: Record<string, any>,
    timestamp: Date
  ): AuditLogEntry {
    return {
      id: crypto.randomUUID(),
      userId,
      entityType,
      action,
      details,
      timestamp,
      ipAddress: this.getCurrentIPAddress(), // Would be injected from request context
      userAgent: this.getCurrentUserAgent(), // Would be injected from request context
    };
  }

  private async saveAuditEntry(entry: AuditLogEntry): Promise<void> {
    try {
      await this.auditRepository.save(entry);
    } catch (error) {
      // Audit logging failures should not break the main flow
      this.logger.error(`Failed to save audit entry: ${error.message}`, error);
    }
  }

  private calculateTotalAmount(entries: CreateManualEntryData[]): string {
    // Calculate total absolute amount across all entries
    const total = entries.reduce((sum, entry) => sum + Math.abs(entry.amount.toDecimal()), 0);
    return total.toString();
  }

  private getCurrentIPAddress(): string {
    // Would be injected from request context
    return '127.0.0.1';
  }

  private getCurrentUserAgent(): string {
    // Would be injected from request context
    return 'ExitBook-API/1.0';
  }
}

// Audit event interfaces
export interface ManualTransactionAuditEvent {
  userId: string;
  transactionId: number;
  description: string;
  entries: CreateManualEntryData[];
  timestamp: Date;
}

export interface TransactionReversalAuditEvent {
  userId: string;
  originalTransactionId: number;
  reversalTransactionId: number;
  reason: string;
  timestamp: Date;
}

export interface DataExportAuditEvent {
  userId: string;
  exportId: string;
  format: ExportFormat;
  recordsExported: number;
  exportSizeBytes: number;
  timestamp: Date;
}

export interface ReconciliationAuditEvent {
  userId: string;
  reconciliationId: string;
  sourcesReconciled: number;
  discrepanciesFound: number;
  criticalIssues: number;
  timestamp: Date;
}

export interface TaxCalculationAuditEvent {
  userId: string;
  disposalTransactionId: number;
  assetSymbol: string;
  quantityDisposed: string;
  accountingMethod: string;
  realizedGain: string;
  taxLotsConsumed: number;
  timestamp: Date;
}

export interface AuditLogFilters {
  entityType?: string;
  action?: string;
  dateRange?: DateRange;
  limit?: number;
  offset?: number;
}

export interface AuditLogEntry {
  id: string;
  userId: string;
  entityType: string;
  action: string;
  details: Record<string, any>;
  timestamp: Date;
  ipAddress?: string;
  userAgent?: string;
}
```

### Success Criteria Phase 5

- [ ] Reconciliation service accurately identifying balance discrepancies (>95% accuracy)
- [ ] Manual transaction system working with proper validation and audit trail
- [ ] Transaction reversal system maintaining ledger integrity
- [ ] Data export supporting multiple formats (JSON, CSV, Excel)
- [ ] Comprehensive audit trail for all user actions and system changes
- [ ] Performance benchmarks for reconciliation (complete in <30s for typical user)

### Dependencies & Blockers

- **Exchange API Access**: Rate limits and API key management for balance fetching
- **External Services**: Reliable blockchain node access for wallet balance verification
- **Data Privacy**: GDPR/CCPA compliance for data export and deletion
- **Security**: Encryption for stored API keys and audit log integrity

### Risk Mitigation

- **API Reliability**: Circuit breakers and fallback strategies for external services
- **Data Integrity**: Hash verification and transaction validation for all modifications
- **User Safety**: Confirmation workflows for destructive operations (reversals)
- **Audit Compliance**: Immutable audit logs with cryptographic integrity

---

_Phase 5 complete. This establishes user trust through data transparency, correction capabilities, and comprehensive audit trails while maintaining the integrity of the financial system._
