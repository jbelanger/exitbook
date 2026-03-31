import { mkdir, unlink } from 'node:fs/promises';
import path from 'node:path';

import {
  buildTaxPackageBuildContext,
  deriveTaxPackageReadinessMetadata,
  exportTaxPackage,
  type TaxPackageExportResult,
  validateTaxPackageScope,
  type TaxPackageFile,
  type TaxPackageIssue,
  type WrittenTaxPackageFile,
} from '@exitbook/accounting/cost-basis';
import { err, ok, resultDoAsync, sha256Hex, wrapError, type Result } from '@exitbook/foundation';
import type { Command } from 'commander';

import {
  ExitCodes,
  type CliCommandResult,
  jsonSuccess,
  runCliRuntimeCommand,
  textSuccess,
  toCliResult,
  type CliCompletion,
} from '../../../cli/command.js';
import { detectCliOutputFormat, type CliOutputFormat, parseCliCommandOptionsResult } from '../../../cli/options.js';
import type { CliAppRuntime } from '../../../runtime/app-runtime.js';
import type { CommandRuntime } from '../../../runtime/command-runtime.js';
import { writeFilesWithAtomicRenames } from '../../shared/file-utils.js';

import { withCostBasisCommandScope } from './cost-basis-command-scope.js';
import type { ValidatedCostBasisConfig } from './cost-basis-handler.js';
import { CostBasisExportCommandOptionsSchema } from './cost-basis-option-schemas.js';
import { buildCostBasisInputFromFlags } from './cost-basis-utils.js';
import { runCostBasisArtifact } from './run-cost-basis.js';

interface CostBasisExportCommandResult {
  calculationId: string;
  outputDir: string;
  outputPaths: string[];
  packageStatus: 'blocked' | 'ready';
  snapshotId?: string | undefined;
}

interface CostBasisExportPreparedInput {
  outputDir: string;
  params: ValidatedCostBasisConfig;
  refresh?: boolean | undefined;
  scope: ReturnType<typeof validateTaxPackageScope> extends Result<infer T, Error> ? T : never;
}

const V1_TAX_PACKAGE_OUTPUT_FILES = new Set([
  'manifest.json',
  'report.md',
  'dispositions.csv',
  'transfers.csv',
  'acquisitions.csv',
  'lots.csv',
  'issues.csv',
  'superficial-loss-adjustments.csv',
  'source-links.csv',
]);

export function registerCostBasisExportCommand(costBasisCommand: Command, appRuntime: CliAppRuntime): void {
  costBasisCommand
    .command('export')
    .description('Export a jurisdiction-aware cost-basis filing package')
    .addHelpText(
      'after',
      `
Examples:
  $ exitbook cost-basis export --format tax-package --jurisdiction CA --tax-year 2024
  $ exitbook cost-basis export --format tax-package --jurisdiction CA --tax-year 2024 --output ./reports/2024-ca-tax-package
  $ exitbook cost-basis export --format tax-package --jurisdiction US --tax-year 2024 --output ./reports/2024-us-tax-package
`
    )
    .option('--format <type>', 'Export format', 'tax-package')
    .option('--jurisdiction <code>', 'Tax jurisdiction: CA, US')
    .option('--tax-year <year>', 'Tax year for calculation (e.g., 2024)')
    .option('--method <method>', 'Calculation method: fifo, lifo, specific-id, average-cost')
    .option('--asset <symbol>', 'Rejected for tax-package export; filing export requires full scope')
    .option('--refresh', 'Force recomputation and replace the latest stored snapshot for this scope')
    .option('--output <dir>', 'Output directory for the tax package')
    .option('--json', 'Output command metadata in JSON format')
    .action((_rawOptions: unknown, command: Command) =>
      executeCostBasisExportCommand(command.optsWithGlobals(), appRuntime)
    );
}

