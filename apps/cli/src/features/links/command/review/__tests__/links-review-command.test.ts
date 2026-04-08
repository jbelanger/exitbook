/* eslint-disable @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return -- Vitest command-scope mocks intentionally use partial test doubles. */
import { err, ok } from '@exitbook/foundation';
import { Command } from 'commander';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { LinkSelectorResolutionError } from '../../../link-selector.js';

const {
  mockCreateSpinner,
  mockCtx,
  mockExitCliFailure,
  mockOutputSuccess,
  mockResolveProposalRef,
  mockRunCommand,
  mockRunLinksReview,
  mockStopSpinner,
  mockWithLinksReviewCommandScope,
} = vi.hoisted(() => ({
  mockCreateSpinner: vi.fn(),
  mockCtx: {
    dataDir: '/tmp/exitbook-links',
    database: vi.fn(),
  },
  mockExitCliFailure: vi.fn(),
  mockOutputSuccess: vi.fn(),
  mockResolveProposalRef: vi.fn(),
  mockRunCommand: vi.fn(),
  mockRunLinksReview: vi.fn(),
  mockStopSpinner: vi.fn(),
  mockWithLinksReviewCommandScope: vi.fn(),
}));

vi.mock('../../../../../runtime/command-runtime.js', () => ({
  runCommand: mockRunCommand,
}));

vi.mock('../../../../../cli/error.js', () => ({
  exitCliFailure: mockExitCliFailure,
}));

vi.mock('../../../../../cli/output.js', () => ({
  outputSuccess: mockOutputSuccess,
}));

vi.mock('../../../../shared/spinner.js', () => ({
  createSpinner: mockCreateSpinner,
  stopSpinner: mockStopSpinner,
}));

vi.mock('../links-review-command-scope.js', () => ({
  withLinksReviewCommandScope: mockWithLinksReviewCommandScope,
}));

vi.mock('../run-links-review.js', () => ({
  runLinksReview: mockRunLinksReview,
}));

import { registerLinksConfirmCommand, registerLinksRejectCommand } from '../links-review-command.js';

function createLinksProgram(): Command {
  const program = new Command();
  const links = program.command('links');
  registerLinksConfirmCommand(links);
  registerLinksRejectCommand(links);
  return program;
}

describe('links review command', () => {
  const linksReviewScope = {
    handler: {},
    resolveProposalRef: mockResolveProposalRef,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockCreateSpinner.mockReturnValue({ text: 'spinner' });
    mockRunCommand.mockImplementation(async (fn: (ctx: typeof mockCtx) => Promise<void>) => {
      await fn(mockCtx);
    });
    mockWithLinksReviewCommandScope.mockImplementation(async (_ctx, operation) => operation(linksReviewScope));
    mockResolveProposalRef.mockResolvedValue(
      ok({
        proposalKey:
          'single:v1:movement:exchange:source:1:btc:outflow:0:movement:blockchain:target:2:btc:inflow:0:exchange:source:btc:blockchain:target:btc',
        proposalRef: 'a1b2c3d4e5',
        representativeLinkId: 123,
      })
    );
    mockExitCliFailure.mockImplementation(
      (command: string, failure: { error: Error; exitCode: number }, format: 'json' | 'text') => {
        throw new Error(`CLI:${command}:${format}:${failure.error.message}:${failure.exitCode}`);
      }
    );
  });

  it('runs confirm in JSON mode through the links review command scope', async () => {
    const program = createLinksProgram();
    mockRunLinksReview.mockResolvedValue(
      ok({
        affectedLinkCount: 1,
        affectedLinkIds: [123],
        linkId: 123,
        newStatus: 'confirmed',
        reviewedAt: new Date('2026-03-28T16:00:00.000Z'),
        reviewedBy: 'cli-user',
      })
    );

    await program.parseAsync(['links', 'confirm', 'a1b2c3d4e5', '--json'], { from: 'user' });

    expect(mockCreateSpinner).toHaveBeenCalledWith('Confirming link...', true);
    expect(mockWithLinksReviewCommandScope).toHaveBeenCalledWith(mockCtx, expect.any(Function));
    expect(mockResolveProposalRef).toHaveBeenCalledWith('a1b2c3d4e5');
    expect(mockRunLinksReview).toHaveBeenCalledWith(linksReviewScope, { linkId: 123 }, 'confirm');
    expect(mockStopSpinner).toHaveBeenCalled();
    expect(mockOutputSuccess).toHaveBeenCalledWith(
      'links-confirm',
      {
        affectedLinkCount: 1,
        affectedLinkIds: [123],
        newStatus: 'confirmed',
        proposalRef: 'a1b2c3d4e5',
        reviewedAt: '2026-03-28T16:00:00.000Z',
        reviewedBy: 'cli-user',
      },
      undefined
    );
  });

  it('returns selector resolution failures with browse-style exit codes', async () => {
    const program = createLinksProgram();
    mockResolveProposalRef.mockResolvedValue(
      err(new LinkSelectorResolutionError('not-found', "Link proposal ref 'missing-ref' not found"))
    );

    await expect(program.parseAsync(['links', 'reject', 'missing-ref'], { from: 'user' })).rejects.toThrow(
      "CLI:links-reject:text:Link proposal ref 'missing-ref' not found:4"
    );

    expect(mockWithLinksReviewCommandScope).toHaveBeenCalled();
    expect(mockResolveProposalRef).toHaveBeenCalledWith('missing-ref');
    expect(mockRunLinksReview).not.toHaveBeenCalled();
    expect(mockExitCliFailure).toHaveBeenCalledWith('links-reject', expect.objectContaining({ exitCode: 4 }), 'text');
  });
});
