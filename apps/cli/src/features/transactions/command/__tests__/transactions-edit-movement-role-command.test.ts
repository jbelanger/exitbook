import { formatMovementFingerprintRef, type Transaction } from '@exitbook/core';
import { ok, parseDecimal, type Currency } from '@exitbook/foundation';
import { Command } from 'commander';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createPersistedTransaction } from '../../../shared/__tests__/transaction-test-utils.js';

const {
  mockClearRole,
  mockCtx,
  mockExitCliFailure,
  mockFindByFingerprintRef,
  mockOutputSuccess,
  mockOverrideStoreConstructor,
  mockOverrideStoreInstance,
  mockPrepareTransactionsCommandScope,
  mockRunCommand,
  mockSetRole,
  mockTransactionsEditMovementRoleHandlerConstructor,
} = vi.hoisted(() => ({
  mockClearRole: vi.fn(),
  mockCtx: {
    dataDir: '/tmp/exitbook-transactions',
    tag: 'command-runtime',
  },
  mockExitCliFailure: vi.fn(),
  mockFindByFingerprintRef: vi.fn(),
  mockOutputSuccess: vi.fn(),
  mockOverrideStoreConstructor: vi.fn(),
  mockOverrideStoreInstance: { tag: 'override-store' },
  mockPrepareTransactionsCommandScope: vi.fn(),
  mockRunCommand: vi.fn(),
  mockSetRole: vi.fn(),
  mockTransactionsEditMovementRoleHandlerConstructor: vi.fn(),
}));

vi.mock('@exitbook/data/overrides', () => ({
  OverrideStore: vi.fn().mockImplementation(function MockOverrideStore(...args: unknown[]) {
    mockOverrideStoreConstructor(...args);
    return mockOverrideStoreInstance;
  }),
}));

vi.mock('../../../../runtime/command-runtime.js', () => ({
  CommandRuntime: class {},
  renderApp: vi.fn(),
  runCommand: mockRunCommand,
}));

vi.mock('../../../../cli/error.js', () => ({
  exitCliFailure: mockExitCliFailure,
}));

vi.mock('../../../../cli/output.js', () => ({
  outputSuccess: mockOutputSuccess,
}));

vi.mock('../transactions-command-scope.js', () => ({
  prepareTransactionsCommandScope: mockPrepareTransactionsCommandScope,
}));

vi.mock('../transactions-edit-movement-role-handler.js', () => ({
  TransactionsEditMovementRoleHandler: vi.fn().mockImplementation(function MockTransactionsEditMovementRoleHandler(
    ...args: unknown[]
  ) {
    mockTransactionsEditMovementRoleHandlerConstructor(...args);
    return {
      clearRole: mockClearRole,
      setRole: mockSetRole,
    };
  }),
}));

import { registerTransactionsCommand } from '../transactions.js';

function createProgram(): Command {
  const program = new Command();
  registerTransactionsCommand(program);
  return program;
}

function createTransaction(): Transaction {
  return createPersistedTransaction({
    id: 123,
    accountId: 1,
    txFingerprint: '1234567890abcdef1234567890abcdef',
    platformKey: 'cardano',
    platformKind: 'blockchain',
    datetime: '2026-04-10T12:00:00.000Z',
    timestamp: Date.parse('2026-04-10T12:00:00.000Z'),
    status: 'success',
    operation: { category: 'transfer', type: 'deposit' },
    movements: {
      inflows: [
        {
          assetId: 'blockchain:cardano:native',
          assetSymbol: 'ADA' as Currency,
          grossAmount: parseDecimal('10.5'),
          netAmount: parseDecimal('10.5'),
        },
      ],
      outflows: [],
    },
    fees: [],
  });
}

