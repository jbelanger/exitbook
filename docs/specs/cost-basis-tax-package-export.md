---
last_verified: 2026-03-15
status: canonical
---

# Cost Basis Tax Package Export Specification

> ⚠️ **Code is law**: If this document disagrees with implementation, the implementation is correct and this spec must be updated.

Defines the `exitbook cost-basis export --format tax-package` feature. This spec covers scope validation, readiness classification, package assembly, manifest and CSV contracts, and the CLI/accounting boundary for tax-package export.

## Quick Reference

| Concept          | Key Rule                                                                                   |
| ---------------- | ------------------------------------------------------------------------------------------ |
| Intent           | `tax-package` is a filing-support artifact, not a generic dump of current CLI state        |
| Jurisdictions    | v1 supports only `CA` and `US`                                                             |
| Scope            | Export requires the full default tax-year scope; no `--asset`, no custom date windows      |
| Readiness        | Package status is `ready`, `review_required`, or `blocked`                                 |
| Blocked behavior | A blocked package still writes a minimal package with `manifest.json`, `report.md`, issues |
| Manifest         | `manifest.json` is the stable machine-readable contract and artifact index                 |
| Facts seam       | Export builders consume `CostBasisFilingFacts`, not export-specific row-fact types         |
| File writing     | Accounting builds files; the CLI provides the writer and maps status to exit behavior      |

## Goals

- **Filing-support export**: Produce a jurisdiction-aware package meant for preparer review, not exploratory browsing.
- **Deterministic contract**: Emit stable files, stable row refs, and a manifest that identifies every generated artifact.
- **Explicit readiness**: Export must surface blocking and review issues instead of silently degrading.
- **Accounting-owned assembly**: Package selection, readiness, and rendering stay inside the cost-basis export capability rather than the CLI host.

## Non-Goals

- Building a full tax return, e-file package, or tax interview workflow.
- Supporting arbitrary partial scopes in v1.
- Claiming unsupported downstream filing placement such as Form 8949 box assignment.
- Making PDF the critical path.
- Letting the domain write files directly to disk.

## Definitions

### Tax Package Scope

```ts
interface TaxPackageValidatedScope {
  config: Pick<ValidatedCostBasisConfig, 'startDate' | 'endDate' | 'jurisdiction' | 'method' | 'taxYear'>;
  filingScope: 'full_tax_year';
  requiredStartDate: Date;
  requiredEndDate: Date;
}
```

Semantics:

- the package always targets the jurisdiction’s default tax-year date range
- a validated scope is a precondition for readiness evaluation and package rendering

### Readiness Result

```ts
type TaxPackageStatus = 'ready' | 'review_required' | 'blocked';

interface TaxPackageIssue {
  code: TaxPackageIssueCode;
  severity: 'review' | 'blocked';
  summary: string;
  details: string;
  affectedArtifact?: string | undefined;
  affectedRowRef?: string | undefined;
  recommendedAction?: string | undefined;
}
```

Readiness is package state, not transport failure:

- `ready`: no known review or blocking issues
- `review_required`: export succeeds with explicit review items
- `blocked`: export succeeds, writes a minimal package, and marks the dataset unusable for filing under current rules

### Build Context

```ts
interface TaxPackageBuildContext {
  artifactRef: {
    calculationId: string;
    scopeKey: string;
    snapshotId?: string | undefined;
  };
  workflowResult: CostBasisWorkflowResult;
  sourceContext: {
    transactionsById: Map<number, UniversalTransactionData>;
    accountsById: Map<number, Account>;
    confirmedLinksById: Map<number, TransactionLink>;
  };
}
```

This is the validated adapter context used by jurisdiction builders. It includes source facts for label and traceability work that do not belong in `CostBasisFilingFacts`.

## Behavioral Rules

### CLI Host Flow

The CLI host is intentionally thin:

1. parse and validate CLI flags
2. build `CostBasisInput`
3. validate tax-package scope
4. execute `CostBasisHandler.executeArtifactWithContext(...)`
5. build `TaxPackageBuildContext`
6. derive readiness metadata
7. call `exportTaxPackage(...)`
8. print output paths and package status
9. map `blocked` to `ExitCodes.BLOCKED_PACKAGE`

The CLI owns:

- flag parsing
- output-directory resolution
- file-writer implementation
- exit-code mapping

Accounting owns:

