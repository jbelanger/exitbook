# Transaction Linking

Transaction linking connects related transactions across different sources (e.g., exchange withdrawals → blockchain deposits) to propagate cost basis information for accurate capital gains calculations.

## Problem Statement

When crypto assets move from exchanges to personal wallets, the cost basis chain is broken:

**Exchange (Kraken):**

- Buy 1 BTC @ $50,000 → Cost basis = $50,000/BTC ✓
- Withdraw 1 BTC to wallet → Has cost basis from trade ✓

**Blockchain (Bitcoin):**

- Received 1 BTC at bc1q... → No cost basis ❌
- Send 0.5 BTC to merchant → Cannot calculate gain/loss ❌

Transaction linking solves this by automatically detecting and connecting related transactions based on asset, amount, timing, and addresses.

## Architecture

### Components

1. **Types & Schemas** (`types.ts`, `schemas.ts`)
   - `TransactionLink` - Link between source and target transactions
   - `TransactionCandidate` - Simplified transaction for matching
   - `PotentialMatch` - Match candidate with confidence score
   - `MatchingConfig` - Algorithm configuration

2. **Matching Algorithm** (`matching-utils.ts`)
   - `calculateAmountSimilarity()` - Compare amounts accounting for fees
   - `isTimingValid()` - Check if timing is within acceptable window
   - `checkAddressMatch()` - Verify blockchain addresses match
   - `calculateConfidenceScore()` - Overall match confidence (0-1)
   - `findPotentialMatches()` - Find and rank matches

3. **Service** (`transaction-linking-service.ts`)
   - `TransactionLinkingService` - Main linking orchestrator
   - Converts transactions to candidates
   - Finds matches using algorithm
   - Deduplicates and auto-confirms high-confidence matches

4. **Repository** (`@exitbook/platform-data`)
   - `TransactionLinkRepository` - CRUD operations for links
   - Storage in `transaction_links` table

## Usage

### Basic Usage

```typescript
import { TransactionLinkingService, DEFAULT_MATCHING_CONFIG } from '@exitbook/accounting';
import { TransactionRepository, TransactionLinkRepository } from '@exitbook/platform-data';
import { getLogger } from '@exitbook/shared-logger';

// Initialize services
const logger = getLogger('transaction-linking');
const linkingService = new TransactionLinkingService(logger, DEFAULT_MATCHING_CONFIG);
const transactionRepo = new TransactionRepository(db);
const linkRepo = new TransactionLinkRepository(db);

// Fetch all transactions
const txResult = await transactionRepo.getTransactions();
if (txResult.isErr()) {
  throw txResult.error;
}

// Find links
const linkingResult = await linkingService.linkTransactions(txResult.value);
if (linkingResult.isErr()) {
  throw linkingResult.error;
}

// Save confirmed links to database
const { confirmedLinks, suggestedLinks } = linkingResult.value;

for (const link of confirmedLinks) {
  await linkRepo.create({
    id: link.id,
    sourceTransactionId: link.sourceTransactionId,
    targetTransactionId: link.targetTransactionId,
    linkType: link.linkType,
    confidenceScore: link.confidenceScore,
    matchCriteria: link.matchCriteria,
    status: link.status,
    reviewedBy: link.reviewedBy,
    reviewedAt: link.reviewedAt,
    createdAt: link.createdAt,
    updatedAt: link.updatedAt,
    metadata: link.metadata,
  });
}

console.log(`Confirmed ${confirmedLinks.length} links automatically`);
console.log(`Found ${suggestedLinks.length} suggested links for review`);
```

### Custom Configuration

```typescript
import Decimal from 'decimal.js';

const customConfig = {
  maxTimingWindowHours: 72, // 3 days instead of default 48 hours
  minAmountSimilarity: parseDecimal('0.90'), // Allow up to 10% difference
  minConfidenceScore: parseDecimal('0.65'), // Lower threshold
  autoConfirmThreshold: parseDecimal('0.98'), // Higher auto-confirm threshold
};

const linkingService = new TransactionLinkingService(logger, customConfig);
```

## Integration with Cost Basis Calculator

Transaction linking should run **before** cost basis calculations as a pre-processing step:

