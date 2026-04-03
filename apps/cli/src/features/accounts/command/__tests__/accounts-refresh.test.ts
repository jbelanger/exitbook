import { Command } from 'commander';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { CliAppRuntime } from '../../../../runtime/app-runtime.js';

const { mockExecuteStoredBalanceRefreshCommand } = vi.hoisted(() => ({
  mockExecuteStoredBalanceRefreshCommand: vi.fn(),
}));

vi.mock('../../../balance/command/balance-refresh-command-support.js', () => ({
  buildStoredBalanceRefreshHelpText: vi.fn().mockReturnValue('help'),
  executeStoredBalanceRefreshCommand: mockExecuteStoredBalanceRefreshCommand,
}));

import { registerAccountsCommand } from '../accounts.js';

describe('accounts refresh command', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockExecuteStoredBalanceRefreshCommand.mockResolvedValue(undefined);
  });

  it('routes accounts refresh through the shared balance refresh executor', async () => {
    const program = new Command();
    const appRuntime = { adapterRegistry: {} } as CliAppRuntime;

    registerAccountsCommand(program, appRuntime);

    await program.parseAsync(['accounts', 'refresh', 'kraken-main', '--json'], { from: 'user' });

    expect(mockExecuteStoredBalanceRefreshCommand).toHaveBeenCalledWith(
      expect.objectContaining({
        appRuntime,
        commandId: 'accounts-refresh',
        selector: 'kraken-main',
        selectorRequiredMessage: 'Accounts refresh requires an account selector',
      })
    );
  });
});
