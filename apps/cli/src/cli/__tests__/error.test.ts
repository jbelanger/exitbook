/* eslint-disable @typescript-eslint/no-unsafe-return -- ok for tests */
/* eslint-disable @typescript-eslint/no-unsafe-member-access -- ok for tests */
/* eslint-disable @typescript-eslint/no-unsafe-call -- ok for tests */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createCliFailure, ExitCodes } from '../command.js';
import { writeCliFailure } from '../error.js';

describe('cli-error', () => {
  const originalEnv = process.env['NODE_ENV'];
  let stderrWriteSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    process.env['NODE_ENV'] = 'development';
    stderrWriteSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
  });

  afterEach(() => {
    process.env['NODE_ENV'] = originalEnv;
    stderrWriteSpy.mockRestore();
  });

  function getRenderedStderr(): string {
    return stderrWriteSpy.mock.calls
      .map((call: unknown[]) => {
        const chunk = call[0];
        if (typeof chunk === 'string') {
          return chunk;
        }

        if (chunk instanceof Uint8Array) {
          return new TextDecoder().decode(chunk);
        }

        return String(chunk);
      })
      .join('');
  }

  it('does not print stack traces in text mode', () => {
    const error = new Error("Account 'theta-wallet' already exists");
    error.stack =
      "Error: Account 'theta-wallet' already exists\n    at AccountLifecycleService.create (/Users/test/account-lifecycle-service.ts:91:18)";

    writeCliFailure('accounts-add', createCliFailure(error, ExitCodes.GENERAL_ERROR), 'text');

    const rendered = getRenderedStderr();

    expect(rendered).toBe("✗ Error: Account 'theta-wallet' already exists\n");
    expect(rendered).not.toContain('AccountLifecycleService.create');
    expect(rendered).not.toContain('/Users/test/account-lifecycle-service.ts:91:18');
  });

  it('does not print a generic not-found hint', () => {
    writeCliFailure(
      'accounts-remove',
      createCliFailure(new Error("Account 'injective-wallet' not found"), ExitCodes.NOT_FOUND),
      'text'
    );

    expect(getRenderedStderr()).toBe("✗ Error: Account 'injective-wallet' not found\n");
  });

  it('prints actionable error tips without a blank spacer line', () => {
    writeCliFailure(
      'import',
      createCliFailure(new Error('Authentication failed'), ExitCodes.AUTHENTICATION_ERROR),
      'text'
    );

    expect(getRenderedStderr()).toBe(
      '✗ Error: Authentication failed\nCheck your API credentials in the .env file or pass them as arguments (--api-key YOUR_KEY --api-secret YOUR_SECRET).\n'
    );
  });
});
