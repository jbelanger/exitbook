import { err, ok } from '@exitbook/foundation';
import { Command } from 'commander';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ExitCodes } from '../../../../cli/exit-codes.js';
import type { CliAppRuntime } from '../../../../runtime/app-runtime.js';

const {
  mockBuildCostBasisInputFromFlags,
  mockBuildTaxPackageBuildContext,
  mockCtx,
  mockDeriveTaxPackageReadinessMetadata,
  mockExitCliFailure,
  mockExportTaxPackage,
  mockMkdir,
  mockOutputSuccess,
  mockRunCommand,
  mockValidateTaxPackageScope,
  mockWithCostBasisCommandScope,
} = vi.hoisted(() => ({
  mockBuildCostBasisInputFromFlags: vi.fn(),
  mockBuildTaxPackageBuildContext: vi.fn(),
  mockCtx: {
    database: vi.fn(),
  },
  mockDeriveTaxPackageReadinessMetadata: vi.fn(),
  mockExitCliFailure: vi.fn(),
  mockExportTaxPackage: vi.fn(),
  mockMkdir: vi.fn(),
  mockOutputSuccess: vi.fn(),
  mockRunCommand: vi.fn(),
  mockValidateTaxPackageScope: vi.fn(),
  mockWithCostBasisCommandScope: vi.fn(),
}));

vi.mock('../../../../runtime/command-runtime.js', () => ({
  CommandRuntime: class {},
  runCommand: mockRunCommand,
}));

vi.mock('../../../../cli/output.js', () => ({
  outputSuccess: mockOutputSuccess,
}));

vi.mock('../../../../cli/error.js', () => ({
  exitCliFailure: mockExitCliFailure,
}));

vi.mock('../cost-basis-command-scope.js', () => ({
  withCostBasisCommandScope: mockWithCostBasisCommandScope,
}));

vi.mock('../cost-basis-utils.js', () => ({
  buildCostBasisInputFromFlags: mockBuildCostBasisInputFromFlags,
}));

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return {
    ...actual,
    mkdir: mockMkdir,
  };
});

vi.mock('@exitbook/accounting/cost-basis', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@exitbook/accounting/cost-basis')>();
  return {
    ...actual,
    buildTaxPackageBuildContext: mockBuildTaxPackageBuildContext,
    deriveTaxPackageReadinessMetadata: mockDeriveTaxPackageReadinessMetadata,
    exportTaxPackage: mockExportTaxPackage,
    validateTaxPackageScope: mockValidateTaxPackageScope,
  };
});

import { registerCostBasisExportCommand } from '../cost-basis-export.js';

const mockProcessExit = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);

function createCostBasisProgram(): Command {
  const program = new Command();
  registerCostBasisExportCommand(program.command('cost-basis'), {} as CliAppRuntime);
  return program;
}

beforeEach(() => {
  vi.clearAllMocks();

  mockRunCommand.mockImplementation(async (appOrFn: unknown, maybeFn?: (ctx: typeof mockCtx) => Promise<void>) => {
    const fn = typeof appOrFn === 'function' ? appOrFn : maybeFn;
    await fn?.(mockCtx);
    if (!fn) {
      throw new Error('Missing runCommand callback');
    }
  });
  mockMkdir.mockResolvedValue(undefined);
  mockBuildCostBasisInputFromFlags.mockReturnValue(
    ok({
      jurisdiction: 'CA',
      taxYear: 2024,
      method: 'average-cost',
      startDate: '2024-01-01',
      endDate: '2024-12-31',
      fiatCurrency: 'CAD',
    })
  );
  mockValidateTaxPackageScope.mockReturnValue(ok({ scope: 'full' }));
  mockWithCostBasisCommandScope.mockResolvedValue(
    ok({
      artifact: { tag: 'artifact' },
      sourceContext: { tag: 'source-context' },
      scopeKey: 'cost-basis:default',
      snapshotId: 'snapshot-1',
      assetReviewSummaries: new Map(),
    })
  );
  mockBuildTaxPackageBuildContext.mockReturnValue(ok({ tag: 'build-context' }));
  mockDeriveTaxPackageReadinessMetadata.mockReturnValue({ tag: 'readiness-metadata' });
  mockExportTaxPackage.mockResolvedValue(
    ok({
      artifactRef: {
        calculationId: 'calc-1',
        snapshotId: 'snapshot-1',
      },
      files: [
        {
          absolutePath: '/tmp/reports/2024-ca-tax-package/report.md',
        },
      ],
      manifest: {
        blockingIssues: [],
        warnings: [],
      },
      status: 'blocked',
    })
  );
  mockExitCliFailure.mockImplementation(
    (command: string, failure: { error: Error; exitCode: number }, format: 'json' | 'text') => {
      throw new Error(`CLI:${command}:${format}:${failure.error.message}:${failure.exitCode}`);
    }
  );
});

describe('cost-basis export command', () => {
  it('writes JSON output and exits with BLOCKED_PACKAGE when the export is inspection-only', async () => {
    const program = createCostBasisProgram();

    await program.parseAsync(['cost-basis', 'export', '--jurisdiction', 'CA', '--tax-year', '2024', '--json'], {
      from: 'user',
    });

    expect(mockWithCostBasisCommandScope).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        format: 'json',
      }),
      expect.any(Function)
    );
    expect(mockOutputSuccess).toHaveBeenCalledWith(
      'cost-basis-export',
      {
        calculationId: 'calc-1',
        snapshotId: 'snapshot-1',
        packageStatus: 'blocked',
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- ok in tests
        outputDir: expect.stringContaining('reports/2024-ca-tax-package'),
        outputPaths: ['/tmp/reports/2024-ca-tax-package/report.md'],
      },
      undefined
    );
    expect(mockProcessExit).toHaveBeenCalledWith(ExitCodes.BLOCKED_PACKAGE);
  });

  it('treats preflight input validation failures as validation errors without opening the runtime', async () => {
    const program = createCostBasisProgram();
    mockBuildCostBasisInputFromFlags.mockReturnValue(err(new Error('--tax-year is required (e.g., 2024)')));

    await expect(
      program.parseAsync(['cost-basis', 'export', '--jurisdiction', 'CA', '--json'], { from: 'user' })
    ).rejects.toThrow('CLI:cost-basis-export:json:--tax-year is required (e.g., 2024):8');

    expect(mockRunCommand).not.toHaveBeenCalled();
    expect(mockValidateTaxPackageScope).not.toHaveBeenCalled();
  });
});
