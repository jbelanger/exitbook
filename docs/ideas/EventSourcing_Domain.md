## Complete Core Entities and Aggregates for Event-Sourced Architecture

Here's the comprehensive domain model with all core aggregates, entities, value
objects, and their relationships:

## 1. **Trading Context - Core Aggregates**

```typescript
// ============ TRANSACTION AGGREGATE ============
// The root aggregate for all financial movements

export class Transaction extends EventSourcedAggregate {
  private transactionId: TransactionId;
  private userId: UserId;
  private externalId: ExternalId;
  private classification: TransactionClassification;
  private entries: LedgerEntry[];
  private status: TransactionStatus;
  private metadata: TransactionMetadata;

  // Private constructor - use factory methods
  private constructor() {
    super();
  }

  // ======== Factory Methods ========

  // In the aggregate - pure domain logic only
  static import(
    command: ImportTransactionCommand,
  ): Result<Transaction, TransactionError> {
    const transaction = new Transaction();
    const events: DomainEvent[] = [
      new TransactionImported({
        version: 1,
        transactionId: TransactionId.generate(),
        userId: command.userId,
        externalId: command.externalId,
        source: command.source,
        rawData: command.rawData,
        idempotencyKey: `${command.source}:${command.externalId}`,
        importedAt: Clock.now(),
      }),
    ];
    transaction.applyEvents(events);
    return ok(transaction);
  }

  static createManual(
    command: CreateManualTransactionCommand,
  ): Result<Transaction, TransactionError> {
    const transaction = new Transaction();

    // Validate entries balance
    const validation = LedgerRules.validateBalance(command.entries);
    if (validation.isErr()) {
      return err(validation.error);
    }

    const events: DomainEvent[] = [
      new ManualTransactionCreated({
        transactionId: TransactionId.generate(),
        userId: command.userId,
        description: command.description,
        entries: command.entries,
        createdBy: command.createdBy,
        createdAt: Clock.now(),
      }),
    ];

    transaction.applyEvents(events);
    return ok(transaction);
  }

  // ======== Commands ========

  classify(
    classifier: TransactionClassifier,
  ): Result<DomainEvent[], TransactionError> {
    if (this.status !== TransactionStatus.IMPORTED) {
      return err(new InvalidStateError('Transaction already classified'));
    }

    const classification = classifier.classify(this.metadata.rawData);

    return ok([
      new TransactionClassified({
        transactionId: this.transactionId,
        classification: classification.type,
        confidence: classification.confidence,
        protocol: classification.protocol,
        classifiedAt: Clock.now(),
      }),
    ]);
  }

  recordLedgerEntries(
    entries: LedgerEntry[],
  ): Result<DomainEvent[], TransactionError> {
    // Validation happens HERE in the aggregate
    const validation = LedgerRules.validateBalance(entries);
    if (validation.isErr()) {
      return err(new UnbalancedEntriesError(validation.error));
    }

    if (!this.classification) {
      return err(
        new InvalidStateError(
          'Transaction must be classified before recording entries',
        ),
      );
    }

    return ok([
      new LedgerEntriesRecorded({
        transactionId: this.transactionId,
        entries: entries.map((e) => e.toDTO()),
        recordedAt: Clock.now(),
      }),
    ]);
  }

  reverse(
    reason: string,
    reversedBy: UserId,
  ): Result<DomainEvent[], TransactionError> {
    if (this.status === TransactionStatus.REVERSED) {
      return err(new AlreadyReversedError(this.transactionId));
    }

    const reversalEntries = this.entries.map((entry) => entry.reverse());

    return ok([
      new TransactionReversed({
        transactionId: this.transactionId,
        reversalReason: reason,
        reversalEntries: reversalEntries.map((e) => e.toDTO()),
        reversedBy,
        reversedAt: Clock.now(),
      }),
    ]);
  }

  // ======== Event Handlers ========

  protected applyTransactionImported(event: TransactionImported): void {
    this.transactionId = event.data.transactionId;
    this.userId = event.data.userId;
    this.externalId = event.data.externalId;
    this.status = TransactionStatus.IMPORTED;
    this.metadata = TransactionMetadata.fromRawData(event.data.rawData);
  }

  protected applyTransactionClassified(event: TransactionClassified): void {
    this.classification = new TransactionClassification(
      event.data.classification,
      event.data.confidence,
      event.data.protocol,
    );
    this.status = TransactionStatus.CLASSIFIED;
  }

  protected applyLedgerEntriesRecorded(event: LedgerEntriesRecorded): void {
    this.entries = event.data.entries.map((e) => LedgerEntry.fromDTO(e));
    this.status = TransactionStatus.RECORDED;
  }

  protected applyTransactionReversed(event: TransactionReversed): void {
    this.status = TransactionStatus.REVERSED;
  }
}

// ============ LEDGER ENTRY ENTITY ============
// Child entity of Transaction

export class LedgerEntry extends Entity {
  private entryId: EntryId;
  private accountId: AccountId;
  private amount: Money;
  private direction: EntryDirection;
  private entryType: EntryType;
  private metadata: EntryMetadata;

  constructor(data: CreateEntryData) {
    super();

    this.entryId = EntryId.generate();
    this.accountId = data.accountId;
    this.amount = data.amount;
    this.direction = data.direction;
    this.entryType = data.entryType;
    this.metadata = data.metadata || EntryMetadata.empty();
  }

  reverse(): LedgerEntry {
    return new LedgerEntry({
      accountId: this.accountId,
      amount: this.amount,
      direction: this.direction.opposite(),
      entryType: EntryType.REVERSAL,
      metadata: this.metadata.withReversal(),
    });
  }

  isDebit(): boolean {
    return this.direction === EntryDirection.DEBIT;
  }

  isCredit(): boolean {
    return this.direction === EntryDirection.CREDIT;
  }

  getSignedAmount(): Money {
    return this.isDebit() ? this.amount.negate() : this.amount;
  }
}

// ============ ACCOUNT AGGREGATE ============
// Represents a specific account (wallet, exchange account, etc)

export class Account extends EventSourcedAggregate {
  private accountId: AccountId;
  private userId: UserId;
  private accountType: AccountType;
  private asset: AssetId;
  private metadata: AccountMetadata;
  private status: AccountStatus;

  static create(command: CreateAccountCommand): Result<Account, AccountError> {
    const account = new Account();

    // Validate account type for asset class
    const validation = AccountRules.validateAccountType(
      command.accountType,
      command.asset,
    );
    if (validation.isErr()) {
      return err(validation.error);
    }

    const events: DomainEvent[] = [
      new AccountCreated({
        accountId: AccountId.generate(),
        userId: command.userId,
        accountType: command.accountType,
        asset: command.asset,
        name: command.name,
        source: command.source,
        metadata: command.metadata,
        createdAt: Clock.now(),
      }),
    ];

    account.applyEvents(events);
    return ok(account);
  }

  freeze(reason: string): Result<DomainEvent[], AccountError> {
    if (this.status === AccountStatus.FROZEN) {
      return err(new AccountAlreadyFrozenError(this.accountId));
    }

    return ok([
      new AccountFrozen({
        accountId: this.accountId,
        reason,
        frozenAt: Clock.now(),
      }),
    ]);
  }

  updateMetadata(
    metadata: Partial<AccountMetadata>,
  ): Result<DomainEvent[], AccountError> {
    return ok([
      new AccountMetadataUpdated({
        accountId: this.accountId,
        previousMetadata: this.metadata,
        newMetadata: { ...this.metadata, ...metadata },
        updatedAt: Clock.now(),
      }),
    ]);
  }
}
```

## 2. **Portfolio Context - Core Aggregates**

