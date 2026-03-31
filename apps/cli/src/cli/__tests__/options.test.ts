import { Command } from 'commander';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import {
  parseCliBrowseRootInvocationResult,
  parseCliBrowseOptionsResult,
  parseCliCommandOptionsResult,
} from '../options.js';
import { explorerListSurfaceSpec } from '../presentation.js';

describe('command option result helpers', () => {
  it('parses a selector and browse options from root command tokens', () => {
    const invocationResult = parseCliBrowseRootInvocationResult(
      ['kraken-main', '--platform', 'kraken', '--json'],
      (command) => command.option('--platform <name>').option('--json')
    );

    expect(invocationResult.isOk()).toBe(true);
    if (invocationResult.isOk()) {
      expect(invocationResult.value).toEqual({
        selector: 'kraken-main',
        rawOptions: {
          platform: 'kraken',
          json: true,
        },
      });
    }
  });

  it('returns parse failures without exiting for browse root invocations', () => {
    const invocationResult = parseCliBrowseRootInvocationResult(['first', 'second', '--json'], (command) =>
      command.option('--json')
    );

    expect(invocationResult.isErr()).toBe(true);
    if (invocationResult.isErr()) {
      expect(invocationResult.error.exitCode).toBe(2);
      expect(invocationResult.error.error.message).toBe('error: too many arguments. Expected 1 argument but got 2.');
    }
  });

  it('returns result failures for invalid option payloads', () => {
    const optionsResult = parseCliCommandOptionsResult(
      { json: 'yes' },
      z.object({
        json: z.boolean().optional(),
      })
    );

    expect(optionsResult.isErr()).toBe(true);
    if (optionsResult.isErr()) {
      expect(optionsResult.error.exitCode).toBe(2);
      expect(optionsResult.error.error.message).toContain('expected boolean');
    }
  });

  it('returns browse presentation details without exiting', () => {
    const browseOptionsResult = parseCliBrowseOptionsResult(
      { json: true },
      z.object({ json: z.boolean().optional() }),
      explorerListSurfaceSpec('accounts')
    );

    expect(browseOptionsResult.isOk()).toBe(true);
    if (browseOptionsResult.isOk()) {
      expect(browseOptionsResult.value.options).toEqual({ json: true });
      expect(browseOptionsResult.value.presentation.kind).toBe('explorer-list');
      expect(browseOptionsResult.value.presentation.mode).toBe('json');
    }
  });

  it('returns empty options when no selector or flags are provided', () => {
    const invocationResult = parseCliBrowseRootInvocationResult(undefined, (command: Command) =>
      command.option('--json')
    );

    expect(invocationResult.isOk()).toBe(true);
    if (invocationResult.isOk()) {
      expect(invocationResult.value).toEqual({
        selector: undefined,
        rawOptions: {},
      });
    }
  });
});
