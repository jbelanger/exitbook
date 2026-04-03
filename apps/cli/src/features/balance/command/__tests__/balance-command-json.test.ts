/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return -- Vitest command-scope mocks intentionally use partial test doubles. */
import { err, ok } from '@exitbook/foundation';
import { Command } from 'commander';
import type { ReactElement } from 'react';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

const {
  mockCtx,
  mockExitCliFailure,
  mockGetByFingerprintRef,
  mockGetByName,
  mockOutputBalanceStaticDetail,
  mockOutputBalanceStaticList,
  mockOutputSuccess,
  mockRenderApp,
  mockRunBalanceView,
  mockRunCommand,
  mockWithBalanceCommandScope,
} = vi.hoisted(() => ({
  mockCtx: {
    closeDatabase: vi.fn(),
    database: vi.fn(),
    onAbort: vi.fn(),
  },
  mockExitCliFailure: vi.fn(),
  mockGetByFingerprintRef: vi.fn(),
  mockGetByName: vi.fn(),
  mockOutputBalanceStaticDetail: vi.fn(),
  mockOutputBalanceStaticList: vi.fn(),
  mockOutputSuccess: vi.fn(),
  mockRenderApp: vi.fn(),
  mockRunBalanceView: vi.fn(),
  mockRunCommand: vi.fn(),
  mockWithBalanceCommandScope: vi.fn(),
}));

const originalStdinTTYDescriptor = Object.getOwnPropertyDescriptor(process.stdin, 'isTTY');
const originalStdoutTTYDescriptor = Object.getOwnPropertyDescriptor(process.stdout, 'isTTY');

vi.mock('../../../../runtime/command-runtime.js', () => ({
  renderApp: mockRenderApp,
  runCommand: mockRunCommand,
}));

vi.mock('../../../../cli/output.js', () => ({
  outputSuccess: mockOutputSuccess,
}));

vi.mock('../../../../cli/error.js', () => ({
  exitCliFailure: mockExitCliFailure,
}));

vi.mock('../balance-command-scope.js', () => ({
  withBalanceCommandScope: mockWithBalanceCommandScope,
}));

vi.mock('../run-balance.js', () => ({
  runBalanceView: mockRunBalanceView,
}));

vi.mock('../../view/balance-view-components.jsx', () => ({
  BalanceApp: 'BalanceApp',
}));

vi.mock('../../view/balance-static-renderer.js', () => ({
  outputBalanceStaticDetail: mockOutputBalanceStaticDetail,
  outputBalanceStaticList: mockOutputBalanceStaticList,
}));

import { registerBalanceCommand } from '../balance.js';

function createBalanceCommand(): Command {
  const program = new Command();
  registerBalanceCommand(program);
  return program;
}

function createAccount(overrides: {
  accountFingerprint?: string;
  accountType?: 'blockchain' | 'exchange-api' | 'exchange-csv';
  id: number;
  identifier?: string;
  name?: string;
  platformKey?: string;
  providerName?: string | undefined;
}): {
  accountFingerprint: string;
  accountType: 'blockchain' | 'exchange-api' | 'exchange-csv';
  id: number;
  identifier: string;
  name?: string | undefined;
  platformKey: string;
  providerName?: string | undefined;
} {
  return {
    accountType: overrides.accountType ?? 'blockchain',
    accountFingerprint: overrides.accountFingerprint ?? `${String(overrides.id).padStart(64, '0')}`,
    id: overrides.id,
    identifier: overrides.identifier ?? `identifier-${overrides.id}`,
    name: overrides.name,
    providerName: overrides.providerName,
    platformKey: overrides.platformKey ?? 'bitcoin',
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('CI', '');
  setTTYFlags(true, true);
  mockCtx.database.mockResolvedValue({});
  mockRunCommand.mockImplementation(async (appOrFn: unknown, maybeFn?: (ctx: typeof mockCtx) => Promise<void>) => {
    const fn = typeof appOrFn === 'function' ? appOrFn : maybeFn;
    await fn?.(mockCtx);
    if (!fn) {
      throw new Error('fn is not a function');
    }
  });
  mockWithBalanceCommandScope.mockImplementation(async (_ctx, _options, operation) =>
    operation({
      accountService: {
        getByName: mockGetByName,
        getByFingerprintRef: mockGetByFingerprintRef,
      },
      profile: {
        id: 1,
        profileKey: 'default',
        displayName: 'default',
        createdAt: new Date('2026-03-01T00:00:00.000Z'),
      },
      snapshotReader: {},
      verificationRunner: {},
    })
  );
  mockGetByName.mockResolvedValue(ok(undefined));
  mockGetByFingerprintRef.mockResolvedValue(ok(undefined));
  mockExitCliFailure.mockImplementation(
    (command: string, failure: { error: Error; exitCode: number }, format: 'json' | 'text') => {
      throw new Error(`CLI:${command}:${format}:${failure.error.message}:${failure.exitCode}`);
    }
  );
  mockRenderApp.mockImplementation(async (create: (unmount: () => void) => ReactElement) => {
    create(() => undefined);
  });
});