```typescript
// ============ POSITION AGGREGATE ============
// Tracks a user's position in a specific asset

export class Position extends EventSourcedAggregate {
  private positionId: PositionId;
  private userId: UserId;
  private asset: AssetId;
  private quantity: Quantity;
  private acquisitions: Acquisition[] = [];
  private totalCostBasis: Money;
  private status: PositionStatus;

  static open(command: OpenPositionCommand): Result<Position, PositionError> {
    const position = new Position();

    const events: DomainEvent[] = [
      new PositionOpened({
        positionId: PositionId.generate(),
        userId: command.userId,
        asset: command.asset,
        initialQuantity: command.quantity,
        acquisitionPrice: command.price,
        acquisitionMethod: command.method,
        openedAt: Clock.now(),
      }),
    ];

    position.applyEvents(events);
    return ok(position);
  }

  increase(
    amount: Quantity,
    price: Money,
    source: AcquisitionSource,
  ): Result<DomainEvent[], PositionError> {
    if (this.status === PositionStatus.CLOSED) {
      return err(new PositionClosedError(this.positionId));
    }

    const newQuantity = this.quantity.add(amount);

    return ok([
      new PositionIncreased({
        positionId: this.positionId,
        previousQuantity: this.quantity,
        addedQuantity: amount,
        newQuantity,
        acquisitionPrice: price,
        source,
        increasedAt: Clock.now(),
      }),
    ]);
  }

  decrease(amount: Quantity): Result<DomainEvent[], PositionError> {
    if (this.quantity.isLessThan(amount)) {
      return err(new InsufficientQuantityError(this.quantity, amount));
    }

    const newQuantity = this.quantity.subtract(amount);
    const events: DomainEvent[] = [];

    events.push(
      new PositionDecreased({
        positionId: this.positionId,
        previousQuantity: this.quantity,
        removedQuantity: amount,
        newQuantity,
        decreasedAt: Clock.now(),
      }),
    );

    if (newQuantity.isZero()) {
      events.push(
        new PositionClosed({
          positionId: this.positionId,
          closedAt: Clock.now(),
        }),
      );
    }

    return ok(events);
  }

  getWeightedAverageCost(): Money {
    if (this.acquisitions.length === 0 || this.quantity.isZero()) {
      return Money.zero(this.totalCostBasis.currency);
    }

    return this.totalCostBasis.divide(this.quantity.toNumber()).unwrap();
  }

  getTotalCostBasis(): Money {
    return this.totalCostBasis;
  }

  getUnrealizedGain(currentPrice: Money): Result<Money, PositionError> {
    const currentValue = currentPrice
      .multiply(this.quantity.toNumber())
      .unwrap();
    return currentValue.subtract(this.totalCostBasis);
  }

  // Event handlers to maintain cost basis
  protected applyPositionOpened(event: PositionOpened): void {
    this.positionId = event.data.positionId;
    this.userId = event.data.userId;
    this.asset = event.data.asset;
    this.quantity = event.data.initialQuantity;
    this.totalCostBasis = event.data.acquisitionPrice
      .multiply(event.data.initialQuantity.toNumber())
      .unwrap();
    this.acquisitions.push({
      quantity: event.data.initialQuantity,
      price: event.data.acquisitionPrice,
      date: event.data.openedAt,
      transactionId: event.data.transactionId,
    });
    this.status = PositionStatus.OPEN;
  }

  protected applyPositionIncreased(event: PositionIncreased): void {
    this.quantity = event.data.newQuantity;
    const additionalCostBasis = event.data.acquisitionPrice
      .multiply(event.data.addedQuantity.toNumber())
      .unwrap();
    this.totalCostBasis = this.totalCostBasis.add(additionalCostBasis).unwrap();
    this.acquisitions.push({
      quantity: event.data.addedQuantity,
      price: event.data.acquisitionPrice,
      date: event.data.increasedAt,
      transactionId: event.data.transactionId,
    });
  }

  protected applyPositionDecreased(event: PositionDecreased): void {
    this.quantity = event.data.newQuantity;
    // For cost basis reduction, use weighted average cost
    const reductionRatio =
      event.data.removedQuantity.toNumber() /
      event.data.previousQuantity.toNumber();
    const costBasisReduction = this.totalCostBasis
      .multiply(reductionRatio)
      .unwrap();
    this.totalCostBasis = this.totalCostBasis
      .subtract(costBasisReduction)
      .unwrap();
  }

  protected applyPositionClosed(event: PositionClosed): void {
    this.status = PositionStatus.CLOSED;
    this.totalCostBasis = Money.zero(this.totalCostBasis.currency);
  }
}

// ============ ACQUISITION INTERFACE ============
interface Acquisition {
  quantity: Quantity;
  price: Money;
  date: Date;
  transactionId: TransactionId;
}

// ============ PORTFOLIO AGGREGATE ============
// Root aggregate for portfolio management

export class Portfolio extends EventSourcedAggregate {
  private portfolioId: PortfolioId;
  private userId: UserId;
  private positions: Map<AssetId, PositionSummary>;
  private lastValuation: PortfolioValuation;

  static initialize(userId: UserId): Result<Portfolio, PortfolioError> {
    const portfolio = new Portfolio();

    const events: DomainEvent[] = [
      new PortfolioInitialized({
        portfolioId: PortfolioId.generate(),
        userId,
        initializedAt: Clock.now(),
      }),
    ];

    portfolio.applyEvents(events);
    return ok(portfolio);
  }

  calculateValuation(
    prices: PriceMap,
    baseCurrency: Currency,
  ): Result<DomainEvent[], PortfolioError> {
    const holdings: Holding[] = [];
    let totalValue = Money.zero(baseCurrency);

    for (const [assetId, position] of this.positions) {
      const price = prices.get(assetId);
      if (!price) continue;

      const value = position.quantity.multiply(price);
      totalValue = totalValue.add(value);

      holdings.push(new Holding(assetId, position.quantity, price, value));
    }

    const valuation = new PortfolioValuation(
      totalValue,
      holdings,
      baseCurrency,
      Clock.now(),
    );

    return ok([
      new PortfolioValuated({
        portfolioId: this.portfolioId,
        valuation: valuation.toDTO(),
        valuatedAt: Clock.now(),
      }),
    ]);
  }

  rebalance(
    targetAllocations: AllocationMap,
  ): Result<RebalanceOrder[], PortfolioError> {
    // Complex rebalancing logic
    const currentAllocations = this.calculateCurrentAllocations();
    const orders = RebalanceCalculator.calculate(
      currentAllocations,
      targetAllocations,
    );

    return ok(orders);
  }
}
```

## 3. **Taxation Context - Core Aggregates**

```typescript
// ============ TAX LOT AGGREGATE ============
// Tracks cost basis for tax calculations

export class TaxLot extends EventSourcedAggregate {
  private lotId: TaxLotId;
  private userId: UserId;
  private asset: AssetId;
  private quantity: TaxLotQuantity;
  private costBasis: CostBasis;
  private acquisitionDate: Date;
  private status: TaxLotStatus;

  static create(command: CreateTaxLotCommand): Result<TaxLot, TaxLotError> {
    const lot = new TaxLot();

    // Validate cost basis
    if (command.costBasis.isNegative()) {
      return err(new InvalidCostBasisError(command.costBasis));
    }

    const events: DomainEvent[] = [
      new TaxLotCreated({
        lotId: TaxLotId.generate(),
        userId: command.userId,
        asset: command.asset,
        quantity: command.quantity,
        costBasis: command.costBasis,
        acquisitionDate: command.acquisitionDate,
        acquisitionMethod: command.method,
        createdAt: Clock.now(),
      }),
    ];

    lot.applyEvents(events);
    return ok(lot);
  }

  consume(disposal: DisposalCommand): Result<DomainEvent[], TaxLotError> {
    if (this.status !== TaxLotStatus.OPEN) {
      return err(new TaxLotNotAvailableError(this.lotId));
    }

    if (disposal.quantity.isGreaterThan(this.quantity.remaining)) {
      return err(
        new InsufficientLotQuantityError(
          this.lotId,
          this.quantity.remaining,
          disposal.quantity,
        ),
      );
    }

    // Calculate consumption
    const consumedQuantity = disposal.quantity;
    const consumptionRatio = consumedQuantity.divide(this.quantity.original);
    const consumedCostBasis = this.costBasis.multiply(consumptionRatio);
    const proceeds = disposal.quantity.multiply(disposal.price);
    const realizedGain = proceeds.subtract(consumedCostBasis);
    const holdingPeriod = HoldingPeriod.between(
      this.acquisitionDate,
      disposal.date,
    );
    const newRemaining = this.quantity.remaining.subtract(consumedQuantity);

    const events: DomainEvent[] = [];

    if (newRemaining.unwrap().isZero()) {
      events.push(
        new TaxLotFullyConsumed({
          lotId: this.lotId,
          consumedQuantity,
          consumedCostBasis,
          proceeds,
          realizedGain,
          holdingPeriod: holdingPeriod.getDays(),
          isLongTerm: holdingPeriod.isLongTerm(),
          consumedAt: Clock.now(),
        }),
      );
    } else {
      events.push(
        new TaxLotPartiallyConsumed({
          lotId: this.lotId,
          consumed: consumedQuantity,
          remaining: newRemaining.unwrap(),
          consumedCostBasis,
          proceeds,
          realizedGain,
          holdingPeriod: holdingPeriod.getDays(),
          isLongTerm: holdingPeriod.isLongTerm(),
          consumedAt: Clock.now(),
        }),
      );
    }

    return ok(events);
  }
}

// ============ TAX REPORT AGGREGATE ============
// Manages tax reporting

export class TaxReport extends EventSourcedAggregate {
  private reportId: TaxReportId;
  private userId: UserId;
  private taxYear: TaxYear;
  private transactions: TaxableTransaction[];
  private summary: TaxSummary;
  private status: ReportStatus;

  static generate(
    command: GenerateTaxReportCommand,
  ): Result<TaxReport, TaxReportError> {
    const report = new TaxReport();

    // Validate tax year
    if (!command.taxYear.isValid()) {
      return err(new InvalidTaxYearError(command.taxYear));
    }

    const events: DomainEvent[] = [
      new TaxReportGenerated({
        reportId: TaxReportId.generate(),
        userId: command.userId,
        taxYear: command.taxYear,
        accountingMethod: command.method,
        generatedAt: Clock.now(),
      }),
    ];

    report.applyEvents(events);
    return ok(report);
  }

  addTransaction(
    transaction: TaxableTransaction,
  ): Result<DomainEvent[], TaxReportError> {
    if (this.status === ReportStatus.FINALIZED) {
      return err(new ReportFinalizedError(this.reportId));
    }

    return ok([
      new TaxableTransactionAdded({
        reportId: this.reportId,
        transaction: transaction.toDTO(),
        addedAt: Clock.now(),
      }),
    ]);
  }

  finalize(): Result<DomainEvent[], TaxReportError> {
    if (this.status === ReportStatus.FINALIZED) {
      return err(new AlreadyFinalizedError(this.reportId));
    }

    const summary = TaxCalculator.calculateSummary(this.transactions);

    return ok([
      new TaxReportFinalized({
        reportId: this.reportId,
        summary: summary.toDTO(),
        finalizedAt: Clock.now(),
      }),
    ]);
  }
}
```

## 4. **Reconciliation Context - Core Aggregates**

