/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return -- Vitest command-scope mocks intentionally use partial test doubles. */
import { ok } from '@exitbook/foundation';
import { Command } from 'commander';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { CliAppRuntime } from '../../../../runtime/app-runtime.js';
import type { EventRelay } from '../../../../ui/shared/event-relay.js';
import type { BalanceEvent } from '../../../balance/view/balance-view-state.js';

const {
  mockAwaitBalanceVerificationStream,
  mockCtx,
  mockExitCliFailure,
  mockGetByFingerprintRef,
  mockGetByName,
  mockLoadBalanceVerificationAccounts,
  mockOutputSuccess,
  mockRunBalanceRefreshSingle,
  mockRunCommand,
  mockStartBalanceVerificationStream,
  mockWithBalanceCommandScope,
} = vi.hoisted(() => ({
  mockAwaitBalanceVerificationStream: vi.fn(),
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
  mockRunBalanceRefreshSingle: vi.fn(),
  mockRunCommand: vi.fn(),
  mockStartBalanceVerificationStream: vi.fn(),
  mockWithBalanceCommandScope: vi.fn(),
}));

vi.mock('../../../../runtime/command-runtime.js', () => ({
  runCommand: mockRunCommand,
}));

vi.mock('../../../../cli/output.js', () => ({
  outputSuccess: mockOutputSuccess,
}));

vi.mock('../../../../cli/error.js', () => ({
  exitCliFailure: mockExitCliFailure,
}));

vi.mock('../../../balance/command/balance-command-scope.js', () => ({
  withBalanceCommandScope: mockWithBalanceCommandScope,
}));

vi.mock('../../../balance/command/run-balance.js', () => ({
  abortBalanceVerification: vi.fn(),
  awaitBalanceVerificationStream: mockAwaitBalanceVerificationStream,
  loadBalanceVerificationAccounts: mockLoadBalanceVerificationAccounts,
  runBalanceRefreshAll: vi.fn(),
  runBalanceRefreshSingle: mockRunBalanceRefreshSingle,
  startBalanceVerificationStream: mockStartBalanceVerificationStream,
}));

import { registerAccountsCommand } from '../accounts.js';

function createAccountsCommand(): Command {
  const program = new Command();
  registerAccountsCommand(program, { blockchainExplorersConfig: {} } as CliAppRuntime);
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
  mockAwaitBalanceVerificationStream.mockResolvedValue(undefined);
  mockExitCliFailure.mockImplementation(
    (command: string, failure: { error: Error; exitCode: number }, format: 'json' | 'text') => {
      throw new Error(`CLI:${command}:${format}:${failure.error.message}:${failure.exitCode}`);
    }
  );
});

