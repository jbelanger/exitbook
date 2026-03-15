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
- `--output` points to a package directory or package path prefix
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

export async function exportTaxPackage(
  input: ExportTaxPackageInput,
  deps: {
    writer: ITaxPackageFileWriter;
    now: () => Date;
  }
): Promise<Result<TaxPackageExportResult, Error>>;
```

The file writer is the only required infrastructure port for the export step.

## Readiness Model

`tax-package` should not behave like a convenience dump.
It should declare whether the package is suitable for preparer use.

Proposed package statuses:

- `ready`
- `review_required`
- `blocked`

Proposed issue classes:

- `MISSING_PRICE_DATA`
- `PARTIAL_SCOPE`
- `UNSUPPORTED_METHOD_FOR_JURISDICTION`
- `FX_FALLBACK_USED`
- `UNRESOLVED_ASSET_REVIEW`
- `UNKNOWN_TRANSACTION_CLASSIFICATION`
- `INCOMPLETE_TRANSFER_LINKING`

Rules:

- `blocked` means export fails or emits only a manifest explaining why the
  package cannot be used.
- `review_required` means export succeeds with explicit review items.
- `ready` means no known blocking or review issues remain under the current
  ruleset.

We should never silently hide readiness problems.

## Scope Rules

`tax-package` should be stricter than normal `cost-basis`.

Initial rules:

- require a full filing scope for the selected jurisdiction and tax year
- reject `--asset`
- reject custom partial date windows in v1
- reject unsupported method and jurisdiction combinations when the package is
  meant to support filing

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
- `generatedAt`
- `method`
- `taxCurrency`
- `reviewItems`
- `blockingIssues`
- `artifactIndex`

The manifest should identify every generated file with logical purpose, not
just filename.

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
- review items
- audit manifest

### US

US package likely needs:

- summary
- line-by-line disposals
- short-term and long-term grouping
- acquisition context for each disposal
- transfer appendix where relevant
- review items
- audit manifest

US will likely need more shaping work than Canada because the current generic
pipeline is less explicitly modeled as a filing artifact.

## Output Files

Phase 1 should be multi-file and text-first.

Candidate file set:

- `manifest.json`
- `summary.json`
- `summary.csv`
- `dispositions.csv`
- `review-items.csv`
- `report.md`

Canada-specific files:

- `acquisitions.csv`
- `transfers.csv`
- `superficial-loss-adjustments.csv`

US-specific files:

- `lots.csv`
- `transfers.csv`

We should not block the feature on PDF.
If we add PDF later, it should render from the same domain-owned report model.

## Host Integration

The CLI host should reuse the existing cost-basis execution path to obtain a
`CostBasisWorkflowResult`, then hand that result to the export capability.

Expected host flow:

1. parse export flags
2. build cost-basis input
3. execute or reuse the current stored artifact
4. construct the concrete file writer
5. call `exportTaxPackage(...)`
6. print paths and readiness status

This keeps the host thin while still letting the domain own the export package.

## Suggested Package Structure

Candidate module layout:

- `packages/accounting/src/cost-basis/export/tax-package-types.ts`
- `packages/accounting/src/cost-basis/export/tax-package-review-gate.ts`
- `packages/accounting/src/cost-basis/export/tax-package-render-model.ts`
- `packages/accounting/src/cost-basis/export/tax-package-exporter.ts`
- `packages/accounting/src/cost-basis/export/canada-tax-package-builder.ts`
- `packages/accounting/src/cost-basis/export/us-tax-package-builder.ts`

CLI side:

- `apps/cli/src/features/cost-basis/command/cost-basis-export.ts`

## Phase Plan

### Phase 1

- dev/spec docs
- command surface
- domain package contract
- readiness gate
- JSON/CSV/Markdown package output
- Canada and US support

### Phase 2

- HTML and PDF rendering
- print-friendly cover sheet
- reconciliation appendix
- better accountant-facing narrative formatting

### Phase 3

- package validation tooling
- machine-readable downstream integrations
- import adapters for external tax software if justified

## Open Questions

- Should `blocked` prevent all file output, or should we still emit a manifest
  plus issue report?
- Should `review_required` be considered a successful exit code or a special
  non-zero code?
- Should `--output` always mean directory for `tax-package`, even if other
  export commands treat it as a single file path?
- Do we want one common `report.md` format across jurisdictions, or
  jurisdiction-owned markdown templates?
- How much of the package schema should be shared versus jurisdiction-specific?

## Current Leaning

- Keep tax-package assembly in the domain.
- Pass in only a file-writer port from the host.
- Make Canada the first high-confidence package because the domain model is
  already closer to filing language.
- Keep PDF out of the first delivery unless it falls out naturally from the
  render model.
