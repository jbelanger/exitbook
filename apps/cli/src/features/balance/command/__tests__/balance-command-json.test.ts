/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return -- Vitest command-scope mocks intentionally use partial test doubles. */
import { err, ok } from '@exitbook/foundation';
import { Command } from 'commander';
import type { ReactElement } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { CliAppRuntime } from '../../../../runtime/app-runtime.js';

const {
  mockCtx,
  mockExitCliFailure,
  mockGetByFingerprintRef,
  mockGetByName,
  mockLoadBalanceVerificationAccounts,
  mockOutputSuccess,
  mockRenderApp,
  mockRunBalanceRefreshSingle,
  mockRunBalanceView,
  mockRunCommand,
  mockStartBalanceVerificationStream,
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
  mockLoadBalanceVerificationAccounts: vi.fn(),
  mockOutputSuccess: vi.fn(),
  mockRenderApp: vi.fn(),
  mockRunBalanceRefreshSingle: vi.fn(),
  mockRunBalanceView: vi.fn(),
  mockRunCommand: vi.fn(),
  mockStartBalanceVerificationStream: vi.fn(),
  mockWithBalanceCommandScope: vi.fn(),
}));

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
  abortBalanceVerification: vi.fn(),
  loadBalanceVerificationAccounts: mockLoadBalanceVerificationAccounts,
  runBalanceRefreshAll: vi.fn(),
  runBalanceRefreshSingle: mockRunBalanceRefreshSingle,
  runBalanceView: mockRunBalanceView,
  startBalanceVerificationStream: mockStartBalanceVerificationStream,
}));

vi.mock('../../view/balance-view-components.jsx', () => ({
  BalanceApp: 'BalanceApp',
}));

import { registerBalanceRefreshCommand } from '../balance-refresh.js';
import { registerBalanceViewCommand } from '../balance-view.js';

const appRuntime = {
  blockchainExplorersConfig: {},
} as CliAppRuntime;

