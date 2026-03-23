import { err, ok } from '@exitbook/core';
import { Command } from 'commander';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { CliAppRuntime } from '../../../../composition/runtime.js';

const { mockCreateBalanceHandler, mockCtx, mockDisplayCliError, mockOutputSuccess, mockRunCommand } = vi.hoisted(
  () => ({
    mockCreateBalanceHandler: vi.fn(),
    mockCtx: {
      database: vi.fn(),
    },
    mockDisplayCliError: vi.fn(),
    mockOutputSuccess: vi.fn(),
    mockRunCommand: vi.fn(),
  })
);

vi.mock('../../../shared/command-runtime.js', () => ({
  renderApp: vi.fn(),
  runCommand: mockRunCommand,
}));

vi.mock('../../../shared/json-output.js', () => ({
  outputSuccess: mockOutputSuccess,
}));

vi.mock('../../../shared/cli-error.js', () => ({
  displayCliError: mockDisplayCliError,
}));

vi.mock('../balance-handler.js', () => ({
  createBalanceHandler: mockCreateBalanceHandler,
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
  accountType?: 'blockchain' | 'exchange-api' | 'exchange-csv';
  id: number;
  identifier?: string;
  providerName?: string | undefined;
  sourceName?: string;
}): {
  accountType: 'blockchain' | 'exchange-api' | 'exchange-csv';
  id: number;
  identifier: string;
  providerName?: string | undefined;
  sourceName: string;
} {
  return {
    accountType: overrides.accountType ?? 'blockchain',
    id: overrides.id,
    identifier: overrides.identifier ?? `identifier-${overrides.id}`,
    providerName: overrides.providerName,
    sourceName: overrides.sourceName ?? 'bitcoin',
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockCtx.database.mockResolvedValue({});
  mockRunCommand.mockImplementation(async (fn: (ctx: typeof mockCtx) => Promise<void>) => {
    await fn(mockCtx);
  });
  mockDisplayCliError.mockImplementation(
    (command: string, error: Error, _exitCode: number, format: 'json' | 'text') => {
      throw new Error(`CLI:${command}:${format}:${error.message}`);
    }
  );
});

describe('balance command JSON mode', () => {
  it('outputs stored snapshot JSON including requestedAccount for child scope requests', async () => {
    const program = createBalanceCommand();
    const scopeAccount = createAccount({ id: 1, identifier: 'xpub-root' });
    const requestedAccount = createAccount({ id: 2, identifier: 'bc1-child' });

    mockCreateBalanceHandler.mockResolvedValue(
      ok({
        viewStoredSnapshots: vi.fn().mockResolvedValue(
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
        ),
      })
    );

    await program.parseAsync(['view', '--account-id', '2', '--json'], { from: 'user' });

    expect(mockOutputSuccess).toHaveBeenCalledWith(
      'balance-view',
      {
        accounts: [
          {
            accountId: 1,
            sourceName: 'bitcoin',
            accountType: 'blockchain',
            requestedAccount: {
              id: 2,
              sourceName: 'bitcoin',
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
        filters: { accountId: 2 },
      }
    );
  });

  it('routes fail-closed stored snapshot errors through the JSON CLI error path', async () => {
    const program = createBalanceCommand();
    const failClosedError = new Error(
      'Stored balance snapshot for scope account #1 (bitcoin) is stale because processed transactions were reset, which invalidated stored balance snapshots for all scopes. Run "exitbook balance refresh" to rebuild all stored balances, or "exitbook balance refresh --account-id 2" to rebuild only the requested scope.'
    );

    mockCreateBalanceHandler.mockResolvedValue(
      ok({
        viewStoredSnapshots: vi.fn().mockResolvedValue(err(failClosedError)),
      })
    );

    await expect(program.parseAsync(['view', '--account-id', '2', '--json'], { from: 'user' })).rejects.toThrow(
      'CLI:balance-view:json:Stored balance snapshot for scope account #1 (bitcoin) is stale because processed transactions were reset, which invalidated stored balance snapshots for all scopes. Run "exitbook balance refresh" to rebuild all stored balances, or "exitbook balance refresh --account-id 2" to rebuild only the requested scope.'
    );

    expect(mockDisplayCliError).toHaveBeenCalledWith('balance-view', failClosedError, 1, 'json');
  });

  it('outputs refresh JSON including requestedAccount when a child request resolves to the parent scope', async () => {
    const program = createBalanceCommand();
    const scopeAccount = createAccount({
      id: 1,
      identifier: 'xpub-root',
      providerName: 'mempool',
    });
    const requestedAccount = createAccount({ id: 2, identifier: 'bc1-child' });

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

    mockCreateBalanceHandler.mockResolvedValue(
      ok({
        refreshSingleScope: vi.fn().mockResolvedValue(
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
        ),
      })
    );

    await program.parseAsync(['refresh', '--account-id', '2', '--json'], { from: 'user' });

    expect(mockOutputSuccess).toHaveBeenCalledWith(
      'balance-refresh',
      expect.objectContaining({
        status: 'match',
        balances: comparisons,
        account: {
          id: 1,
          type: 'blockchain',
          sourceName: 'bitcoin',
          identifier: 'xpub-root',
          providerName: 'mempool',
        },
        requestedAccount: {
          id: 2,
          type: 'blockchain',
          sourceName: 'bitcoin',
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
      })
    );
  });

  it('outputs calculated-only refresh JSON when live verification is unavailable', async () => {
    const program = createBalanceCommand();
    const scopeAccount = createAccount({
      id: 74,
      identifier: 'lukso-address',
      sourceName: 'lukso',
    });

    mockCreateBalanceHandler.mockResolvedValue(
      ok({
        refreshSingleScope: vi.fn().mockResolvedValue(
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
        ),
      })
    );

    await program.parseAsync(['refresh', '--account-id', '74', '--json'], { from: 'user' });

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
      })
    );
  });
});
