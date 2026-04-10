import { ok } from '@exitbook/foundation';
import { Command } from 'commander';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const {
  mockCtx,
  mockCreate,
  mockExitCliFailure,
  mockHandlerConstructor,
  mockOutputSuccess,
  mockOverrideStoreConstructor,
  mockOverrideStoreInstance,
  mockResolveCommandProfile,
  mockRunCommand,
} = vi.hoisted(() => ({
  mockCtx: {
    dataDir: '/tmp/exitbook-links',
    database: vi.fn().mockResolvedValue({ tag: 'db' }),
    tag: 'command-runtime',
  },
  mockCreate: vi.fn(),
  mockExitCliFailure: vi.fn(),
  mockHandlerConstructor: vi.fn(),
  mockOutputSuccess: vi.fn(),
  mockOverrideStoreConstructor: vi.fn(),
  mockOverrideStoreInstance: { tag: 'override-store' },
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

vi.mock('../links-create-handler.js', () => ({
  LinksCreateHandler: vi.fn().mockImplementation(function MockLinksCreateHandler(...args: unknown[]) {
    mockHandlerConstructor(...args);
    return {
      create: mockCreate,
    };
  }),
}));

import { registerLinksCreateCommand } from '../links-create-command.js';

function createProgram(): Command {
  const program = new Command();
  const links = program.command('links');
  registerLinksCreateCommand(links);
  return program;
}

describe('links create command', () => {
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
    consoleLogSpy.mockClear();
  });

  afterEach(() => {
    consoleLogSpy.mockClear();
  });

  it('creates a manual link in text mode', async () => {
    const program = createProgram();
    mockCreate.mockResolvedValue(
      ok({
        action: 'created',
        changed: true,
        assetSymbol: 'RENDER',
        linkId: 91,
        linkType: 'blockchain_to_blockchain',
        reviewedAt: new Date('2026-04-10T12:00:00.000Z'),
        reviewedBy: 'cli-user',
        sourceAmount: '80.61',
        sourcePlatformKey: 'ethereum',
        sourceTransactionId: 1001,
        sourceTransactionRef: 'e96a8b7baa',
        targetAmount: '80.61',
        targetPlatformKey: 'solana',
        targetTransactionId: 1002,
        targetTransactionRef: 'b7c08af224',
        reason: 'Token migration',
      })
    );

    await program.parseAsync(
      ['links', 'create', 'e96a8b7baa', 'b7c08af224', '--asset', 'RENDER', '--reason', 'Token migration'],
      { from: 'user' }
    );

    expect(mockOverrideStoreConstructor).toHaveBeenCalledWith('/tmp/exitbook-links');
    expect(mockHandlerConstructor).toHaveBeenCalledWith({ tag: 'db' }, 1, 'default', mockOverrideStoreInstance);
    expect(mockCreate).toHaveBeenCalledWith({
      assetSymbol: 'RENDER',
      reason: 'Token migration',
      sourceSelector: 'e96a8b7baa',
      targetSelector: 'b7c08af224',
    });
    expect(consoleLogSpy.mock.calls[0]?.[0]).toContain('✓');
    expect(consoleLogSpy.mock.calls[0]?.[0]).toContain('Manual link created');
    expect(consoleLogSpy).toHaveBeenCalledWith('   Link: #91 (blockchain_to_blockchain)');
    expect(consoleLogSpy).toHaveBeenCalledWith('   Source: #1001 (ethereum / e96a8b7baa) 80.61 RENDER');
    expect(consoleLogSpy).toHaveBeenCalledWith('   Target: #1002 (solana / b7c08af224) 80.61 RENDER');
    expect(consoleLogSpy).toHaveBeenCalledWith('   Reason: Token migration');
  });

  it('returns JSON output for an existing confirmed exact link', async () => {
    const program = createProgram();
    const result = {
      action: 'already-confirmed' as const,
      changed: false,
      assetSymbol: 'RENDER',
      existingStatusBefore: 'confirmed' as const,
      linkId: 55,
      linkType: 'blockchain_to_blockchain' as const,
      reviewedAt: new Date('2026-04-10T12:00:00.000Z'),
      reviewedBy: 'reviewer',
      sourceAmount: '80.61',
      sourcePlatformKey: 'ethereum',
      sourceTransactionId: 1001,
      sourceTransactionRef: 'e96a8b7baa',
      targetAmount: '80.61',
      targetPlatformKey: 'solana',
      targetTransactionId: 1002,
      targetTransactionRef: 'b7c08af224',
    };
    mockCreate.mockResolvedValue(ok(result));

    await program.parseAsync(['links', 'create', 'e96a8b7baa', 'b7c08af224', '--asset', 'RENDER', '--json'], {
      from: 'user',
    });

    expect(mockCreate).toHaveBeenCalledWith({
      assetSymbol: 'RENDER',
      reason: undefined,
      sourceSelector: 'e96a8b7baa',
      targetSelector: 'b7c08af224',
    });
    expect(mockOutputSuccess).toHaveBeenCalledWith('links-create', result, undefined);
    expect(consoleLogSpy).not.toHaveBeenCalled();
  });
});
