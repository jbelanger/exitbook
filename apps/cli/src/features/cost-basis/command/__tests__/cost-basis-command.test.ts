import { err, ok } from '@exitbook/foundation';
import { Command } from 'commander';
import type { ReactElement } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { CliAppRuntime } from '../../../../runtime/app-runtime.js';

const {
  mockBuildCostBasisIssueNotices,
  mockBuildCostBasisInputFromFlags,
  mockBuildCostBasisJsonData,
  mockBuildPresentationModel,
  mockCreateCostBasisAssetState,
  mockCreateSpinner,
  mockExitCliFailure,
  mockOutputSuccess,
  mockPromptForCostBasisParams,
  mockRenderApp,
  mockRunCommand,
  mockRunCostBasisArtifact,
  mockStopSpinner,
  mockWithCostBasisCommandScope,
} = vi.hoisted(() => ({
  mockBuildCostBasisIssueNotices: vi.fn(),
  mockBuildCostBasisInputFromFlags: vi.fn(),
  mockBuildCostBasisJsonData: vi.fn(),
  mockBuildPresentationModel: vi.fn(),
  mockCreateCostBasisAssetState: vi.fn(),
  mockCreateSpinner: vi.fn(),
  mockExitCliFailure: vi.fn(),
  mockOutputSuccess: vi.fn(),
  mockPromptForCostBasisParams: vi.fn(),
  mockRenderApp: vi.fn(),
  mockRunCommand: vi.fn(),
  mockRunCostBasisArtifact: vi.fn(),
  mockStopSpinner: vi.fn(),
  mockWithCostBasisCommandScope: vi.fn(),
}));

vi.mock('../../../../runtime/command-runtime.js', () => ({
  renderApp: mockRenderApp,
  runCommand: mockRunCommand,
}));

vi.mock('../../cost-basis-issue-notices.js', () => ({
  buildCostBasisIssueNotices: mockBuildCostBasisIssueNotices,
}));

vi.mock('../../../../cli/error.js', () => ({
  exitCliFailure: mockExitCliFailure,
}));

vi.mock('../../../../cli/output.js', () => ({
  outputSuccess: mockOutputSuccess,
}));

vi.mock('../../../shared/spinner.js', () => ({
  createSpinner: mockCreateSpinner,
  stopSpinner: mockStopSpinner,
}));

vi.mock('../cost-basis-command-scope.js', () => ({
  withCostBasisCommandScope: mockWithCostBasisCommandScope,
}));

vi.mock('../run-cost-basis.js', () => ({
  runCostBasisArtifact: mockRunCostBasisArtifact,
}));

vi.mock('../cost-basis-utils.js', () => ({
  buildCostBasisInputFromFlags: mockBuildCostBasisInputFromFlags,
}));

vi.mock('../cost-basis-prompts.jsx', () => ({
  promptForCostBasisParams: mockPromptForCostBasisParams,
}));

vi.mock('../cost-basis-json.js', () => ({
  buildCostBasisJsonData: mockBuildCostBasisJsonData,
}));

vi.mock('../../view/cost-basis-view-utils.js', () => ({
  buildPresentationModel: mockBuildPresentationModel,
}));

vi.mock('../../view/cost-basis-view-components.jsx', () => ({
  CostBasisApp: 'CostBasisApp',
}));

vi.mock('../../view/cost-basis-view-state.js', () => ({
  createCostBasisAssetState: mockCreateCostBasisAssetState,
  createCostBasisTimelineState: vi.fn(),
}));

import { registerCostBasisCommand } from '../cost-basis.js';

interface MockCtx {
  closeDatabase: ReturnType<typeof vi.fn>;
  database: ReturnType<typeof vi.fn>;
}

function createProgram(): Command {
  const program = new Command();
  registerCostBasisCommand(program, {
    blockchainExplorersConfig: {},
  } as CliAppRuntime);
  return program;
}

