# Cost Basis Tax Package

Status: working draft

This note tracks the planned `cost-basis export --format tax-package` feature.
It is intentionally a development note, not a final product spec.

## Intent

`tax-package` is the filing-support artifact for the app.

The goal is not a generic export surface like "JSON or CSV from the current
screen." The goal is a jurisdiction-aware package that can support tax filing
or tax preparation workflows with:

- explicit totals
- line-by-line disposal records
- audit and FX context
- review and blocking issues
- stable multi-file output

The package shape should be selected from `--jurisdiction`.
The user should not need to specify a form name such as `us-8949`.

Implementation should start from the package contract and readiness logic, not
from CLI wiring. The CLI is a thin host for this feature, not its design center.

## Goals

- Add `cost-basis export --format tax-package` as a first-class command.
- Keep export assembly inside the cost-basis domain.
- Make the package stricter than exploratory `cost-basis` output.
- Produce a stable package contract with explicit readiness state.
- Support Canada and US first.
- Make file output multi-artifact and deterministic.

## Non-Goals

- Claiming "ready to file without review" for every dataset.
- Building a full tax return.
- Letting the CLI own tax-package assembly logic.
- Starting with PDF as the critical path.
- Supporting arbitrary partial scopes such as a single asset timeline as a
  filing package.

## Boundary To Keep

Tax-package export logic belongs in the cost-basis domain.

The CLI should:

- parse flags
- resolve output location
- construct the concrete writer
- call the domain export entrypoint
- print success or failure

The domain should own:

- package readiness rules
- jurisdiction-specific package selection
- package manifest and file set
- CSV/JSON/Markdown render models
- appendices and review sections
- deterministic logical file names

The domain should not write files directly.
Instead it should receive a file-writer port.

## Proposed Shape

### CLI Surface

```bash
pnpm run dev cost-basis export --format tax-package --jurisdiction CA --tax-year 2024
pnpm run dev cost-basis export --format tax-package --jurisdiction US --tax-year 2024 --output ./reports/2024-us-tax-package
```

Initial expectations:

- `--format` accepts `tax-package`
- `--jurisdiction` is required
- `--tax-year` is required
- `--output` points to a package directory
- `--json` remains CLI metadata output, not the package itself

### Domain Entry Point

The package should be exported from a cost-basis-owned module, likely under:

- `packages/accounting/src/cost-basis/export/`

Candidate entrypoint:

```ts
export interface ITaxPackageFileWriter {
  writeAll(files: readonly TaxPackageFile[]): Promise<Result<WrittenTaxPackageFile[], Error>>;
}

export interface TaxPackageFile {
  relativePath: string;
  content: string;
}

export interface ExportTaxPackageArtifactRef {
  calculationId: string;
  snapshotId: string;
  scopeKey: string;
}

export async function exportTaxPackage(
  input: ExportTaxPackageInput,
  deps: {
    writer: ITaxPackageFileWriter;
    now: () => Date;
  }
): Promise<Result<TaxPackageExportResult, Error>>;
```

The file writer is the only required infrastructure port for the export step.

Recommended behavior:

- `exportTaxPackage(...)` returns `Ok(...)` when package generation and writing
  succeed, even if the resulting package status is `blocked`
- render or write failures return `Err(...)`
- readiness is package state, not transport failure
- the CLI maps package status to exit code policy

Invalid export requests should be rejected before artifact reuse or rebuild.
Examples:

- partial-scope requests such as `--asset`
- unsupported filing-package method and jurisdiction combinations
- custom partial date windows in v1

Those are request-validation failures, not package readiness outcomes.
They should fail fast and should not write a package directory.

## Readiness Model

`tax-package` should not behave like a convenience dump.
It should declare whether the package is suitable for preparer use.

Proposed package statuses:

- `ready`
- `review_required`
- `blocked`

Proposed issue classes:

- `MISSING_PRICE_DATA`
- `FX_FALLBACK_USED`
- `UNRESOLVED_ASSET_REVIEW`
- `UNKNOWN_TRANSACTION_CLASSIFICATION`
- `INCOMPLETE_TRANSFER_LINKING`

Rules:

- `blocked` means a valid export request produced a minimal package that
  explains why the dataset cannot be used yet
- `review_required` means export succeeds with explicit review items.
- `ready` means no known blocking or review issues remain under the current
  ruleset.

We should never silently hide readiness problems.

Recommended exit behavior:

- `ready` exits `0`
- `review_required` exits `0`
- invalid export requests fail before package generation with a normal
  validation-style CLI error
- `blocked` writes the package, then exits non-zero because the export
  completed but the dataset is not filing-usable

Recommended v1 CLI mapping:

- add `ExitCodes.BLOCKED_PACKAGE = 12` as a dedicated non-zero exit code for
  this outcome