afterAll(() => {
  vi.unstubAllEnvs();
  restoreTTYFlags();
});

describe('balance command JSON mode', () => {
  it('renders the stored snapshot static list for bare balance', async () => {
    const program = createBalanceCommand();

    mockRunBalanceView.mockResolvedValue(
      ok({
        accounts: [
          {
            account: createAccount({ id: 1, identifier: 'xpub-root', name: 'root-wallet' }),
            snapshot: {
              verificationStatus: 'match',
              statusReason: undefined,
              suggestion: undefined,
              lastRefreshAt: new Date('2026-03-12T18:10:00.000Z'),
            },
            assets: [
              {
                assetId: 'blockchain:bitcoin:native',
                assetSymbol: 'BTC',
                calculatedBalance: '1.25',
                diagnostics: { txCount: 4 },
              },
            ],
          },
        ],
      })
    );

    await program.parseAsync(['balance'], { from: 'user' });

    expect(mockWithBalanceCommandScope).toHaveBeenCalledWith(
      mockCtx,
      { format: 'text', needsWorkflow: false, prepareStoredSnapshots: true },
      expect.any(Function)
    );
    expect(mockRunBalanceView).toHaveBeenCalledWith(
      expect.objectContaining({
        profile: expect.objectContaining({ id: 1 }),
      }),
      { accountId: undefined }
    );
    expect(mockOutputBalanceStaticList).toHaveBeenCalledOnce();
    expect(mockRenderApp).not.toHaveBeenCalled();
    expect(mockCtx.closeDatabase).not.toHaveBeenCalled();
  });

  it('outputs stored snapshot JSON including requestedAccount for a bare child-scope selector', async () => {
    const program = createBalanceCommand();
    const scopeAccount = createAccount({ id: 1, identifier: 'xpub-root' });
    const requestedAccount = createAccount({
      id: 2,
      identifier: 'bc1-child',
      name: 'wallet-child',
      accountFingerprint: '2bc1c1d0aa000000000000000000000000000000000000000000000000000000',
    });
    const viewStoredSnapshots = vi.fn().mockResolvedValue(
      ok({
        accounts: [
          {
            account: scopeAccount,
            requestedAccount,
            snapshot: {
              verificationStatus: 'unavailable',
              statusReason: 'Live verification unavailable',
              suggestion: 'Add a provider',
              lastRefreshAt: new Date('2026-03-12T18:10:00.000Z'),
            },
            assets: [
              {
                assetId: 'blockchain:bitcoin:native',
                assetSymbol: 'BTC',
                calculatedBalance: '1.25',
                diagnostics: { txCount: 4 },
              },
            ],
          },
        ],
      })
    );

    mockRunBalanceView.mockImplementation(viewStoredSnapshots);
    mockGetByFingerprintRef.mockResolvedValue(ok(requestedAccount));

    await program.parseAsync(['balance', '2bc1c1d0aa', '--json'], { from: 'user' });

    expect(mockWithBalanceCommandScope).toHaveBeenCalledWith(
      mockCtx,
      { format: 'json', needsWorkflow: false, prepareStoredSnapshots: true },
      expect.any(Function)
    );
    expect(viewStoredSnapshots).toHaveBeenCalledWith(
      expect.objectContaining({
        profile: expect.objectContaining({ id: 1 }),
      }),
      { accountId: 2 }
    );

    expect(mockOutputSuccess).toHaveBeenCalledWith(
      'balance',
      {
        accounts: [
          {
            accountId: 1,
            platformKey: 'bitcoin',
            accountType: 'blockchain',
            requestedAccount: {
              id: 2,
              platformKey: 'bitcoin',
              accountType: 'blockchain',
            },
            snapshot: {
              verificationStatus: 'unavailable',
              statusReason: 'Live verification unavailable',
              suggestion: 'Add a provider',
              lastRefreshAt: '2026-03-12T18:10:00.000Z',
            },
            assets: [
              {
                assetId: 'blockchain:bitcoin:native',
                assetSymbol: 'BTC',
                calculatedBalance: '1.25',
                diagnostics: { txCount: 4 },
              },
            ],
          },
        ],
      },
      {
        totalAccounts: 1,
        mode: 'view',
        selector: { kind: 'ref', value: '2bc1c1d0aa' },
      }
    );
  });

  it('routes processing-prerequisite failures through the JSON CLI error path', async () => {
    const program = createBalanceCommand();
    const prerequisiteError = new Error('processing failed');

    mockWithBalanceCommandScope.mockResolvedValue(err(prerequisiteError));

    await expect(program.parseAsync(['balance', 'view', '--json'], { from: 'user' })).rejects.toThrow(
      'CLI:balance-view:json:processing failed:1'
    );

    expect(mockRunBalanceView).not.toHaveBeenCalled();
    expect(mockExitCliFailure).toHaveBeenCalledWith(
      'balance-view',
      expect.objectContaining({ error: prerequisiteError, exitCode: 1 }),
      'json'
    );
  });

  it('routes stored snapshot failures through the JSON CLI error path after prerequisites succeed', async () => {
    const program = createBalanceCommand();
    const failClosedError = new Error('stored snapshot read failed');

    const viewStoredSnapshots = vi.fn().mockResolvedValue(err(failClosedError));
    mockRunBalanceView.mockImplementation(viewStoredSnapshots);

    mockGetByName.mockResolvedValue(ok(createAccount({ id: 2, identifier: 'bc1-child', name: 'wallet-child' })));

    await expect(program.parseAsync(['balance', 'view', 'wallet-child', '--json'], { from: 'user' })).rejects.toThrow(
      'CLI:balance-view:json:stored snapshot read failed:1'
    );

    expect(viewStoredSnapshots).toHaveBeenCalledWith(
      expect.objectContaining({
        profile: expect.objectContaining({ id: 1 }),
      }),
      { accountId: 2 }
    );
    expect(mockExitCliFailure).toHaveBeenCalledWith(
      'balance-view',
      expect.objectContaining({ error: failClosedError, exitCode: 1 }),
      'json'
    );
  });

  it('renders the single-account stored snapshot TUI and closes the database first', async () => {
    const program = createBalanceCommand();
    let renderedElement: ReactElement | undefined;

    mockRunBalanceView.mockResolvedValue(
      ok({
        accounts: [
          {
            account: createAccount({ id: 9, identifier: 'xpub-balance' }),
            snapshot: {
              verificationStatus: 'match',
              statusReason: undefined,
              suggestion: 'Looks good',
              lastRefreshAt: new Date('2026-03-12T18:10:00.000Z'),
            },
            assets: [
              {
                assetId: 'blockchain:bitcoin:native',
                assetSymbol: 'BTC',
                calculatedBalance: '1.25',
                diagnostics: { txCount: 4 },
              },
            ],
          },
        ],
      })
    );
    mockRenderApp.mockImplementation(async (create: (unmount: () => void) => ReactElement) => {
      renderedElement = create(() => undefined);
    });

    mockGetByFingerprintRef.mockResolvedValue(
      ok(
        createAccount({
          id: 9,
          identifier: 'xpub-balance',
          accountFingerprint: '9abcde0000000000000000000000000000000000000000000000000000000000',
        })
      )
    );

    await program.parseAsync(['balance', 'view', '9abcde0000'], { from: 'user' });

    expect(mockWithBalanceCommandScope).toHaveBeenCalledWith(
      mockCtx,
      { format: 'text', needsWorkflow: false, prepareStoredSnapshots: true },
      expect.any(Function)
    );
    expect(mockCtx.closeDatabase).toHaveBeenCalledOnce();
    expect(mockRenderApp).toHaveBeenCalledOnce();
    expect(renderedElement?.type).toBe('BalanceApp');
    expect(mockOutputSuccess).not.toHaveBeenCalled();
  });

  it('falls back to the static list when balance view runs off-TTY', async () => {
    const program = createBalanceCommand();

    setTTYFlags(true, false);
    mockRunBalanceView.mockResolvedValue(
      ok({
        accounts: [
          {
            account: createAccount({
              id: 5,
              identifier: 'kraken-root',
              name: 'kraken-main',
              accountType: 'exchange-api',
            }),
            snapshot: {
              verificationStatus: 'warning',
              statusReason: 'Provider coverage incomplete',
              suggestion: 'Run refresh again',
              lastRefreshAt: new Date('2026-03-12T18:10:00.000Z'),
            },
            assets: [
              {
                assetId: 'exchange:kraken:btc',
                assetSymbol: 'BTC',
                calculatedBalance: '0.42',
                diagnostics: { txCount: 2 },
              },
            ],
          },
        ],
      })
    );

    await program.parseAsync(['balance', 'view'], { from: 'user' });

    expect(mockOutputBalanceStaticList).toHaveBeenCalledOnce();
    expect(mockRenderApp).not.toHaveBeenCalled();
    expect(mockCtx.closeDatabase).not.toHaveBeenCalled();
  });
});

function restoreTTYFlags(): void {
  if (originalStdinTTYDescriptor) {
    Object.defineProperty(process.stdin, 'isTTY', originalStdinTTYDescriptor);
  }

  if (originalStdoutTTYDescriptor) {
    Object.defineProperty(process.stdout, 'isTTY', originalStdoutTTYDescriptor);
  }
}

function setTTYFlags(stdinIsTTY: boolean, stdoutIsTTY: boolean): void {
  Object.defineProperty(process.stdin, 'isTTY', {
    configurable: true,
    value: stdinIsTTY,
  });
  Object.defineProperty(process.stdout, 'isTTY', {
    configurable: true,
    value: stdoutIsTTY,
  });
}
