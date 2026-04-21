/* eslint-disable @typescript-eslint/no-unsafe-assignment -- acceptable for tests */
import { err, ok } from '@exitbook/foundation';
import { Command } from 'commander';
import type { ReactElement } from 'react';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  captureTerminalInteractivity,
  restoreTerminalInteractivity,
  setTerminalInteractivity,
} from '../../../../runtime/__tests__/terminal-test-utils.js';
import type { CliAppRuntime } from '../../../../runtime/app-runtime.js';

const {
  mockComputeCategoryCounts,
  mockFindAccountByName,
  mockFindAllAccounts,
  mockFindRawTransactionsByTransactionId,
  mockCreateTransactionsViewState,
  mockCtx,
  mockExitCliFailure,
  mockExportExecute,
  mockFindByFingerprintRef,
  mockOutputSuccess,
  mockOutputTransactionStaticDetail,
  mockOutputTransactionsStaticList,
  mockPrepareTransactionsCommandScope,
  mockReadTransactionAnnotationsForCommand,
  mockReadTransactionsForCommand,
  mockRenderApp,
  mockRunCommand,
  mockToTransactionViewItem,
  mockToTransactionViewItems,
  mockWriteFilesWithAtomicRenames,
} = vi.hoisted(() => ({
  mockComputeCategoryCounts: vi.fn(),
  mockFindAccountByName: vi.fn(),
  mockFindAllAccounts: vi.fn(),
  mockFindRawTransactionsByTransactionId: vi.fn(),
  mockCreateTransactionsViewState: vi.fn(),
  mockCtx: { tag: 'command-runtime' },
  mockExitCliFailure: vi.fn(),
  mockExportExecute: vi.fn(),
  mockFindByFingerprintRef: vi.fn(),
  mockOutputSuccess: vi.fn(),
  mockOutputTransactionStaticDetail: vi.fn(),
  mockOutputTransactionsStaticList: vi.fn(),
  mockPrepareTransactionsCommandScope: vi.fn(),
  mockReadTransactionAnnotationsForCommand: vi.fn(),
  mockReadTransactionsForCommand: vi.fn(),
  mockRenderApp: vi.fn(),
  mockRunCommand: vi.fn(),
  mockToTransactionViewItem: vi.fn(),
  mockToTransactionViewItems: vi.fn(),
  mockWriteFilesWithAtomicRenames: vi.fn(),
}));

vi.mock('../../../../runtime/command-runtime.js', () => ({
  CommandRuntime: class {},
  renderApp: mockRenderApp,
  runCommand: mockRunCommand,
}));

vi.mock('../../../../cli/error.js', () => ({
  exitCliFailure: mockExitCliFailure,
}));

vi.mock('../../../../cli/output.js', () => ({
  outputSuccess: mockOutputSuccess,
}));

vi.mock('../../../shared/file-utils.js', () => ({
  writeFilesWithAtomicRenames: mockWriteFilesWithAtomicRenames,
}));

vi.mock('../../view/transactions-static-renderer.js', () => ({
  outputTransactionStaticDetail: mockOutputTransactionStaticDetail,
  outputTransactionsStaticList: mockOutputTransactionsStaticList,
}));

vi.mock('../transactions-command-scope.js', () => ({
  prepareTransactionsCommandScope: mockPrepareTransactionsCommandScope,
}));

vi.mock('../transactions-read-support.js', () => ({
  readTransactionAnnotationsForCommand: mockReadTransactionAnnotationsForCommand,
  readTransactionsForCommand: mockReadTransactionsForCommand,
}));

