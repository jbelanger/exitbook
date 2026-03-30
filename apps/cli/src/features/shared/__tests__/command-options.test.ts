import { Command } from 'commander';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockDisplayCliError } = vi.hoisted(() => ({
  mockDisplayCliError: vi.fn(),
}));

vi.mock('../cli-error.js', () => ({
  displayCliError: mockDisplayCliError,
}));

import { parseCliBrowseRootInvocation } from '../command-options.js';

beforeEach(() => {
  vi.clearAllMocks();
  mockDisplayCliError.mockImplementation(
    (command: string, error: Error, _exitCode: number, format: 'json' | 'text') => {
      throw new Error(`CLI:${command}:${format}:${error.message}`);
    }
  );
});

describe('parseCliBrowseRootInvocation', () => {
  it('parses a selector and browse options from root command tokens', () => {
    const invocation = parseCliBrowseRootInvocation(
      'accounts',
      ['kraken-main', '--platform', 'kraken', '--json'],
      (command) => command.option('--platform <name>').option('--json')
    );

    expect(invocation).toEqual({
      selector: 'kraken-main',
      rawOptions: {
        platform: 'kraken',
        json: true,
      },
    });
  });

  it('routes parse failures through the cli error helper using token-level json detection', () => {
    expect(() =>
      parseCliBrowseRootInvocation('accounts', ['first', 'second', '--json'], (command) => command.option('--json'))
    ).toThrow('CLI:accounts:json:error: too many arguments. Expected 1 argument but got 2.');

    expect(mockDisplayCliError).toHaveBeenCalledWith('accounts', expect.any(Error), 2, 'json');
  });

  it('returns empty options when no selector or flags are provided', () => {
    const invocation = parseCliBrowseRootInvocation('accounts', undefined, (command: Command) =>
      command.option('--json')
    );

    expect(invocation).toEqual({
      selector: undefined,
      rawOptions: {},
    });
  });
});
