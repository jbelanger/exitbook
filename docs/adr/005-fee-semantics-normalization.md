# ADR-005: Fee Semantics Normalization

## Status

Accepted – implementation in progress.

## Context

Exitbook ingests transactions from exchanges and blockchains, each expressing fees differently:

- **Kraken**: Debits withdrawal amount separately from platform fee (two ledger entries)
- **Ethereum**: Deducts gas directly from transferred asset (one on-chain transaction)
- **Binance**: May charge withdrawal fees in a different asset (BNB for BTC withdrawal)

Our current model stores a single `amount` per movement with basic `network`/`platform` fee slots. During transfer reconciliation, we incorrectly subtract all fees from transfer amounts, causing "Transfer amount mismatch" errors when fees don't actually reduce the on-chain transfer quantity.

**Example failure:**

- Kraken withdrawal: 0.00648264 BTC sent on-chain + 0.0004 BTC fee (separate ledger entry)
- System subtracts 0.0004 from 0.00648264 = 0.00608264
- Blockchain shows 0.00648264 received → mismatch error

This ambiguity also prevents accurate cost-basis calculations, as we can't distinguish fees that reduce proceeds from fees that should be added to acquisition costs.

## Problem

We lack metadata to distinguish:

1. **On-chain fees** (gas, miner tips) that reduce the transfer amount
2. **Platform fees** (withdrawal fees, trading fees) charged separately from transfers
3. **Cross-asset fees** paid in different currencies

Without this distinction:

- Transfer reconciliation fails on valid transactions
- Cost-basis calculations either double-count or reject fees
- Tax reporting can't separate network fees from platform fees

## Decision

Introduce explicit gross/net movement amounts and structured fee metadata to make transfer reconciliation deterministic and enable accurate cost-basis calculations.

### Data Model Changes

#### Movements

Add gross/net semantics to `AssetMovement`:

```typescript
{
  asset: string,
  grossAmount: Decimal,          // Amount venue debited/credited (REQUIRED)
  netAmount?: Decimal,           // Amount transmitted on-chain (defaults to grossAmount)
  amount?: Decimal,              // DEPRECATED: Kept temporarily to avoid build errors during refactoring
  priceAtTxTime?: PriceInfo
}
```

**Rationale:**

- `grossAmount`: What the user initiated / what shows in venue ledger (REQUIRED)
- `netAmount`: What actually moved on-chain (after on-chain fee deductions). Optional - defaults to `grossAmount` if omitted
- `amount`: Deprecated field kept only to avoid build errors during refactoring; all code must use `grossAmount`/`netAmount`
- Most transactions: `netAmount === grossAmount` (no on-chain fees)
- On-chain gas fees: `netAmount = grossAmount - gasFee`

#### Fees

Replace fee object slots with a flexible array structure:

```typescript
fees: Array<{
  asset: string;
  amount: Decimal;
  scope: 'network' | 'platform' | 'spread' | 'tax' | 'other';
  settlement: 'on-chain' | 'balance' | 'external';
  priceAtTxTime?: PriceInfo;
}>;
```

**Scope** – Why was this fee charged?

- `network`: Paid to miners/validators (gas, miner fees)
- `platform`: Revenue for the venue (withdrawal fees, trading fees, maker/taker)
- `spread`: Implicit fee in swap/quote price deviation (future extension)
- `tax`: Regulatory levy (GST, VAT, FATCA withholding)
- `other`: Edge cases (penalties, staking commissions)

**Settlement** – How was this fee paid?

- `on-chain`: Deducted from the on-chain transfer itself.
  - Results in `netAmount < grossAmount`.
  - Blockchain receipt shows a reduced amount.
  - Applies to classic gas/validator fees _and_ to exchange/platform rakes that are carved out of the same on-chain send (e.g., Coinbase UNI withdrawals).
- `balance`: Charged from a custodial balance via a separate ledger entry.
  - On-chain transfer stays at full `grossAmount`.
  - Typical for exchanges like Kraken that book a distinct fee row.
- `external`: Paid outside tracked balances (ACH, credit card, invoice).
  - Reserved for future use.
  - Not common in current exchange/blockchain scenarios.

> **Important:** `scope` answers “why the fee exists,” `settlement` answers “where the funding came from.” They are independent axes. Platform fees can be settled on-chain or from balance; network fees can, in rare cases, be prefunded by the venue (`settlement='balance'`). Our schema must permit any combination that real venues exhibit.

**Array Structure Advantages:**

- Naturally supports multiple fees of same scope (multi-hop DEX swaps, compound transactions)
- No redundancy between slot names and scope field
- Consistent with movements pattern (both are arrays)
- Flexible for edge cases without schema changes

### Implementation Examples

**Critical Distinction: UTXO vs Account-Based Blockchains**