- scope validation rules
- readiness evaluation
- filing-facts construction
- jurisdiction package assembly
- manifest and report content

### Scope Validation

`validateTaxPackageScope(...)` enforces request validity before export execution.

Rules:

- supported jurisdictions are `CA` and `US` only
- Canada requires `average-cost`
- US rejects `average-cost`
- `--asset` is rejected
- custom `--start-date` / `--end-date` windows are rejected
- the effective date range must equal the jurisdiction’s full default tax-year range

Invalid export requests:

- do not produce a package
- do not enter readiness evaluation
- fail as validation errors rather than blocked packages

### Readiness Evaluation

`evaluateTaxPackageReadiness(...)` is pure logic over the validated scope, workflow result, and derived readiness metadata.

Current issue codes:

- `MISSING_PRICE_DATA` → `blocked`
- `UNRESOLVED_ASSET_REVIEW` → `blocked`
- `UNKNOWN_TRANSACTION_CLASSIFICATION` → `blocked`
- `FX_FALLBACK_USED` → `review`
- `INCOMPLETE_TRANSFER_LINKING` → `review`

Metadata derivation rules:

- `fxFallbackCount` comes from display-report FX fallback markers on standard workflow reports
- `incompleteTransferLinkCount` comes from non-confirmed-link standard transfers or incomplete Canada transfer linkage
- `unknownTransactionClassificationCount` comes from retained transactions with unresolved classification notes
- `unresolvedAssetReviewCount` counts in-scope assets still blocked by asset review

### Export Pipeline

`exportTaxPackage(...)` performs the shared orchestration:

1. evaluate readiness
2. build `CostBasisFilingFacts` from the workflow artifact
3. dispatch to `buildCanadaTaxPackage(...)` or `buildUsTaxPackage(...)`
4. compute manifest artifact-index hashes
5. hand files to `ITaxPackageFileWriter.writeAll(...)`
6. return written file metadata plus final manifest and status

Error semantics:

- render and writer failures return `Err(...)`
- `blocked` is not an error; it is a successful export with unusable readiness status

### File Writer Boundary

Accounting never writes files directly.

The CLI-side writer:

- receives `TaxPackageFile[]`
- writes files atomically
- computes written file metadata
- removes stale managed v1 package files that are no longer part of the current export

Managed v1 files:

- `manifest.json`
- `report.md`
- `dispositions.csv`
- `transfers.csv`
- `acquisitions.csv`
- `lots.csv`
- `issues.csv`
- `superficial-loss-adjustments.csv`
- `source-links.csv`

### Source Coverage

Before package assembly, `buildTaxPackageBuildContext(...)` validates that the source context contains the transactions, accounts, and confirmed links required by the workflow artifact.

This preserves the boundary:

- filing facts stay source-label independent
- export builders still fail closed if required adapter traceability is missing

## Package Contract

### Manifest

Every package includes `manifest.json` with:

```ts
interface TaxPackageManifest {
  packageKind: 'tax-package';
  packageVersion: 1;
  packageStatus: 'ready' | 'review_required' | 'blocked';
  jurisdiction: CostBasisJurisdiction;
  taxYear: number;
  calculationId: string;
  snapshotId?: string | undefined;
  scopeKey: string;
  generatedAt: string;
  method: CostBasisMethod;
  taxCurrency: string;
  summaryTotals: {
    totalProceeds: string;
    totalCostBasis: string;
    totalGainLoss: string;
    totalTaxableGainLoss: string;
  };
  reviewItems: readonly TaxPackageIssue[];
  blockingIssues: readonly TaxPackageIssue[];
  artifactIndex: readonly TaxPackageArtifactIndexEntry[];
}
```

Artifact index entries include:

- `logicalName`
- `relativePath`
- `mediaType`
- `purpose`
- optional `rowCount`
- optional `sha256`

The manifest `artifactIndex` is backfilled with file hashes after the jurisdiction builder produces the package files.

### Human Report

Every package includes `report.md`.

The report contains:

- package status
- generated time
- jurisdiction, tax year, method, and tax currency
- summary totals
- blocking and review issue counts
- detailed issue sections
- included-file descriptions
- filing notes

Shared filing notes always include:

- dates use `YYYY-MM-DD`
- spreadsheet tools may need explicit date formatting
- taxable transfer or network-fee disposals appear in `dispositions.csv`, while non-taxable internal carryovers appear in `transfers.csv`

## Common CSV Rules

### Formatting