vi.mock('../transactions-browse-utils.js', () => ({
  buildTransactionsJsonFiltersWithResolvedAccount: vi.fn(
    (params: {
      account?: string | undefined;
      address?: string | undefined;
      assetId?: string | undefined;
      assetSymbol?: string | undefined;
      from?: string | undefined;
      noPrice?: boolean | undefined;
      operationType?: string | undefined;
      platform?: string | undefined;
      since?: string | undefined;
      to?: string | undefined;
      until?: string | undefined;
    }) => {
      const filters = Object.fromEntries(
        Object.entries({
          account: params.account,
          platform: params.platform,
          asset: params.assetSymbol,
          assetId: params.assetId,
          address: params.address,
          from: params.from,
          to: params.to,
          since: params.since,
          until: params.until,
          operationType: params.operationType,
          noPrice: params.noPrice ? true : undefined,
        }).filter(([, value]) => value !== undefined)
      );

      return Object.keys(filters).length > 0 ? filters : undefined;
    }
  ),
  buildTransactionsViewFilters: vi.fn(
    (params: {
      account?: string | undefined;
      address?: string | undefined;
      assetId?: string | undefined;
      assetSymbol?: string | undefined;
      from?: string | undefined;
      noPrice?: boolean | undefined;
      operationType?: string | undefined;
      platform?: string | undefined;
      to?: string | undefined;
    }) => ({
      accountFilter: params.account,
      platformFilter: params.platform,
      assetIdFilter: params.assetId,
      assetFilter: params.assetSymbol,
      addressFilter: params.address,
      fromFilter: params.from,
      toFilter: params.to,
      operationTypeFilter: params.operationType,
      noPriceFilter: params.noPrice,
    })
  ),
  generateDefaultPath: vi.fn(() => 'data/kraken-transactions.json'),
  parseSinceToUnixSeconds: vi.fn((since: string | undefined) => {
    if (!since) {
      return ok(undefined);
    }

    const date = new Date(since);
    if (Number.isNaN(date.getTime())) {
      return err(new Error(`Invalid date format: ${since}`));
    }

    return ok(Math.floor(date.getTime() / 1000));
  }),
  validateUntilDate: vi.fn((until: string | undefined) => {
    if (!until) {
      return ok(undefined);
    }

    const date = new Date(until);
    if (Number.isNaN(date.getTime())) {
      return err(new Error(`Invalid date format: ${until}`));
    }

    return ok(undefined);
  }),
}));

vi.mock('../../transaction-view-projection.js', () => ({
  toTransactionViewItem: mockToTransactionViewItem,
  toTransactionViewItems: mockToTransactionViewItems,
}));

vi.mock('../transactions-export-handler.js', () => ({
  TransactionsExportHandler: class {
    execute = mockExportExecute;
  },
}));

vi.mock('../../view/index.js', () => ({
  TransactionsViewApp: 'TransactionsViewApp',
  computeCategoryCounts: mockComputeCategoryCounts,
  createTransactionsViewState: mockCreateTransactionsViewState,
}));

import { registerTransactionsExploreCommand } from '../transactions-explore.js';

const originalTerminalInteractivity = captureTerminalInteractivity();
const mockAppRuntime = { tag: 'app-runtime' } as unknown as CliAppRuntime;

function createProgram(): Command {
  const program = new Command();
  registerTransactionsExploreCommand(program.command('transactions'), mockAppRuntime);
  return program;
}

interface ReadTransactionsCommandCall {
  accountIds?: number[] | undefined;
  address?: string | undefined;
  assetId?: string | undefined;
  assetSymbol?: string | undefined;
  db: {
    accounts: {
      findAll: unknown;
      findByName: unknown;
    };
    transactions: {
      findByFingerprintRef: unknown;
      findRawTransactionsByTransactionId: unknown;
    };
  };
  from?: string | undefined;
  noPrice?: boolean | undefined;
  operationType?: string | undefined;
  platformKey?: string | undefined;
  profileId: number;
  since?: number | undefined;
  to?: string | undefined;
  until?: string | undefined;
}

function getReadTransactionsCommandCall(index: number): ReadTransactionsCommandCall | undefined {
  return mockReadTransactionsForCommand.mock.calls[index]?.[0] as ReadTransactionsCommandCall | undefined;
}

