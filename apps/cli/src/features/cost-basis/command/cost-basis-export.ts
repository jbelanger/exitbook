import { createHash } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';

import {
  buildTaxPackageBuildContext,
  exportTaxPackage,
  type ITaxPackageFileWriter,
  validateTaxPackageScope,
  type TaxPackageFile,
  type WrittenTaxPackageFile,
} from '@exitbook/accounting';
import { err, ok, type Result } from '@exitbook/core';
import type { AdapterRegistry } from '@exitbook/ingestion';
import type { Command } from 'commander';

import { displayCliError } from '../../shared/cli-error.js';
import { runCommand } from '../../shared/command-runtime.js';
import { ExitCodes } from '../../shared/exit-codes.js';
import { writeFilesAtomically } from '../../shared/file-utils.js';
import { outputSuccess } from '../../shared/json-output.js';
import { unwrapResult } from '../../shared/result-utils.js';
import { CostBasisExportCommandOptionsSchema } from '../../shared/schemas.js';
import { isJsonMode } from '../../shared/utils.js';

import type { CostBasisInput } from './cost-basis-handler.js';
import { createCostBasisHandler } from './cost-basis-handler.js';
import { buildCostBasisInputFromFlags } from './cost-basis-utils.js';

interface CostBasisExportCommandResult {
  calculationId: string;
  outputDir: string;
  outputPaths: string[];
  packageStatus: 'blocked' | 'ready' | 'review_required';
  snapshotId?: string | undefined;
}

export function registerCostBasisExportCommand(costBasisCommand: Command, registry: AdapterRegistry): void {
  costBasisCommand
    .command('export')
    .description('Export a jurisdiction-aware cost-basis filing package')
    .addHelpText(
      'after',
      `
Examples:
  $ exitbook cost-basis export --format tax-package --jurisdiction CA --tax-year 2024
  $ exitbook cost-basis export --format tax-package --jurisdiction CA --tax-year 2024 --output ./reports/2024-ca-tax-package
`
    )
    .option('--format <type>', 'Export format', 'tax-package')
    .option('--jurisdiction <code>', 'Tax jurisdiction: CA, US')
    .option('--tax-year <year>', 'Tax year for calculation (e.g., 2024)')
    .option('--method <method>', 'Calculation method: fifo, lifo, specific-id, average-cost')
    .option('--fiat-currency <currency>', 'Fiat currency for cost basis: USD, CAD, EUR, GBP')
    .option('--start-date <date>', 'Custom start date (YYYY-MM-DD, requires --end-date)')
    .option('--end-date <date>', 'Custom end date (YYYY-MM-DD, requires --start-date)')
    .option('--asset <symbol>', 'Rejected for tax-package export; filing export requires full scope')
    .option('--refresh', 'Force recomputation and replace the latest stored snapshot for this scope')
    .option('--output <dir>', 'Output directory for the tax package')
    .option('--json', 'Output command metadata in JSON format')
    .action((rawOptions: unknown) => executeCostBasisExportCommand(rawOptions, registry));
}

