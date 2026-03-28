/* eslint-disable @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return -- Vitest command-scope mocks intentionally use partial test doubles. */
import { ok } from '@exitbook/foundation';
import { Command } from 'commander';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
  mockCreateSpinner,
  mockCtx,
  mockDisplayCliError,
  mockOutputSuccess,
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
  mockDisplayCliError: vi.fn(),
  mockOutputSuccess: vi.fn(),
  mockRunCommand: vi.fn(),
  mockRunLinksReview: vi.fn(),
  mockStopSpinner: vi.fn(),
  mockWithLinksReviewCommandScope: vi.fn(),
}));

vi.mock('../../../../../runtime/command-runtime.js', () => ({
  runCommand: mockRunCommand,
}));

vi.mock('../../../../shared/cli-error.js', () => ({
  displayCliError: mockDisplayCliError,
}));

vi.mock('../../../../shared/json-output.js', () => ({
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
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockCreateSpinner.mockReturnValue({ text: 'spinner' });
    mockRunCommand.mockImplementation(async (fn: (ctx: typeof mockCtx) => Promise<void>) => {
      await fn(mockCtx);
    });
    mockWithLinksReviewCommandScope.mockImplementation(async (_ctx, operation) => operation(linksReviewScope));
    mockDisplayCliError.mockImplementation(
      (command: string, error: Error, _exitCode: number, format: 'json' | 'text') => {
        throw new Error(`CLI:${command}:${format}:${error.message}`);
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

    await program.parseAsync(['links', 'confirm', '123', '--json'], { from: 'user' });

    expect(mockCreateSpinner).toHaveBeenCalledWith('Confirming link...', true);
    expect(mockWithLinksReviewCommandScope).toHaveBeenCalledWith(mockCtx, expect.any(Function));
    expect(mockRunLinksReview).toHaveBeenCalledWith(linksReviewScope, { linkId: 123 }, 'confirm');
    expect(mockStopSpinner).toHaveBeenCalled();
    expect(mockOutputSuccess).toHaveBeenCalledWith('links-confirm', {
      affectedLinkCount: 1,
      affectedLinkIds: [123],
      linkId: 123,
      newStatus: 'confirmed',
      reviewedAt: '2026-03-28T16:00:00.000Z',
      reviewedBy: 'cli-user',
    });
  });

  it('rejects invalid link ids before entering the command scope', async () => {
    const program = createLinksProgram();

    await expect(program.parseAsync(['links', 'reject', 'abc'], { from: 'user' })).rejects.toThrow(
      'CLI:links-reject:text:Link ID must be a valid integer'
    );

    expect(mockWithLinksReviewCommandScope).not.toHaveBeenCalled();
    expect(mockRunLinksReview).not.toHaveBeenCalled();
    expect(mockDisplayCliError).toHaveBeenCalledWith('links-reject', expect.any(Error), 2, 'text');
  });
});
