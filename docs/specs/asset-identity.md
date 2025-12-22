---
last_verified: 2025-12-22
status: updated
---

# Asset Identity Specification

> ⚠️ **Code is law**: If this document disagrees with implementation, the implementation is correct and this spec must be updated.

Define a unique asset identity that prevents symbol collisions across chains, contracts, and exchanges, and make that identity the key for balances, pricing, and cost basis.

## Quick Reference

| Concept                  | Key Rule                                                        |
| ------------------------ | --------------------------------------------------------------- |
| `assetSymbol`            | Display label (e.g., `USDC`, `ETH`)                             |
| `assetId`                | Unique identity key used for math and storage                   |
| `assetRef`               | Chain/exchange reference (contract, mint, denom, currency code) |
| `assetNamespace`         | `blockchain` / `exchange` / `fiat`                              |
| `asset` (legacy)         | Replace with `assetSymbol` + `assetId`                          |
| `currency` (balance key) | Replace with `assetId` or `assetKey`                            |

## Problem Summary

Today, assets are keyed by symbol only. Tokens with the same symbol (across chains or contracts) are aggregated together, which corrupts balances, price enrichment, and cost basis.

### Evidence (Current Code)

- Balance calculation groups by `asset` string only: `packages/ingestion/src/features/balances/balance-calculator.ts:23`.
- EVM processor only persists `asset` symbol, discarding `tokenAddress`: `packages/ingestion/src/sources/blockchains/evm/processor.ts:110` vs `packages/ingestion/src/sources/blockchains/evm/processor-utils.ts:414`.
- Live balances use symbol (fallback contract address), so collisions occur on the live side too: `packages/ingestion/src/features/balances/balance-utils.ts:289`.
- Price propagation and cost basis are keyed by `asset` symbol: `packages/accounting/src/price-enrichment/price-enrichment-utils.ts:337`, `packages/accounting/src/persistence/cost-basis-repository.ts:178`.

## Goals

- **Correctness**: No cross-chain or cross-contract aggregation for same symbol.
- **Traceability**: Each movement/fee has a recoverable, stable identity.
- **Compatibility**: Preserve `assetSymbol` for UI/printing.

## Non-Goals

- Building a full on-chain token registry.
- Auto-merging equivalent wrapped assets (e.g., bridged USDC variants).

## Definitions

### Asset Identity Fields (Minimal)

```ts
// Minimal fields required everywhere
assetId: string; // Unique key used for math & storage
assetSymbol: string; // Display symbol (e.g., USDC)
```

Additional metadata (contract/mint/denom/network) should be fetched from
TokenMetadata or derived by parsing `assetId`. Do not duplicate token metadata
on movements/fees beyond what is needed for display.

### Asset ID Format

- **Blockchain native**: `blockchain:<chain>:native`
- **Blockchain token**: `blockchain:<chain>:<contractOrMintOrDenom>`
- **Exchange asset**: `exchange:<exchange>:<currencyCode>`
- **Fiat**: `fiat:<currencyCode>`

Example: `blockchain:ethereum:0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48` (USDC on Ethereum)

## Canonicalization Rules

### Blockchain Token References

**Case Handling**:

- **Hex addresses** (0x-prefixed): Normalized to lowercase for EVM compatibility
- **Non-hex references** (Solana mints, IBC denoms): Preserved as-is (case-sensitive)

**Rationale**: EVM addresses are case-insensitive, but Solana mint addresses (base58-encoded public keys) and IBC denoms (containing uppercase hex) are case-sensitive. Lowercasing these would corrupt the identifier and prevent round-tripping with provider data.

**Examples**:

```
blockchain:ethereum:0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48  (lowercased)
blockchain:solana:EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v    (preserved)
blockchain:cosmos:ibc/27394FB092D2ECCD56123C74F36E4C1F926001CEADA9CA97EA622B25F41E5EB2  (preserved)
```

### Exchange Asset IDs

**Format**: `exchange:<exchange>:<currencyCode>` (all lowercase)

**Rules** (implemented in `buildExchangeAssetId`):

