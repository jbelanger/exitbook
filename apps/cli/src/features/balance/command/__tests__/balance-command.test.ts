import { Command } from 'commander';
import { describe, expect, it } from 'vitest';

import type { CliAppRuntime } from '../../../../runtime/app-runtime.js';
import { registerBalanceCommand } from '../balance.js';

const appRuntime = {
  blockchainExplorersConfig: {},
} as CliAppRuntime;

describe('registerBalanceCommand', () => {
  it('registers the balance namespace with a bare browse entrypoint plus view and refresh subcommands', () => {
    const program = new Command();

    registerBalanceCommand(program, appRuntime);

    const balanceCommand = program.commands.find((command) => command.name() === 'balance');
    expect(balanceCommand).toBeDefined();
    expect(balanceCommand?.description()).toBe('Browse stored balance snapshots or refresh live verification');
    expect(balanceCommand?.usage()).toBe('[selector] [options]');
    expect(balanceCommand?.commands.map((command) => command.name())).toEqual(['view', 'refresh']);
  });
});
