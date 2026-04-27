import { Command } from 'commander';
import { describe, expect, it } from 'vitest';

import type { CliAppRuntime } from '../../../../runtime/app-runtime.js';
import { registerLedgerCommand } from '../ledger.js';

describe('registerLedgerCommand', () => {
  it('registers the EVM-family ledger stress gate under the ledger namespace', () => {
    const program = new Command();

    registerLedgerCommand(program, {} as CliAppRuntime);

    const ledgerCommand = program.commands.find((command) => command.name() === 'ledger');
    const stressCommand = ledgerCommand?.commands.find((command) => command.name() === 'stress');
    const evmFamilyCommand = stressCommand?.commands.find((command) => command.name() === 'evm-family');
    const nearCommand = stressCommand?.commands.find((command) => command.name() === 'near');

    expect(ledgerCommand?.description()).toBe('Inspect and validate accounting ledger migration state');
    expect(stressCommand?.description()).toBe('Run repeatable ledger migration stress checks');
    expect(evmFamilyCommand?.description()).toBe(
      'Rerun EVM-family ledger-v2 processors and compare against legacy balance impact'
    );
    expect(evmFamilyCommand?.options.map((option) => option.long)).toEqual(
      expect.arrayContaining(['--chains', '--expected-diffs', '--json'])
    );
    expect(nearCommand?.description()).toBe('Rerun NEAR ledger-v2 processor and compare against legacy balance impact');
    expect(nearCommand?.options.map((option) => option.long)).toEqual(
      expect.arrayContaining(['--expected-diffs', '--json'])
    );
  });
});