- Case: Always lowercase (`BTC` → `btc`)
- Exchange slug: Match client ID (`kraken`, `kucoin`, `coinbase`)
- Currency code: Use ccxt `currency` field (NOT `code` or `id`)
- Aliases: Normalize BEFORE `buildExchangeAssetId` (e.g., Kraken `XXBT` → `BTC` via `normalizeKrakenAsset`)

**Examples**:

```
exchange:kraken:btc      (NOT exchange:kraken:xbt or exchange:kraken:xxbt)
exchange:kucoin:usdt
exchange:coinbase:usdc
```

**Critical**: CSV and API paths MUST produce identical `assetId` for same currency.

## Availability & Fallback Rules

### On-chain

- **EVM**: `tokenAddress` is usually available for ERC-20 transfers. Use it when present.
- **Solana**: `tokenAddress` (mint) is usually available for SPL tokens.
- **Cosmos/IBC**: use denom when provided by provider (e.g., `ibc/...`).
- **Native assets**: use `native` sentinel (consistent across all chains: Bitcoin, Solana, etc.).
- **If missing**: **fail-fast** by returning an error. This stops processing the transaction group and logs a detailed error message. Rationale: Missing token references indicate provider data quality issues that must be surfaced immediately rather than silently papered over with ambiguous `unknown` identifiers. The `buildUnknownAssetId` utility exists for future use cases but is not used in current blockchain processors.

### Exchange

- **Network is not always available.** Trades and ledger entries typically do not include a network. Deposits/withdrawals sometimes do (e.g., KuCoin `Transfer Network`, Coinbase `network`).
- **Canonical assetId**: Use `exchange:<exchange>:<currencyCode>` per canonicalization rules above. Store `network` separately for link matching and warnings.
- **If currencyCode missing**: this should not happen with ccxt data, but if it does, use normalized symbol (current `asset`) and log a warning.

## Behavioral Rules

### Balance Calculation

- Use `assetId` as the grouping key.
- `assetSymbol` is retained only for display/reporting.

### Price Enrichment

- Prices must be associated to `assetId`, not `assetSymbol`.
- Price providers may still accept symbols; introduce a `pricingKey` mapping:
  - On-chain tokens: prefer contract/mint where provider supports it (lookup via `assetId` -> TokenMetadata).
  - Otherwise, fall back to symbol with warnings for ambiguous symbols.

### Cost Basis / Lots

- Lots are keyed by `assetId`.
- Queries by symbol should resolve to a set of `assetId`s for display filters.

## Data Model Changes (High-Level)

- `AssetMovement` and `FeeMovement` include `assetId` + `assetSymbol` (no duplicated token metadata).
- Persist `assetId` in `movements_*` and `fees` JSON blobs.
- Update initial schema migration (`001_initial_schema.ts`) accordingly.

## Implementation Plan (No Code Here)

1. **Schema update**: Add `assetId` to movement/fee schemas in `packages/core/src/schemas/universal-transaction.ts`.
2. **Processors**: Populate `assetId` in all blockchain and exchange processors.
3. **Storage**: Persist new fields in movement/fee JSON.
4. **Balance & verification**: Key by `assetId` in `balance-calculator` and live balances.
5. **Pricing**: Route price enrichment to use `assetId`; add mapping for providers.
6. **Cost basis**: Use `assetId` for lots and lookups.
7. **Linking**: Use exchange `network` (when present) for mapping exchange withdrawals to chain deposits.
8. **Re-process**: Drop/recreate DB and re-run import to backfill `assetId`.

## Edge Cases & Gotchas

- **Symbol collisions**: same symbol across chains must remain separate, even if price is similar.
- **Wrapped assets**: treat wrapped and native as distinct unless explicitly merged by a higher-level report.
- **Provider gaps**: missing contract/mint/denom must log warnings; do not silently coerce.

## Recommended Terminology Updates

- `asset` (movement) -> `assetSymbol` (display) + `assetId` (identity)
- `currency` (balance key) -> `assetId` or `assetKey`

---

_Last updated: 2025-12-22_
