---
status: deferred
last_verified: 2026-04-27
---

# Binance Ledger-V2 Draft

This is a temporary implementation draft for a future Binance exchange source.
It is not a canonical spec. Move stable behavior into specs only after raw
provider data and live reconciliation prove the model.

Deferred on 2026-04-27. Do not treat this as active exchange migration work.

## Problem

Exitbook does not currently have a Binance exchange importer, client, or
ledger-v2 processor. Binance can fit the shared exchange ledger model, but it is
not as narrow as Kraken, Coinbase, or KuCoin:

- Spot trades are queried per market symbol through `GET /api/v3/myTrades`.
- Spot balances, funding balances, deposits, withdrawals, convert trades, and
  internal wallet transfers come from separate API families.
- Binance asset symbols do not identify chain-native assets. Network strings on
  deposit and withdrawal rows are useful evidence, not enough to create
  chain-native asset ids.
- Binance has several account scopes: spot, funding, earn, futures, margin, and
  pool products. Claiming live balance parity requires deciding which scopes the
  importer and live reference include.

## Source Evidence

Official Binance docs checked on 2026-04-27:

- Request signing and timestamp rules:
  https://developers.binance.com/docs/binance-spot-api-docs/rest-api/request-security
- Server time and exchange symbol metadata:
  https://developers.binance.com/docs/binance-spot-api-docs/rest-api/general-endpoints
- Spot account and account trades:
  https://developers.binance.com/docs/binance-spot-api-docs/rest-api/account-endpoints
- Deposit history:
  https://developers.binance.com/docs/wallet/capital/deposite-history
- Withdrawal history:
  https://developers.binance.com/docs/wallet/capital/withdraw-history
- Positive user assets:
  https://developers.binance.com/docs/wallet/asset/user-assets
- Funding wallet:
  https://developers.binance.com/docs/wallet/asset/funding-wallet
- Universal transfer history:
  https://developers.binance.com/docs/wallet/asset/query-user-universal-transfer
- Convert trade history:
  https://developers.binance.com/docs/convert/trade/Get-Convert-Trade-History

Rotki confirmations checked locally:

- `/Users/joel/Dev/rotki/rotkehlchen/exchanges/binance.py`
- `/Users/joel/Dev/rotki/rotkehlchen/data_import/importers/binance.py`
- `/Users/joel/Dev/rotki/rotkehlchen/tests/exchanges/test_binance.py`
- `/Users/joel/Dev/rotki/rotkehlchen/tests/exchanges/test_binance_us.py`
- `/Users/joel/Dev/rotki/rotkehlchen/tests/data/binance_history.csv`
- `/Users/joel/Dev/rotki/rotkehlchen/tests/utils/data/binance_exchange_info.json`

Rotki's implementation confirms the official API shape:

- It signs Binance requests with `X-MBX-APIKEY`, a timestamp, and an HMAC
  signature.
- It reads `exchangeInfo` to map `symbol` to base and quote assets.
- It uses selected trade pairs for `myTrades`; querying all possible symbols is
  too expensive and too noisy.
- It treats `isBuyer` as the trade direction, `qty` as base quantity, `price` as
  quote price, and `commission` plus `commissionAsset` as fee evidence.
- It queries spot balances, funding balances, simple earn positions, futures,
  and pool balances separately.
- It chunks deposit and withdrawal API history with an 89-day window and convert
  trade history with a 30-day window.
- It treats Binance CSV exports as timestamp groups with operation labels rather
  than independent rows.

## Recommended Scope

Start with Binance.com, not Binance US. Binance US should be a separate source
or capability flag because Rotki and Binance docs show endpoint coverage
differences, especially around convert and broader wallet products.

Phase 1 should cover a conservative spot-wallet source:

- signed Binance REST client
- spot account live balances from `GET /api/v3/account`
- symbol metadata from `GET /api/v3/exchangeInfo`
- spot trades from `GET /api/v3/myTrades`
- crypto deposits from `GET /sapi/v1/capital/deposit/hisrec`
- crypto withdrawals from `GET /sapi/v1/capital/withdraw/history`
- convert trades from `GET /sapi/v1/convert/tradeFlow`, only when available
- universal transfers as explicit evidence, not balance-impacting postings, in
  the first implementation

Defer these until raw data proves they are needed:

- funding-wallet balance parity
- earn balance categories and reward journals
- futures, margin, and pool balances
- fiat deposits, fiat withdrawals, and fiat card or payment flows
- Binance CSV import
- Binance US support

The key open decision is balance scope. If live reference uses spot balances
only, then transfers between spot and funding accounts must be represented or
diagnosed so users understand why spot balance changed without external cash
flow. If live reference aggregates spot plus funding, then funding wallet
balances and transfer history must be imported together. Phase 1 should pick
spot-only because it is testable with the official spot account endpoint and
does not require new ledger balance categories.

## API Client Shape

Add a Binance exchange client under:

- `packages/exchange-providers/src/exchanges/binance/client.ts`
- `packages/exchange-providers/src/exchanges/binance/contracts.ts`
- `packages/exchange-providers/src/exchanges/binance/index.ts`
- `packages/exchange-providers/src/exchanges/binance/__tests__/client.test.ts`

Register it through the existing exchange client factory after the client has
focused tests.

Client responsibilities:

1. Build signed requests with sorted query/body parameters, `timestamp`,
   `recvWindow`, and HMAC-SHA-256 `signature`.
2. Attach `X-MBX-APIKEY`.
3. Query server time through `GET /api/v3/time` and maintain a clock offset.
4. Fetch `exchangeInfo` and cache `symbol -> { baseAsset, quoteAsset }`.
5. Fetch account balances from `GET /api/v3/account` with
   `omitZeroBalances=true` when possible.
6. Fetch trades by configured symbol list through `GET /api/v3/myTrades`.
7. Fetch deposits and withdrawals in less-than-90-day windows.
8. Fetch convert trades in 30-day windows when enabled.
9. Fetch universal transfers only for diagnostics unless the balance scope
   decision changes.

Do not silently scan every symbol from `exchangeInfo` by default. Either require
configured Binance markets or derive a bounded symbol candidate set from known
raw data. If neither is available, return a recoverable error that explains why
spot trades cannot be queried accurately.

## Raw Schemas

Add provider-specific schemas under:

- `packages/ingestion/src/sources/exchanges/binance/schemas.ts`

Initial raw event types:

```ts
type BinanceRawEvent =
  | BinanceSpotTradeRaw
  | BinanceDepositRaw
  | BinanceWithdrawalRaw
  | BinanceConvertTradeRaw
  | BinanceUniversalTransferRaw;
```

Expected minimum fields:

- `BinanceSpotTradeRaw`: `symbol`, `id`, `orderId`, `price`, `qty`,
  `quoteQty`, `commission`, `commissionAsset`, `time`, `isBuyer`, `isMaker`.
- `BinanceDepositRaw`: `id`, `amount`, `coin`, `network`, `status`, `address`,
  `txId`, `insertTime`, optional `completeTime`, `transferType`, `walletType`.
- `BinanceWithdrawalRaw`: `id`, `amount`, `transactionFee`, `coin`, `status`,
  `address`, `txId`, `applyTime`, optional `completeTime`, `network`,
  `transferType`, `walletType`, `withdrawOrderId`.
- `BinanceConvertTradeRaw`: `quoteId`, `orderId`, `orderStatus`, `fromAsset`,
  `fromAmount`, `toAsset`, `toAmount`, `ratio`, `inverseRatio`, `createTime`.
- `BinanceUniversalTransferRaw`: `asset`, `amount`, `type`, `status`,
  `tranId`, `timestamp`.

Status filtering:

- deposits materialize only successful/credited rows
- withdrawals materialize only completed rows
- convert trades materialize only `SUCCESS`
- universal transfers materialize no postings in phase 1 and should preserve
  rows for diagnostics

Unexpected status values must produce diagnostics or warnings, not silent
skips.

## Normalization

Add Binance source files under:

- `packages/ingestion/src/sources/exchanges/binance/normalize-provider-event.ts`
- `packages/ingestion/src/sources/exchanges/binance/build-correlation-groups.ts`
- `packages/ingestion/src/sources/exchanges/binance/interpret-group.ts`
- `packages/ingestion/src/sources/exchanges/binance/processor-v2.ts`
- `packages/ingestion/src/sources/exchanges/binance/register.ts`

Stable provider event keys:

- spot trade: `spot-trade:${symbol}:${id}`
- deposit: `deposit:${id || txId}`
- withdrawal: `withdrawal:${id || txId}`
- convert trade: `convert:${orderId || quoteId}`
- universal transfer: `universal-transfer:${tranId}`

Correlation:

- Spot `myTrades` rows are already one fill each. Each fill can become one
  source activity and one trade journal.
- Deposits and withdrawals are one source activity each.
- Convert trade rows are one source activity and one trade journal.
- Universal transfer rows are one source activity with diagnostics in phase 1.

CSV imports should not reuse this grouping directly. Rotki's CSV importer
confirms that Binance CSV exports are timestamp groups with operation labels
such as `Transaction Buy`, `Transaction Spend`, `Transaction Fee`, `Binance
Convert`, `Small assets exchange BNB`, `Deposit`, `Withdraw`, `Distribution`,
and `Simple Earn` operations. Treat CSV support as a separate follow-up so API
semantics do not get distorted by export-specific grouping rules.

## Interpretation

Spot trade:

- Read base and quote assets from `exchangeInfo`.
- If `isBuyer` is true:
  - positive base principal posting for `qty`
  - negative quote principal posting for `quoteQty` or `qty * price`