```typescript
// ============ RECONCILIATION AGGREGATE ============
// Manages balance reconciliation sessions

export class Reconciliation extends EventSourcedAggregate {
  private reconciliationId: ReconciliationId;
  private userId: UserId;
  private source: DataSource;
  private discrepancies: Discrepancy[];
  private status: ReconciliationStatus;

  static initiate(
    command: InitiateReconciliationCommand,
  ): Result<Reconciliation, ReconciliationError> {
    const reconciliation = new Reconciliation();

    const events: DomainEvent[] = [
      new ReconciliationInitiated({
        reconciliationId: ReconciliationId.generate(),
        userId: command.userId,
        source: command.source,
        initiatedAt: Clock.now(),
      }),
    ];

    reconciliation.applyEvents(events);
    return ok(reconciliation);
  }

  recordDiscrepancy(
    discrepancy: Discrepancy,
  ): Result<DomainEvent[], ReconciliationError> {
    if (this.status !== ReconciliationStatus.IN_PROGRESS) {
      return err(new ReconciliationNotInProgressError(this.reconciliationId));
    }

    const severity = DiscrepancyRules.calculateSeverity(discrepancy);

    return ok([
      new DiscrepancyDetected({
        reconciliationId: this.reconciliationId,
        asset: discrepancy.asset,
        internalBalance: discrepancy.internal,
        externalBalance: discrepancy.external,
        difference: discrepancy.difference,
        severity,
        detectedAt: Clock.now(),
      }),
    ]);
  }

  resolve(
    resolution: ResolutionCommand,
  ): Result<DomainEvent[], ReconciliationError> {
    const discrepancy = this.discrepancies.find(
      (d) => d.asset === resolution.asset,
    );
    if (!discrepancy) {
      return err(new DiscrepancyNotFoundError(resolution.asset));
    }

    return ok([
      new DiscrepancyResolved({
        reconciliationId: this.reconciliationId,
        asset: resolution.asset,
        resolutionType: resolution.type,
        adjustment: resolution.adjustment,
        resolvedBy: resolution.resolvedBy,
        resolvedAt: Clock.now(),
      }),
    ]);
  }

  complete(): Result<DomainEvent[], ReconciliationError> {
    const unresolvedCount = this.discrepancies.filter(
      (d) => !d.isResolved,
    ).length;

    if (unresolvedCount > 0) {
      return err(new UnresolvedDiscrepanciesError(unresolvedCount));
    }

    return ok([
      new ReconciliationCompleted({
        reconciliationId: this.reconciliationId,
        totalDiscrepancies: this.discrepancies.length,
        completedAt: Clock.now(),
      }),
    ]);
  }
}

// ============ CORRECTION AGGREGATE ============
// Manages manual corrections and adjustments

export class Correction extends EventSourcedAggregate {
  private correctionId: CorrectionId;
  private userId: UserId;
  private correctionType: CorrectionType;
  private adjustments: Adjustment[];
  private status: CorrectionStatus;

  static propose(
    command: ProposeCorrectionCommand,
  ): Result<Correction, CorrectionError> {
    const correction = new Correction();

    // Validate adjustments balance (if applicable)
    if (command.type === CorrectionType.BALANCE_ADJUSTMENT) {
      const validation = CorrectionRules.validateBalanceAdjustment(
        command.adjustments,
      );
      if (validation.isErr()) {
        return err(validation.error);
      }
    }

    const events: DomainEvent[] = [
      new CorrectionProposed({
        correctionId: CorrectionId.generate(),
        userId: command.userId,
        correctionType: command.type,
        adjustments: command.adjustments,
        reason: command.reason,
        proposedBy: command.proposedBy,
        proposedAt: Clock.now(),
      }),
    ];

    correction.applyEvents(events);
    return ok(correction);
  }

  approve(approver: UserId): Result<DomainEvent[], CorrectionError> {
    if (this.status !== CorrectionStatus.PROPOSED) {
      return err(new InvalidCorrectionStatusError(this.status));
    }

    return ok([
      new CorrectionApproved({
        correctionId: this.correctionId,
        approvedBy: approver,
        approvedAt: Clock.now(),
      }),
    ]);
  }

  apply(): Result<DomainEvent[], CorrectionError> {
    if (this.status !== CorrectionStatus.APPROVED) {
      return err(new CorrectionNotApprovedError(this.correctionId));
    }

    return ok([
      new CorrectionApplied({
        correctionId: this.correctionId,
        adjustments: this.adjustments.map((a) => a.toDTO()),
        appliedAt: Clock.now(),
      }),
    ]);
  }
}
```

## 5. **Core Value Objects**

```typescript
// ============ MONEY VALUE OBJECT ============
export class Money {
  private constructor(
    private readonly amount: BigNumber,
    private readonly currency: Currency,
    private readonly scale: number,
  ) {}

  static of(
    amount: string | number,
    currency: Currency,
  ): Result<Money, MoneyError> {
    try {
      const bigAmount = new BigNumber(amount);
      if (!bigAmount.isFinite()) {
        return err(new InvalidMoneyAmountError(amount));
      }
      return ok(new Money(bigAmount, currency, currency.decimals));
    } catch (error) {
      return err(new MoneyParseError(amount, error));
    }
  }

  static zero(currency: Currency): Money {
    return new Money(new BigNumber(0), currency, currency.decimals);
  }

  add(other: Money, converter?: MoneyConverter): Result<Money, MoneyError> {
    if (!this.isSameCurrency(other)) {
      if (!converter) {
        return err(new CurrencyMismatchError(this.currency, other.currency));
      }
      // Convert other to this currency
      const convertedResult = converter.convert(
        other,
        this.currency,
        Clock.now(),
      );
      if (convertedResult.isErr()) {
        return err(convertedResult.error);
      }
      const converted = convertedResult.value;
      return ok(
        new Money(
          this.amount.plus(converted.amount),
          this.currency,
          this.scale,
        ),
      );
    }
    return ok(
      new Money(this.amount.plus(other.amount), this.currency, this.scale),
    );
  }

  subtract(
    other: Money,
    converter?: MoneyConverter,
  ): Result<Money, MoneyError> {
    if (!this.isSameCurrency(other)) {
      if (!converter) {
        return err(new CurrencyMismatchError(this.currency, other.currency));
      }
      // Convert other to this currency
      const convertedResult = converter.convert(
        other,
        this.currency,
        Clock.now(),
      );
      if (convertedResult.isErr()) {
        return err(convertedResult.error);
      }
      const converted = convertedResult.value;
      return ok(
        new Money(
          this.amount.minus(converted.amount),
          this.currency,
          this.scale,
        ),
      );
    }
    return ok(
      new Money(this.amount.minus(other.amount), this.currency, this.scale),
    );
  }

  multiply(factor: string | number): Result<Money, MoneyError> {
    const bigFactor = new BigNumber(factor);
    return ok(
      new Money(this.amount.multipliedBy(bigFactor), this.currency, this.scale),
    );
  }

  divide(divisor: string | number): Result<Money, MoneyError> {
    const bigDivisor = new BigNumber(divisor);
    if (bigDivisor.isZero()) {
      return err(new DivisionByZeroError());
    }
    return ok(
      new Money(this.amount.dividedBy(bigDivisor), this.currency, this.scale),
    );
  }

  isNegative(): boolean {
    return this.amount.isNegative();
  }

  isZero(): boolean {
    return this.amount.isZero();
  }

  isPositive(): boolean {
    return this.amount.isPositive();
  }

  negate(): Money {
    return new Money(this.amount.negated(), this.currency, this.scale);
  }

  abs(): Money {
    return new Money(this.amount.abs(), this.currency, this.scale);
  }

  private isSameCurrency(other: Money): boolean {
    return this.currency.equals(other.currency);
  }

  toString(): string {
    return `${this.amount.toFixed(this.scale)} ${this.currency.symbol}`;
  }

  toNumber(): number {
    return this.amount.toNumber();
  }

  compare(other: Money): number {
    if (!this.isSameCurrency(other)) {
      throw new Error('Cannot compare different currencies');
    }
    return this.amount.comparedTo(other.amount);
  }

  isGreaterThan(other: Money): boolean {
    return this.compare(other) > 0;
  }

  isLessThan(other: Money): boolean {
    return this.compare(other) < 0;
  }

  equals(other: Money): boolean {
    return this.isSameCurrency(other) && this.amount.isEqualTo(other.amount);
  }

  // For database storage
  toBigInt(): bigint {
    const multiplier = new BigNumber(10).pow(this.scale);
    const scaled = this.amount.multipliedBy(multiplier);
    return BigInt(scaled.toFixed(0));
  }

  static fromBigInt(value: bigint, currency: Currency): Money {
    const divisor = new BigNumber(10).pow(currency.decimals);
    const amount = new BigNumber(value.toString()).dividedBy(divisor);
    return new Money(amount, currency, currency.decimals);
  }

  toDTO(): MoneyDTO {
    return {
      amount: this.amount.toString(),
      currency: this.currency.symbol,
      scale: this.scale,
    };
  }
}

// ============ MONEY CONVERTER SERVICE ============
export class MoneyConverter {
  constructor(private rates: ExchangeRateProvider) {}

  convert(
    money: Money,
    toCurrency: Currency,
    timestamp: Date,
  ): Result<Money, ConversionError> {
    if (money.currency.equals(toCurrency)) {
      return ok(money); // No conversion needed
    }

    const rateResult = this.rates.getRate(
      money.currency,
      toCurrency,
      timestamp,
    );
    if (rateResult.isErr()) {
      return err(
        new ExchangeRateNotFoundError(money.currency, toCurrency, timestamp),
      );
    }

    const rate = rateResult.value;
    const convertedAmount = money.amount.multipliedBy(rate.value);

    return ok(new Money(convertedAmount, toCurrency, toCurrency.decimals));
  }

  // Batch conversion for efficiency
  convertMultiple(
    amounts: Money[],
    toCurrency: Currency,
    timestamp: Date,
  ): Result<Money[], ConversionError> {
    const results: Money[] = [];

    for (const amount of amounts) {
      const converted = this.convert(amount, toCurrency, timestamp);
      if (converted.isErr()) {
        return err(converted.error);
      }
      results.push(converted.value);
    }

    return ok(results);
  }
}

// ============ QUANTITY VALUE OBJECT ============
export class Quantity {
  private constructor(
    private readonly value: BigNumber,
    private readonly precision: number,
  ) {}

  static of(
    value: string | number,
    precision: number = 18,
  ): Result<Quantity, QuantityError> {
    const bigValue = new BigNumber(value);
    if (!bigValue.isFinite() || bigValue.isNegative()) {
      return err(new InvalidQuantityError(value));
    }
    return ok(new Quantity(bigValue, precision));
  }

  add(other: Quantity): Quantity {
    return new Quantity(this.value.plus(other.value), this.precision);
  }

  subtract(other: Quantity): Result<Quantity, QuantityError> {
    const result = this.value.minus(other.value);
    if (result.isNegative()) {
      return err(new NegativeQuantityError());
    }
    return ok(new Quantity(result, this.precision));
  }

  multiply(factor: string | number): Quantity {
    return new Quantity(this.value.multipliedBy(factor), this.precision);
  }

  divide(divisor: string | number): Result<Quantity, QuantityError> {
    const bigDivisor = new BigNumber(divisor);
    if (bigDivisor.isZero()) {
      return err(new DivisionByZeroError());
    }
    return ok(new Quantity(this.value.dividedBy(bigDivisor), this.precision));
  }

  isZero(): boolean {
    return this.value.isZero();
  }

  isGreaterThan(other: Quantity): boolean {
    return this.value.isGreaterThan(other.value);
  }

  isLessThan(other: Quantity): boolean {
    return this.value.isLessThan(other.value);
  }

  toNumber(): number {
    return this.value.toNumber();
  }

  isGreaterThanOrEqual(other: Quantity): boolean {
    return this.value.isGreaterThanOrEqualTo(other.value);
  }

  static zero(): Quantity {
    return new Quantity(new BigNumber(0), 18);
  }

  static min(a: Quantity, b: Quantity): Quantity {
    return a.isLessThan(b) ? a : b;
  }
}

// ============ HOLDING PERIOD VALUE OBJECT ============
export class HoldingPeriod {
  private constructor(private readonly days: number) {}

  static between(start: Date, end: Date): HoldingPeriod {
    // Use date-fns for reliable date math to avoid integer overflow
    // For now, using safe calculation with proper bounds checking
    const startTime = start.getTime();
    const endTime = end.getTime();

    if (endTime < startTime) {
      throw new Error('End date must be after start date');
    }

    const diffMs = endTime - startTime;
    const msPerDay = 1000 * 60 * 60 * 24;

    // Check for potential overflow before division
    if (diffMs > Number.MAX_SAFE_INTEGER - msPerDay) {
      throw new Error('Date range too large for safe calculation');
    }

    const days = Math.floor(diffMs / msPerDay);
    return new HoldingPeriod(Math.max(0, days));
  }

  isLongTerm(): boolean {
    return this.days >= 365; // US tax law: 1 year for long-term
  }

  isShortTerm(): boolean {
    return !this.isLongTerm();
  }

  getDays(): number {
    return this.days;
  }

  getYears(): number {
    return this.days / 365;
  }
}

// ============ ASSET ID VALUE OBJECT ============
export class AssetId {
  private constructor(
    private readonly symbol: string,
    private readonly type: AssetType,
    private readonly blockchain?: string,
    private readonly contractAddress?: string,
  ) {}

  static crypto(
    symbol: string,
    blockchain: string,
    contractAddress?: string,
  ): AssetId {
    return new AssetId(
      symbol.toUpperCase(),
      AssetType.CRYPTO,
      blockchain,
      contractAddress,
    );
  }

  static fiat(symbol: string): AssetId {
    return new AssetId(symbol.toUpperCase(), AssetType.FIAT);
  }

  static nft(collection: string, tokenId: string, blockchain: string): AssetId {
    const symbol = `${collection}#${tokenId}`;
    return new AssetId(symbol, AssetType.NFT, blockchain);
  }

  static lpToken(protocol: string, pair: string, blockchain: string): AssetId {
    const symbol = `${protocol}-${pair}-LP`;
    return new AssetId(symbol, AssetType.LP_TOKEN, blockchain);
  }

  equals(other: AssetId): boolean {
    return (
      this.symbol === other.symbol &&
      this.type === other.type &&
      this.blockchain === other.blockchain
    );
  }

  toString(): string {
    return this.blockchain ? `${this.symbol}@${this.blockchain}` : this.symbol;
  }
}