describe('transactions explore command', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setTerminalInteractivity(true);
    mockRunCommand.mockImplementation(async (...args: unknown[]) => {
      const fn = (typeof args[0] === 'function' ? args[0] : args[1]) as (ctx: typeof mockCtx) => Promise<void>;
      await fn(mockCtx);
    });
    mockExitCliFailure.mockImplementation(
      (command: string, failure: { error: Error; exitCode: number }, format: 'json' | 'text') => {
        throw new Error(`CLI:${command}:${format}:${failure.error.message}:${failure.exitCode}`);
      }
    );
    mockPrepareTransactionsCommandScope.mockResolvedValue(
      ok({
        database: {
          tag: 'db',
          accounts: {
            create: vi.fn(),
            findAll: mockFindAllAccounts,
            findByFingerprintRef: vi.fn(),
            findById: vi.fn(),
            findByIdentifier: vi.fn(),
            findByIdentity: vi.fn(),
            findByName: mockFindAccountByName,
            update: vi.fn(),
          },
          assetReview: {
            listAll: vi.fn().mockResolvedValue(ok([])),
          },
          profiles: {
            list: vi.fn().mockResolvedValue(ok([])),
          },
          transactionAnnotations: {
            readAnnotations: vi.fn().mockResolvedValue(ok([])),
          },
          transactions: {
            findAll: vi.fn().mockResolvedValue(ok([])),
            findByFingerprintRef: mockFindByFingerprintRef,
            findRawTransactionsByTransactionId: mockFindRawTransactionsByTransactionId,
          },
          transactionLinks: {
            findAll: vi.fn().mockResolvedValue(ok([])),
          },
        },
        dataDir: '/tmp/exitbook-cli-tests',
        profile: {
          id: 1,
          profileKey: 'default',
          displayName: 'default',
          createdAt: new Date('2026-03-01T00:00:00.000Z'),
        },
      })
    );
    mockFindAllAccounts.mockResolvedValue(ok([]));
    mockFindAccountByName.mockResolvedValue(ok(undefined));
    mockReadTransactionsForCommand.mockResolvedValue(ok([{ id: 1 }, { id: 2 }]));
    mockReadTransactionAnnotationsForCommand.mockResolvedValue(ok([]));
    mockFindByFingerprintRef.mockResolvedValue(ok(undefined));
    mockFindRawTransactionsByTransactionId.mockResolvedValue(ok([]));
    mockToTransactionViewItem.mockImplementation((transaction: { id: number; txFingerprint?: string | undefined }) => ({
      annotations: [],
      id: transaction.id,
      platformKey: 'kraken',
      txFingerprint: transaction.txFingerprint ?? `fingerprint-${transaction.id}`,
    }));
    mockToTransactionViewItems.mockImplementation(
      (transactions: { id: number; txFingerprint?: string | undefined }[]) =>
        transactions.map((transaction) => ({
          annotations: [],
          id: transaction.id,
          platformKey: 'kraken',
          txFingerprint: transaction.txFingerprint ?? `fingerprint-${transaction.id}`,
        }))
    );
    mockComputeCategoryCounts.mockReturnValue({ trade: 2 });
    mockCreateTransactionsViewState.mockReturnValue({ tag: 'view-state' });
    mockExportExecute.mockResolvedValue(
      ok({
        outputs: [{ path: '/tmp/transactions.json', content: '{}' }],
        transactionCount: 2,
        format: 'json',
        csvFormat: undefined,
      })
    );
    mockWriteFilesWithAtomicRenames.mockResolvedValue(ok(['/tmp/transactions.json']));
  });

  afterAll(() => {
    restoreTerminalInteractivity(originalTerminalInteractivity);
  });

  it('outputs JSON through the shared boundary with the normalized command id', async () => {
    const program = createProgram();

    await program.parseAsync(['transactions', 'explore', '--platform', 'kraken', '--json'], { from: 'user' });

    expect(mockPrepareTransactionsCommandScope).toHaveBeenCalledWith(mockCtx, { format: 'json' });
    const firstReadTransactionsCall = getReadTransactionsCommandCall(0);
    expect(firstReadTransactionsCall).toMatchObject({
      profileId: 1,
      accountIds: undefined,
      platformKey: 'kraken',
      address: undefined,
      from: undefined,
      to: undefined,
      since: undefined,
      until: undefined,
      assetId: undefined,
      assetSymbol: undefined,
      operationType: undefined,
      noPrice: undefined,
    });
    expect(firstReadTransactionsCall?.db.accounts.findAll).toBe(mockFindAllAccounts);
    expect(firstReadTransactionsCall?.db.accounts.findByName).toBe(mockFindAccountByName);
    expect(firstReadTransactionsCall?.db.transactions.findByFingerprintRef).toBe(mockFindByFingerprintRef);
    expect(firstReadTransactionsCall?.db.transactions.findRawTransactionsByTransactionId).toBe(
      mockFindRawTransactionsByTransactionId
    );
    expect(mockOutputSuccess).toHaveBeenCalledWith(
      'transactions-explore',
      {
        data: [
          { annotations: [], id: 1, platformKey: 'kraken', txFingerprint: 'fingerprint-1' },
          { annotations: [], id: 2, platformKey: 'kraken', txFingerprint: 'fingerprint-2' },
        ],
        meta: {
          count: 2,
          offset: 0,
          limit: 50,
          hasMore: false,
          filters: {
            platform: 'kraken',
          },
        },
      },
      undefined
    );
  });

  it('resolves --account to the selected account subtree before reading transactions', async () => {
    const program = createProgram();
    const rootAccount = {
      id: 7,
      profileId: 1,
      name: 'wallet-main',
      parentAccountId: undefined,
      accountType: 'blockchain',
      platformKey: 'bitcoin',
      identifier: 'bc1-root',
      accountFingerprint: '7aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      createdAt: new Date('2026-03-01T00:00:00.000Z'),
      updatedAt: undefined,
    };
    const childAccount = {
      ...rootAccount,
      id: 8,
      name: undefined,
      parentAccountId: 7,
      identifier: 'bc1-child',
      accountFingerprint: '8bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
    };

    mockFindAccountByName.mockResolvedValue(ok(rootAccount));
    mockFindAllAccounts.mockImplementation(async (filters?: { parentAccountId?: number | undefined }) => {
      if (filters?.parentAccountId === rootAccount.id) {
        return ok([childAccount]);
      }

      if (filters?.parentAccountId === childAccount.id) {
        return ok([]);
      }

      return ok([rootAccount, childAccount]);
    });

    await program.parseAsync(['transactions', 'explore', '--account', 'wallet-main', '--json'], { from: 'user' });

    const accountReadTransactionsCall = getReadTransactionsCommandCall(0);
    expect(accountReadTransactionsCall).toMatchObject({
      profileId: 1,
      accountIds: [7, 8],
      platformKey: undefined,
      address: undefined,
      from: undefined,
      to: undefined,
      since: undefined,
      until: undefined,
      assetId: undefined,
      assetSymbol: undefined,
      operationType: undefined,
      noPrice: undefined,
    });
    expect(accountReadTransactionsCall?.db.accounts.findAll).toBe(mockFindAllAccounts);
    expect(accountReadTransactionsCall?.db.accounts.findByName).toBe(mockFindAccountByName);
    expect(accountReadTransactionsCall?.db.transactions.findByFingerprintRef).toBe(mockFindByFingerprintRef);
    expect(accountReadTransactionsCall?.db.transactions.findRawTransactionsByTransactionId).toBe(
      mockFindRawTransactionsByTransactionId
    );
    expect(mockOutputSuccess).toHaveBeenCalledWith(
      'transactions-explore',
      expect.objectContaining({
        meta: expect.objectContaining({
          filters: {
            account: 'wallet-main',
          },
        }),
      }),
      undefined
    );
  });

  it('treats invalid --until values as invalid-args failures before loading transactions', async () => {
    const program = createProgram();

    await expect(
      program.parseAsync(['transactions', 'explore', '--until', 'not-a-date', '--json'], { from: 'user' })
    ).rejects.toThrow('CLI:transactions-explore:json:Invalid date format: not-a-date:2');

    expect(mockPrepareTransactionsCommandScope).not.toHaveBeenCalled();
    expect(mockReadTransactionsForCommand).not.toHaveBeenCalled();
  });

  it('renders the TUI and preserves the parsed --since filter for inline export', async () => {
    const program = createProgram();
    let renderedElement: ReactElement | undefined;

    mockRenderApp.mockImplementation(async (create: (unmount: () => void) => ReactElement) => {
      renderedElement = create(() => undefined);
    });

    await program.parseAsync(
      [
        'transactions',
        'explore',
        '--platform',
        'kraken',
        '--since',
        '2024-01-15',
        '--annotation-kind',
        'bridge_participant',
        '--annotation-tier',
        'heuristic',
      ],
      {
        from: 'user',
      }
    );

    expect(mockPrepareTransactionsCommandScope).toHaveBeenCalledWith(mockCtx, { format: 'text' });
    expect(mockRenderApp).toHaveBeenCalledOnce();
    expect(renderedElement?.type).toBe('TransactionsViewApp');
    const appElement = renderedElement as ReactElement<{
      onExport: (format: 'json' | 'csv', csvFormat?: 'normalized' | 'simple') => Promise<unknown>;
    }>;
    const exportResult = await appElement.props.onExport('json', undefined);
    expect(mockExportExecute).toHaveBeenCalledWith({
      profileId: 1,
      accountIds: undefined,
      platformKey: 'kraken',
      format: 'json',
      csvFormat: undefined,
      outputPath: 'data/kraken-transactions.json',
      since: Math.floor(new Date('2024-01-15').getTime() / 1000),
      until: undefined,
      assetId: undefined,
      assetSymbol: undefined,
      operationType: undefined,
      annotationKind: 'bridge_participant',
      annotationTier: 'heuristic',
      noPrice: undefined,
    });
    expect(mockWriteFilesWithAtomicRenames).toHaveBeenCalledWith([{ path: '/tmp/transactions.json', content: '{}' }]);
    expect(exportResult).toEqual(
      ok({
        outputPaths: ['/tmp/transactions.json'],
        transactionCount: 2,
      })
    );
  });

  it('preselects the requested transaction when explore is called with a selector', async () => {
    const program = createProgram();
    let renderedElement: ReactElement | undefined;
    const selected = { id: 2, txFingerprint: 'bbbbbbbbbb-selected' };

    mockFindByFingerprintRef.mockResolvedValue(ok(selected));
    mockReadTransactionsForCommand.mockResolvedValue(ok([{ id: 1, txFingerprint: 'aaaa' }, selected]));
    mockRenderApp.mockImplementation(async (create: (unmount: () => void) => ReactElement) => {
      renderedElement = create(() => undefined);
    });

    await program.parseAsync(['transactions', 'explore', 'bbbbbbbbbb'], { from: 'user' });

    expect(mockFindByFingerprintRef).toHaveBeenCalledWith(1, 'bbbbbbbbbb');
    expect(mockCreateTransactionsViewState).toHaveBeenCalledWith(
      [
        { annotations: [], id: 1, platformKey: 'kraken', txFingerprint: 'aaaa' },
        { annotations: [], id: 2, platformKey: 'kraken', txFingerprint: 'bbbbbbbbbb-selected' },
      ],
      {
        accountFilter: undefined,
        annotationKindFilter: undefined,
        annotationTierFilter: undefined,
        addressFilter: undefined,
        platformFilter: undefined,
        assetIdFilter: undefined,
        assetFilter: undefined,
        fromFilter: undefined,
        toFilter: undefined,
        operationTypeFilter: undefined,
        noPriceFilter: undefined,
      },
      2,
      { trade: 2 },
      1
    );
    expect(renderedElement?.type).toBe('TransactionsViewApp');
  });

  it('rejects combining a selector with limit or list filters', async () => {
    const program = createProgram();

    await expect(
      program.parseAsync(['transactions', 'explore', 'bbbbbbbbbb', '--limit', '100'], { from: 'user' })
    ).rejects.toThrow(
      'CLI:transactions-explore:text:Transaction selector cannot be combined with --account, --platform, --asset, --asset-id, --address, --from, --to, --since, --until, --operation-type, --annotation-kind, --annotation-tier, --no-price, or --limit:2'
    );

    expect(mockPrepareTransactionsCommandScope).not.toHaveBeenCalled();
    expect(mockReadTransactionsForCommand).not.toHaveBeenCalled();
  });

  it('rejects --source-data without a selector', async () => {
    const program = createProgram();

    await expect(program.parseAsync(['transactions', 'explore', '--source-data'], { from: 'user' })).rejects.toThrow(
      'CLI:transactions-explore:text:--source-data requires a transaction selector:2'
    );

    expect(mockPrepareTransactionsCommandScope).not.toHaveBeenCalled();
  });

  it('renders selector detail as JSON with full source data when --source-data is requested', async () => {
    const program = createProgram();
    const selected = { id: 2, txFingerprint: 'bbbbbbbbbb-selected' };

    mockFindByFingerprintRef.mockResolvedValue(ok(selected));
    mockFindRawTransactionsByTransactionId.mockResolvedValue(
      ok([
        {
          accountId: 1,
          blockchainTransactionHash: undefined,
          createdAt: new Date('2026-03-02T00:00:00.000Z'),
          eventId: 'evt-1',
          id: 301,
          normalizedData: { normalized: true },
          processedAt: new Date('2026-03-02T00:00:00.000Z'),
          processingStatus: 'processed',
          providerData: { amount: '1.25' },
          providerName: 'kraken',
          sourceAddress: undefined,
          timestamp: Date.parse('2026-03-01T12:00:00.000Z'),
          transactionTypeHint: 'trade',
        },
      ])
    );

    await program.parseAsync(['transactions', 'explore', 'bbbbbbbbbb', '--source-data', '--json'], { from: 'user' });

    expect(mockFindRawTransactionsByTransactionId).toHaveBeenCalledWith(selected.id, 1);
    expect(mockOutputSuccess).toHaveBeenCalledWith(
      'transactions-explore',
      expect.objectContaining({
        data: expect.objectContaining({
          sourceLineage: [
            expect.objectContaining({
              rawTransactionId: 301,
              providerName: 'kraken',
              eventId: 'evt-1',
            }),
          ],
          sourceData: [
            expect.objectContaining({
              rawTransactionId: 301,
              providerName: 'kraken',
              eventId: 'evt-1',
              providerPayload: { amount: '1.25' },
              normalizedPayload: { normalized: true },
            }),
          ],
        }),
      }),
      undefined
    );
  });

  it('falls back to static detail for selector source dumps on interactive terminals', async () => {
    const program = createProgram();
    const selected = { id: 2, txFingerprint: 'bbbbbbbbbb-selected' };

    mockFindByFingerprintRef.mockResolvedValue(ok(selected));
    mockFindRawTransactionsByTransactionId.mockResolvedValue(ok([]));

    await program.parseAsync(['transactions', 'explore', 'bbbbbbbbbb', '--source-data'], { from: 'user' });

    expect(mockRenderApp).not.toHaveBeenCalled();
    expect(mockOutputTransactionStaticDetail).toHaveBeenCalledWith(
      expect.objectContaining({
        id: selected.id,
        txFingerprint: selected.txFingerprint,
      })
    );
  });
});
