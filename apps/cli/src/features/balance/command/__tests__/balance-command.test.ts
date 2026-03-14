import { Command } from 'commander';
import { describe, expect, it } from 'vitest';

import { registerBalanceCommand } from '../balance.js';

describe('registerBalanceCommand', () => {
  it('registers the balance namespace with view and refresh subcommands', () => {
    const program = new Command();

    registerBalanceCommand(program);

    const balanceCommand = program.commands.find((command) => command.name() === 'balance');
    expect(balanceCommand).toBeDefined();
    expect(balanceCommand?.description()).toBe('View stored balance snapshots or refresh live verification');
    expect(balanceCommand?.commands.map((command) => command.name())).toEqual(['view', 'refresh']);
  });
});