async function executeCostBasisExportCommand(rawOptions: unknown, appRuntime: CliAppRuntime): Promise<void> {
  const command = 'cost-basis-export';
  const format = detectCliOutputFormat(rawOptions);

  await runCliRuntimeCommand({
    command,
    format,
    appRuntime,
    prepare: async () =>
      resultDoAsync(async function* () {
        const options = yield* parseCliCommandOptionsResult(rawOptions, CostBasisExportCommandOptionsSchema);
        const params = yield* toCliResult(buildCostBasisInputFromFlags(options), ExitCodes.VALIDATION_ERROR);
        const scope = yield* toCliResult(
          validateTaxPackageScope({
            config: params,
            asset: options.asset,
          }),
          ExitCodes.VALIDATION_ERROR
        );

        const outputDir = resolveCostBasisExportOutputDir(options.output, buildDefaultOutputDir(params));
        await mkdir(outputDir, { recursive: true });

        return {
          outputDir,
          params,
          refresh: options.refresh,
          scope,
        };
      }),
    action: async (context) => executeCostBasisExportCommandResult(context.runtime, context.prepared, format),
  });
}

async function executeCostBasisExportCommandResult(
  ctx: CommandRuntime,
  prepared: CostBasisExportPreparedInput,
  format: CliOutputFormat
): Promise<CliCommandResult> {
  return resultDoAsync(async function* () {
    const artifactResult = yield* toCliResult(
      await withCostBasisCommandScope(ctx, { format, params: prepared.params }, (scope) =>
        runCostBasisArtifact(scope, prepared.params, { refresh: prepared.refresh })
      ),
      ExitCodes.GENERAL_ERROR
    );

    const buildContext = yield* toCliResult(
      buildTaxPackageBuildContext({
        artifact: artifactResult.artifact,
        sourceContext: artifactResult.sourceContext,
        scopeKey: artifactResult.scopeKey,
        snapshotId: artifactResult.snapshotId,
      }),
      ExitCodes.GENERAL_ERROR
    );

    const readinessMetadata = deriveTaxPackageReadinessMetadata({
      context: buildContext,
      assetReviewSummaries: artifactResult.assetReviewSummaries,
    });

    const exportResult = yield* toCliResult(
      await exportTaxPackage(
        {
          context: buildContext,
          readinessMetadata,
          scope: prepared.scope,
        },
        {
          now: () => new Date(),
          writer: new TaxPackageDirectoryWriter(prepared.outputDir),
        }
      ),
      ExitCodes.GENERAL_ERROR
    );

    return buildCostBasisExportCompletion(format, prepared.outputDir, exportResult);
  });
}

export class TaxPackageDirectoryWriter {
  constructor(private readonly outputDir: string) {}

  async writeAll(files: readonly TaxPackageFile[]): Promise<Result<WrittenTaxPackageFile[], Error>> {
    const outputFiles = files.map((file) => ({
      path: path.join(this.outputDir, file.relativePath),
      content: file.content,
    }));

    const writeResult = await writeFilesWithAtomicRenames(outputFiles);
    if (writeResult.isErr()) {
      return err(writeResult.error);
    }

    const staleFileCleanupResult = await removeStaleManagedTaxPackageFiles(
      this.outputDir,
      new Set(files.map((file) => file.relativePath))
    );
    if (staleFileCleanupResult.isErr()) {
      return err(staleFileCleanupResult.error);
    }

    try {
      return ok(
        files.map((file, index) => {
          const absolutePath = writeResult.value[index];
          if (!absolutePath) {
            throw new Error(`Missing output path for tax package file ${file.relativePath}`);
          }

          return {
            ...file,
            absolutePath,
            sha256: sha256Hex(file.content),
            bytesWritten: Buffer.byteLength(file.content, 'utf8'),
          };
        })
      );
    } catch (error) {
      return wrapError(error, 'Failed to write export files');
    }
  }
}

function buildDefaultOutputDir(params: ValidatedCostBasisConfig): string {
  return path.join('reports', `${params.taxYear}-${params.jurisdiction.toLowerCase()}-tax-package`);
}