Rules shared across package CSVs:

- tax-currency money renders as fixed 2-decimal strings
- quantities and other measures use `Decimal.toFixed()` semantics with trailing zero trimming
- dates render as `YYYY-MM-DD`
- optional non-applicable values render as empty strings
- package-local refs use deterministic prefixes such as `DISP-0001`, `LOT-0001`, `XFER-0001`, `ISSUE-0001`

### Account Labels

Account labels are human-facing:

- when a source name is unique in the package, use `sourceName`
- when multiple accounts share a source name, use `sourceName (identifier)`

### Issues CSV

`issues.csv` is emitted only when issues exist.

Columns:

- `issue_ref`
- `code`
- `severity`
- `summary`
- `details`
- `affected_artifact`
- `affected_row_ref`
- `recommended_action`

Rows sort by:

- severity (`blocked` before `review`)
- `code`
- `affected_artifact`
- `affected_row_ref`

### Source Links CSV

`source-links.csv` is emitted only when source references are available.

Columns:

- `package_ref`
- `package_artifact`
- `source_type`
- `source_venue_label`
- `source_account_label`
- `source_reference`
- `source_reference_kind`
- `source_url`

Purpose:

- preserve audit traceability without leaking raw transaction identifiers into the primary accountant-facing CSVs

## US Package Contract

### File Set

Ready US package:

- `manifest.json`
- `report.md`
- `dispositions.csv`
- `transfers.csv`
- `lots.csv`
- optional `issues.csv`
- optional `source-links.csv`

Blocked US package:

- `manifest.json`
- `report.md`
- `issues.csv` when issues exist

### `dispositions.csv`

Columns:

- `disposition_ref`
- `disposition_group`
- `asset`
- `account_label`
- `date_disposed`
- `quantity_disposed`
- `proceeds_gross`
- `selling_expenses`
- `net_proceeds`
- `cost_basis`
- `gain_loss`
- `tax_currency`
- `date_acquired`
- `holding_period_days`
- `tax_treatment`
- `lot_ref`

Semantics:

- one row per matched lot on a disposition
- `disposition_ref` is the row identity
- `disposition_group` groups rows from the same underlying disposal event
- `tax_treatment` comes from the shared filing-facts seam
- downstream Form 8949 placement is intentionally omitted

Sort order:

- `tax_treatment` (`short_term`, then `long_term`, then anything else)
- `date_disposed`
- `date_acquired`
- `asset`
- filing-fact id

### `transfers.csv`

Columns:

- `transfer_ref`
- `asset`
- `date_transferred`
- `transfer_status`
- `transfer_direction`
- `source_account_label`
- `target_account_label`
- `quantity_transferred`
- `cost_basis_carried`
- `tax_currency`
- `cost_basis_per_unit`
- `basis_source`
- `source_lot_ref`

Semantics:

- `transfer_direction` is always `internal_transfer` in the current US package
- `transfer_status` is `verified` for confirmed-link provenance and `review_needed_inbound` otherwise
- `basis_source` currently always renders as `lot_carryover`
- `cost_basis_carried` includes any same-asset fee basis amount capitalized into the transfer

Sort order:

- `date_transferred`
- `asset`
- filing-fact id

### `lots.csv`

Columns:

- `lot_ref`
- `asset`
- `account_label`
- `date_acquired`
- `origin_period`
- `quantity_acquired`
- `cost_basis_per_unit`
- `total_cost_basis`
- `remaining_quantity`
- `lot_status`
- `tax_currency`

Semantics:

- this is the US lot-identity appendix
- includes both open lots and fully disposed lots needed to explain the filing-year result
- `origin_period` distinguishes carry-in support rows from current-year acquisitions

Sort order:

- `date_acquired`
- `asset`
- filing-fact id

### US Filing Notes

The current US report explicitly documents that:

- the package intentionally omits downstream Form 8949 box placement and adjustment-code mapping
- `tax_treatment` comes from the canonical filing-facts seam
- `basis_source` stays `lot_carryover` even when the carried amount includes same-asset fee basis
- `lots.csv` is the lot-identity appendix for disposition auditability

## Canada Package Contract

### File Set

Ready Canada package:

- `manifest.json`
- `report.md`
- `dispositions.csv`
- `transfers.csv`
- `acquisitions.csv`
- optional `issues.csv`
- optional `superficial-loss-adjustments.csv`
- optional `source-links.csv`