// ============ DISCREPANCY VALUE OBJECT ============
export class Discrepancy {
  constructor(
    readonly asset: AssetId,
    readonly internal: Money,
    readonly external: Money,
    readonly difference: Money,
    readonly percentage: number,
    readonly isResolved: boolean = false,
  ) {}

  static calculate(
    asset: AssetId,
    internal: Money,
    external: Money,
  ): Discrepancy {
    const difference = internal.subtract(external).unwrap();
    const average = internal.add(external).unwrap().divide(2).unwrap();
    const percentage = average.isZero()
      ? 0
      : Math.abs(difference.toNumber() / average.toNumber()) * 100;

    return new Discrepancy(asset, internal, external, difference, percentage);
  }

  getSeverity(): DiscrepancySeverity {
    if (this.percentage > 10) return DiscrepancySeverity.CRITICAL;
    if (this.percentage > 1) return DiscrepancySeverity.WARNING;
    return DiscrepancySeverity.MINOR;
  }

  resolve(): Discrepancy {
    return new Discrepancy(
      this.asset,
      this.internal,
      this.external,
      this.difference,
      this.percentage,
      true,
    );
  }
}
```

## 6. **Domain Services and Policies**

```typescript
// ============ TRANSACTION CLASSIFIER SERVICE ============
export interface TransactionClassifier {
  classify(rawData: RawTransactionData): TransactionClassification;
}

// ============ TRANSACTION CLASSIFIER SERVICE (continued) ============
export class RuleBasedTransactionClassifier implements TransactionClassifier {
  constructor(private rules: ClassificationRule[]) {}

  classify(rawData: RawTransactionData): TransactionClassification {
    for (const rule of this.rules) {
      if (rule.matches(rawData)) {
        return rule.classify(rawData);
      }
    }

    return TransactionClassification.unknown();
  }
}

// ============ TAX CALCULATION SERVICE ============
export class TaxCalculationService {
  constructor(
    private readonly lotSelector: TaxLotSelector,
    private readonly gainCalculator: GainCalculator
  ) {}

  calculateRealizedGains(
    disposal: DisposalCommand,
    lots: TaxLot[],
    method: AccountingMethod
  ): Result<RealizedGains, TaxError> {
    // Select lots based on accounting method
    const selectedLots = this.lotSelector.selectLots(lots, disposal.quantity, method);

    if (selectedLots.isErr()) {
      return err(selectedLots.error);
    }

    // Calculate gains for each consumed lot
    const consumptions: LotConsumption[] = [];
    let remainingQuantity = disposal.quantity;

    for (const lot of selectedLots.value) {
      const consumeQuantity = Quantity.min(remainingQuantity, lot.remainingQuantity);
      const consumption = lot.consume({
        quantity: consumeQuantity,
        price: disposal.price,
        date: disposal.date,
      });

      if (consumption.isErr()) {
        return err(consumption.error);
      }

      consumptions.push(consumption.value);
      remainingQuantity = remainingQuantity.subtract(consumeQuantity).unwrap();

      if (remainingQuantity.isZero()) break;
    }

    return ok(this.gainCalculator.aggregate(consumptions));
  }
}

// ============ TAX LOT SELECTOR STRATEGY ============
export interface TaxLotSelector {
  selectLots(availableLots: TaxLot[], quantityNeeded: Quantity, method: AccountingMethod): Result<TaxLot[], TaxError>;
}

export class FIFOSelector implements TaxLotSelector {
  selectLots(availableLots: TaxLot[], quantityNeeded: Quantity, method: AccountingMethod): Result<TaxLot[], TaxError> {
    // Sort by acquisition date (oldest first)
    const sorted = [...availableLots].sort((a, b) => a.acquisitionDate.getTime() - b.acquisitionDate.getTime());

    return this.selectUntilQuantityMet(sorted, quantityNeeded);
  }

  private selectUntilQuantityMet(lots: TaxLot[], needed: Quantity): Result<TaxLot[], TaxError> {
    const selected: TaxLot[] = [];
    let accumulated = Quantity.zero();

    for (const lot of lots) {
      if (accumulated.isGreaterThanOrEqual(needed)) break;
      selected.push(lot);
      accumulated = accumulated.add(lot.remainingQuantity);
    }

    if (accumulated.isLessThan(needed)) {
      return err(new InsufficientLotsError(needed, accumulated));
    }

    return ok(selected);
  }
}

export class LIFOSelector implements TaxLotSelector {
  selectLots(availableLots: TaxLot[], quantityNeeded: Quantity, method: AccountingMethod): Result<TaxLot[], TaxError> {
    // Sort by acquisition date (newest first)
    const sorted = [...availableLots].sort((a, b) => b.acquisitionDate.getTime() - a.acquisitionDate.getTime());

    return new FIFOSelector().selectUntilQuantityMet(sorted, quantityNeeded);
  }
}

export class HIFOSelector implements TaxLotSelector {
  selectLots(availableLots: TaxLot[], quantityNeeded: Quantity, method: AccountingMethod): Result<TaxLot[], TaxError> {
    // Sort by cost basis per unit (highest first)
    const sorted = [...availableLots].sort((a, b) => {
      const aPerUnit = a.costBasis.divide(a.quantity.toNumber()).unwrap();
      const bPerUnit = b.costBasis.divide(b.quantity.toNumber()).unwrap();
      return bPerUnit.toNumber() - aPerUnit.toNumber(); // Highest first for HIFO
    });

    return this.selectUntilQuantityMet(sorted, quantityNeeded);
  }

  private selectUntilQuantityMet(lots: TaxLot[], needed: Quantity): Result<TaxLot[], TaxError> {
    const selected: TaxLot[] = [];
    let accumulated = Quantity.zero();

    for (const lot of lots) {
      if (accumulated.isGreaterThanOrEqual(needed)) break;
      selected.push(lot);
      accumulated = accumulated.add(lot.remainingQuantity);
    }

    if (accumulated.isLessThan(needed)) {
      return err(new InsufficientLotsError(needed, accumulated));
    }

    return ok(selected);
  }
}