async function executeCostBasisExportCommand(rawOptions: unknown, registry: AdapterRegistry): Promise<void> {
  const isJson = isJsonMode(rawOptions);
  const parseResult = CostBasisExportCommandOptionsSchema.safeParse(rawOptions);
  if (!parseResult.success) {
    displayCliError(
      'cost-basis-export',
      new Error(parseResult.error.issues[0]?.message ?? 'Invalid options'),
      ExitCodes.INVALID_ARGS,
      isJson ? 'json' : 'text'
    );
  }

  const options = parseResult.data;

  try {
    const params = unwrapResult(buildCostBasisInputFromFlags(options));
    const scopeValidation = validateTaxPackageScope({
      config: params.config,
      asset: options.asset,
      hasCustomDateWindow: options.startDate !== undefined || options.endDate !== undefined,
    });
    if (scopeValidation.isErr()) {
      displayCliError('cost-basis-export', scopeValidation.error, ExitCodes.VALIDATION_ERROR, isJson ? 'json' : 'text');
    }

    const scope = scopeValidation.value;
    if (scope.config.jurisdiction === 'US') {
      displayCliError(
        'cost-basis-export',
        new Error('US tax package export is not implemented yet. Canada is the only supported filing package today.'),
        ExitCodes.CONFIG_ERROR,
        isJson ? 'json' : 'text'
      );
    }

    const outputDir = path.resolve(options.output ?? buildDefaultOutputDir(params));
    await mkdir(outputDir, { recursive: true });

    await runCommand(async (ctx) => {
      const database = await ctx.database();
      const handlerResult = await createCostBasisHandler(ctx, database, {
        isJsonMode: isJson,
        params,
        registry,
      });
      if (handlerResult.isErr()) {
        displayCliError('cost-basis-export', handlerResult.error, ExitCodes.GENERAL_ERROR, isJson ? 'json' : 'text');
      }

      const artifactResult = await handlerResult.value.executeArtifact(params, { refresh: options.refresh });
      if (artifactResult.isErr()) {
        displayCliError('cost-basis-export', artifactResult.error, ExitCodes.GENERAL_ERROR, isJson ? 'json' : 'text');
      }

      const buildContextResult = buildTaxPackageBuildContext({
        artifact: artifactResult.value.artifact,
        sourceContext: artifactResult.value.sourceContext,
        scopeKey: artifactResult.value.scopeKey,
        snapshotId: artifactResult.value.snapshotId,
      });
      if (buildContextResult.isErr()) {
        displayCliError(
          'cost-basis-export',
          buildContextResult.error,
          ExitCodes.GENERAL_ERROR,
          isJson ? 'json' : 'text'
        );
      }

      const exportResult = await exportTaxPackage(
        {
          context: buildContextResult.value,
          scope,
        },
        {
          now: () => new Date(),
          writer: new TaxPackageDirectoryWriter(outputDir),
        }
      );
      if (exportResult.isErr()) {
        displayCliError('cost-basis-export', exportResult.error, ExitCodes.GENERAL_ERROR, isJson ? 'json' : 'text');
      }

      const response: CostBasisExportCommandResult = {
        calculationId: exportResult.value.artifactRef.calculationId,
        snapshotId: exportResult.value.artifactRef.snapshotId,
        packageStatus: exportResult.value.status,
        outputDir,
        outputPaths: exportResult.value.files.map((file) => file.absolutePath),
      };

      if (isJson) {
        outputSuccess('cost-basis-export', response);
      } else {
        console.log(`Exported tax package to: ${outputDir}`);
        console.log(`Package status: ${exportResult.value.status}`);
        for (const file of exportResult.value.files) {
          console.log(`  - ${file.absolutePath}`);
        }
      }

      if (exportResult.value.status === 'blocked') {
        ctx.exitCode = ExitCodes.BLOCKED_PACKAGE;
      }
    });
  } catch (error) {
    displayCliError(
      'cost-basis-export',
      error instanceof Error ? error : new Error(String(error)),
      ExitCodes.GENERAL_ERROR,
      isJson ? 'json' : 'text'
    );
  }
}

class TaxPackageDirectoryWriter implements ITaxPackageFileWriter {
  constructor(private readonly outputDir: string) {}

  async writeAll(files: readonly TaxPackageFile[]): Promise<Result<WrittenTaxPackageFile[], Error>> {
    const outputFiles = files.map((file) => ({
      path: path.join(this.outputDir, file.relativePath),
      content: file.content,
    }));

    const writeResult = await writeFilesAtomically(outputFiles);
    if (writeResult.isErr()) {
      return err(writeResult.error);
    }

    return ok(
      files.map((file, index) => {
        const absolutePath = writeResult.value[index];
        if (!absolutePath) {
          throw new Error(`Missing output path for tax package file ${file.relativePath}`);
        }

        return {
          ...file,
          absolutePath,
          sha256: createHash('sha256').update(file.content, 'utf8').digest('hex'),
          bytesWritten: Buffer.byteLength(file.content, 'utf8'),
        };
      })
    );
  }
}

function buildDefaultOutputDir(params: CostBasisInput): string {
  return path.join('reports', `${params.config.taxYear}-${params.config.jurisdiction.toLowerCase()}-tax-package`);
}
