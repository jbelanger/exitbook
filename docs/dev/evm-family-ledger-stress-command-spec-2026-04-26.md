---
last_verified: 2026-04-26
status: active
---

# EVM-Family Ledger Stress Command Spec

`ledger stress evm-family` is the repeatable migration gate for EVM-style
ledger-v2 processing. It reruns ledger-v2 from stored raw imports and compares
the resulting ledger balance impact against persisted legacy processed
transactions.

## Command

```sh
exitbook ledger stress evm-family
exitbook ledger stress evm-family [selector]
exitbook ledger stress evm-family --chains ethereum,arbitrum,avalanche,theta
exitbook ledger stress evm-family --expected-diffs ./fixtures/evm-ledger-diffs.json
exitbook ledger stress evm-family --json
```

## Model

- Scope: account-based EVM-compatible chains plus Theta.
- Input side: persisted `raw_transactions.normalized_data`.
- Ledger side: current ledger-v2 processors, including token metadata
  resolution through the normal provider runtime.
- Reference side: persisted legacy processed transactions aggregated by account,
  asset, and liquid balance category using current balance-impact semantics.
- Output side: account-level summaries plus row-level diffs.

The command does not mutate raw rows, processed transactions, ledger tables, or
projection state.

## Expected Diffs

Default mode allows no diffs.

Intentional divergences must be declared in a JSON expectation file:

```json
{
  "schema": "exitbook.evm-family-ledger-stress.expected-diffs.v1",
  "diffs": [
    {
      "accountFingerprint": "abc123...",
      "assetId": "blockchain:ethereum:native",
      "balanceCategory": "liquid",
      "delta": "0.000000000000000001",
      "reason": "Documented legacy rounding difference."
    }
  ]
}
```

An observed diff is accepted only when the account fingerprint, asset id,
balance category, and exact delta match. Expected diffs that no longer appear
are stale and fail the run.

## Exit Behavior

- Exit `0` only when every checked account has no unexpected diffs and no stale
  expected diffs.
- Exit non-zero when any checked account fails, has no usable raw rows, has no
  persisted legacy transactions, or an expectation is stale.
- Fatal setup and selector errors use the normal CLI failure boundary.

## E2E Usage

Live EVM-family workflow tests should run this command after import/reprocess
for the imported account. That makes Arbitrum, Avalanche, Ethereum, and Theta
coverage machine-enforced once real-data test cases are configured.