- keep `ExitCodes.VALIDATION_ERROR` for invalid flags and invalid export scope
  requests
- reserve `Err(...)` for infrastructure, rendering, or unexpected domain errors

The readiness gate should be pure logic:

- input: `CostBasisWorkflowResult`, export scope metadata, jurisdiction config
- output: `ready | review_required | blocked` with structured issue list
- no I/O

This makes the first PR small, deterministic, and test-heavy.

## Scope Rules

`tax-package` should be stricter than normal `cost-basis`.

Initial rules:

- require a full filing scope for the selected jurisdiction and tax year
- reject `--asset`
- reject custom partial date windows in v1
- reject unsupported method and jurisdiction combinations when the package is
  meant to support filing

These checks should happen before rendering work.
Where possible, they should happen before artifact reuse or rebuild so we do not
compute a workflow result for a request that can never produce a filing package.

These are request-validation rules, not readiness issues.
They should fail the command early rather than producing a `blocked` package.
If we want shared code names for preflight failures, `PARTIAL_SCOPE` and
`UNSUPPORTED_METHOD_FOR_JURISDICTION` belong here instead of in the readiness
issue list.

Example:

- Canada should not quietly produce an ACB support package from a non-ACB
  method while pretending it is filing-ready

## Package Contract

Every tax package should include a stable manifest.

Proposed core fields:

- `packageKind`
- `packageVersion`
- `packageStatus`
- `jurisdiction`
- `taxYear`
- `calculationId`
- `snapshotId`
- `scopeKey`
- `generatedAt`
- `method`
- `taxCurrency`
- `reviewItems`
- `blockingIssues`
- `artifactIndex`

The manifest should identify every generated file with logical purpose, not
just filename.

Issue records should use one shared schema across manifest and flat-file output.
Recommended minimum fields:

- `code`
- `severity`
- `summary`
- `details`
- `affectedArtifact`
- `affectedRowRef`

Traceability should distinguish:

- `calculationId`: the workflow calculation identifier embedded in lots, tax
  reports, and summaries
- `snapshotId`: the persisted latest-artifact snapshot identifier returned by
  `CostBasisArtifactService`
- `scopeKey`: the artifact cache key for the export scope

Recommended `artifactIndex` fields:

- `logicalName`
- `relativePath`
- `mediaType`
- `purpose`
- `rowCount` where applicable
- `sha256`

## Jurisdiction Ownership

Jurisdiction selects the package shape.

### Canada

Canada is the closest to a formal package already because the engine already
has:

- acquisitions
- dispositions
- transfers
- superficial loss adjustments
- denied loss totals
- CAD tax output

V1 Canada package should likely include:

- summary
- dispositions
- acquisitions appendix
- transfers appendix
- superficial loss adjustments appendix
- issues
- audit manifest

Canada should be the first builder because the current output already speaks tax
filing language closely enough that the package is mostly contract shaping and
readiness policy, not conceptual remapping.

### US

US package likely needs:

- summary
- line-by-line disposals
- short-term and long-term grouping
- acquisition context for each disposal
- transfer appendix where relevant
- issues
- audit manifest

US will likely need more shaping work than Canada because the current generic
pipeline is less explicitly modeled as a filing artifact.

## Output Files

Phase 1 should be multi-file and text-first.

V1 should stay intentionally small.
We should avoid emitting multiple representations of the same information unless
they serve different user jobs.

Core files across jurisdictions:

- `manifest.json`
- `report.md`
- `dispositions.csv`
- `transfers.csv`

Canada-default files:

- `acquisitions.csv`

US-default files:

- `lots.csv`

Conditional files:

- `issues.csv`
- `superficial-loss-adjustments.csv`

`blocked` should still emit at least:

- `manifest.json`
- `issues.csv`
- `report.md`

File roles:

- `report.md` is the human entrypoint and should contain readiness status,
  totals, issue summary, and a short explanation of each attached file
- `manifest.json` is the stable machine-readable contract and audit index
- `dispositions.csv` is the primary filing-support table
- `acquisitions.csv`, `transfers.csv`, and `lots.csv` are audit/support
  appendices worth keeping when they match the jurisdiction model closely and
  are low-cost to produce

What v1 should not do:

- emit both `summary.json` and `summary.csv`
- duplicate package summary data across multiple standalone files without a
  clear downstream consumer
- create jurisdiction-specific appendices that are always empty or rarely used

We should not block the feature on PDF.
If we add PDF later, it should render from the same domain-owned report model.

## CSV Contract

The CSVs should optimize for accountant use first and internal traceability
second.

That leads to four design rules:

- keep filing-support rows human-readable
- use one stable shared prefix where jurisdictions overlap
- use package-local cross-reference fields instead of leaking internal engine
  IDs into the contract