function buildCostBasisExportCompletion(
  format: CliOutputFormat,
  outputDir: string,
  exportResult: TaxPackageExportResult
): CliCompletion {
  const response: CostBasisExportCommandResult = {
    calculationId: exportResult.artifactRef.calculationId,
    snapshotId: exportResult.artifactRef.snapshotId,
    packageStatus: exportResult.status,
    outputDir,
    outputPaths: exportResult.files.map((file) => file.absolutePath),
  };
  const exitCode = exportResult.status === 'blocked' ? ExitCodes.BLOCKED_PACKAGE : undefined;

  if (format === 'json') {
    return jsonSuccess(response, undefined, exitCode);
  }

  return textSuccess(() => {
    console.log(`Exported tax package to: ${outputDir}`);
    console.log(`Package status: ${exportResult.status}`);
    for (const line of buildTaxPackageStatusSummaryLines(exportResult, outputDir)) {
      console.log(line);
    }
    console.log('Files:');
    for (const file of exportResult.files) {
      console.log(`  - ${file.absolutePath}`);
    }
  }, exitCode);
}

export function resolveCostBasisExportOutputDir(
  requestedOutputDir: string | undefined,
  defaultOutputDir: string,
  env: NodeJS.ProcessEnv = process.env,
  cwd = process.cwd()
): string {
  const invocationCwd = env['INIT_CWD'];
  const baseDir = invocationCwd !== undefined && invocationCwd.trim().length > 0 ? invocationCwd : cwd;
  return path.resolve(baseDir, requestedOutputDir ?? defaultOutputDir);
}

export function buildTaxPackageStatusSummaryLines(
  exportResult: Pick<TaxPackageExportResult, 'manifest' | 'status'>,
  outputDir: string
): string[] {
  const reportPath = path.join(outputDir, 'report.md');
  const issuesPath = path.join(outputDir, 'issues.csv');

  switch (exportResult.status) {
    case 'ready':
      if (exportResult.manifest.warnings.length === 0) {
        return [];
      }

      return [
        'This package is filing-ready, but it includes warnings you should understand before filing.',
        ...renderIssueGroup('Warnings', exportResult.manifest.warnings),
        '',
        `Review ${reportPath} and ${issuesPath} for full details.`,
      ];
    case 'blocked': {
      const lines = [
        'This package was written for inspection, but it is not filing-ready.',
        ...renderIssueGroup('Blocking issues', exportResult.manifest.blockingIssues),
      ];

      if (exportResult.manifest.warnings.length > 0) {
        lines.push('', ...renderIssueGroup('Warnings', exportResult.manifest.warnings));
      }

      lines.push('', `Review ${reportPath} and ${issuesPath} for full details.`);
      return lines;
    }
  }
}

function renderIssueGroup(title: string, issues: readonly TaxPackageIssue[]): string[] {
  if (issues.length === 0) {
    return [`${title}: 0`];
  }

  return [`${title}: ${issues.length}`, ...issues.flatMap((issue) => renderIssueLines(issue))];
}

function renderIssueLines(issue: TaxPackageIssue): string[] {
  const lines = [`  - ${issue.code}: ${issue.summary}`, `    ${issue.details}`];
  if (issue.recommendedAction) {
    lines.push(`    Recommended action: ${issue.recommendedAction}`);
  }

  return lines;
}

async function removeStaleManagedTaxPackageFiles(
  outputDir: string,
  currentRelativePaths: ReadonlySet<string>
): Promise<Result<void, Error>> {
  try {
    await Promise.all(
      [...V1_TAX_PACKAGE_OUTPUT_FILES]
        .filter((relativePath) => !currentRelativePaths.has(relativePath))
        .map(async (relativePath) => {
          try {
            await unlink(path.join(outputDir, relativePath));
          } catch (error) {
            if (isFileNotFoundError(error)) {
              return;
            }

            throw error;
          }
        })
    );

    return ok(undefined);
  } catch (error) {
    return wrapError(error, 'Cost basis export failed');
  }
}

function isFileNotFoundError(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT';
}