function createBalanceCommand(): Command {
  const program = new Command();
  registerBalanceViewCommand(program, appRuntime);
  registerBalanceRefreshCommand(program, appRuntime);
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

describe('balance command JSON mode', () => {
  it('outputs stored snapshot JSON including requestedAccount for child scope requests', async () => {
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

    await program.parseAsync(['view', '--account-ref', '2bc1c1d0aa', '--json'], { from: 'user' });

    expect(mockWithBalanceCommandScope).toHaveBeenCalledWith(
      mockCtx,
      { format: 'json', needsWorkflow: true, prepareStoredSnapshots: true },
      expect.any(Function)
    );
    expect(viewStoredSnapshots).toHaveBeenCalledWith(
      expect.objectContaining({
        profile: expect.objectContaining({ id: 1 }),
      }),
      { accountId: 2 }
    );

    expect(mockOutputSuccess).toHaveBeenCalledWith(
      'balance-view',
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
        filters: { accountRef: '2bc1c1d0aa' },
      }
    );
  });

  it('routes processing-prerequisite failures through the JSON CLI error path', async () => {
    const program = createBalanceCommand();
    const prerequisiteError = new Error('processing failed');

    mockWithBalanceCommandScope.mockResolvedValue(err(prerequisiteError));

    await expect(program.parseAsync(['view', '--json'], { from: 'user' })).rejects.toThrow(
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

    await expect(
      program.parseAsync(['view', '--account-name', 'wallet-child', '--json'], { from: 'user' })
    ).rejects.toThrow('CLI:balance-view:json:stored snapshot read failed:1');

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

    await program.parseAsync(['view', '--account-ref', '9abcde0000'], { from: 'user' });

    expect(mockCtx.closeDatabase).toHaveBeenCalledOnce();
    expect(mockRenderApp).toHaveBeenCalledOnce();
    expect(renderedElement?.type).toBe('BalanceApp');
    expect(mockOutputSuccess).not.toHaveBeenCalled();
  });

  it('outputs refresh JSON including requestedAccount when a child request resolves to the parent scope', async () => {
    const program = createBalanceCommand();
    const scopeAccount = createAccount({
      id: 1,
      identifier: 'xpub-root',
      providerName: 'mempool',
    });
    const requestedAccount = createAccount({
      id: 2,
      identifier: 'bc1-child',
      name: 'wallet-child',
    });

    const comparisons = [
      {
        assetId: 'blockchain:bitcoin:native',
        assetSymbol: 'BTC',
        calculatedBalance: '1.25',
        liveBalance: '1.25',
        difference: '0',
        percentageDiff: 0,
        status: 'match',
        diagnostics: { txCount: 4 },
      },
    ];

    const refreshSingleScope = vi.fn().mockResolvedValue(
      ok({
        mode: 'verification',
        account: scopeAccount,
        requestedAccount,
        comparisons,
        verificationResult: {
          mode: 'verification',
          timestamp: '2026-03-12T18:10:00.000Z',
          status: 'match',
          summary: {
            matches: 1,
            mismatches: 0,
            warnings: 0,
            totalAssets: 1,
          },
          coverage: {
            status: 'complete',
            confidence: 'high',
            requestedAddresses: 1,
            successfulAddresses: 1,
            failedAddresses: 0,
            totalAssets: 1,
            parsedAssets: 1,
            failedAssets: 0,
            overallCoverageRatio: 1,
          },
          suggestion: 'Balances match',
          partialFailures: undefined,
          warnings: undefined,
        },
        streamMetadata: {
          normal: {
            totalFetched: 4,
          },
        },
      })
    );

    mockRunBalanceRefreshSingle.mockImplementation(refreshSingleScope);
    mockGetByName.mockResolvedValue(ok(requestedAccount));

    await program.parseAsync(['refresh', '--account-name', 'wallet-child', '--json'], { from: 'user' });

    expect(refreshSingleScope).toHaveBeenCalledWith(
      expect.objectContaining({
        profile: expect.objectContaining({ id: 1 }),
      }),
      { accountId: 2, credentials: undefined }
    );

    expect(mockOutputSuccess).toHaveBeenCalledWith(
      'balance-refresh',
      expect.objectContaining({
        status: 'match',
        balances: comparisons,
        account: {
          id: 1,
          type: 'blockchain',
          platformKey: 'bitcoin',
          identifier: 'xpub-root',
          providerName: 'mempool',
        },
        requestedAccount: {
          id: 2,
          type: 'blockchain',
          platformKey: 'bitcoin',
          identifier: 'bc1-child',
          providerName: undefined,
        },
        source: {
          type: 'blockchain',
          name: 'bitcoin',
          address: 'xpub-root',
        },
        meta: {
          timestamp: '2026-03-12T18:10:00.000Z',
          streams: {
            normal: {
              totalFetched: 4,
            },
          },
        },
        suggestion: 'Balances match',
      }),
      undefined
    );
  });

  it('outputs calculated-only refresh JSON when live verification is unavailable', async () => {
    const program = createBalanceCommand();
    const scopeAccount = createAccount({
      id: 74,
      identifier: 'lukso-address',
      platformKey: 'lukso',
    });
    const refreshSingleScope = vi.fn().mockResolvedValue(
      ok({
        mode: 'calculated-only',
        account: scopeAccount,
        assets: [
          {
            assetId: 'blockchain:lukso:native',
            assetSymbol: 'LYX',
            calculatedBalance: '12.5',
            diagnostics: { txCount: 4 },
          },
        ],
        verificationResult: {
          mode: 'calculated-only',
          timestamp: '2026-03-12T18:10:00.000Z',
          status: 'warning',
          summary: {
            matches: 0,
            mismatches: 0,
            warnings: 0,
            totalCurrencies: 1,
          },
          coverage: {
            status: 'partial',
            confidence: 'low',
            requestedAddresses: 1,
            successfulAddresses: 0,
            failedAddresses: 1,
            totalAssets: 1,
            parsedAssets: 0,
            failedAssets: 1,
            overallCoverageRatio: 0,
          },
          suggestion:
            'Stored calculated balances only. Add a balance-capable provider for lukso to enable live verification.',
          partialFailures: undefined,
          warnings: [
            'Live balance verification is unavailable for lukso: no registered provider supports getAddressBalances. Stored calculated balances only.',
          ],
        },
      })
    );

    mockRunBalanceRefreshSingle.mockImplementation(refreshSingleScope);
    mockGetByFingerprintRef.mockResolvedValue(ok(scopeAccount));

    await program.parseAsync(['refresh', '--account-ref', '74abcde000', '--json'], { from: 'user' });

    expect(refreshSingleScope).toHaveBeenCalledWith(
      expect.objectContaining({
        profile: expect.objectContaining({ id: 1 }),
      }),
      { accountId: 74, credentials: undefined }
    );

    expect(mockOutputSuccess).toHaveBeenCalledWith(
      'balance-refresh',
      expect.objectContaining({
        status: 'warning',
        mode: 'calculated-only',
        balances: [
          {
            assetId: 'blockchain:lukso:native',
            assetSymbol: 'LYX',
            calculatedBalance: '12.5',
            diagnostics: { txCount: 4 },
          },
        ],
        warnings: [
          'Live balance verification is unavailable for lukso: no registered provider supports getAddressBalances. Stored calculated balances only.',
        ],
      }),
      undefined
    );
  });

  it('renders the refresh-all TUI and wires the verification stream through the runtime', async () => {
    const program = createBalanceCommand();
    let renderedElement: ReactElement | undefined;

    mockLoadBalanceVerificationAccounts.mockResolvedValue(
      ok([
        {
          account: createAccount({ id: 21, identifier: 'kraken-root', accountType: 'exchange-api' }),
          accountId: 21,
          platformKey: 'kraken',
          accountType: 'exchange-api',
          skipReason: undefined,
        },
      ])
    );
    mockRenderApp.mockImplementation(async (create: (unmount: () => void) => ReactElement) => {
      renderedElement = create(() => undefined);
    });

    await program.parseAsync(['refresh'], { from: 'user' });

    expect(mockLoadBalanceVerificationAccounts).toHaveBeenCalledWith(
      expect.objectContaining({
        profile: expect.objectContaining({ id: 1 }),
      })
    );
    expect(mockStartBalanceVerificationStream).toHaveBeenCalledOnce();
    expect(mockCtx.onAbort).toHaveBeenCalledOnce();
    expect(mockRenderApp).toHaveBeenCalledOnce();
    expect(renderedElement?.type).toBe('BalanceApp');
  });
});
