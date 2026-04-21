/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-return -- Command-boundary tests intentionally mock generic runtime options and completion objects. */
import { buildLinkGapIssueKey } from '@exitbook/accounting/linking';
import { ok } from '@exitbook/foundation';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  mockBuildProfileLinkGapAnalysis,
  mockBuildProfileLinkGapSourceReader,
  mockOutputResolvedLinkGapsStaticList,
  mockOverrideStoreConstructor,
  mockOverrideStoreInstance,
  mockReadResolvedLinkGapExceptions,
  mockResolveCommandProfile,
  mockRunCliRuntimeCommand,
} = vi.hoisted(() => ({
  mockBuildProfileLinkGapAnalysis: vi.fn(),
  mockBuildProfileLinkGapSourceReader: vi.fn(),
  mockOutputResolvedLinkGapsStaticList: vi.fn(),
  mockOverrideStoreConstructor: vi.fn(),
  mockOverrideStoreInstance: { tag: 'override-store' },
  mockReadResolvedLinkGapExceptions: vi.fn(),
  mockResolveCommandProfile: vi.fn(),
  mockRunCliRuntimeCommand: vi.fn(),
}));

vi.mock('@exitbook/accounting/linking', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@exitbook/accounting/linking')>();

  return {
    ...actual,
    buildProfileLinkGapAnalysis: mockBuildProfileLinkGapAnalysis,
  };
});

vi.mock('@exitbook/data/accounting', () => ({
  buildProfileLinkGapSourceReader: mockBuildProfileLinkGapSourceReader,
}));

vi.mock('@exitbook/data/overrides', () => ({
  OverrideStore: vi.fn().mockImplementation(function MockOverrideStore(...args: unknown[]) {
    mockOverrideStoreConstructor(...args);
    return mockOverrideStoreInstance;
  }),
  readResolvedLinkGapExceptions: mockReadResolvedLinkGapExceptions,
}));

vi.mock('../../../../../cli/command.js', async () => {
  const actual = await vi.importActual<typeof import('../../../../../cli/command.js')>('../../../../../cli/command.js');

  return {
    ...actual,
    runCliRuntimeCommand: mockRunCliRuntimeCommand,
  };
});

vi.mock('../../../../profiles/profile-resolution.js', () => ({
  resolveCommandProfile: mockResolveCommandProfile,
}));

vi.mock('../../../view/links-static-renderer.js', async () => {
  const actual = await vi.importActual<typeof import('../../../view/links-static-renderer.js')>(
    '../../../view/links-static-renderer.js'
  );

  return {
    ...actual,
    outputResolvedLinkGapsStaticList: mockOutputResolvedLinkGapsStaticList,
  };
});

import { runLinksGapsResolvedCommand } from '../links-gaps-resolved-command.js';

