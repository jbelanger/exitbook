import { ok } from '@exitbook/foundation';
import { Command } from 'commander';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const {
  mockBuildProfileLinkGapSourceReader,
  mockCtx,
  mockExitCliFailure,
  mockHandlerConstructor,
  mockOutputSuccess,
  mockOverrideStoreConstructor,
  mockOverrideStoreInstance,
  mockRefreshProfileIssueProjection,
  mockReopen,
  mockResolve,
  mockResolveCommandProfile,
  mockRunCommand,
} = vi.hoisted(() => ({
  mockBuildProfileLinkGapSourceReader: vi.fn(),
  mockCtx: {
    dataDir: '/tmp/exitbook-links',
    database: vi.fn().mockResolvedValue({ tag: 'db' }),
    tag: 'command-runtime',
  },
  mockExitCliFailure: vi.fn(),
  mockHandlerConstructor: vi.fn(),
  mockOutputSuccess: vi.fn(),
  mockOverrideStoreConstructor: vi.fn(),
  mockOverrideStoreInstance: { tag: 'override-store' },
  mockRefreshProfileIssueProjection: vi.fn(),
  mockReopen: vi.fn(),
  mockResolve: vi.fn(),
  mockResolveCommandProfile: vi.fn(),
  mockRunCommand: vi.fn(),
}));

vi.mock('@exitbook/data/overrides', () => ({
  OverrideStore: vi.fn().mockImplementation(function MockOverrideStore(...args: unknown[]) {
    mockOverrideStoreConstructor(...args);
    return mockOverrideStoreInstance;
  }),
}));

vi.mock('../../../../../runtime/command-runtime.js', () => ({
  CommandRuntime: class {},
  renderApp: vi.fn(),
  runCommand: mockRunCommand,
}));

vi.mock('../../../../../cli/error.js', () => ({
  exitCliFailure: mockExitCliFailure,
}));

vi.mock('../../../../../cli/output.js', () => ({
  outputSuccess: mockOutputSuccess,
}));

vi.mock('../../../../profiles/profile-resolution.js', () => ({
  resolveCommandProfile: mockResolveCommandProfile,
}));

vi.mock('@exitbook/data/accounting', async () => {
  return {
    buildProfileLinkGapSourceReader: mockBuildProfileLinkGapSourceReader,
    refreshProfileAccountingIssueProjection: mockRefreshProfileIssueProjection,
  };
});

vi.mock('../links-gap-resolution-handler.js', () => ({
  LinksGapResolutionHandler: vi.fn().mockImplementation(function MockLinksGapResolutionHandler(...args: unknown[]) {
    mockHandlerConstructor(...args);
    return {
      reopen: mockReopen,
      resolve: mockResolve,
    };
  }),
}));

import { registerLinksGapReopenCommand, registerLinksGapResolveCommand } from '../links-gap-resolution-command.js';

function createProgram(): Command {
  const program = new Command();
  const gaps = program.command('links').command('gaps');
  registerLinksGapResolveCommand(gaps);
  registerLinksGapReopenCommand(gaps);
  return program;
}