```typescript
// Proposed cost basis calculator integration
class CostBasisCalculator {
  constructor(
    private readonly db: KyselyDB,
    private readonly config: CostBasisConfig,
    private readonly jurisdictionRules: IJurisdictionRules,
    private readonly logger: Logger
  ) {}

  async calculate(transactions: StoredTransaction[]): Promise<Result<CalculationResult, Error>> {
    // Phase 0: Link transactions (establish complete cost basis)
    const linkingResult = await this.linkTransfers(transactions);
    if (linkingResult.isErr()) {
      return err(linkingResult.error);
    }

    // Phase 1: Create acquisition lots from all transactions
    const lots = await this.createAcquisitionLots(transactions);

    // Phase 2: Match disposals to lots (FIFO, LIFO, etc.)
    const disposals = await this.matchDisposals(transactions, lots);

    // Phase 3: Calculate gains/losses with jurisdiction rules
    const result = await this.calculateGainsLosses(disposals);

    return ok(result);
  }

  private async linkTransfers(transactions: StoredTransaction[]): Promise<Result<void, Error>> {
    this.logger.info('Phase 0: Linking related transactions');

    const linkingService = new TransactionLinkingService(this.logger, DEFAULT_MATCHING_CONFIG);

    const linkingResult = await linkingService.linkTransactions(transactions);
    if (linkingResult.isErr()) {
      return err(linkingResult.error);
    }

    const { confirmedLinks } = linkingResult.value;
    const linkRepo = new TransactionLinkRepository(this.db);

    // Save all confirmed links
    await linkRepo.createBulk(
      confirmedLinks.map((link) => ({
        id: link.id,
        sourceTransactionId: link.sourceTransactionId,
        targetTransactionId: link.targetTransactionId,
        linkType: link.linkType,
        confidenceScore: link.confidenceScore,
        matchCriteria: link.matchCriteria,
        status: link.status,
        reviewedBy: link.reviewedBy,
        reviewedAt: link.reviewedAt,
        createdAt: link.createdAt,
        updatedAt: link.updatedAt,
        metadata: link.metadata,
      }))
    );

    this.logger.info({ confirmedLinks: confirmedLinks.length }, 'Transaction linking completed');

    return ok(undefined);
  }

  // ... rest of calculator implementation
}
```

## Matching Algorithm

### Confidence Score Calculation

The algorithm calculates a confidence score (0-1) based on multiple factors:

**Weights:**

- Asset match: 30% (mandatory)
- Amount similarity: 40%
- Timing validity: 20%
- Close timing bonus: +5% (if within 1 hour)
- Address match: 10% (bonus if available)

**Penalties:**

- Assets don't match → 0 confidence (no match)
- Addresses explicitly don't match → 0 confidence
- Timing outside window → lower score

### Amount Similarity

Accounts for transfer fees by allowing the target amount to be slightly less than source:

```
similarity = targetAmount / sourceAmount
```

Example:

- Source: 1.0 BTC
- Target: 0.99 BTC (1% fee)
- Similarity: 0.99 (99%)

### Auto-Confirmation

Matches with confidence ≥ 95% (default) are automatically confirmed. Lower confidence matches are suggested for manual review.

## Database Schema

```sql
CREATE TABLE transaction_links (
  id TEXT PRIMARY KEY,
  source_transaction_id INTEGER NOT NULL REFERENCES transactions(id),
  target_transaction_id INTEGER NOT NULL REFERENCES transactions(id),
  link_type TEXT NOT NULL, -- exchange_to_blockchain, blockchain_to_blockchain, exchange_to_exchange
  confidence_score TEXT NOT NULL, -- Decimal 0-1
  match_criteria_json TEXT NOT NULL, -- MatchCriteria
  status TEXT NOT NULL, -- suggested, confirmed, rejected
  reviewed_by TEXT,
  reviewed_at INTEGER, -- Unix timestamp
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  metadata_json TEXT
);

CREATE INDEX idx_tx_links_source_id ON transaction_links(source_transaction_id);
CREATE INDEX idx_tx_links_target_id ON transaction_links(target_transaction_id);
CREATE INDEX idx_tx_links_status ON transaction_links(status);
```

## Future Enhancements

1. **Manual Review Interface** - CLI/UI for reviewing suggested links
2. **Machine Learning** - Train model on confirmed links to improve matching
3. **Cross-Exchange Support** - Link exchange-to-exchange transfers
4. **Batch Operations** - Process large transaction sets efficiently
5. **Link Validation** - Verify links remain valid after data updates
6. **Link Propagation** - Automatically propagate cost basis through linked chains

## Testing

Run unit tests:

```bash
pnpm vitest run packages/accounting/src/linking/__tests__/matching-utils.test.ts
```

## Related Issues

- [#101 - Transaction linking: propagate cost basis from exchanges to blockchain wallets](https://github.com/jbelanger/exitbook/issues/101)
- [#96 - Implement accounting package for cost basis calculations](https://github.com/jbelanger/exitbook/issues/96)
- [#99 - Implement post-processing price enrichment service](https://github.com/jbelanger/exitbook/issues/99)
