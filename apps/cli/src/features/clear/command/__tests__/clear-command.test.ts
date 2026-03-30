/* eslint-disable @typescript-eslint/no-unsafe-assignment -- ok for tests */
import type { Profile } from '@exitbook/core';
import { err, ok } from '@exitbook/foundation';
import { Command } from 'commander';
import type { ReactElement } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { DeletionPreview } from '../clear-service.js';

const {
  mockCreateClearViewState,
  mockCreateSpinner,
  mockCtx,
  mockExitCliFailure,
  mockOutputSuccess,
  mockPreviewClear,
  mockRenderApp,
  mockRunClear,
  mockRunCommand,
  mockStopSpinner,
  mockWithClearCommandScope,
} = vi.hoisted(() => ({
  mockCreateClearViewState: vi.fn(),
  mockCreateSpinner: vi.fn(),
  mockCtx: {
    database: vi.fn(),
  },
  mockExitCliFailure: vi.fn(),
  mockOutputSuccess: vi.fn(),
  mockPreviewClear: vi.fn(),
  mockRenderApp: vi.fn(),
  mockRunClear: vi.fn(),
  mockRunCommand: vi.fn(),
  mockStopSpinner: vi.fn(),
  mockWithClearCommandScope: vi.fn(),
}));

vi.mock('../../../../runtime/command-runtime.js', () => ({
  CommandRuntime: class {},
  renderApp: mockRenderApp,
  runCommand: mockRunCommand,
}));

vi.mock('../../../shared/cli-error.js', () => ({
  exitCliFailure: mockExitCliFailure,
}));

vi.mock('../../../shared/json-output.js', () => ({
  outputSuccess: mockOutputSuccess,
}));

vi.mock('../../../shared/spinner.js', () => ({
  createSpinner: mockCreateSpinner,
  stopSpinner: mockStopSpinner,
}));

vi.mock('../clear-command-scope.js', () => ({
  withClearCommandScope: mockWithClearCommandScope,
}));

vi.mock('../run-clear.js', async () => {
  const actual = await vi.importActual<typeof import('../run-clear.js')>('../run-clear.js');

  return {
    ...actual,
    previewClear: mockPreviewClear,
    runClear: mockRunClear,
  };
});

vi.mock('../../view/clear-view-components.jsx', () => ({
  ClearViewApp: 'ClearViewApp',
}));

vi.mock('../../view/clear-view-state.js', () => ({
  createClearViewState: mockCreateClearViewState,
}));

import { registerClearCommand } from '../clear.js';

function createProgram(): Command {
  const program = new Command();
  registerClearCommand(program);
  return program;
}

function makeProfile(overrides: Partial<Profile> = {}): Profile {
  return {
    id: 1,
    profileKey: 'default',
    displayName: 'default',
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    ...overrides,
  };
}

function makePreview(overrides: Partial<DeletionPreview> = {}): DeletionPreview {
  return {
    assetReview: { assets: 0 },
    balances: { assetRows: 0, scopes: 0 },
    links: { links: 0 },
    processedTransactions: { transactions: 0 },
    costBasisSnapshots: { snapshots: 0 },
    purge: undefined,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();

  mockRunCommand.mockImplementation(async (fn: (ctx: typeof mockCtx) => Promise<void>) => {
    await fn(mockCtx);
  });
  mockWithClearCommandScope.mockImplementation(
    async (_ctx: unknown, operation: (scope: { clearService: object; profile: Profile }) => Promise<unknown>) =>
      operation({
        clearService: { tag: 'clear-service' },
        profile: makeProfile(),
      })
  );
  mockCreateClearViewState.mockImplementation((scope, previewWithRaw, previewWithoutRaw, includeRaw) => ({
    includeRaw,
    previewWithRaw,
    previewWithoutRaw,
    scope,
  }));
  mockCreateSpinner.mockReturnValue({ ora: { tag: 'spinner' } });
  mockExitCliFailure.mockImplementation(
    (command: string, failure: { error: Error; exitCode: number }, format: 'json' | 'text') => {
      throw new Error(`CLI:${command}:${format}:${failure.error.message}:${failure.exitCode}`);
    }
  );
});

