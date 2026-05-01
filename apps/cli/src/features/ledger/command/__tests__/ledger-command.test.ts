import { Command } from 'commander';
import { describe, expect, it } from 'vitest';

import type { CliAppRuntime } from '../../../../runtime/app-runtime.js';
import { registerLedgerCommand } from '../ledger.js';

describe('registerLedgerCommand', () => {
  it('registers ledger stress gates under the ledger namespace', () => {
    const program = new Command();

    registerLedgerCommand(program, {} as CliAppRuntime);

    const ledgerCommand = program.commands.find((command) => command.name() === 'ledger');
    const stressCommand = ledgerCommand?.commands.find((command) => command.name() === 'stress');
    const evmFamilyCommand = stressCommand?.commands.find((command) => command.name() === 'evm-family');
    const nearCommand = stressCommand?.commands.find((command) => command.name() === 'near');
    const solanaCommand = stressCommand?.commands.find((command) => command.name() === 'solana');
    const xrpCommand = stressCommand?.commands.find((command) => command.name() === 'xrp');

    expect(ledgerCommand?.description()).toBe('Inspect, validate, and run accounting ledger migration workflows');
    expect(ledgerCommand?.commands.find((command) => command.name() === 'linking-v2')).toBeUndefined();
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
    expect(solanaCommand?.description()).toBe(
      'Rerun Solana ledger-v2 processor and compare against legacy balance impact'
    );
    expect(solanaCommand?.options.map((option) => option.long)).toEqual(
      expect.arrayContaining(['--expected-diffs', '--json'])
    );
    expect(xrpCommand?.description()).toBe('Rerun XRP ledger-v2 processor and compare against legacy balance impact');
    expect(xrpCommand?.options.map((option) => option.long)).toEqual(
      expect.arrayContaining(['--expected-diffs', '--json'])
    );
  });
});