// ============ PORTFOLIO VALUATION SERVICE ============
export class PortfolioValuationService {
  constructor(
    private readonly priceProvider: PriceProvider,
    private readonly calculator: ValuationCalculator
  ) {}

  async calculateValuation(
    positions: Position[],
    baseCurrency: Currency,
    timestamp: Date = new Date()
  ): Promise<Result<PortfolioValuation, ValuationError>> {
    // Fetch all required prices
    const assets = positions.map(p => p.asset);
    const pricesResult = await this.priceProvider.getPrices(assets, baseCurrency, timestamp);

    if (pricesResult.isErr()) {
      return err(new PriceFetchError(pricesResult.error));
    }

    const prices = pricesResult.value;

    // Calculate valuation
    return this.calculator.calculate(positions, prices, baseCurrency);
  }
}

// ============ RECONCILIATION SERVICE ============
export class ReconciliationService {
  constructor(
    private readonly balanceFetcher: ExternalBalanceFetcher,
    private readonly discrepancyAnalyzer: DiscrepancyAnalyzer,
    private readonly resolutionEngine: ResolutionEngine
  ) {}

  async reconcile(
    userId: UserId,
    source: DataSource,
    internalBalances: Map<AssetId, Money>
  ): Promise<Result<ReconciliationResult, ReconciliationError>> {
    // Fetch external balances
    const externalResult = await this.balanceFetcher.fetchBalances(userId, source);

    if (externalResult.isErr()) {
      return err(new ExternalFetchError(source, externalResult.error));
    }

    const externalBalances = externalResult.value;

    // Analyze discrepancies
    const discrepancies = this.discrepancyAnalyzer.analyze(internalBalances, externalBalances);

    // Propose auto-resolution for minor discrepancies (requires approval)
    const resolutionProposals = await this.resolutionEngine.proposeAutoResolution(
      discrepancies.filter(d => d.getSeverity() === DiscrepancySeverity.MINOR)
    );

    return ok(new ReconciliationResult(discrepancies, resolutionProposals, source, new Date()));
  }
}

// ============ RESOLUTION ENGINE ============
export class ResolutionEngine {
  proposeAutoResolution(discrepancies: Discrepancy[]): Promise<ResolutionProposal[]> {
    const proposals: ResolutionProposal[] = [];

    for (const discrepancy of discrepancies) {
      // Even "minor" discrepancies should require explicit approval
      proposals.push(new ResolutionProposal(
        discrepancy,
        ResolutionType.AUTO,
        requiresApproval: true,
        proposedBy: 'system',
        reason: 'Minor discrepancy detected - proposed for auto-resolution'
      ));
    }

    return Promise.resolve(proposals);
  }

  async approveResolution(proposalId: string, approvedBy: UserId): Promise<Result<Resolution, ResolutionError>> {
    // Only execute resolution after explicit approval
    const proposal = await this.findProposal(proposalId);
    if (!proposal) {
      return err(new ProposalNotFoundError(proposalId));
    }

    return ok(new Resolution(proposal.discrepancy, proposal.type, approvedBy, Clock.now()));
  }
}

// ============ IMPORT ORCHESTRATION SERVICE ============
export class ImportOrchestrationService {
  constructor(
    private readonly fetcher: DataFetcher,
    private readonly classifier: TransactionClassifier,
    private readonly transformer: TransactionTransformer,
    private readonly validator: TransactionValidator
  ) {}

  async importTransactions(
    source: DataSource,
    credentials: EncryptedCredentials,
    dateRange: DateRange
  ): Promise<Result<ImportResult, ImportError>> {
    // Fetch raw data
    const rawDataResult = await this.fetcher.fetch(source, credentials, dateRange);

    if (rawDataResult.isErr()) {
      return err(new FetchError(source, rawDataResult.error));
    }

    const rawTransactions = rawDataResult.value;
    const results: ProcessedTransaction[] = [];
    const failures: ImportFailure[] = [];

    // Process each transaction
    for (const raw of rawTransactions) {
      try {
        // Classify
        const classification = this.classifier.classify(raw);

        // Transform to domain model
        const transformed = this.transformer.transform(raw, classification);

        // Validate
        const validation = this.validator.validate(transformed);
        if (validation.isErr()) {
          failures.push(new ImportFailure(raw.id, validation.error));
          continue;
        }

        results.push(transformed);
      } catch (error) {
        failures.push(new ImportFailure(raw.id, error));
      }
    }

    return ok(new ImportResult(results, failures, source));
  }
}
```

## 7. **Domain Policies and Rules**

```typescript
// ============ LEDGER RULES ============
export class LedgerRules {
  static validateBalance(entries: LedgerEntry[]): Result<void, LedgerError> {
    // Group entries by currency
    const byCurrency = new Map<Currency, Money>();

    for (const entry of entries) {
      const currency = entry.amount.currency;
      const current = byCurrency.get(currency) || Money.zero(currency);
      const updated = entry.isDebit()
        ? current.subtract(entry.amount)
        : current.add(entry.amount);

      if (updated.isErr()) return err(updated.error);
      byCurrency.set(currency, updated.value);
    }

    // Check each currency balances to zero
    for (const [currency, balance] of byCurrency) {
      if (!balance.isZero()) {
        return err(new UnbalancedEntriesError(currency, balance));
      }
    }

    return ok(undefined);
  }

  static validateAccountTypes(
    entries: LedgerEntry[],
  ): Result<void, LedgerError> {
    for (const entry of entries) {
      const accountType = entry.account.type;
      const assetType = entry.amount.currency.type;

      if (!this.isValidCombination(accountType, assetType)) {
        return err(new InvalidAccountAssetCombination(accountType, assetType));
      }
    }

    return ok(undefined);
  }

  private static isValidCombination(
    accountType: AccountType,
    assetType: AssetType,
  ): boolean {
    // NFT accounts can only hold NFTs
    if (accountType === AccountType.NFT_WALLET) {
      return assetType === AssetType.NFT;
    }

    // LP accounts can only hold LP tokens
    if (accountType === AccountType.DEFI_LP) {
      return assetType === AssetType.LP_TOKEN;
    }

    // Regular accounts cannot hold NFTs or LP tokens
    if (
      accountType === AccountType.WALLET ||
      accountType === AccountType.EXCHANGE
    ) {
      return assetType === AssetType.CRYPTO || assetType === AssetType.FIAT;
    }

    return true;
  }
}

// ============ DISCREPANCY RULES ============
export class DiscrepancyRules {
  private static readonly CRITICAL_THRESHOLD = 0.1; // 10%
  private static readonly WARNING_THRESHOLD = 0.01; // 1%
  private static readonly MINOR_THRESHOLD = 0.001; // 0.1%

  static calculateSeverity(discrepancy: Discrepancy): DiscrepancySeverity {
    const percentage = Math.abs(discrepancy.percentage);

    if (percentage >= this.CRITICAL_THRESHOLD) {
      return DiscrepancySeverity.CRITICAL;
    }
    if (percentage >= this.WARNING_THRESHOLD) {
      return DiscrepancySeverity.WARNING;
    }
    if (percentage >= this.MINOR_THRESHOLD) {
      return DiscrepancySeverity.MINOR;
    }

    return DiscrepancySeverity.NEGLIGIBLE;
  }

  static canAutoResolve(discrepancy: Discrepancy): boolean {
    return (
      discrepancy.getSeverity() === DiscrepancySeverity.NEGLIGIBLE ||
      discrepancy.getSeverity() === DiscrepancySeverity.MINOR
    );
  }
}

// ============ TAX RULES ============
export class TaxRules {
  private static readonly LONG_TERM_DAYS = 365;
  private static readonly WASH_SALE_DAYS = 30;

  static isLongTermGain(holdingPeriod: HoldingPeriod): boolean {
    return holdingPeriod.getDays() >= this.LONG_TERM_DAYS;
  }

  static isWashSale(
    disposal: DisposalEvent,
    reacquisition: AcquisitionEvent,
  ): boolean {
    const daysBetween =
      Math.abs(disposal.date.getTime() - reacquisition.date.getTime()) /
      (1000 * 60 * 60 * 24);

    return (
      daysBetween <= this.WASH_SALE_DAYS &&
      disposal.asset.equals(reacquisition.asset) &&
      disposal.resulted.isLoss()
    );
  }

  static calculateTaxRate(gainType: GainType, taxBracket: TaxBracket): number {
    if (gainType === GainType.LONG_TERM) {
      return this.getLongTermRate(taxBracket);
    }
    return this.getShortTermRate(taxBracket);
  }

  private static getLongTermRate(bracket: TaxBracket): number {
    // US tax rates (simplified)
    switch (bracket) {
      case TaxBracket.LOW:
        return 0.0;
      case TaxBracket.MEDIUM:
        return 0.15;
      case TaxBracket.HIGH:
        return 0.2;
      default:
        return 0.15;
    }
  }

  private static getShortTermRate(bracket: TaxBracket): number {
    // Short-term gains taxed as ordinary income
    switch (bracket) {
      case TaxBracket.LOW:
        return 0.12;
      case TaxBracket.MEDIUM:
        return 0.24;
      case TaxBracket.HIGH:
        return 0.37;
      default:
        return 0.24;
    }
  }
}
```

## 8. **Workflow Sagas**

```typescript
// ============ IMPORT WORKFLOW SAGA ============
export class ImportWorkflowSaga extends Saga {
  private readonly steps: WorkflowStep[] = [
    new FetchRawDataStep(),
    new ValidateDataStep(),
    new ClassifyTransactionsStep(),
    new TransformToLedgerStep(),
    new CreateTaxLotsStep(),
    new UpdatePositionsStep(),
    new ReconcileBalancesStep(),
  ];

