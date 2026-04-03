import { Command } from 'commander';
import { describe, expect, it } from 'vitest';

import { registerBalanceCommand } from '../balance.js';

describe('registerBalanceCommand', () => {
  it('registers the balance namespace with a bare browse entrypoint plus a view subcommand', () => {
    const program = new Command();

    registerBalanceCommand(program);

    const balanceCommand = program.commands.find((command) => command.name() === 'balance');
    expect(balanceCommand).toBeDefined();
    expect(balanceCommand?.description()).toBe('Browse stored balance snapshots');
    expect(balanceCommand?.usage()).toBe('[selector] [options]');
    expect(balanceCommand?.commands.map((command) => command.name())).toEqual(['view']);
  });
});