- If `isBuyer` is false:
  - negative base principal posting for `qty`
  - positive quote principal posting for `quoteQty` or `qty * price`
- Add one balance-settled fee posting when `commission > 0`.
- Fee asset comes from `commissionAsset`; do not infer that it is either base
  or quote.
- Source components should distinguish fill evidence from fee evidence.

Deposit:

- Emit a transfer journal with one positive liquid principal posting.
- Preserve `txId`, `address`, `network`, `walletType`, and `transferType` as
  source metadata and diagnostics.
- Do not derive chain-native asset identity from `coin` or `network`.

Withdrawal:

- Emit a transfer journal with one negative liquid principal posting for
  `amount`.
- Emit a negative fee posting for `transactionFee` when positive.
- Rotki models withdrawal amount and fee separately. Confirm with real Binance
  raw data whether Binance's live spot balance delta is `amount + fee`; if so,
  the v2 liquid balance impact must include both postings.
- Preserve `txId`, `address`, `network`, `walletType`, and `transferType` as
  source metadata and diagnostics.

Convert trade:

- Emit a trade journal with one negative principal posting for `fromAmount` and
  one positive principal posting for `toAmount`.
- Use `orderId` as the preferred group identity, falling back to `quoteId`.
- Do not invent a fee posting unless raw data supplies fee evidence.

Universal transfer:

- In phase 1, do not emit liquid postings because this is internal movement
  between Binance account scopes.
- Preserve the event as source evidence and attach a diagnostic explaining that
  scope-level balance categories are deferred.
- If later balance references become scope-aware, map transfer `type` values to
  source and destination scopes instead of skipping the balance effect.

Earn, margin, futures, and pool events:

- Defer until the ledger balance model can represent the relevant category or
  account scope cleanly.
- Do not collapse earn/futures balances into liquid spot balance just to reach a
  total.

## Tests

Focused unit tests should land before live validation:

- signed request canonicalization and HMAC fixture
- account balance parsing with free plus locked
- exchangeInfo symbol mapping
- buy spot trade with fee in base asset
- buy spot trade with fee in quote asset
- buy or sell spot trade with fee in BNB
- deposit materialization and metadata retention
- withdrawal materialization with separate fee posting
- convert materialization
- universal transfer diagnostic-only behavior
- unexpected status diagnostics
- market selection error when no configured symbols are available

Imported-corpus validation should mirror Kraken, Coinbase, and KuCoin once raw
Binance data is available:

- raw rows imported
- legacy transaction count, if a legacy importer exists
- ledger-v2 draft count
- v2 balance rows by asset
- v1-v2 diffs, if v1 exists
- v2-live spot balance diffs
- explicit list of skipped or diagnostic-only event classes

Because Binance would be a first implementation in this repo, v1-v2 parity is
not always available. In that case, require v2 self-consistency plus live spot
balance reconciliation against an imported period that fully covers current
spot balances.

## Acceptance

- Binance client can fetch signed account, trade, deposit, withdrawal, and
  convert data without using ccxt-specific abstractions.
- Source activity stable keys are deterministic and provider-specific.
- Spot trade postings reconcile exactly from raw quantities and fees.
- Withdrawal postings preserve both principal and fee impact.
- On-chain deposit/withdrawal metadata is retained without guessing chain-native
  asset identity.
- Universal transfers are visible as evidence, not silently lost.
- Spot-only live reconciliation is documented as spot-only and does not claim
  funding, earn, futures, margin, or pool parity.
- Unsupported wallet scopes produce clear diagnostics or explicit deferred
  statuses.

## Open Questions

- Should Binance market symbols be configured by the user, derived from prior
  imports, or both?
- Should the importer support Binance CSV before API, given that CSV can cover
  more historical wallet operations but needs a different grouping model?
- Should funding-wallet balances be included in the first live reference, or is
  spot-only parity enough for the first pass?
- How should `walletType` and universal transfer `type` values map into future
  exchange balance scopes?
- Do user exports include transaction fees for deposits or internal withdrawals
  that the API does not expose?

## Decisions

- Start with Binance.com API and spot-only live reconciliation.
- Treat Binance US as a later source/capability split.
- Require a bounded market list for `myTrades`; do not query every symbol by
  default.
- Preserve exchange-scoped asset identity and network evidence separately.
- Keep universal transfers as evidence-only until scope-aware exchange balances
  are implemented.
- Keep CSV import separate from API import because Binance CSV rows encode
  higher-level grouped operations.

## Smells To Watch

- Spot-only live reconciliation can hide funding or earn assets. The UI and CLI
  text must say spot-only when that is what is being compared.
- Binance `myTrades` can miss history if the configured market list is
  incomplete. This is a user-visible data coverage issue, not a parser issue.
- Withdrawal fee semantics must be proven with raw provider data before claiming
  exact live parity.
- Binance network strings are tempting but insufficient for asset identity.
  They should remain metadata until cross-source linking can confirm chain
  evidence.