describe('transactions edit movement-role command', () => {
  const PROFILE_KEY = 'default';
  const transaction = createTransaction();
  const selector = transaction.txFingerprint.slice(0, 10);
  const movementRef = formatMovementFingerprintRef(transaction.movements.inflows![0]!.movementFingerprint);
  const consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);

  beforeEach(() => {
    vi.clearAllMocks();
    mockRunCommand.mockImplementation(async (fn: (ctx: typeof mockCtx) => Promise<void>) => {
      await fn(mockCtx);
    });
    mockExitCliFailure.mockImplementation(
      (command: string, failure: { error: Error; exitCode: number }, format: 'json' | 'text') => {
        throw new Error(`CLI:${command}:${format}:${failure.error.message}:${failure.exitCode}`);
      }
    );
    mockPrepareTransactionsCommandScope.mockResolvedValue(
      ok({
        database: {
          tag: 'db',
          transactions: {
            findByFingerprintRef: mockFindByFingerprintRef,
          },
        },
        profile: {
          id: 1,
          profileKey: PROFILE_KEY,
          displayName: PROFILE_KEY,
          createdAt: new Date('2026-03-01T00:00:00.000Z'),
        },
      })
    );
    mockFindByFingerprintRef.mockResolvedValue(ok(transaction));
    consoleLogSpy.mockClear();
  });

  it('sets a movement role in text mode', async () => {
    const program = createProgram();
    mockSetRole.mockResolvedValue(
      ok({
        action: 'set',
        changed: true,
        movement: {
          assetSymbol: 'ADA',
          direction: 'inflow',
          movementFingerprint: transaction.movements.inflows![0]!.movementFingerprint,
          movementRef,
        },
        nextEffectiveRole: 'staking_reward',
        previousEffectiveRole: 'principal',
        reason: 'manual correction',
        transaction: {
          platformKey: 'cardano',
          txFingerprint: transaction.txFingerprint,
          txRef: selector,
        },
      })
    );

    await program.parseAsync(
      [
        'transactions',
        'edit',
        'movement-role',
        selector,
        '--movement',
        movementRef,
        '--role',
        'staking_reward',
        '--reason',
        'manual correction',
      ],
      { from: 'user' }
    );

    expect(mockFindByFingerprintRef).toHaveBeenCalledWith(1, selector);
    expect(mockTransactionsEditMovementRoleHandlerConstructor).toHaveBeenCalledWith(
      { tag: 'db', transactions: { findByFingerprintRef: mockFindByFingerprintRef } },
      mockOverrideStoreInstance
    );
    expect(mockSetRole).toHaveBeenCalledWith({
      movement: {
        direction: 'inflow',
        movement: transaction.movements.inflows![0],
        movementRef,
      },
      profileKey: PROFILE_KEY,
      reason: 'manual correction',
      role: 'staking_reward',
      target: {
        accountId: 1,
        platformKey: 'cardano',
        transactionId: 123,
        txFingerprint: transaction.txFingerprint,
        txRef: selector,
      },
    });
    expect(consoleLogSpy.mock.calls[0]?.[0]).toContain('Movement role saved');
  });

  it('clears a movement role in JSON mode', async () => {
    const program = createProgram();
    const result = {
      action: 'clear',
      changed: true,
      movement: {
        assetSymbol: 'ADA',
        direction: 'inflow',
        movementFingerprint: transaction.movements.inflows![0]!.movementFingerprint,
        movementRef,
      },
      nextEffectiveRole: 'principal',
      previousEffectiveRole: 'staking_reward',
      transaction: {
        platformKey: 'cardano',
        txFingerprint: transaction.txFingerprint,
        txRef: selector,
      },
    };
    mockClearRole.mockResolvedValue(ok(result));

    await program.parseAsync(
      ['transactions', 'edit', 'movement-role', selector, '--movement', movementRef, '--clear', '--json'],
      { from: 'user' }
    );

    expect(mockClearRole).toHaveBeenCalledWith({
      movement: {
        direction: 'inflow',
        movement: transaction.movements.inflows![0],
        movementRef,
      },
      profileKey: PROFILE_KEY,
      reason: undefined,
      target: {
        accountId: 1,
        platformKey: 'cardano',
        transactionId: 123,
        txFingerprint: transaction.txFingerprint,
        txRef: selector,
      },
    });
    expect(mockOutputSuccess).toHaveBeenCalledWith('transactions-edit-movement-role', result, undefined);
  });

  it('routes missing movement refs through the shared boundary', async () => {
    const program = createProgram();

    await expect(
      program.parseAsync(
        ['transactions', 'edit', 'movement-role', selector, '--movement', 'deadbeef00', '--role', 'staking_reward'],
        { from: 'user' }
      )
    ).rejects.toThrow(
      `CLI:transactions-edit-movement-role:text:Movement ref 'deadbeef00' not found on transaction ${transaction.txFingerprint}:4`
    );

    expect(mockSetRole).not.toHaveBeenCalled();
  });
});
