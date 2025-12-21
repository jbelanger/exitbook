---
last_verified: 2025-12-20
status: draft
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

### Asset Identity

```ts
export interface AssetIdentity {
  assetId: string; // Unique key used for math & storage
  assetSymbol: string; // Display symbol (e.g., USDC)
  assetNamespace: 'blockchain' | 'exchange' | 'fiat';
  assetRef: string; // Contract/mint/denom/currency code
  chain?: string | undefined;
  exchange?: string | undefined;
  network?: string | undefined; // Transfer network (exchange deposits/withdrawals)
}
```

### Asset ID Format (Proposed)

- **Blockchain native**: `blockchain:<chain>:native`
- **Blockchain token**: `blockchain:<chain>:<contractOrMintOrDenom>`
- **Exchange asset**: `exchange:<exchange>:<currencyCode>`
- **Fiat**: `fiat:<currencyCode>`

Example: `blockchain:ethereum:0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48` (USDC on Ethereum)

## Availability & Fallback Rules

### On-chain

- **EVM**: `tokenAddress` is usually available for ERC-20 transfers. Use it when present.
- **Solana**: `tokenAddress` (mint) is usually available for SPL tokens.
- **Cosmos/IBC**: use denom when provided by provider (e.g., `ibc/...`).
- **Native assets**: use `native` sentinel (consistent across all chains: Bitcoin, Solana, etc.).
- **If missing**: fall back to `assetId = blockchain:<chain>:unknown:<symbol>` and log `logger.warn()` with transaction id + context. This prevents silent data corruption and highlights provider gaps.

### Exchange

- **Network is not always available.** Trades and ledger entries typically do not include a network. Deposits/withdrawals sometimes do (e.g., KuCoin `Transfer Network`, Coinbase `network`).
- **Recommendation**: Use `exchange:<exchange>:<currencyCode>` as the canonical `assetId` for exchange balances and movements. Store `network` separately for link matching and warnings.
- **If currencyCode missing**: this should not happen with ccxt data, but if it does, use normalized symbol (current `asset`) and log a warning.

## Behavioral Rules

### Balance Calculation

- Use `assetId` as the grouping key.
- `assetSymbol` is retained only for display/reporting.

### Price Enrichment

- Prices must be associated to `assetId`, not `assetSymbol`.
- Price providers may still accept symbols; introduce a `pricingKey` mapping:
  - On-chain tokens: prefer contract/mint where provider supports it.
  - Otherwise, fall back to symbol with warnings for ambiguous symbols.

### Cost Basis / Lots

- Lots are keyed by `assetId`.
- Queries by symbol should resolve to a set of `assetId`s for display filters.

## Data Model Changes (High-Level)

- `AssetMovement` and `FeeMovement` include `assetId` + optional metadata.
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

_Last updated: 2025-12-20_