  async execute(
    context: ImportContext,
  ): Promise<Result<ImportResult, WorkflowError>> {
    const workflow = new WorkflowExecution(this.steps);

    try {
      const result = await workflow.execute(context);

      if (result.isOk()) {
        await this.publishSuccess(result.value);
      } else {
        await this.handleFailure(result.error, context);
      }

      return result;
    } catch (error) {
      return err(new WorkflowExecutionError(error));
    }
  }

  async compensate(
    failedStep: WorkflowStep,
    context: ImportContext,
  ): Promise<void> {
    // Reverse completed steps
    const completedSteps = this.steps.slice(0, this.steps.indexOf(failedStep));

    for (const step of completedSteps.reverse()) {
      await step.compensate(context);
    }
  }
}

// ============ TAX CALCULATION SAGA ============
export class TaxCalculationSaga extends Saga {
  async handle(
    command: CalculateTaxesCommand,
  ): Promise<Result<TaxReport, TaxError>> {
    const events: DomainEvent[] = [];

    try {
      // Step 1: Load tax lots
      const lots = await this.loadTaxLots(command.userId, command.asset);

      // Step 2: Load disposals for tax year
      const disposals = await this.loadDisposals(
        command.userId,
        command.taxYear,
      );

      // Step 3: Process each disposal
      for (const disposal of disposals) {
        const consumptionResult = await this.processDisposal(
          disposal,
          lots,
          command.method,
        );

        if (consumptionResult.isOk()) {
          events.push(...consumptionResult.value);
        }
      }

      // Step 4: Generate report
      const report = await this.generateReport(
        command.userId,
        command.taxYear,
        events,
      );

      // Step 5: Publish events
      await this.publishEvents(events);

      return ok(report);
    } catch (error) {
      await this.compensate(events);
      return err(new TaxCalculationError(error));
    }
  }

  private async processDisposal(
    disposal: DisposalEvent,
    availableLots: TaxLot[],
    method: AccountingMethod,
  ): Promise<Result<DomainEvent[], TaxError>> {
    const taxCalculator = new TaxCalculationService(
      this.getLotSelector(method),
      new GainCalculator(),
    );

    const gainsResult = await taxCalculator.calculateRealizedGains(
      disposal,
      availableLots,
      method,
    );

    if (gainsResult.isErr()) {
      return err(gainsResult.error);
    }

    const gains = gainsResult.value;
    const events: DomainEvent[] = [];

    // Create events for each lot consumption
    for (const consumption of gains.consumptions) {
      events.push(
        new TaxLotConsumed({
          lotId: consumption.lotId,
          consumedQuantity: consumption.quantity,
          consumedCostBasis: consumption.costBasis,
          proceeds: consumption.proceeds,
          realizedGain: consumption.realizedGain,
          holdingPeriod: consumption.holdingPeriod,
          consumedAt: Clock.now(),
        }),
      );
    }

    return ok(events);
  }

  private getLotSelector(method: AccountingMethod): TaxLotSelector {
    switch (method) {
      case AccountingMethod.FIFO:
        return new FIFOSelector();
      case AccountingMethod.LIFO:
        return new LIFOSelector();
      case AccountingMethod.HIFO:
        return new HIFOSelector();
      default:
        return new FIFOSelector();
    }
  }
}
```

## 9. **Event Handlers and Projections**

```typescript
// ============ PORTFOLIO PROJECTION HANDLER ============
export class PortfolioProjectionHandler {
  constructor(private readonly projectionDb: ProjectionDatabase) {}

  @EventHandler(PositionOpened)
  async handlePositionOpened(event: PositionOpened): Promise<void> {
    await this.projectionDb.holdings.upsert({
      userId: event.userId,
      assetId: event.asset.toString(),
      quantity: event.initialQuantity.toString(),
      costBasis: event.acquisitionPrice.toString(),
      firstAcquisitionDate: event.openedAt,
      lastTransactionDate: event.openedAt,
      totalTransactions: 1,
    });
  }

  @EventHandler(PositionIncreased)
  async handlePositionIncreased(event: PositionIncreased): Promise<void> {
    const holding = await this.projectionDb.holdings.findOne({
      userId: event.userId,
      assetId: event.asset.toString(),
    });

    if (!holding) return;

    const newQuantity = new BigNumber(holding.quantity).plus(
      event.addedQuantity.toString(),
    );

    const newCostBasis = new BigNumber(holding.costBasis).plus(
      event.acquisitionPrice.toString(),
    );

    await this.projectionDb.holdings.update(
      {
        userId: event.userId,
        assetId: event.asset.toString(),
      },
      {
        quantity: newQuantity.toString(),
        costBasis: newCostBasis.toString(),
        lastTransactionDate: event.increasedAt,
        totalTransactions: holding.totalTransactions + 1,
      },
    );
  }

  @EventHandler(PortfolioValuated)
  async handlePortfolioValuated(event: PortfolioValuated): Promise<void> {
    // Update all holdings with latest prices
    for (const holding of event.valuation.holdings) {
      await this.projectionDb.holdings.update(
        {
          userId: event.userId,
          assetId: holding.asset,
        },
        {
          lastPrice: holding.price,
          lastPriceUsd: holding.priceUsd,
          totalValueUsd: holding.valueUsd,
          unrealizedGainUsd: holding.unrealizedGain,
          roiPercentage: holding.roiPercentage,
          lastPriceTimestamp: event.valuatedAt,
        },
      );
    }
  }
}

// ============ TAX LOT PROJECTION HANDLER ============
export class TaxLotProjectionHandler {
  constructor(private readonly projectionDb: ProjectionDatabase) {}

  @EventHandler(TaxLotCreated)
  async handleTaxLotCreated(event: TaxLotCreated): Promise<void> {
    await this.projectionDb.taxLots.insert({
      lotId: event.lotId,
      userId: event.userId,
      assetId: event.asset,
      acquisitionDate: event.acquisitionDate,
      acquisitionTransactionId: event.transactionId,
      acquisitionMethod: event.acquisitionMethod,
      originalQuantity: event.quantity.toString(),
      remainingQuantity: event.quantity.toString(),
      totalCostBasis: event.costBasis.toString(),
      costBasisPerUnit: event.costBasis.divide(event.quantity).toString(),
      costBasisCurrency: event.costBasis.currency,
      status: 'open',
      createdAt: event.createdAt,
    });
  }

  @EventHandler(TaxLotConsumed)
  async handleTaxLotConsumed(event: TaxLotConsumed): Promise<void> {
    const lot = await this.projectionDb.taxLots.findOne({
      lotId: event.lotId,
    });

    if (!lot) return;

    const newRemaining = new BigNumber(lot.remainingQuantity).minus(
      event.consumedQuantity.toString(),
    );

    const status = newRemaining.isZero() ? 'closed' : 'partial';

    await this.projectionDb.taxLots.update(
      {
        lotId: event.lotId,
      },
      {
        remainingQuantity: newRemaining.toString(),
        consumedQuantity: new BigNumber(lot.consumedQuantity)
          .plus(event.consumedQuantity.toString())
          .toString(),
        status,
      },
    );

    // Record the realized gain
    await this.projectionDb.realizedGains.insert({
      userId: lot.userId,
      disposalDate: event.disposalDate,
      disposalTransactionId: event.disposalTransactionId,
      assetId: lot.assetId,
      quantityDisposed: event.consumedQuantity.toString(),
      proceeds: event.proceeds.toString(),
      costBasis: event.consumedCostBasis.toString(),
      realizedGain: event.realizedGain.toString(),
      holdingPeriodDays: event.holdingPeriod,
      taxTreatment: event.isLongTerm ? 'long_term' : 'short_term',
      consumedLots: [
        {
          lotId: event.lotId,
          quantity: event.consumedQuantity.toString(),
          costBasis: event.consumedCostBasis.toString(),
        },
      ],
      createdAt: event.consumedAt,
    });
  }
}
```

## Event Versioning Strategy

All domain events include a version field for schema evolution and backward
compatibility:

```typescript
// ============ BASE DOMAIN EVENT ============
export interface DomainEvent {
  readonly version: number;
  readonly eventId: EventId;
  readonly aggregateId: string;
  readonly timestamp: Date;
  readonly eventType: string;
  readonly data: any;
}

// ============ VERSIONED EVENT EXAMPLE ============
export class TransactionImported implements DomainEvent {
  readonly version = 1; // Current version
  readonly eventId: EventId;
  readonly aggregateId: string;
  readonly timestamp: Date;
  readonly eventType = 'TransactionImported';

  constructor(public readonly data: TransactionImportedData) {
    this.eventId = EventId.generate();
    this.aggregateId = data.transactionId.toString();
    this.timestamp = data.importedAt;
  }
}

// ============ EVENT MIGRATION HANDLER ============
export class EventMigrationService {
  private migrations = new Map<string, Map<number, EventMigration>>();

  registerMigration(
    eventType: string,
    fromVersion: number,
    migration: EventMigration,
  ): void {
    if (!this.migrations.has(eventType)) {
      this.migrations.set(eventType, new Map());
    }
    this.migrations.get(eventType)!.set(fromVersion, migration);
  }

  migrate(event: DomainEvent): DomainEvent {
    const eventMigrations = this.migrations.get(event.eventType);
    if (!eventMigrations) return event;

    let currentEvent = event;
    const currentVersion = event.version;
    const targetVersion = this.getLatestVersion(event.eventType);

    for (let version = currentVersion; version < targetVersion; version++) {
      const migration = eventMigrations.get(version);
      if (migration) {
        currentEvent = migration.migrate(currentEvent);
      }
    }

    return currentEvent;
  }

  private getLatestVersion(eventType: string): number {
    // Return latest version for event type
    const versions = Array.from(this.migrations.get(eventType)?.keys() || []);
    return Math.max(...versions, 1);
  }
}