Blocked Canada package:

- `manifest.json`
- `report.md`
- `issues.csv` when issues exist

### `dispositions.csv`

Columns:

- `disposition_ref`
- `disposition_group`
- `asset`
- `account_label`
- `date_disposed`
- `quantity_disposed`
- `proceeds_gross`
- `selling_expenses`
- `net_proceeds`
- `cost_basis`
- `gain_loss`
- `tax_currency`
- `acb_per_unit`
- `denied_loss`
- `taxable_gain_loss`

Semantics:

- `proceeds_gross` and `selling_expenses` are reconstructed at export time from `inputContext`
- `net_proceeds` is the Canada filing-facts proceeds amount
- `denied_loss` is blank when zero

Sort order:

- `date_disposed`
- `asset`
- filing-fact id

### `transfers.csv`

Columns:

- `transfer_ref`
- `asset`
- `date_transferred`
- `transfer_status`
- `transfer_direction`
- `source_account_label`
- `target_account_label`
- `quantity_transferred`
- `cost_basis_carried`
- `tax_currency`
- `carried_acb_per_unit`
- `fee_acb_adjustment`

Semantics:

- `transfer_direction` is `deposit`, `withdrawal`, or `internal_transfer`
- `transfer_status` is `verified` only when linked transfer context is complete; otherwise it is `review_needed_inbound` or `review_needed_outbound`

Sort order:

- `date_transferred`
- `asset`
- filing-fact id

### `acquisitions.csv`

Columns:

- `acquisition_ref`
- `asset`
- `account_label`
- `date_acquired`
- `origin_period`
- `quantity_acquired`
- `total_cost_basis`
- `cost_basis_per_unit`
- `remaining_quantity`
- `remaining_acb`
- `tax_currency`

Semantics:

- this is a Canada pooled-ACB support appendix, not a running transaction ledger
- includes acquisition layers needed to explain the filing-year result, including carry-in support rows

Sort order:

- `date_acquired`
- `asset`
- filing-fact id

### `superficial-loss-adjustments.csv`

Columns:

- `adjustment_ref`
- `asset`
- `date_disposed`
- `replacement_acquisition_date`
- `denied_loss`
- `denied_quantity`
- `related_disposition_ref`
- `substituted_acquisition_ref`
- `tax_currency`

Semantics:

- uses package-local refs rather than raw Canada event ids
- ties each denied loss back to the triggering disposition and substituted acquisition

Sort order:

- adjustment date
- `asset`
- filing-fact id

### Canada Filing Notes

The current Canada report explicitly documents that:

- the package applies the current Canada capital-gains inclusion rate
- `dispositions.csv` keeps gross proceeds, selling expenses, and net proceeds explicit
- `acquisitions.csv` is a pooled ACB support appendix rather than a transaction ledger

## Invariants

- `manifest.json` and `report.md` are always present.
- A blocked package still writes a minimal artifact set explaining why the export cannot be used for filing.
- Account labels and source-link rows are adapter-level outputs, not filing-facts fields.
- Package-local refs are deterministic because builder sort order is part of the contract.
- US export does not emit guessed `form_8949_*` fields as core package facts.

## Edge Cases & Gotchas

- **Blocked is not failure**: Rendering a blocked package is a successful export path with a non-zero CLI exit code.
- **Stale file cleanup matters**: If a later export shrinks the package, the writer removes now-stale managed files such as a previous `dispositions.csv`.
- **Canada source dependency**: Canada export requires `inputContext` because some export-only fields are reconstructed from source events.
- **FX fallback is review-only**: FX fallback does not block export by itself; it produces `review_required`.

## Known Limitations (Current Implementation)

- v1 supports only `CA` and `US`.
- v1 rejects partial scopes and custom filing windows.
- v1 is text-first and does not generate PDF artifacts.
- US package intentionally omits downstream filing placement such as Form 8949 box mapping and adjustment-code mapping.
- `source_url` is currently blank in `source-links.csv` even though the column exists in the contract.

## Related Specs

- [Cost Basis Filing Facts](./cost-basis-filing-facts.md)
- [Cost Basis Orchestration](./cost-basis-orchestration.md)
- [Average Cost Basis](./average-cost-basis.md)
- [Transfers & Tax](./transfers-and-tax.md)
- [CLI Cost Basis View](./cli/cost-basis/cost-basis-view-spec.md)

---

_Last updated: 2026-03-15_