describe('links gap resolution commands', () => {
  const consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);

  beforeEach(() => {
    vi.clearAllMocks();
    mockRunCommand.mockImplementation(async (fn: (ctx: typeof mockCtx) => Promise<void>) => {
      await fn(mockCtx);
    });
    mockExitCliFailure.mockImplementation(
      (command: string, failure: { error: Error; exitCode: number }, format: 'json' | 'text') => {
        throw new Error(`CLI:${command}:${format}:${failure.error.message}:${failure.exitCode}`);
      }
    );
    mockResolveCommandProfile.mockResolvedValue(
      ok({
        id: 1,
        profileKey: 'default',
        displayName: 'default',
        createdAt: new Date('2026-04-01T00:00:00.000Z'),
      })
    );
    mockBuildProfileLinkGapSourceReader.mockReturnValue({ tag: 'source-reader' });
    mockRefreshProfileIssueProjection.mockResolvedValue(ok(undefined));
    consoleLogSpy.mockClear();
  });

  afterEach(() => {
    consoleLogSpy.mockClear();
  });

  it('resolves a gap transaction in text mode', async () => {
    const program = createProgram();
    mockResolve.mockResolvedValue(
      ok({
        action: 'resolve',
        assetId: 'blockchain:bitcoin:native',
        assetSymbol: 'BTC',
        changed: true,
        direction: 'inflow',
        gapRef: 'a1b2c3d4e5',
        platformKey: 'bitcoin',
        reason: 'BullBitcoin purchase sent directly to wallet',
        transactionGapCount: 2,
        transactionId: 1834,
        transactionRef: '3ab863db2a',
        txFingerprint: '3ab863db2a-full-fingerprint',
      })
    );

    await program.parseAsync(
      ['links', 'gaps', 'resolve', 'a1b2c3d4e5', '--reason', 'BullBitcoin purchase sent directly to wallet'],
      { from: 'user' }
    );

    expect(mockOverrideStoreConstructor).toHaveBeenCalledWith('/tmp/exitbook-links');
    expect(mockBuildProfileLinkGapSourceReader).toHaveBeenCalledWith({ tag: 'db' }, '/tmp/exitbook-links', {
      profileId: 1,
      profileKey: 'default',
    });
    expect(mockHandlerConstructor).toHaveBeenCalledWith({ tag: 'source-reader' }, 'default', mockOverrideStoreInstance);
    expect(mockResolve).toHaveBeenCalledWith({
      selector: 'a1b2c3d4e5',
      reason: 'BullBitcoin purchase sent directly to wallet',
    });
    expect(mockRefreshProfileIssueProjection).toHaveBeenCalledWith({ tag: 'db' }, '/tmp/exitbook-links', {
      displayName: 'default',
      profileId: 1,
      profileKey: 'default',
    });
    expect(consoleLogSpy.mock.calls[0]?.[0]).toContain('✓');
    expect(consoleLogSpy.mock.calls[0]?.[0]).toContain('Link gap resolved');
    expect(consoleLogSpy).toHaveBeenCalledWith('   Gap: a1b2c3d4e5 (BTC / inflow)');
    expect(consoleLogSpy).toHaveBeenCalledWith('   Transaction: #1834 (bitcoin / 3ab863db2a)');
    expect(consoleLogSpy).toHaveBeenCalledWith('   Asset ID: blockchain:bitcoin:native');
    expect(consoleLogSpy).toHaveBeenCalledWith('   Fingerprint: 3ab863db2a-full-fingerprint');
    expect(consoleLogSpy).toHaveBeenCalledWith('   Open gap rows on tx: 2');
    expect(consoleLogSpy).toHaveBeenCalledWith('   Reason: BullBitcoin purchase sent directly to wallet');
  });

  it('reopens a gap in JSON mode', async () => {
    const program = createProgram();
    const result = {
      action: 'reopen',
      assetId: 'blockchain:solana:native',
      assetSymbol: 'SOL',
      changed: true,
      direction: 'outflow',
      gapRef: '761aacb377',
      platformKey: 'solana',
      transactionGapCount: 2,
      transactionId: 761,
      transactionRef: '761aacb377',
      txFingerprint: '761aacb377-full-fingerprint',
    };
    mockReopen.mockResolvedValue(ok(result));

    await program.parseAsync(['links', 'gaps', 'reopen', '761aacb377', '--json'], { from: 'user' });

    expect(mockReopen).toHaveBeenCalledWith({
      selector: '761aacb377',
      reason: undefined,
    });
    expect(mockRefreshProfileIssueProjection).toHaveBeenCalledWith({ tag: 'db' }, '/tmp/exitbook-links', {
      displayName: 'default',
      profileId: 1,
      profileKey: 'default',
    });
    expect(mockOutputSuccess).toHaveBeenCalledWith('links-gaps-reopen', result, undefined);
    expect(consoleLogSpy).not.toHaveBeenCalled();
  });
});