- keep raw source-system traceability out of v1 unless we intentionally add a
  separate support appendix for it

### Source References

Raw `transactionId`, `acquisitionTransactionId`, `disposalTransactionId`,
`taxPropertyKey`, and event IDs are useful inside the engine and CLI, but they
are not good primary contract columns for accountant-facing CSVs.

Recommendation:

- do not include raw transaction IDs in default package CSVs
- do not expose engine UUIDs or Canada event IDs directly as the exported row
  identity
- generate deterministic package-local row refs such as `DISP-0001`,
  `ACQ-0001`, `LOT-0001`, `XFER-0001`, and `SLA-0001`
- use those refs for cross-file links and for `issues.csv`

If we later need source-level audit export, add a separate optional appendix
such as `source-transactions.csv` or `source-links.csv` rather than mixing raw
transaction references into every filing-support table.

### Formatting Rules

- tax-currency monetary totals should be rendered as fixed 2-decimal strings
- quantity and other non-fiat precision fields should be rendered with
  `Decimal.toFixed()` semantics, without scientific notation and without an
  arbitrary 8dp cap
- per-unit monetary fields are audit values, not filing totals; they should
  preserve more precision than 2dp where needed
- the manifest declares the package tax currency, so CSV column names should be
  generic (`proceeds`, not `proceeds_cad`)

### Asset Labels

The `asset` column should be a user-facing label, not a raw internal key.

Recommendation:

- use the plain asset symbol when it is unique in the package
- if one symbol maps to multiple tax properties or asset identities in scope,
  use a collision-safe label that disambiguates them
- do not expose raw `taxPropertyKey` as a standalone default column unless we
  later add a more technical support appendix

### Sort Order

Sort order should be part of the contract so package-local refs are
deterministic.

Recommended defaults:

- Canada `dispositions.csv`: `date_disposed`, then `asset`, then
  `disposition_ref`
- US `dispositions.csv`: `tax_treatment` (`short_term`, then `long_term`),
  then `date_disposed`, then `date_acquired`, then `asset`, then
  `disposition_ref`
- `acquisitions.csv`: `date_acquired`, then `asset`, then `acquisition_ref`
- `lots.csv`: `date_acquired`, then `asset`, then `lot_ref`
- `transfers.csv`: `date_transferred`, then `asset`, then `transfer_ref`
- `superficial-loss-adjustments.csv`: `date_adjusted`, then `asset`, then
  `adjustment_ref`
- `issues.csv`: blocked rows first, then review rows, then `code`, then
  `affected_artifact`, then `affected_row_ref`

### dispositions.csv

This is the primary filing-support table.

Shared core columns:

- `disposition_ref`
- `asset`
- `date_disposed`
- `quantity_disposed`
- `proceeds`
- `cost_basis`
- `gain_loss`

Canada appended columns:

- `acb_per_unit`
- `denied_loss`
- `taxable_gain_loss`

US appended columns:

- `date_acquired`
- `holding_period_days`
- `tax_treatment`
- `lot_ref`

Notes:

- keep a stable shared prefix across jurisdictions
- denormalize US acquisition date from the matched lot onto the disposition row
- do not include raw transaction IDs in the default contract

### acquisitions.csv

Canada-default pool-support appendix.

Columns:

- `acquisition_ref`
- `asset`
- `date_acquired`
- `quantity_acquired`
- `total_cost`
- `cost_basis_per_unit`
- `remaining_quantity`
- `remaining_allocated_acb`

This file exists because Canada’s ACB model is pool-based and the acquisition
rows are meaningful filing support, not just engine internals.

### lots.csv

US-default lot inventory appendix.

Columns:

- `lot_ref`
- `asset`
- `date_acquired`
- `quantity_acquired`
- `cost_basis_per_unit`
- `total_cost_basis`
- `remaining_quantity`
- `status`
- `method`

Notes:

- this is a US-default file because individual lot identity is core to the
  standard workflow
- `quantity_acquired` is an intentional export name even though the source field
  is `AcquisitionLot.quantity`; the CSV should describe the original acquired
  lot quantity, while `remaining_quantity` describes the post-disposal balance
- `lot_ref` is the row identity exported in the package and should be the value
  referenced from `dispositions.csv`

### transfers.csv

Audit/support appendix shared by both jurisdiction families.

Shared columns:

- `transfer_ref`
- `asset`
- `date_transferred`
- `quantity_transferred`
- `cost_basis_carried`

Canada appended columns:

- `direction`
- `carried_acb_per_unit`
- `fee_adjustment`

US appended columns:

- `cost_basis_per_unit`
- `provenance`
- `source_lot_ref`

Notes:

- do not include source and target transaction IDs in the default contract
- transfer rows exist to explain basis carryover, not to reproduce the raw link
  graph

