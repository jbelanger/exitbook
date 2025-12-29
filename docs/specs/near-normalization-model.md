# NEAR Normalization Model (What Should Have Been Done From the Start)

## Purpose

Define NEAR-specific normalized models that represent NEAR transactions as they actually occur on-chain, while still supporting Exitbook’s accounting pipeline. The model must preserve NEAR’s receipt-based execution and avoid forcing NEAR into Solana-style single-event records.

## Core Principles

- **Separate raw vs normalized**: Raw provider data should be captured with minimal shaping. Normalized NEAR models should still be NEAR-native, not generic. Accounting-specific shapes should be derived later.
- **Receipt-first identity**: A NEAR transaction can spawn multiple receipts; the normalized event granularity should be **receipt-level** (or finer when actions within a receipt need separate events).
- **Event identity must be stable**: `eventId` should include `transaction_hash`, `receipt_id`, and optional `action_index` to disambiguate multiple events per receipt.
- **NEAR semantics over generic fields**: Use fields like `signer_id`, `receiver_id`, `predecessor_id`, `attached_deposit`, `gas_burnt`, `tokens_burnt`, and per-receipt `status` instead of generic `from/to/amount`.
- **Do not infer money movement from deposits alone**: Attached deposits are not equivalent to net transfers. Accounting should be derived from balance deltas and token transfers, not from `attached_deposit`.

## Data Model Layers

### 1) Raw Provider Models (NearBlocks / RPC)

- Keep provider responses near-raw with lossless structures and types.
- Normalize only data types (numbers -> decimal strings), not meaning.
- Store original identifiers: `transaction_hash`, `receipt_id`, `block_hash`, `block_height`, `block_timestamp`.

### 2) Normalized NEAR Transaction Models

These are **NEAR-native** and still provider-agnostic.

#### NearTransaction (transaction-level envelope)

Represents the base transaction that spawned receipts.

- `id`: `transaction_hash`
- `signer_id`, `receiver_id`
- `block_height`, `block_hash`, `block_timestamp`
- `actions`: list of transaction actions (not receipts)
- `outcome_status`: success/failed at transaction level
- `receipts`: array of `NearReceipt` (see below)

#### NearReceipt (receipt-level event envelope)

Receipts are where state changes actually happen.

- `receipt_id` (primary receipt identity)
- `predecessor_id` and `receiver_id`
- `transaction_hash` (parent)
- `block_height`, `block_hash`, `block_timestamp`
- `receipt_kind` (action, data, refund)
- `actions` (per receipt)
- `outcome`:
  - `status`
  - `gas_burnt`
  - `tokens_burnt`
  - `logs`

#### NearAction (action-level detail)

- `action_type`
- `method_name` (for function calls)
- `args` (raw or parsed)
- `attached_deposit` (yoctoNEAR)
- `gas` (yocto / gas units)

#### NearBalanceChange (account delta)

- `account_id`
- `pre_balance` / `post_balance` (yoctoNEAR)
- `delta` (computed, not raw)
- `source_receipt_id` (link to receipt)

#### NearTokenTransfer (NEP-141)

- `contract_id`
- `from`, `to`
- `amount` (decimal string)
- `decimals`, `symbol` (if known)
- `source_receipt_id`

## Event Granularity Rules

- The **primary normalized event** is a receipt.
- Emit multiple events when:
  - A receipt contains multiple token transfers.
  - A receipt contains multiple balance changes affecting the queried account.
- `eventId` should be generated from:
  - `transaction_hash` + `receipt_id` + optional `action_index`/`transfer_index`.

## Required vs Derived Fields

- **Required at normalization**:
  - `transaction_hash`, `receipt_id`, `block_timestamp`, `signer_id`, `receiver_id`, `receipt_kind`, `status`.
- **Derived later (accounting)**:
  - `from/to` address roles for fund flows.
  - `amount` for single-asset summaries.
  - `fee` assignment to user’s perspective.

## Mapping Guidance (NearBlocks)

- Use `/txns-only` for base `NearTransaction`.
- Use `/receipts` and `/activity` to build `NearReceipt` and `NearBalanceChange`.
- Use `/ft-txns` to emit `NearTokenTransfer` events **linked to receipts**.
- Never set `amount = sum(attached_deposit)` as a transaction transfer amount.

## Compatibility With Accounting Pipeline

- Build a separate **accounting projection** (`NearFundFlow`) from:
  - `NearBalanceChange` for NEAR native deltas.
  - `NearTokenTransfer` for NEP-141 deltas.
  - `tokens_burnt` for fee handling.
- This projection can map to the existing universal transaction model without corrupting the NEAR-native normalized layer.

## Naming Corrections (examples)

- Prefer `signer_id`/`receiver_id` over `from`/`to` in normalized NEAR models.
- Prefer `attached_deposit_yocto` over `amount` when representing action deposits.
- Prefer `receipt_status` over `status` if status is at receipt granularity.

## Summary

The normalized NEAR model should mirror NEAR’s receipt execution model and preserve semantic correctness. A separate accounting projection should interpret that data for portfolio tracking. This avoids forcing NEAR into Solana-style records and prevents inaccurate “amount/from/to” assumptions.