describe('cost-basis command', () => {
  const ctx: MockCtx = {
    closeDatabase: vi.fn(),
    database: vi.fn(),
  };
  const scope = {
    handler: {},
    profile: {
      id: 1,
      profileKey: 'default',
      displayName: 'default',
      createdAt: new Date('2026-03-01T00:00:00.000Z'),
    },
  };
  const params = {
    currency: 'USD',
    endDate: new Date('2024-12-31T23:59:59.999Z'),
    fiatCurrency: 'USD',
    jurisdiction: 'US',
    method: 'fifo',
    startDate: new Date('2024-01-01T00:00:00.000Z'),
    taxYear: 2024,
  };
  const presentation = {
    assetItems: [],
    context: {
      calculationId: 'calc-1',
      currency: 'USD',
      dateRange: { end: '2024-12-31', start: '2024-01-01' },
      jurisdiction: 'US',
      method: 'fifo',
      taxYear: 2024,
    },
    issueNotices: [],
    summary: {
      disposalsProcessed: 1,
      lotsCreated: 2,
    },
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockRunCommand.mockImplementation(async (appOrFn: unknown, maybeFn?: (runtime: MockCtx) => Promise<void>) => {
      const fn = typeof appOrFn === 'function' ? appOrFn : maybeFn;
      await fn?.(ctx);
    });
    mockWithCostBasisCommandScope.mockImplementation(
      async (_ctx: unknown, _options: unknown, operation: (value: typeof scope) => Promise<unknown>) => operation(scope)
    );
    mockBuildCostBasisInputFromFlags.mockReturnValue(ok(params));
    mockRunCostBasisArtifact.mockResolvedValue(
      ok({
        artifact: { tag: 'workflow-result' },
        scopeKey: 'cost-basis:default',
        snapshotId: 'snapshot-1',
        sourceContext: { tag: 'source-context' },
        assetReviewSummaries: new Map(),
      })
    );
    mockBuildCostBasisIssueNotices.mockReturnValue(ok([]));
    mockBuildPresentationModel.mockReturnValue(presentation);
    mockBuildCostBasisJsonData.mockReturnValue({
      calculationId: 'calc-1',
      currency: 'USD',
      dateRange: { end: '2024-12-31', start: '2024-01-01' },
      jurisdiction: 'US',
      method: 'fifo',
      issueNotices: [],
      summary: presentation.summary,
      taxYear: 2024,
      assets: [],
    });
    mockCreateCostBasisAssetState.mockReturnValue({ assets: [], kind: 'assets' });
    mockCreateSpinner.mockReturnValue({ text: 'spinner' });
    mockPromptForCostBasisParams.mockResolvedValue(undefined);
    mockRenderApp.mockImplementation(async (create: (unmount: () => void) => ReactElement) => {
      create(() => undefined);
    });
    mockExitCliFailure.mockImplementation(
      (command: string, failure: { error: Error; exitCode: number }, format: 'json' | 'text') => {
        throw new Error(`CLI:${command}:${format}:${failure.error.message}:${failure.exitCode}`);
      }
    );
  });

  it('outputs JSON through the shared boundary', async () => {
    const program = createProgram();

    await program.parseAsync(['cost-basis', '--jurisdiction', 'US', '--tax-year', '2024', '--json'], { from: 'user' });

    expect(mockOutputSuccess).toHaveBeenCalledWith(
      'cost-basis',
      {
        calculationId: 'calc-1',
        currency: 'USD',
        dateRange: { end: '2024-12-31', start: '2024-01-01' },
        jurisdiction: 'US',
        method: 'fifo',
        issueNotices: [],
        summary: presentation.summary,
        taxYear: 2024,
        assets: [],
      },
      undefined
    );
  });

  it('renders the cost basis TUI in text mode', async () => {
    const program = createProgram();
    let renderedElement: ReactElement | undefined;

    mockRenderApp.mockImplementation(async (create: (unmount: () => void) => ReactElement) => {
      renderedElement = create(() => undefined);
    });

    await program.parseAsync(['cost-basis', '--jurisdiction', 'US', '--tax-year', '2024', '--method', 'fifo'], {
      from: 'user',
    });

    expect(mockCreateSpinner).toHaveBeenCalledWith('Calculating cost basis...', false);
    expect(mockStopSpinner).toHaveBeenCalled();
    expect(ctx.closeDatabase).toHaveBeenCalledOnce();
    expect(renderedElement?.type).toBe('CostBasisApp');
  });

  it('prints a cancellation message when the prompt flow is cancelled', async () => {
    const program = createProgram();
    const consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);

    await program.parseAsync(['cost-basis'], { from: 'user' });

    expect(mockRunCommand).not.toHaveBeenCalled();
    expect(consoleLogSpy).toHaveBeenCalledWith('\nCost basis calculation cancelled');
  });

  it('routes invalid flag input through the CLI boundary', async () => {
    const program = createProgram();
    const failure = new Error('Tax year is required');
    mockBuildCostBasisInputFromFlags.mockReturnValue(err(failure));

    await expect(program.parseAsync(['cost-basis', '--json'], { from: 'user' })).rejects.toThrow(
      'CLI:cost-basis:json:Tax year is required:2'
    );

    expect(mockRunCommand).not.toHaveBeenCalled();
    expect(mockExitCliFailure).toHaveBeenCalledWith(
      'cost-basis',
      expect.objectContaining({ error: failure, exitCode: 2 }),
      'json'
    );
  });
});