describe('accounts refresh command', () => {
  it('outputs refresh JSON including requestedAccount when a child request resolves to the parent scope', async () => {
    const program = createAccountsCommand();
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

    mockRunBalanceRefreshSingle.mockResolvedValue(
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
    mockGetByName.mockResolvedValue(ok(requestedAccount));

    await program.parseAsync(['accounts', 'refresh', 'wallet-child', '--json'], { from: 'user' });

    expect(mockRunBalanceRefreshSingle).toHaveBeenCalledWith(
      expect.objectContaining({
        profile: expect.objectContaining({ id: 1 }),
      }),
      { accountId: 2 }
    );

    expect(mockOutputSuccess).toHaveBeenCalledWith(
      'accounts-refresh',
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
    const program = createAccountsCommand();
    const scopeAccount = createAccount({
      id: 74,
      identifier: 'lukso-address',
      platformKey: 'lukso',
    });

    mockRunBalanceRefreshSingle.mockResolvedValue(
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
    mockGetByFingerprintRef.mockResolvedValue(ok(scopeAccount));

    await program.parseAsync(['accounts', 'refresh', '74abcde000', '--json'], { from: 'user' });

    expect(mockRunBalanceRefreshSingle).toHaveBeenCalledWith(
      expect.objectContaining({
        profile: expect.objectContaining({ id: 1 }),
      }),
      { accountId: 74 }
    );

    expect(mockOutputSuccess).toHaveBeenCalledWith(
      'accounts-refresh',
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

  it('prints a text progress summary for single-account refresh', async () => {
    const program = createAccountsCommand();
    const consoleLog = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const scopeAccount = createAccount({
      id: 21,
      identifier: 'kraken-root',
      name: 'kraken-main',
      accountType: 'exchange-api',
      platformKey: 'kraken',
    });

    mockRunBalanceRefreshSingle.mockResolvedValue(
      ok({
        mode: 'verification',
        account: scopeAccount,
        requestedAccount: undefined,
        comparisons: [
          {
            assetId: 'exchange:kraken:btc',
            assetSymbol: 'BTC',
            calculatedBalance: '0.42',
            liveBalance: '0.42',
            difference: '0',
            percentageDiff: 0,
            status: 'match',
            diagnostics: { txCount: 2 },
          },
        ],
        verificationResult: {
          mode: 'verification',
          timestamp: '2026-03-12T18:10:00.000Z',
          status: 'match',
          summary: {
            matches: 1,
            mismatches: 0,
            warnings: 0,
            totalCurrencies: 1,
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
        streamMetadata: undefined,
      })
    );
    mockGetByName.mockResolvedValue(ok(scopeAccount));

    await program.parseAsync(['accounts', 'refresh', 'kraken-main'], { from: 'user' });

    expect(consoleLog).toHaveBeenCalledWith(expect.stringContaining('Refreshing kraken-main (kraken)...'));
    expect(consoleLog).toHaveBeenCalledWith(expect.stringContaining('kraken-main (kraken): match'));
    consoleLog.mockRestore();
  });

  it('prints all-account refresh progress and wires the verification stream through the runtime', async () => {
    const program = createAccountsCommand();
    const consoleLog = vi.spyOn(console, 'log').mockImplementation(() => undefined);

    mockLoadBalanceVerificationAccounts.mockResolvedValue(
      ok([
        {
          account: createAccount({
            id: 21,
            identifier: 'kraken-root',
            accountType: 'exchange-api',
            name: 'kraken',
            platformKey: 'kraken',
          }),
          accountId: 21,
          platformKey: 'kraken',
          accountType: 'exchange-api',
          skipReason: undefined,
        },
      ])
    );
    mockStartBalanceVerificationStream.mockImplementation((_scope, _accounts, relay: EventRelay<BalanceEvent>) => {
      relay.push({ type: 'VERIFICATION_STARTED', accountId: 21 });
      relay.push({
        type: 'VERIFICATION_COMPLETED',
        accountId: 21,
        result: {
          accountId: 21,
          platformKey: 'kraken',
          accountType: 'exchange-api',
          status: 'success',
          assetCount: 1,
          matchCount: 1,
          mismatchCount: 0,
          warningCount: 0,
        },
      });
      relay.push({ type: 'ALL_VERIFICATIONS_COMPLETE' });
    });

    await program.parseAsync(['accounts', 'refresh'], { from: 'user' });

    expect(mockLoadBalanceVerificationAccounts).toHaveBeenCalledWith(
      expect.objectContaining({
        profile: expect.objectContaining({ id: 1 }),
      })
    );
    expect(mockStartBalanceVerificationStream).toHaveBeenCalledOnce();
    expect(mockAwaitBalanceVerificationStream).toHaveBeenCalledOnce();
    expect(mockCtx.onAbort).toHaveBeenCalledOnce();
    expect(consoleLog).toHaveBeenCalledWith(expect.stringContaining('Refreshing balances for 1 account'));
    expect(consoleLog).toHaveBeenCalledWith(expect.stringContaining('kraken (kraken): success'));
    expect(consoleLog).toHaveBeenCalledWith(expect.stringContaining('Refresh complete: 1 total'));
    consoleLog.mockRestore();
  });
});
