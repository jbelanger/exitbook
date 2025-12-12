# Fee Semantics Specification

This is the canonical spec for how Exitbook models, ingests, stores, links, and accounts for fees. If this document disagrees with implementation, the implementation is correct (“code is law”) and this spec must be updated.

## Goals

- **Deterministic transfer linking** (avoid “transfer mismatch” caused by subtracting the wrong fees).
- **Correct accounting inputs** (cost basis and proceeds calculations need consistent fee semantics).
- **Auditability** (fees must be explicit and attributable to a scope + settlement).

## Definitions

### Asset movements: `grossAmount` vs `netAmount`

Every inflow/outflow movement has two amount fields:

```ts
{
  asset: 'BTC',
  grossAmount: Decimal('1.0'),
  netAmount: Decimal('0.9995'),
  priceAtTxTime?: PriceAtTxTime
}
```

- `grossAmount` (required): the logical amount of the movement for portfolio/accounting purposes.
- `netAmount` (optional at schema level): the amount used for **transfer matching** (what the other side should see).
  - If omitted, the persistence layer normalizes `netAmount = grossAmount` on save.
  - Invariants:
    - `netAmount <= grossAmount` (schema-enforced)
    - For movements where “on-chain-settled” fees apply to the _same asset_, processors should emit amounts such that:
      - `netAmount = grossAmount - sum(on-chain fees in same asset)` (see “Settlement”)

### Fee movements: `fees[]`

Fees are stored as an array, not as fixed “network/platform slots”:

```ts
transaction.fees = [
  {
    asset: 'ETH',
    amount: Decimal('0.001'),
    scope: 'network',
    settlement: 'balance',
    priceAtTxTime?: PriceAtTxTime
  }
];
```

Fee fields are required:

- `scope`: _why/what kind of fee is this?_
  - `network`: miners/validators (gas, miner fees)
  - `platform`: exchange/venue revenue (trading fees, withdrawal fees, maker/taker)
  - `spread`: implicit quote deviation (supported by schema; currently treated like a normal fee by accounting if present)
  - `tax`: regulatory levy/withholding (GST/VAT/etc.)
  - `other`: edge cases (penalties, staking commissions, etc.)
- `settlement`: _how was it paid?_
  - `on-chain`: fee is embedded into the movement semantics for matching (common for UTXO chains; also used by some exchanges for “carved-out” withdrawals)
  - `balance`: fee is a separate deduction from the account balance (common for account-based chains’ gas, and for most exchange fees)
  - `external`: fee paid outside tracked balances (reserved)

## Settlement semantics (important)

`settlement` is not “where the fee goes” — it is **how the fee interacts with movement amounts**.

- `settlement='balance'`
  - The primary movement amount matches what the counterparty sees (`netAmount === grossAmount`).
  - The fee is an additional balance decrement (separate from the movement).
  - Example: EVM/Solana gas fees, most exchange trading/withdrawal fees.

- `settlement='on-chain'`
  - The fee is represented as the difference between `grossAmount` and `netAmount` for matching purposes.
  - Common pattern when the venue reports a “gross withdrawal” but broadcasts a smaller on-chain amount:
    - `grossAmount = netAmount + fee.amount` (when fee asset matches movement asset)
  - Note: UTXO chains conceptually pay fees from inputs (not “from the output amount”), but Exitbook models this as `on-chain` settlement because the wallet’s debited amount includes the fee while the recipient’s observed amount does not.

## Source ingestion rules (current behavior)

### Bitcoin (UTXO)

- Emits a `network` fee with `settlement='on-chain'`.
- For outgoing wallet flows, processors emit:
  - `outflow.grossAmount`: wallet debited amount attributable to leaving the wallet (excluding change)
  - `outflow.netAmount`: amount that should match the counterparty deposit (gross minus the on-chain fee)

### Account-based chains (EVM, Solana, Cosmos, Substrate, NEAR, …)

- Network fees are recorded as `scope='network'`, `settlement='balance'`.
- Movement amounts are not reduced by gas in Exitbook:
  - `movement.netAmount === movement.grossAmount`
- Fees are only recorded when the user is determined to have paid them (e.g., Solana fee is not attributed to the receiver when an external sender paid it).

### “Standard” exchanges (most CCXT-style ledgers)

- Ledger `amount` represents the movement itself; fees are separate:
  - movements: `netAmount = grossAmount`
  - fees: `scope='platform'`, `settlement='balance'` (fee currency may differ from movement asset)
- When multiple entries for the same “logical transaction” exist, processors may consolidate duplicate fees by `(asset, scope, settlement)` (sum amounts).

### Coinbase withdrawals (carved-out fee)

Some Coinbase withdrawals report:

- a **gross** withdrawal amount that includes the fee, and
- a fee that must be subtracted to get the on-chain broadcast amount.

Exitbook models this as:

- outflow: `grossAmount = gross`, `netAmount = gross - fee`
- fee: `scope='platform'`, `settlement='on-chain'`

## Downstream behavior (linking + accounting)

### Transfer linking uses `netAmount`

Transaction linking converts each movement into a matching “candidate” using:

- `amount = movement.netAmount ?? movement.grossAmount`

This is the core mechanism that prevents fee-related transfer mismatches:

- Source outflows and target inflows match on the same “on-chain-observable” amount.

### Hidden fee detection (outflow validation)

When matching transfers, Exitbook validates that fee semantics are internally consistent:

- For a given outflow and asset, it expects `netAmount` to equal `grossAmount - sum(on-chain fees in same asset)`.
- If the difference exceeds configured tolerance, the transaction is treated as invalid/mis-modeled (likely missing fee metadata).

### Cost basis and proceeds treat `settlement` differently

When valuing fees for accounting:

- **Acquisitions (inflows):** all fees are considered part of cost basis (no settlement filter).
- **Disposals (outflows):** only `settlement='on-chain'` fees reduce proceeds.

This makes “off-chain/balance” platform fees not corrupt disposal proceeds while still allowing them to be accounted for elsewhere.

### Fee prices are required for crypto accounting

Accounting needs fiat valuation of fees:

- If a fee is in a crypto asset and is used in a cost basis/proceeds calculation, it must have `fee.priceAtTxTime`, or the calculation errors.
- Fiat fees can be handled without explicit `priceAtTxTime` only in limited cases (1:1 when the fee currency matches the movement’s price currency); otherwise an FX rate/price is required.

### FX normalization applies to fees too

Price normalization (non-USD fiat → USD storage currency) applies to both:

- movement `priceAtTxTime`, and
- fee `priceAtTxTime`

Only fiat-denominated non-USD prices are normalized; crypto-denominated “prices” are treated as unexpected and skipped.

## Data quality checks (CLI “gaps”)

The `gaps view --category fees` analysis is a diagnostics tool that flags (non-exhaustive):

- `fee_without_price`: network/platform fee exists but has no `priceAtTxTime`
- `missing_fee_fields`: a transaction classified as a fee but has no populated fee entries
- `fee_in_movements`: a note/metadata hints at a fee but the amount is only represented as a movement

## Required invariants (summary)

- Movements:
  - `grossAmount` is required everywhere.
  - `netAmount <= grossAmount`.
  - Persistence normalizes missing `netAmount` to `grossAmount`.
- Fees:
  - Each fee must have `asset`, `amount`, `scope`, `settlement`.
  - Fees are an array; multiple fee entries per transaction are allowed.