Different blockchain architectures handle fees differently, which affects how `grossAmount` and `netAmount` relate:

| Model                   | Examples                            | Fee Handling                                  | netAmount Calculation           |
| ----------------------- | ----------------------------------- | --------------------------------------------- | ------------------------------- |
| **UTXO**                | Bitcoin                             | Fees implicit in UTXOs                        | `netAmount = grossAmount - fee` |
| **Account-Based**       | Ethereum, Solana, Substrate, Cosmos | Fees paid separately from transfer            | `netAmount = grossAmount`       |
| **Platform (Exchange)** | Kraken, Binance                     | Platform fees typically separate ledger entry | `netAmount = grossAmount`       |
| **Platform (On-Chain)** | Coinbase UNI withdrawals            | Platform fee carved from on-chain send        | `netAmount = grossAmount - fee` |

**Key Insight:** The `settlement='on-chain'` field indicates the fee was part of the blockchain transaction, but does NOT always mean `netAmount < grossAmount`. For account-based chains, on-chain fees are still paid separately from the transfer amount, resulting in `netAmount = grossAmount`.

#### 1. Kraken BTC Withdrawal (Platform Fee, Off-Chain)

```typescript
{
  movements: {
    outflows: [{
      asset: 'BTC',
      grossAmount: '0.00648264',
      netAmount: '0.00648264'     // Full amount goes on-chain
    }]
  },
  fees: [{
    asset: 'BTC',
    amount: '0.0004',
    scope: 'platform',              // Kraken's revenue
    settlement: 'balance'           // Separate ledger entry
  }]
}
```

**Reconciliation:** Source withdrawal netAmount (0.00648264) matches target deposit netAmount (0.00648264) ✓

**Cost Basis:** Platform fee added to acquisition cost at destination.

#### 2. Ethereum Transfer (Network Fee, Separate Payment)

```typescript
{
  movements: {
    outflows: [{
      asset: 'ETH',
      grossAmount: '1.5000',
      netAmount: '1.5000'           // Recipient receives full amount
    }]
  },
  fees: [{
    asset: 'ETH',
    amount: '0.0010',
    scope: 'network',                // Paid to validators
    settlement: 'balance'            // Deducted separately from balance
  }]
}
```

**Reconciliation:** Source netAmount (1.5000) matches target netAmount (1.5000) ✓

**Cost Basis:** Network fee paid separately from transfer; balance calculator subtracts both transfer and fee.

#### 3. Coinbase UNI Withdrawal (Platform Fee, On-Chain)

```typescript
{
  movements: {
    outflows: [{
      asset: 'UNI',
      grossAmount: '18',
      netAmount: '17.83574483'      // Coinbase broadcasts the reduced amount
    }]
  },
  fees: [{
    asset: 'UNI',
    amount: '0.16425517',
    scope: 'platform',              // Coinbase revenue / covers gas internally
    settlement: 'on-chain'          // Withheld from the on-chain send
  }]
}
```

**Reconciliation:** Source netAmount (17.83574483) matches target deposit netAmount ✓

**Cost Basis:** Platform fee is available for policy decisions (e.g., add to disposal cost basis) without corrupting transfer sizing.

#### 4. Bitcoin On-Chain Transfer (Network Fee, UTXO Model)

**IMPORTANT:** Bitcoin's UTXO model handles fees differently than account-based chains. Fees are implicit in the UTXO amounts, resulting in `netAmount < grossAmount`.

```typescript
{
  movements: {
    outflows: [{
      asset: 'BTC',
      grossAmount: '0.5000',           // Amount removed from wallet (after change)
      netAmount: '0.4996'              // Amount received at destination (after fee)
    }]
  },
  fees: [{
    asset: 'BTC',
    amount: '0.0004',
    scope: 'network',                   // Paid to miners
    settlement: 'on-chain'              // Implicit in UTXO structure
  }]
}
```

**Reconciliation:** Source netAmount (0.4996) matches target deposit netAmount (0.4996) ✓

**Balance Impact:** User's balance decreases by 0.5000 BTC (grossAmount includes implicit fee)

**UTXO Model Explanation:**

- User's wallet selects UTXOs totaling (e.g.) 0.6 BTC
- Transaction output 1: 0.4996 BTC to recipient (netAmount)
- Transaction output 2: 0.1 BTC back to user (change)
- Implicit fee: 0.6 - 0.4996 - 0.1 = 0.0004 BTC
- grossAmount = 0.5 BTC (what left the wallet after accounting for change)
- netAmount = 0.4996 BTC (what recipient receives)

#### 5. Binance BTC Withdrawal (Cross-Asset Fee)

```typescript
{
  movements: {
    outflows: [{
      asset: 'BTC',
      grossAmount: '0.25',
      netAmount: '0.25'             // BTC transfer unaffected
    }]
  },
  fees: [{
    asset: 'BNB',
    amount: '0.0005',
    scope: 'platform',
    settlement: 'balance'           // Separate BNB debit
  }]
}
```

