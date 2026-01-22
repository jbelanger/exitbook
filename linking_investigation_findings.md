# Linking Investigation Findings

## Summary

Blockchain outflows are not linking to exchange deposits primarily because the linking algorithm matches on **movement netAmount** (not gross) and enforces hard thresholds that are often violated when a single on-chain transaction funds multiple outputs or when exchanges don’t provide tx hashes.

### 1. **Transaction Hash-Based Linking Works (Coinbase, Some KuCoin)**

Exchanges that report blockchain metadata can link successfully:

- **Coinbase**: Reports `blockchain_name` and `blockchain_transaction_hash` for deposits
  - Example: Transaction 14215 (Coinbase BTC deposit) has tx hash `c700f28764ab1e...`
  - Links to blockchain outflow 14091 via `blockchain_internal` link type (100% confidence)
  - This matching is based on shared transaction hash

- **KuCoin**: Some deposits have blockchain metadata (26 out of 139)
  - blockchain_name: 'unknown'
  - blockchain_transaction_hash: populated (e.g., Solana signatures)
  - Can link via transaction hash matching

### 2. **Heuristic Matching Fails (Kraken, Most KuCoin/Coinbase)**

Exchanges that DON'T report blockchain metadata cannot link:

- **Kraken**: NO blockchain metadata on any deposits (0 out of 326)
  - source_type: 'exchange'
  - blockchain_name: NULL
  - blockchain_transaction_hash: NULL
  - Must rely on heuristic matching (asset + amount + timing)

- **Coinbase**: Only 6 out of 124 deposits have blockchain metadata
- **KuCoin**: 113 out of 139 deposits lack blockchain metadata

#### Why Heuristic Matching Fails

**Reason 1: Amount Discrepancies Exceed Hard Thresholds**

Linking uses **movement netAmount** (not grossAmount) for matching:

- `convertToCandidates()` uses `movement.netAmount ?? movement.grossAmount`
- For Bitcoin, `netAmount` = (walletInput − walletOutput) − network fee
- This means the “outflow” amount reflects **total external spend**, not a single output

Example case:

- Blockchain outflow (tx 14091): 0.0155772 BTC sent at 2024-05-30T02:48:12
- Kraken deposit (tx 13781): 0.01473948 BTC received at 2024-05-30T03:53:16
- Amount similarity: 0.01473948 / 0.0155772 = **94.63%**
- Hard threshold: 95% (minAmountSimilarity)
- **Result: FILTERED OUT** (below threshold, before confidence scoring)

This discrepancy is expected when:

- A single UTXO transaction pays **multiple external recipients**
- The exchange records only **its specific output**
- The wallet-level outflow is the **sum of all external outputs** (minus fee)

**Reason 2: One-to-One Deduplication Prevents Multi-Recipient Matching**

From the deduplication logic (matching-utils.ts:579-587):

> - One target can only match one source (highest confidence wins)
> - One source can only match one target (highest confidence wins)

This prevents a **single blockchain outflow** from linking to **multiple exchange deposits**, even when they are separate outputs from the same on-chain transaction.

**Reason 3: Variance Validation Blocks Larger Differences**

Even suggested matches are validated via `validateLinkAmounts()`:

- Rejects `target > source`
- Rejects variance **> 10%**

So even if `minAmountSimilarity` were lowered below 90%, matches would still be rejected once variance exceeds 10%.

**Reason 4: Multiple Recipients from Same UTXO Transaction**

Bitcoin UTXO transactions can have multiple outputs:

- Output 1: 0.01469897 BTC → Coinbase (linked via tx hash)
- Output 2: 0.00087823 BTC → Change address (linked via tx hash)
- Output 3: ???

If the sender created multiple outputs going to different exchanges, each exchange would report a different amount, making heuristic matching difficult.

### 3. **Link Type Classification (Confirmed)**

Link type is derived from **transaction.sourceType**, not `tx.blockchain` presence.

- Exchange transactions remain `sourceType: 'exchange'` even when blockchain metadata exists.
- So tx-hash matches should classify as `exchange_to_blockchain`, not `blockchain_to_blockchain`.

No evidence of misclassification found in current code.

## Statistics

### Linking Success by Account Type

**Exchange Accounts:**

- Kraken: 2.5% inflows linked, 14.5% outflows linked
- Coinbase: 4.8% inflows linked, 11.3% outflows linked
- KuCoin: 18.0% inflows linked, 14.4% outflows linked

**Blockchain Accounts:**

- Bitcoin addresses: 100% inflows linked, 0% outflows linked
- Cardano addresses: 100% inflows linked, 0% outflows linked
- Most other chains: High inflow linking, low outflow linking

### Blockchain Metadata Coverage

Out of 589 total exchange inflows:

- **32 have blockchain metadata** (6 Coinbase, 26 KuCoin) → Can link via tx hash
- **557 do NOT have blockchain metadata** → Rely on heuristic matching

## Recommendations

1. **Lower Amount Similarity Threshold (But Respect 10% Variance Guardrail)**
   - Current: 95%
   - Suggested: 90% to account for UTXO multi-output transactions
   - Note: `validateLinkAmounts()` still rejects >10% variance, so 90% is the effective floor unless that validation is also adjusted.

2. **Enhance Kraken Integration**
   - Investigate if Kraken API can provide blockchain transaction hashes
   - Current: Using Kraken API which doesn't provide tx hashes
   - If available, could significantly improve linking

3. **Manual Review Workflow**
   - For exchanges without tx hash metadata, lower confidence threshold
   - Present matches at 90-95% confidence as "suggested" for manual review

4. **Multi-Output UTXO Handling**
   - Detect when a blockchain transaction has multiple outputs
   - Allow one source (blockchain outflow) to link to multiple targets (exchange deposits)
   - Currently: Deduplication enforces 1:1 matching

5. **Address Matching Enhancement**
   - If exchanges expose deposit addresses (from/to), use them for matching
   - Currently: Kraken/KuCoin deposits don't have from_address populated