describe('clear command', () => {
  it('opens the TUI by default in text mode', async () => {
    const program = createProgram();
    let renderedElement: ReactElement | undefined;
    const previewWithoutRaw = makePreview({
      processedTransactions: { transactions: 2 },
    });
    const previewWithRaw = makePreview({
      processedTransactions: { transactions: 2 },
      purge: {
        accounts: 1,
        rawData: 3,
        sessions: 1,
      },
    });

    mockPreviewClear.mockResolvedValueOnce(ok(previewWithoutRaw)).mockResolvedValueOnce(ok(previewWithRaw));
    mockRenderApp.mockImplementation(async (create: (unmount: () => void) => ReactElement) => {
      renderedElement = create(() => undefined);
    });

    await program.parseAsync(['clear'], { from: 'user' });

    expect(mockPreviewClear).toHaveBeenNthCalledWith(
      1,
      expect.any(Object),
      expect.objectContaining({ includeRaw: false, profileId: 1 })
    );
    expect(mockPreviewClear).toHaveBeenNthCalledWith(
      2,
      expect.any(Object),
      expect.objectContaining({ includeRaw: true, profileId: 1 })
    );
    expect(mockRenderApp).toHaveBeenCalledOnce();
    expect(renderedElement?.type).toBe('ClearViewApp');
    expect(mockRunClear).not.toHaveBeenCalled();
    expect(mockOutputSuccess).not.toHaveBeenCalled();
  });

  it('outputs empty JSON results through the shared boundary', async () => {
    const program = createProgram();

    mockPreviewClear.mockResolvedValue(ok(makePreview()));

    await program.parseAsync(['clear', '--json'], { from: 'user' });

    expect(mockRenderApp).not.toHaveBeenCalled();
    expect(mockRunClear).not.toHaveBeenCalled();
    expect(mockOutputSuccess).toHaveBeenCalledWith(
      'clear',
      {
        deleted: {
          transactions: 0,
          links: 0,
          assetReviewStates: 0,
          balanceSnapshots: 0,
          balanceSnapshotAssets: 0,
          costBasisSnapshots: 0,
          accounts: 0,
          sessions: 0,
          rawData: 0,
        },
      },
      undefined
    );
  });

  it('runs terminal clear immediately when confirmation is bypassed', async () => {
    const program = createProgram();
    const spinner = { ora: { tag: 'spinner' } };
    const preview = makePreview({
      processedTransactions: { transactions: 2 },
      links: { links: 1 },
    });

    mockCreateSpinner.mockReturnValue(spinner);
    mockPreviewClear.mockResolvedValue(ok(preview));
    mockRunClear.mockResolvedValue(ok({ deleted: preview }));

    await program.parseAsync(['clear', '--confirm'], { from: 'user' });

    expect(mockCreateSpinner).toHaveBeenCalledWith('Clearing data...', false);
    expect(mockRunClear).toHaveBeenCalledWith(expect.any(Object), expect.objectContaining({ includeRaw: false }));
    expect(mockStopSpinner).toHaveBeenCalledWith(spinner, 'Clear complete - 2 transactions, 1 links');
    expect(mockRenderApp).not.toHaveBeenCalled();
    expect(mockOutputSuccess).not.toHaveBeenCalled();
  });

  it('routes preview failures through the shared CLI error boundary', async () => {
    const program = createProgram();

    mockPreviewClear.mockResolvedValue(err(new Error('Preview failed')));

    await expect(program.parseAsync(['clear', '--json'], { from: 'user' })).rejects.toThrow(
      'CLI:clear:json:Preview failed:1'
    );

    expect(mockExitCliFailure).toHaveBeenCalledWith('clear', expect.objectContaining({ exitCode: 1 }), 'json');
    expect(mockRenderApp).not.toHaveBeenCalled();
  });
});