// ============ EXAMPLE MIGRATION ============
export class TransactionImportedV1ToV2Migration implements EventMigration {
  migrate(event: DomainEvent): DomainEvent {
    // Example: Add new field 'sourceVersion' in v2
    return {
      ...event,
      version: 2,
      data: {
        ...event.data,
        sourceVersion: '1.0.0', // Default value for old events
      },
    };
  }
}
```

## Key Design Principles

1. **Event Sourcing at Core**: All state changes are events, providing natural
   audit trail
2. **Rich Domain Model**: Business logic lives in aggregates, not services
3. **Value Objects for Type Safety**: Money, Quantity, AssetId prevent primitive
   obsession
4. **Explicit Workflows**: Sagas orchestrate complex multi-step processes
5. **Separated Read/Write**: Projections optimize for queries without affecting
   command model
6. **Policy Objects**: Business rules are explicit and testable
7. **Result Types**: All operations that can fail return Result<T, E>
8. **No Shared State**: Aggregates communicate only through events

## 10. **Command Handler Implementation**

```typescript
// ============ IMPORT TRANSACTION COMMAND HANDLER ============
// In the command handler - handles infrastructure concerns
export class ImportTransactionCommandHandler {
  constructor(
    private repository: TransactionRepository,
    private eventStore: EventStore,
    private eventBus: EventBus,
  ) {}

  async handle(
    command: ImportTransactionCommand,
  ): Promise<Result<void, Error>> {
    const idempotencyKey = `${command.source}:${command.externalId}`;

    // Check idempotency at infrastructure level
    const existing = await this.eventStore.findByIdempotencyKey(idempotencyKey);
    if (existing) {
      return ok(undefined); // Already imported
    }

    // Create new transaction
    const result = Transaction.import(command);
    if (result.isErr()) return err(result.error);

    // Save events
    await this.eventStore.append(
      result.value.id,
      result.value.getUncommittedEvents(),
    );

    // Publish for projections
    await this.eventBus.publishAll(result.value.getUncommittedEvents());

    return ok(undefined);
  }
}

// ============ RECORD ENTRIES COMMAND HANDLER ============
export class RecordEntriesCommandHandler {
  constructor(
    private repository: TransactionRepository,
    private eventBus: EventBus,
  ) {}

  async handle(command: RecordEntriesCommand): Promise<Result<void, Error>> {
    // Load aggregate
    const transaction = await this.repository.load(command.transactionId);

    // Execute domain logic
    const result = transaction.recordLedgerEntries(command.entries);
    if (result.isErr()) {
      return err(result.error);
    }

    // Save events
    await this.repository.save(transaction);

    // Publish for projections
    await this.eventBus.publishAll(result.value);

    return ok(undefined);
  }
}
```

## 11. **Event Store Implementation**

```typescript
// ============ POSTGRES EVENT STORE ============
export class PostgresEventStore implements EventStore {
  constructor(private db: Database) {}

  async append(
    streamId: string,
    events: DomainEvent[],
    expectedVersion: number,
  ): Promise<void> {
    await this.db.transaction(async (tx) => {
      // Optimistic concurrency check
      const currentVersion = await tx
        .select('version')
        .from('event_streams')
        .where('stream_id', streamId)
        .forUpdate();

      if (currentVersion !== expectedVersion) {
        throw new ConcurrencyError(streamId, expectedVersion, currentVersion);
      }

      // Append events
      for (const event of events) {
        await tx.insert('events').values({
          stream_id: streamId,
          event_id: event.eventId,
          event_type: event.eventType,
          event_data: JSON.stringify(event.data),
          event_version: event.version,
          created_at: event.timestamp,
          sequence_number: ++currentVersion,
        });
      }

      // Update stream version
      await tx
        .update('event_streams')
        .set({ version: currentVersion })
        .where('stream_id', streamId);
    });
  }

  async readStream(
    streamId: string,
    fromVersion: number = 0,
  ): Promise<EventStream> {
    const events = await this.db
      .select('*')
      .from('events')
      .where('stream_id', streamId)
      .where('sequence_number', '>', fromVersion)
      .orderBy('sequence_number');

    return new EventStream(
      streamId,
      events.map((e) => this.deserializeEvent(e)),
    );
  }

  async findByIdempotencyKey(
    idempotencyKey: string,
  ): Promise<DomainEvent | null> {
    const event = await this.db
      .select('*')
      .from('events')
      .where('event_data->idempotencyKey', idempotencyKey)
      .limit(1);

    return event.length > 0 ? this.deserializeEvent(event[0]) : null;
  }

  private deserializeEvent(eventData: any): DomainEvent {
    // Event deserialization logic with version handling
    const data = JSON.parse(eventData.event_data);
    const EventClass = this.getEventClass(eventData.event_type);
    return new EventClass(data);
  }

  private getEventClass(eventType: string): any {
    // Map event type strings to classes
    const eventClassMap = {
      TransactionImported: TransactionImported,
      LedgerEntriesRecorded: LedgerEntriesRecorded,
      // ... other event types
    };
    return eventClassMap[eventType];
  }
}
```

## 12. **Snapshot Store Implementation**

```typescript
// ============ SNAPSHOT STORE ============
export class SnapshotStore {
  constructor(private db: Database) {}

  async save(aggregateId: string, snapshot: AggregateSnapshot): Promise<void> {
    await this.db.insert('snapshots').values({
      aggregate_id: aggregateId,
      aggregate_type: snapshot.aggregateType,
      version: snapshot.version,
      state: JSON.stringify(snapshot.state),
      created_at: new Date(),
    });
  }

  async load(aggregateId: string): Promise<AggregateSnapshot | null> {
    const result = await this.db
      .select('*')
      .from('snapshots')
      .where('aggregate_id', aggregateId)
      .orderBy('version', 'desc')
      .limit(1);

    if (!result.length) return null;

    return {
      aggregateType: result[0].aggregate_type,
      version: result[0].version,
      state: JSON.parse(result[0].state),
    };
  }
}

// ============ AGGREGATE REPOSITORY WITH SNAPSHOTS ============
export class AggregateRepository<T extends EventSourcedAggregate> {
  constructor(
    private eventStore: EventStore,
    private snapshotStore: SnapshotStore,
    private factory: AggregateFactory<T>,
  ) {}

  async load(id: string): Promise<T> {
    // Try to load from snapshot
    const snapshot = await this.snapshotStore.load(id);

    let aggregate: T;
    let fromVersion = 0;

    if (snapshot) {
      aggregate = this.factory.fromSnapshot(snapshot);
      fromVersion = snapshot.version;
    } else {
      aggregate = this.factory.create();
    }

    // Apply events since snapshot
    const stream = await this.eventStore.readStream(id, fromVersion);
    aggregate.loadFromHistory(stream.events);

    // Take new snapshot if needed
    if (stream.events.length > 100) {
      await this.snapshotStore.save(id, aggregate.toSnapshot());
    }

    return aggregate;
  }

  async save(aggregate: T): Promise<void> {
    const uncommittedEvents = aggregate.getUncommittedEvents();
    if (uncommittedEvents.length === 0) return;

    await this.eventStore.append(
      aggregate.id,
      uncommittedEvents,
      aggregate.version,
    );

    aggregate.markEventsAsCommitted();
  }
}
```

## 13. **Projection Rebuilder**

```typescript
// ============ PROJECTION REBUILDER ============
export class ProjectionRebuilder {
  constructor(
    private eventStore: EventStore,
    private projectionHandlers: Map<string, ProjectionHandler>,
    private checkpointStore: CheckpointStore,
  ) {}

  async rebuild(projectionName: string, fromEvent: number = 0): Promise<void> {
    const handler = this.projectionHandlers.get(projectionName);
    if (!handler) {
      throw new Error(`Unknown projection: ${projectionName}`);
    }

    // Get all events from the beginning or checkpoint
    const checkpoint = await this.checkpointStore.get(projectionName);
    const startFrom = fromEvent || checkpoint?.position || 0;

    const batchSize = 1000;
    let position = startFrom;
    let hasMore = true;

    while (hasMore) {
      const events = await this.eventStore.readAll(position, batchSize);

      for (const event of events) {
        // Apply migration if needed
        const migratedEvent = this.migrationService.migrate(event);

        // Handle event
        await handler.handle(migratedEvent);
        position = event.globalPosition;
      }

      // Update checkpoint
      await this.checkpointStore.save(projectionName, position);

      hasMore = events.length === batchSize;
    }
  }

  async rebuildAll(): Promise<void> {
    // Rebuild all projections in parallel
    const promises = Array.from(this.projectionHandlers.keys()).map((name) =>
      this.rebuild(name),
    );

    await Promise.all(promises);
  }
}
```

## 14. **Enhanced Saga Compensation**

```typescript
// ============ ENHANCED SAGA BASE CLASS ============
export abstract class Saga {
  private completedSteps: SagaStep[] = [];
  private compensations: CompensationAction[] = [];

  protected async executeStep<T>(
    step: SagaStep<T>,
    compensation?: CompensationAction,
  ): Promise<Result<T, Error>> {
    try {
      const result = await step.execute();

      if (result.isOk()) {
        this.completedSteps.push(step);
        if (compensation) {
          this.compensations.push(compensation);
        }
      }

      return result;
    } catch (error) {
      // Trigger compensation
      await this.compensate();
      return err(new SagaExecutionError(step.name, error));
    }
  }

  private async compensate(): Promise<void> {
    // Execute compensations in reverse order
    for (const compensation of this.compensations.reverse()) {
      try {
        await compensation.execute();
      } catch (error) {
        // Log but continue - compensation must not fail
        console.error('Compensation failed:', error);
      }
    }
  }

  protected abstract getSteps(): SagaStep[];
  protected abstract buildCompensationPlan(
    step: SagaStep,
  ): CompensationAction | undefined;
}
```

## 15. **Event Sourced Aggregate Base Class**

```typescript
// ============ EVENT SOURCED AGGREGATE BASE CLASS ============
export abstract class EventSourcedAggregate {
  protected id: string;
  protected version: number = 0;
  private uncommittedEvents: DomainEvent[] = [];