### superficial-loss-adjustments.csv

Canada-only conditional appendix.

Columns:

- `adjustment_ref`
- `asset`
- `date_adjusted`
- `denied_loss`
- `denied_quantity`
- `related_disposition_ref`
- `substituted_acquisition_ref`

This file should use package-local refs rather than raw Canada event IDs.

### issues.csv

Conditional file emitted only when issues exist.

Columns:

- `code`
- `severity`
- `summary`
- `details`
- `affected_artifact`
- `affected_row_ref`

`affected_row_ref` should reference package-local row refs such as
`DISP-0004` or `LOT-0002`.

## Host Integration

The CLI host should reuse the existing cost-basis execution path to obtain a
`CostBasisWorkflowResult`, then hand that result to the export capability.

Expected host flow:

1. parse export flags
2. run domain scope validation for `tax-package`
3. build cost-basis input
4. call `CostBasisArtifactService.execute(...)`
5. construct the concrete file writer
6. call `exportTaxPackage(...)`
7. print paths and readiness status
8. map package status to CLI exit code policy

This keeps the host thin while still letting the domain own the export package.

The artifact service already gives us the right seam:

- reuse vs rebuild stays in accounting
- tax-package export does not need its own cache policy
- manifest traceability can include `snapshotId`, `scopeKey`, and
  `calculationId`

The CLI file-writer implementation should either:

- stage writes into a temporary sibling directory and rename on success, or
- validate directory creation and writability before expensive rendering if full
  atomic replacement is not worth the complexity in v1

We should not spend time rendering a full package only to discover the target
directory is not writable.

## Suggested Package Structure

Candidate module layout:

- `packages/accounting/src/cost-basis/export/tax-package-types.ts`
- `packages/accounting/src/cost-basis/export/tax-package-review-gate.ts`
- `packages/accounting/src/cost-basis/export/tax-package-scope-validator.ts`
- `packages/accounting/src/cost-basis/export/tax-package-report-template.ts`
- `packages/accounting/src/cost-basis/export/tax-package-exporter.ts`
- `packages/accounting/src/cost-basis/export/canada-tax-package-builder.ts`
- `packages/accounting/src/cost-basis/export/us-tax-package-builder.ts`

CLI side:

- `apps/cli/src/features/cost-basis/command/cost-basis-export.ts`

## Phase Plan

### Phase 1

Types and readiness gate.

Recommended first PR:

- `tax-package-types.ts`
- `tax-package-review-gate.ts`
- `tax-package-scope-validator.ts`
- unit tests for status and issue classification

Deliverables:

- stable package/result types
- structured issue model
- pure readiness classification
- pure scope validation

### Phase 2

Canada builder.

Recommended second PR:

- `canada-tax-package-builder.ts`
- jurisdiction-owned CSV, JSON, and Markdown renderers inline with the builder
- shared `tax-package-report-template.ts` for common report envelope, with
  jurisdiction builders owning body sections
- package contract tests for deterministic file names and conditional file
  presence

Deliverables:

- first end-to-end jurisdiction package
- manifest generation
- blocked/review/ready package rendering

### Phase 3

Exporter orchestrator and CLI wiring.

Recommended third PR:

- `tax-package-exporter.ts`
- CLI `cost-basis-export.ts`
- filesystem writer implementation
- `ExitCodes.BLOCKED_PACKAGE` in the CLI host
- artifact-service reuse through `CostBasisArtifactService.execute(...)`

Deliverables:

- end-to-end command path
- exit-code policy
- output directory handling
- traceability fields populated from artifact execution

### Phase 4

US builder.

Recommended fourth PR:

- `us-tax-package-builder.ts`
- explicit short-term and long-term shaping
- lot-to-disposal acquisition context rules

Deliverables:

- second jurisdiction package
- validation that the common manifest contract is sufficient even when content
  files differ materially by jurisdiction

## Recommended Decisions

- Start from the contract layer, not the CLI.
- Keep one common manifest schema and let jurisdictions own content files.
- Treat `--output` as a directory for `tax-package`.
- Keep `report.md` structurally similar via a small shared template, while
  jurisdiction builders own their sections and narratives.
- Keep the default package small: one human entrypoint, one manifest, one
  primary detail CSV, plus a short list of genuinely useful appendices.
- Make `lots.csv` a US-default file rather than a rare conditional appendix.
- Include `sha256` in `artifactIndex` in v1.
- Add a dedicated `ExitCodes.BLOCKED_PACKAGE` now instead of overloading
  `ExitCodes.VALIDATION_ERROR`.
- Write a minimal package for `blocked` instead of failing silently or emitting
  nothing.
- Treat `review_required` as successful export with explicit issues.
- Keep PDF and external tax-software adapters out of the first delivery.

## Remaining Questions

None right now.
