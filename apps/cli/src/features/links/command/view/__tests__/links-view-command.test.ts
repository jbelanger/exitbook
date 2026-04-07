import { err, ok } from '@exitbook/foundation';
import { Command } from 'commander';
import type { ReactElement } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  mockAnalyzeLinkGaps,
  mockCreateGapsViewState,
  mockCreateLinksViewState,
  mockExitCliFailure,
  mockFilterLinksByConfidence,
  mockFormatLinkInfo,
  mockOutputSuccess,
  mockRenderApp,
  mockResolveCommandProfile,
  mockRunCommand,
} = vi.hoisted(() => ({
  mockAnalyzeLinkGaps: vi.fn(),
  mockCreateGapsViewState: vi.fn(),
  mockCreateLinksViewState: vi.fn(),
  mockExitCliFailure: vi.fn(),
  mockFilterLinksByConfidence: vi.fn(),
  mockFormatLinkInfo: vi.fn(),
  mockOutputSuccess: vi.fn(),
  mockRenderApp: vi.fn(),
  mockResolveCommandProfile: vi.fn(),
  mockRunCommand: vi.fn(),
}));

vi.mock('../../../../../runtime/command-runtime.js', () => ({
  renderApp: mockRenderApp,
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

vi.mock('../links-gap-analysis.js', () => ({
  analyzeLinkGaps: mockAnalyzeLinkGaps,
}));

vi.mock('../links-view-presenter.js', async () => {
  const actual = await vi.importActual<typeof import('../links-view-presenter.js')>('../links-view-presenter.js');

  return {
    ...actual,
    filterLinksByConfidence: mockFilterLinksByConfidence,
    formatLinkInfo: mockFormatLinkInfo,
  };
});

vi.mock('../../../view/index.js', () => ({
  LinksViewApp: 'LinksViewApp',
  createGapsViewState: mockCreateGapsViewState,
  createLinksViewState: mockCreateLinksViewState,
}));

vi.mock('../../review/links-review-handler.js', () => ({
  LinksReviewHandler: class {
    execute = vi.fn();
  },
}));

import { registerLinksGapsCommand, registerLinksViewCommand } from '../links-view.js';

interface MockCtx {
  closeDatabase: ReturnType<typeof vi.fn>;
  dataDir: string;
  database: ReturnType<typeof vi.fn>;
}

function createProgram(): Command {
  const program = new Command();
  const links = program.command('links');
  registerLinksViewCommand(links);
  registerLinksGapsCommand(links);
  return program;
}

describe('links view commands', () => {
  const ctx: MockCtx = {
    closeDatabase: vi.fn(),
    dataDir: '/tmp/exitbook-links-view',
    database: vi.fn(),
  };
  const database = {
    accounts: {
      findAll: vi.fn(),
    },
    transactionLinks: {
      findAll: vi.fn(),
    },
    transactions: {
      findAll: vi.fn(),
      findById: vi.fn(),
    },
  };

  beforeEach(() => {
    vi.clearAllMocks();
    ctx.database.mockResolvedValue(database);
    mockRunCommand.mockImplementation(async (fn: (runtime: MockCtx) => Promise<void>) => {
      await fn(ctx);
    });
    mockResolveCommandProfile.mockResolvedValue(
      ok({
        id: 3,
        profileKey: 'default',
        displayName: 'default',
        createdAt: new Date('2026-03-01T00:00:00.000Z'),
      })
    );
    database.transactionLinks.findAll.mockResolvedValue(ok([]));
    database.transactions.findAll.mockResolvedValue(ok([]));
    database.transactions.findById.mockResolvedValue(ok(undefined));
    database.accounts.findAll.mockResolvedValue(ok([]));
    mockFilterLinksByConfidence.mockImplementation((links: unknown[]) => links);
    mockFormatLinkInfo.mockImplementation((link: { id: number }) => ({
      asset_symbol: 'BTC',
      confidence_score: '0.95',
      id: link.id,
      link_type: 'transfer',
      match_criteria: {
        addressMatch: false,
        amountSimilarity: '1',
        assetMatch: true,
        timingHours: 0,
        timingValid: true,
      },
      source_amount: '1',
      source_timestamp: undefined,
      source_transaction: undefined,
      source_transaction_id: 1,
      status: 'confirmed',
      target_amount: '1',
      target_timestamp: undefined,
      target_transaction: undefined,
      target_transaction_id: 2,
      created_at: '2026-03-01T00:00:00.000Z',
      reviewed_at: undefined,
      reviewed_by: undefined,
      updated_at: '2026-03-01T00:00:00.000Z',
    }));
    mockAnalyzeLinkGaps.mockReturnValue({
      issues: [],
      summary: {
        affected_assets: 0,
        assets: [],
        total_issues: 0,
        unmatched_outflows: 0,
        uncovered_inflows: 0,
      },
    });
    mockCreateGapsViewState.mockReturnValue({ tag: 'gaps-view-state' });
    mockCreateLinksViewState.mockReturnValue({ tag: 'links-view-state' });
    mockRenderApp.mockImplementation(async (create: (unmount: () => void) => ReactElement) => {
      create(() => undefined);
    });
    mockExitCliFailure.mockImplementation(
      (command: string, failure: { error: Error; exitCode: number }, format: 'json' | 'text') => {
        throw new Error(`CLI:${command}:${format}:${failure.error.message}:${failure.exitCode}`);
      }
    );
  });

  it('outputs links view JSON through the shared boundary', async () => {
    const program = createProgram();

    database.transactionLinks.findAll.mockResolvedValue(
      ok([
        {
          id: 11,
          sourceTransactionId: 1,
          targetTransactionId: 2,
        },
      ])
    );

    await program.parseAsync(['links', 'view', '--status', 'confirmed', '--json'], { from: 'user' });

    expect(mockOutputSuccess).toHaveBeenCalledWith(
      'links-view',
      {
        data: [
          expect.objectContaining({
            id: 11,
            status: 'confirmed',
          }),
        ],
        meta: {
          count: 1,
          offset: 0,
          limit: 1,
          hasMore: false,
          filters: {
            status: 'confirmed',
          },
        },
      },
      undefined
    );
  });

  it('outputs gaps JSON through links view --gaps', async () => {
    const program = createProgram();

    mockAnalyzeLinkGaps.mockReturnValue({
      issues: [{ txFingerprint: 'tx-1' }],
      summary: {
        affected_assets: 1,
        assets: [],
        total_issues: 1,
        unmatched_outflows: 0,
        uncovered_inflows: 1,
      },
    });

    await program.parseAsync(['links', 'view', '--gaps', '--json'], { from: 'user' });

    expect(mockOutputSuccess).toHaveBeenCalledWith(
      'links-view',
      {
        data: [{ txFingerprint: 'tx-1' }],
        meta: {
          count: 1,
          offset: 0,
          limit: 1,
          hasMore: false,
          filters: {
            total_issues: 1,
            uncovered_inflows: 1,
            unmatched_outflows: 0,
            affected_assets: 1,
            assets: [],
          },
        },
      },
      undefined
    );
  });

  it('renders the gaps TUI after closing the database', async () => {
    const program = createProgram();
    let renderedElement: ReactElement | undefined;

    mockRenderApp.mockImplementation(async (create: (unmount: () => void) => ReactElement) => {
      renderedElement = create(() => undefined);
    });

    await program.parseAsync(['links', 'gaps'], { from: 'user' });

    expect(ctx.closeDatabase).toHaveBeenCalledOnce();
    expect(mockRenderApp).toHaveBeenCalledOnce();
    expect(renderedElement?.type).toBe('LinksViewApp');
  });

  it('routes links view --gaps through the gaps flow', async () => {
    const program = createProgram();
    let renderedElement: ReactElement | undefined;

    mockRenderApp.mockImplementation(async (create: (unmount: () => void) => ReactElement) => {
      renderedElement = create(() => undefined);
    });

    await program.parseAsync(['links', 'view', '--gaps'], { from: 'user' });

    expect(ctx.closeDatabase).toHaveBeenCalledOnce();
    expect(mockAnalyzeLinkGaps).toHaveBeenCalledOnce();
    expect(mockRenderApp).toHaveBeenCalledOnce();
    expect(renderedElement?.type).toBe('LinksViewApp');
  });

  it('keeps links gaps as a JSON compatibility alias', async () => {
    const program = createProgram();

    mockAnalyzeLinkGaps.mockReturnValue({
      issues: [{ txFingerprint: 'tx-compat' }],
      summary: {
        affected_assets: 1,
        assets: [],
        total_issues: 1,
        unmatched_outflows: 1,
        uncovered_inflows: 0,
      },
    });

    await program.parseAsync(['links', 'gaps', '--json'], { from: 'user' });

    expect(mockOutputSuccess).toHaveBeenCalledWith(
      'links-gaps',
      {
        data: [{ txFingerprint: 'tx-compat' }],
        meta: {
          count: 1,
          offset: 0,
          limit: 1,
          hasMore: false,
          filters: {
            total_issues: 1,
            uncovered_inflows: 0,
            unmatched_outflows: 1,
            affected_assets: 1,
            assets: [],
          },
        },
      },
      undefined
    );
  });

  it('routes view data failures through the CLI boundary', async () => {
    const program = createProgram();
    const failure = new Error('failed to load links');
    database.transactionLinks.findAll.mockResolvedValue(err(failure));

    await expect(program.parseAsync(['links', 'view', '--json'], { from: 'user' })).rejects.toThrow(
      'CLI:links-view:json:failed to load links:1'
    );

    expect(mockExitCliFailure).toHaveBeenCalledWith(
      'links-view',
      expect.objectContaining({ error: failure, exitCode: 1 }),
      'json'
    );
  });

  it('rejects links-only filters when --gaps is used', async () => {
    const program = createProgram();

    await expect(
      program.parseAsync(['links', 'view', '--gaps', '--status', 'confirmed'], { from: 'user' })
    ).rejects.toThrow('CLI:links-view:text:--gaps cannot be combined with --status:2');

    expect(mockExitCliFailure).toHaveBeenCalledWith('links-view', expect.objectContaining({ exitCode: 2 }), 'text');
    expect(mockExitCliFailure.mock.calls[0]?.[1]).toMatchObject({
      error: {
        message: '--gaps cannot be combined with --status',
      },
      exitCode: 2,
    });
  });
});