  protected applyEvents(events: DomainEvent[]): void {
    for (const event of events) {
      this.apply(event);
      this.uncommittedEvents.push(event);
    }
  }

  loadFromHistory(events: DomainEvent[]): void {
    for (const event of events) {
      this.apply(event);
      this.version++;
    }
  }

  private apply(event: DomainEvent): void {
    const handler = `apply${event.eventType}`;
    if (typeof this[handler] === 'function') {
      this[handler](event);
    }
  }

  getUncommittedEvents(): DomainEvent[] {
    return this.uncommittedEvents;
  }

  markEventsAsCommitted(): void {
    this.uncommittedEvents = [];
  }

  toSnapshot(): AggregateSnapshot {
    return {
      aggregateType: this.constructor.name,
      version: this.version,
      state: this.getState(),
    };
  }

  protected abstract getState(): any;
}

// ============ AGGREGATE FACTORY INTERFACE ============
export interface AggregateFactory<T extends EventSourcedAggregate> {
  create(): T;
  fromSnapshot(snapshot: AggregateSnapshot): T;
}

// ============ AGGREGATE SNAPSHOT INTERFACE ============
export interface AggregateSnapshot {
  aggregateType: string;
  version: number;
  state: any;
}
```

## 16. **Transaction Repository Implementation**

```typescript
// ============ TRANSACTION REPOSITORY ============
export class TransactionRepository extends AggregateRepository<Transaction> {
  constructor(eventStore: EventStore, snapshotStore: SnapshotStore) {
    super(eventStore, snapshotStore, new TransactionFactory());
  }
}

// ============ TRANSACTION FACTORY ============
class TransactionFactory implements AggregateFactory<Transaction> {
  create(): Transaction {
    return new Transaction();
  }

  fromSnapshot(snapshot: AggregateSnapshot): Transaction {
    const transaction = new Transaction();
    transaction.restoreFromState(snapshot.state);
    return transaction;
  }
}
```

## 17. **Clock Service Implementation**

```typescript
// ============ CLOCK SERVICE ============
export class Clock {
  private static testTime?: Date;

  static now(): Date {
    return this.testTime || new Date();
  }

  static setTestTime(date: Date): void {
    this.testTime = date;
  }

  static clearTestTime(): void {
    this.testTime = undefined;
  }

  // Utility methods for time-based operations
  static addDays(date: Date, days: number): Date {
    const result = new Date(date);
    result.setDate(result.getDate() + days);
    return result;
  }

  static addMonths(date: Date, months: number): Date {
    const result = new Date(date);
    result.setMonth(result.getMonth() + months);
    return result;
  }

  static startOfDay(date: Date): Date {
    const result = new Date(date);
    result.setHours(0, 0, 0, 0);
    return result;
  }

  static endOfDay(date: Date): Date {
    const result = new Date(date);
    result.setHours(23, 59, 59, 999);
    return result;
  }
}
```

## 18. **CheckpointStore Implementation**

```typescript
// ============ CHECKPOINT STORE ============
export interface CheckpointStore {
  get(projectionName: string): Promise<Checkpoint | null>;
  save(projectionName: string, position: number): Promise<void>;
}

export interface Checkpoint {
  projectionName: string;
  position: number;
  updatedAt: Date;
}

export class PostgresCheckpointStore implements CheckpointStore {
  constructor(private db: Database) {}

  async get(projectionName: string): Promise<Checkpoint | null> {
    const result = await this.db
      .select('*')
      .from('projection_checkpoints')
      .where('projection_name', projectionName)
      .limit(1);

    if (!result.length) return null;

    return {
      projectionName: result[0].projection_name,
      position: result[0].position,
      updatedAt: result[0].updated_at,
    };
  }

  async save(projectionName: string, position: number): Promise<void> {
    await this.db
      .insert('projection_checkpoints')
      .values({
        projection_name: projectionName,
        position,
        updated_at: new Date(),
      })
      .onConflict('projection_name')
      .merge(['position', 'updated_at']);
  }
}
```

## 19. **Performance Optimizations**

```typescript
// ============ EVENT STREAM PAGINATION ============
export class OptimizedEventStore extends PostgresEventStore {
  async *readStream(
    streamId: string,
    fromVersion: number = 0,
    pageSize: number = 100,
  ): AsyncIterable<DomainEvent> {
    let currentVersion = fromVersion;

    while (true) {
      const events = await this.db
        .select('*')
        .from('events')
        .where('stream_id', streamId)
        .where('sequence_number', '>', currentVersion)
        .limit(pageSize)
        .orderBy('sequence_number');

      if (events.length === 0) break;

      for (const event of events) {
        yield this.deserializeEvent(event);
        currentVersion = event.sequence_number;
      }

      if (events.length < pageSize) break;
    }
  }
}

// ============ BATCH EVENT PROCESSOR ============
export class BatchEventProcessor {
  constructor(private db: Database) {}

  async processBatch(events: DomainEvent[]): Promise<void> {
    // Group events by handler
    const grouped = this.groupByHandler(events);

    // Process each group in parallel
    await Promise.all(
      Array.from(grouped.entries()).map(([handler, events]) =>
        this.processHandlerBatch(handler, events),
      ),
    );
  }

  private async processHandlerBatch(
    handler: EventHandler,
    events: DomainEvent[],
  ): Promise<void> {
    // Use database transactions for batch updates
    await this.db.transaction(async (tx) => {
      for (const event of events) {
        await handler.handle(event, tx);
      }
    });
  }

  private groupByHandler(
    events: DomainEvent[],
  ): Map<EventHandler, DomainEvent[]> {
    const grouped = new Map<EventHandler, DomainEvent[]>();

    for (const event of events) {
      const handlers = this.getHandlersForEvent(event.eventType);

      for (const handler of handlers) {
        if (!grouped.has(handler)) {
          grouped.set(handler, []);
        }
        grouped.get(handler)!.push(event);
      }
    }

    return grouped;
  }

  private getHandlersForEvent(eventType: string): EventHandler[] {
    // Registry lookup for handlers by event type
    return this.handlerRegistry.getHandlers(eventType);
  }
}
```

This architecture provides:

- Complete audit trail by design
- Time-travel debugging capability
- Natural support for corrections/reversals
- Horizontal scalability
- Clear bounded contexts
- Testable business logic
- Type-safe financial calculations
- Proper separation of domain logic and infrastructure concerns
- Command/Event separation with aggregates returning events
- Event store implementation with optimistic concurrency
- Snapshot support for performance
- Projection rebuilding capability
- Enhanced saga compensation patterns
- Batch processing optimizations

## Production Considerations

### 1. **Event Store Partitioning**

For large datasets, consider partitioning events by time or stream ID:

```sql
-- Partition events table by month
CREATE TABLE events_2024_01 PARTITION OF events
FOR VALUES FROM ('2024-01-01') TO ('2024-02-01');

-- Or partition by stream ID hash
CREATE TABLE events_partition_0 PARTITION OF events
FOR VALUES WITH (MODULUS 4, REMAINDER 0);
```

### 2. **Projection Lag Monitoring**

Add metrics to monitor projection processing delays:

```typescript
export class ProjectionMonitor {
  constructor(private metrics: MetricsClient) {}

  async measureProjectionLag(projectionName: string): Promise<number> {
    const lastProcessedEvent = await this.getLastProcessedEvent(projectionName);
    const latestEvent = await this.eventStore.getLatestEvent();

    const lag = latestEvent.globalPosition - lastProcessedEvent.globalPosition;
    this.metrics.gauge('projection.lag', lag, { projection: projectionName });

    return lag;
  }
}
```

### 3. **Dead Letter Queue**

Handle failed event processing gracefully:

```typescript
export class DeadLetterHandler {
  constructor(
    private deadLetterStore: DeadLetterStore,
    private logger: Logger,
  ) {}

  async handleFailedEvent(
    event: DomainEvent,
    handler: string,
    error: Error,
    retryCount: number,
  ): Promise<void> {
    if (retryCount >= 3) {
      await this.deadLetterStore.store({
        eventId: event.eventId,
        eventData: event,
        failedHandler: handler,
        error: error.message,
        retryCount,
        failedAt: new Date(),
      });

      this.logger.error('Event moved to dead letter queue', {
        eventId: event.eventId,
        handler,
        error: error.message,
      });
    }
  }
}
```

### 4. **Event Archival Strategy**

Archive old events to reduce storage costs:

```typescript
export class EventArchiver {
  constructor(
    private eventStore: EventStore,
    private archiveStorage: ArchiveStorage,
  ) {}

  async archiveOldEvents(olderThanDays: number): Promise<void> {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - olderThanDays);

    const oldEvents = await this.eventStore.getEventsOlderThan(cutoffDate);

    // Move to archive storage
    await this.archiveStorage.store(oldEvents);

    // Remove from hot storage
    await this.eventStore.deleteEvents(oldEvents.map((e) => e.eventId));
  }
}
```

### 5. **Distributed Tracing**

Correlate events across service boundaries:

```typescript
export class TracingEventBus implements EventBus {
  constructor(
    private tracer: Tracer,
    private eventBus: EventBus,
  ) {}

  async publishAll(events: DomainEvent[]): Promise<void> {
    const span = this.tracer.startSpan('event_bus.publish_batch');

    try {
      // Add trace context to events
      const tracedEvents = events.map((event) => ({
        ...event,
        metadata: {
          ...event.metadata,
          traceId: span.context().traceId,
          spanId: span.context().spanId,
        },
      }));

      await this.eventBus.publishAll(tracedEvents);

      span.setTag('events.count', events.length);
      span.setTag('success', true);
    } catch (error) {
      span.setTag('error', true);
      span.log({ error: error.message });
      throw error;
    } finally {
      span.finish();
    }
  }
}
```