**Note:** If exchange shows separate BNB ledger entry, processor creates a distinct BNB transaction.

### Transfer Reconciliation Logic

**Matching uses `netAmount`** (what actually moved on-chain):

```typescript
// In convertToCandidates()
amount: movement.netAmount ?? movement.grossAmount ?? movement.amount;
```

**Rationale:**

- Both source and target use the same on-chain quantity for comparison
- Kraken withdrawal (net=0.00648264) matches Bitcoin deposit (net=0.00648264)
- Variance tolerances now capture only genuine mismatches, not fee accounting errors

### Cost-Basis Calculations

**Fee allocation depends on context:**

**For Acquisitions (inflows):**

- Include ALL fees in cost basis (both network and platform)
- Fees increase what you paid to acquire the asset

**For Disposals (outflows):**

- Include ONLY on-chain fees (settlement='on-chain')
- These fees reduce your proceeds
- Platform fees charged separately don't affect disposal proceeds

```typescript
const relevantFees = isInflow
  ? transaction.fees // All fees
  : transaction.fees.filter((f) => f.settlement === 'on-chain'); // On-chain only
```

**Example:**

- Kraken BTC withdrawal disposal: proceeds = 0.00648264 BTC (platform fee NOT subtracted)
- Ethereum transfer disposal: proceeds = 1.4990 ETH (gas fee already subtracted via netAmount)

### Validation Rules

**Required fields:**

- `grossAmount` is mandatory on all movements (no fallback to legacy `amount`)
- `scope` and `settlement` are mandatory on all fees
- Missing fields return errors via `Result` types (fail-fast, no silent defaults)

**Hard validation rules:**

- `netAmount > grossAmount` → ERROR (cannot receive more than was debited)

**Schema guardrails (soft / configurable):**

- Venues sometimes report unusual combinations (e.g., platform fees with `settlement='on-chain'`).
- We may log or flag them, but we **must not** reject patterns that real exchanges produce.

**Suspicious patterns (warnings):**

- Network fees in fiat currency (likely processor bug)
- Very large fees relative to transfer amounts

### Migration Strategy

Following "clean breaks only" principle:

1. **Database Reset:** Drop and recreate database during development (no schema migrations)
2. **No Backward Compatibility:** All data must use new format
3. **Clean Re-ingestion:** After schema changes, re-import all data from source
4. **Processor Updates:** Update all processors to emit new fee format before ingestion

**No legacy format support:**

- Processors must emit `grossAmount` (required, no fallback to legacy `amount`)
- Processors should emit `netAmount` when it differs from `grossAmount` (on-chain fees); otherwise defaults to `grossAmount`
- Fees must include `scope` and `settlement` (required)
- Old data format will fail validation with clear error messages

### Future Extensions

**Spread Fees (Informational Only):**

- Marked as future extension for reporting/analytics
- Will NOT be included in cost-basis calculations (already reflected in execution prices)
- When implemented: derive by comparing execution vs mid-market price
- Use case: "You paid $X in spreads this year" reports
- Requires reliable mid-market price data at transaction time

## Consequences

**Benefits:**

- Transfer reconciliation becomes deterministic for all fee models
- Cost-basis calculations use accurate fee semantics without corrupting transfer amounts
- Tax reports can separate network fees from platform fees
- Array structure supports complex scenarios (multi-hop swaps, compound transactions)
- Clear validation errors guide correct processor implementation

**Trade-offs:**

- Stored JSON payloads slightly larger (acceptable for correctness)
- Requires coordinated processor updates across all venues
- Clean break means all historical data must be re-ingested

**Technical Debt Avoided:**

- No backward compatibility code to maintain
- No fallbacks to legacy fields (fail-fast with clear errors)
- All validation uses `Result` types (neverthrow) - no silent failures
- Simple, consistent data model across all venues

## Implementation Checklist

- [ ] Update movement/fee schemas in `packages/core/src/schemas/universal-transaction.ts`
- [ ] Adjust database schema in `packages/platform/data/src/migrations/001_initial_schema.ts`
- [ ] Update repository layer in `packages/platform/data/src/repositories/transaction-repository.ts`
- [ ] Update linking logic in `packages/accounting/src/linking/matching-utils.ts`
- [ ] Update lot matcher in `packages/accounting/src/services/lot-matcher.ts`
- [ ] Update interpretation strategies in `packages/ingestion/src/infrastructure/exchanges/shared/strategies/`
- [ ] Update processor base classes to emit new format
- [ ] Update Kraken processor (reference implementation)
- [ ] Add comprehensive test coverage for all fee scenarios
- [ ] Update documentation (CLAUDE.md, processor implementation guide)
- [ ] Drop database and re-ingest all test data