describe('links gaps resolved command', () => {
  let lastCompletion: { output?: { data?: unknown; kind?: string } } | undefined;

  beforeEach(() => {
    vi.clearAllMocks();
    lastCompletion = undefined;

    mockRunCliRuntimeCommand.mockImplementation(async (options) => {
      const preparedResult = await options.prepare();
      if (preparedResult.isErr()) {
        throw preparedResult.error.error;
      }

      const actionResult = await options.action({
        runtime: {
          dataDir: '/tmp/exitbook-links',
          openDatabaseSession: vi.fn().mockResolvedValue({ tag: 'db' }),
        },
        prepared: preparedResult.value,
      });
      if (actionResult.isErr()) {
        throw actionResult.error.error;
      }

      lastCompletion = actionResult.value;

      if (actionResult.value.output?.kind === 'text') {
        await actionResult.value.output.render();
      }

      return actionResult.value;
    });

    mockResolveCommandProfile.mockResolvedValue(
      ok({
        id: 1,
        profileKey: 'default',
        displayName: 'default',
        createdAt: new Date('2026-04-01T00:00:00.000Z'),
      })
    );
    mockBuildProfileLinkGapSourceReader.mockReturnValue({
      loadProfileLinkGapSourceData: vi.fn().mockResolvedValue(
        ok({
          accounts: [],
          excludedAssetIds: new Set<string>(),
          links: [],
          resolvedIssueKeys: new Set<string>(),
          transactions: [],
        })
      ),
    });
  });

  it('renders currently resolved gap exceptions with the stored reason', async () => {
    const resolvedIssue = {
      transactionId: 17,
      txFingerprint: 'resolved-gap-fingerprint',
      platformKey: 'bitcoin',
      blockchainName: 'bitcoin',
      timestamp: '2026-03-21T17:12:00.000Z',
      assetId: 'test:btc',
      assetSymbol: 'BTC',
      missingAmount: '0.0018',
      totalAmount: '0.0018',
      confirmedCoveragePercent: '0',
      operationGroup: 'transfer',
      operationLabel: 'transfer/deposit',
      suggestedCount: 0,
      direction: 'inflow' as const,
    };
    mockBuildProfileLinkGapAnalysis.mockReturnValue({
      issues: [
        resolvedIssue,
        {
          ...resolvedIssue,
          txFingerprint: 'open-gap-fingerprint',
          assetId: 'test:usdt',
          assetSymbol: 'USDT',
        },
      ],
      summary: {
        affected_assets: 2,
        assets: [],
        total_issues: 2,
        uncovered_inflows: 2,
        unmatched_outflows: 0,
      },
    });
    mockReadResolvedLinkGapExceptions.mockResolvedValue(
      ok(
        new Map([
          [
            buildLinkGapIssueKey({
              txFingerprint: resolvedIssue.txFingerprint,
              assetId: resolvedIssue.assetId,
              direction: resolvedIssue.direction,
            }),
            {
              txFingerprint: resolvedIssue.txFingerprint,
              assetId: resolvedIssue.assetId,
              direction: resolvedIssue.direction,
              resolvedAt: '2026-04-18T14:00:00.000Z',
              reason: 'BullBitcoin purchase sent directly to wallet',
            },
          ],
        ])
      )
    );

    await runLinksGapsResolvedCommand('links-gaps-resolved', {});

    expect(mockOverrideStoreConstructor).toHaveBeenCalledWith('/tmp/exitbook-links');
    expect(mockReadResolvedLinkGapExceptions).toHaveBeenCalledWith(mockOverrideStoreInstance, 'default');
    expect(mockOutputResolvedLinkGapsStaticList).toHaveBeenCalledWith([
      expect.objectContaining({
        gapRef: expect.any(String),
        gapIssue: expect.objectContaining({
          txFingerprint: 'resolved-gap-fingerprint',
          assetId: 'test:btc',
        }),
        reason: 'BullBitcoin purchase sent directly to wallet',
        resolvedAt: '2026-04-18T14:00:00.000Z',
        transactionRef: 'resolved-g',
      }),
    ]);
  });

  it('returns resolved gap exceptions in json mode with reason metadata', async () => {
    const resolvedIssue = {
      transactionId: 17,
      txFingerprint: 'resolved-gap-fingerprint',
      platformKey: 'bitcoin',
      blockchainName: 'bitcoin',
      timestamp: '2026-03-21T17:12:00.000Z',
      assetId: 'test:btc',
      assetSymbol: 'BTC',
      missingAmount: '0.0018',
      totalAmount: '0.0018',
      confirmedCoveragePercent: '0',
      operationGroup: 'transfer',
      operationLabel: 'transfer/deposit',
      suggestedCount: 0,
      direction: 'inflow' as const,
    };
    mockBuildProfileLinkGapAnalysis.mockReturnValue({
      issues: [resolvedIssue],
      summary: {
        affected_assets: 1,
        assets: [],
        total_issues: 1,
        uncovered_inflows: 1,
        unmatched_outflows: 0,
      },
    });
    mockReadResolvedLinkGapExceptions.mockResolvedValue(
      ok(
        new Map([
          [
            buildLinkGapIssueKey({
              txFingerprint: resolvedIssue.txFingerprint,
              assetId: resolvedIssue.assetId,
              direction: resolvedIssue.direction,
            }),
            {
              txFingerprint: resolvedIssue.txFingerprint,
              assetId: resolvedIssue.assetId,
              direction: resolvedIssue.direction,
              resolvedAt: '2026-04-18T14:00:00.000Z',
              reason: 'BullBitcoin purchase sent directly to wallet',
            },
          ],
        ])
      )
    );

    await runLinksGapsResolvedCommand('links-gaps-resolved', { json: true });

    expect(mockOutputResolvedLinkGapsStaticList).not.toHaveBeenCalled();
    expect(lastCompletion?.output?.kind).toBe('json');
    expect(lastCompletion?.output?.data).toEqual({
      data: [
        expect.objectContaining({
          kind: 'resolved-gap',
          operationGroup: 'transfer',
          operationLabel: 'transfer/deposit',
          txFingerprint: 'resolved-gap-fingerprint',
          reason: 'BullBitcoin purchase sent directly to wallet',
          resolvedAt: '2026-04-18T14:00:00.000Z',
        }),
      ],
      meta: expect.objectContaining({
        filters: expect.objectContaining({
          resolvedGapExceptions: 1,
        }),
      }),
    });
  });
});
