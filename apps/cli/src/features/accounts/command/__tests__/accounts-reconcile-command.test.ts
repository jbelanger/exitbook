import { Command } from 'commander';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { CliAppRuntime } from '../../../../runtime/app-runtime.js';

const { mockExecuteAccountsReconcileCommand } = vi.hoisted(() => ({
  mockExecuteAccountsReconcileCommand: vi.fn(),
}));

vi.mock('../accounts-reconcile-command-support.js', () => ({
  buildAccountsReconcileHelpText: vi.fn(() => ''),
  executeAccountsReconcileCommand: mockExecuteAccountsReconcileCommand,
}));

import { AccountsReconcileCommandOptionsSchema } from '../accounts-option-schemas.js';
import { registerAccountsReconcileCommand } from '../accounts-reconcile.js';

function createAccountsReconcileProgram(appRuntime: CliAppRuntime = {} as CliAppRuntime): Command {
  const program = new Command();
  const accounts = program.command('accounts');
  registerAccountsReconcileCommand(accounts, appRuntime);
  return program;
}

describe('registerAccountsReconcileCommand', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockExecuteAccountsReconcileCommand.mockResolvedValue(undefined);
  });

  it('leaves reference unset when --refresh-live is passed without an explicit reference', async () => {
    const appRuntime = { tag: 'app-runtime' } as unknown as CliAppRuntime;
    const program = createAccountsReconcileProgram(appRuntime);

    await program.parseAsync(['accounts', 'reconcile', '--refresh-live'], { from: 'user' });

    expect(mockExecuteAccountsReconcileCommand).toHaveBeenCalledWith({
      appRuntime,
      rawOptions: {
        refreshLive: true,
      },
      selector: undefined,
    });
  });
});

describe('AccountsReconcileCommandOptionsSchema', () => {
  it('allows --refresh-live without an explicit reference', () => {
    const result = AccountsReconcileCommandOptionsSchema.safeParse({ refreshLive: true });

    expect(result.success).toBe(true);
  });

  it('rejects --refresh-live with explicit --reference stored', () => {
    const result = AccountsReconcileCommandOptionsSchema.safeParse({
      reference: 'stored',
      refreshLive: true,
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.message).toBe('--refresh-live cannot be combined with --reference stored');
    }
  });
});
