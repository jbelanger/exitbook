import type { IBlockchainProviderRuntime } from '@exitbook/blockchain-providers';
import type { Account, ImportSession } from '@exitbook/core';
import type { EventBus } from '@exitbook/events';
import { err, ok, type Result } from '@exitbook/foundation';
import { describe, expect, it, vi } from 'vitest';

import type { IngestionEvent } from '../../../events.js';
import type { ImportPorts } from '../../../ports/import-ports.js';
import { AdapterRegistry } from '../../../shared/types/adapter-registry.js';
import type { ImportBatchResult } from '../../../shared/types/importers.js';
import { ImportWorkflow } from '../import-workflow.js';

interface TestState {
  accounts: Account[];
  nextAccountId: number;
}

function createAccount(overrides: Partial<Account> = {}): Account {
  const profileId = overrides.profileId ?? 1;
  const accountType = overrides.accountType ?? 'blockchain';
  const platformKey = overrides.platformKey ?? 'bitcoin';
  const identifier = overrides.identifier ?? 'bc1-account';

  return {
    id: overrides.id ?? 1,
    profileId,
    accountType,
    platformKey,
    identifier,
    accountFingerprint: overrides.accountFingerprint ?? `acct:${profileId}:${accountType}:${platformKey}:${identifier}`,
    createdAt: overrides.createdAt ?? new Date('2026-01-01T00:00:00.000Z'),
    ...overrides,
  };
}

function buildImportPorts(state: TestState, failCreateIdentifiers: Set<string> = new Set<string>()): ImportPorts {
  const buildPortsForState = (currentState: TestState): ImportPorts => ({
    createAccount: async (params) => {
      if (failCreateIdentifiers.has(params.identifier)) {
        return err(new Error('Failed to create account'));
      }

      const childAccount = createAccount({
        id: currentState.nextAccountId++,
        profileId: params.profileId,
        parentAccountId: params.parentAccountId,
        accountType: params.accountType,
        platformKey: params.platformKey,
        identifier: params.identifier,
        providerName: params.providerName,
      });
      currentState.accounts.push(childAccount);
      return ok(childAccount);
    },
    findAccountById: async (accountId) => ok(currentState.accounts.find((account) => account.id === accountId)),
    findAccounts: async (filters) =>
      ok(
        currentState.accounts.filter((account) => {
          if (filters.accountType !== undefined && account.accountType !== filters.accountType) return false;
          if (filters.parentAccountId !== undefined && account.parentAccountId !== filters.parentAccountId)
            return false;
          if (filters.platformKey !== undefined && account.platformKey !== filters.platformKey) return false;
          if (filters.profileId !== undefined && account.profileId !== filters.profileId) return false;
          return true;
        })
      ),
    updateAccount: async (accountId, updates) => {
      const account = currentState.accounts.find((candidate) => candidate.id === accountId);
      if (!account) {
        return err(new Error(`Account ${accountId} not found`));
      }

      if (updates.metadata !== undefined) {
        account.metadata = updates.metadata;
      }

      return ok(undefined);
    },
    updateAccountCursor: async () => ok(undefined),
    createImportSession: async () => ok(1),
    findLatestIncompleteImportSession: async () => ok(undefined),
    updateImportSession: async () => ok(undefined),
    finalizeImportSession: async () => ok(undefined),
    findImportSessionById: async () =>
      ok<ImportSession | undefined>({
        id: 1,
        accountId: 1,
        status: 'completed',
        startedAt: new Date('2026-01-01T00:00:00.000Z'),
        completedAt: new Date('2026-01-01T00:00:01.000Z'),
        transactionsImported: 0,
        transactionsSkipped: 0,
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
      }),
    createRawTransactionBatch: async () => ok({ inserted: 0, skipped: 0 }),
    countRawTransactionsByStreamType: async () => ok(new Map()),
    invalidateProjections: async () => ok(undefined),
    withTransaction: async (fn) => {
      const txState: TestState = {
        accounts: structuredClone(currentState.accounts),
        nextAccountId: currentState.nextAccountId,
      };
      const result = await fn(buildPortsForState(txState));
      if (result.isErr()) {
        return result;
      }

      currentState.accounts = txState.accounts;
      currentState.nextAccountId = txState.nextAccountId;
      return result;
    },
  });

  return buildPortsForState(state);
}

function createWorkflow(params: {
  createImporter?: ReturnType<typeof vi.fn> | undefined;
  deriveAddressesFromXpub: ReturnType<typeof vi.fn>;
  eventBus?: EventBus<IngestionEvent> | undefined;
  ports: ImportPorts;
}): ImportWorkflow {
  const createImporter =
    params.createImporter ??
    vi.fn(() => ({
      async *importStreaming(): AsyncIterableIterator<Result<never, Error>> {
        yield* [];
        return;
      },
    }));

  const adapter = {
    blockchain: 'bitcoin',
    chainModel: 'utxo',
    normalizeAddress: (address: string) => ok(address),
    createImporter,
    createProcessor: vi.fn(),
    isExtendedPublicKey: vi.fn((address: string) => address.startsWith('xpub')),
    deriveAddressesFromXpub: params.deriveAddressesFromXpub,
  };

  return new ImportWorkflow(
    params.ports,
    {} as IBlockchainProviderRuntime,
    new AdapterRegistry([adapter as never], []),
    params.eventBus
  );
}

function createImportBatch(overrides: Partial<ImportBatchResult> = {}): ImportBatchResult {
  return {
    rawTransactions: overrides.rawTransactions ?? [],
    streamType: overrides.streamType ?? 'transactions',
    cursor: overrides.cursor ?? {
      primary: {
        type: 'pageToken',
        value: 'cursor:1',
        providerName: 'bitcoin',
      },
      lastTransactionId: 'cursor:1:last',
      totalFetched: 0,
      metadata: {
        providerName: 'bitcoin',
        updatedAt: 1,
        isComplete: true,
      },
    },
    isComplete: overrides.isComplete ?? true,
    providerStats: overrides.providerStats,
    warnings: overrides.warnings,
  };
}

describe('ImportWorkflow xpub child materialization', () => {
  it('re-derives when child rows exist but the parent xpub was never fully materialized', async () => {
    const state: TestState = {
      accounts: [
        createAccount({
          id: 1,
          identifier: 'xpub-parent',
          metadata: {
            xpub: {
              gapLimit: 20,
              lastDerivedAt: 0,
              derivedCount: 0,
            },
          },
        }),
        createAccount({
          id: 2,
          parentAccountId: 1,
          identifier: 'bc1-existing',
        }),
      ],
      nextAccountId: 3,
    };
    const deriveAddressesFromXpub = vi.fn().mockResolvedValue(
      ok([
        { address: 'bc1-existing', derivationPath: '0/0' },
        { address: 'bc1-new', derivationPath: '0/1' },
      ])
    );

    const workflow = createWorkflow({
      deriveAddressesFromXpub,
      ports: buildImportPorts(state, new Set(['bc1-new'])),
    });

    const result = await workflow.execute({ accountId: 1 });

    expect(result.isErr()).toBe(true);
    expect(deriveAddressesFromXpub).toHaveBeenCalledOnce();
  });

  it('treats xpub accounts with only seeded metadata as initial derivations', async () => {
    const state: TestState = {
      accounts: [
        createAccount({
          id: 1,
          identifier: 'xpub-parent',
          metadata: {
            xpub: {
              gapLimit: 20,
              lastDerivedAt: 0,
              derivedCount: 0,
            },
          },
        }),
      ],
      nextAccountId: 2,
    };
    const emitMock = vi.fn();
    const eventBus = {
      emit: emitMock,
    } as unknown as EventBus<IngestionEvent>;
    const deriveAddressesFromXpub = vi.fn().mockResolvedValue(ok([{ address: 'bc1-first', derivationPath: '0/0' }]));

    const workflow = createWorkflow({
      deriveAddressesFromXpub,
      eventBus,
      ports: buildImportPorts(state, new Set(['bc1-first'])),
    });

    await workflow.execute({ accountId: 1 });

    const emittedEvents = emitMock.mock.calls.map((call) => call[0] as IngestionEvent);
    const derivationStartedEvent = emittedEvents.find(
      (event): event is Extract<IngestionEvent, { type: 'xpub.derivation.started' }> =>
        event.type === 'xpub.derivation.started'
    );

    expect(derivationStartedEvent).toBeDefined();
    expect(derivationStartedEvent).toMatchObject({
      type: 'xpub.derivation.started',
      isRederivation: false,
      gapLimit: 20,
    });
    expect(derivationStartedEvent?.previousGap).toBeUndefined();
  });
});

describe('ImportWorkflow failure finalization', () => {
  it('returns an aggregate error when warning-based failure finalization also fails', async () => {
    const state: TestState = {
      accounts: [createAccount()],
      nextAccountId: 2,
    };
    const finalizeImportSession = vi.fn().mockResolvedValue(err(new Error('failed to persist warning failure state')));
    const emitMock = vi.fn();
    const ports = buildImportPorts(state);
    ports.finalizeImportSession = finalizeImportSession;

    const workflow = createWorkflow({
      createImporter: vi.fn(() => ({
        async *importStreaming(): AsyncIterableIterator<Result<ImportBatchResult, Error>> {
          yield ok(
            createImportBatch({
              warnings: ['provider returned partial data'],
            })
          );
        },
      })),
      deriveAddressesFromXpub: vi.fn(),
      eventBus: {
        emit: emitMock,
      } as unknown as EventBus<IngestionEvent>,
      ports,
    });

    const result = await workflow.execute({ accountId: 1 });

    expect(result.isErr()).toBe(true);
    expect(finalizeImportSession).toHaveBeenCalledOnce();
    expect(finalizeImportSession).toHaveBeenCalledWith(
      1,
      expect.objectContaining({
        status: 'failed',
        metadata: {
          warnings: ['provider returned partial data'],
        },
      })
    );

    if (result.isOk()) {
      return;
    }

    expect(result.error).toBeInstanceOf(AggregateError);
    const aggregateError = result.error as AggregateError;
    expect(aggregateError.message).toBe('Import failed for bitcoin and failed to finalize import session');
    expect(aggregateError.errors).toHaveLength(2);
    expect((aggregateError.errors[0] as Error).message).toBe(
      'Import completed with 1 warning(s) and was marked as failed to prevent processing incomplete data. '
    );
    expect((aggregateError.errors[1] as Error).message).toBe('failed to persist warning failure state');

    const importFailedEvent = emitMock.mock.calls
      .map((call) => call[0] as IngestionEvent)
      .find((event): event is Extract<IngestionEvent, { type: 'import.failed' }> => event.type === 'import.failed');

    expect(importFailedEvent).toMatchObject({
      type: 'import.failed',
      platformKey: 'bitcoin',
      accountId: 1,
      error:
        'Import completed with 1 warning(s) and was marked as failed to prevent processing incomplete data. ; additionally failed to finalize import session: failed to persist warning failure state',
    });
  });

  it('returns an aggregate error when abort finalization also fails', async () => {
    const state: TestState = {
      accounts: [createAccount()],
      nextAccountId: 2,
    };
    const finalizeImportSession = vi.fn().mockResolvedValue(err(new Error('failed to persist abort state')));
    const ports = buildImportPorts(state);
    ports.finalizeImportSession = finalizeImportSession;

    const workflow = createWorkflow({
      createImporter: vi.fn(() => ({
        async *importStreaming(): AsyncIterableIterator<Result<ImportBatchResult, Error>> {
          yield ok(createImportBatch());
        },
      })),
      deriveAddressesFromXpub: vi.fn(),
      ports,
    });
    workflow.abort();

    const result = await workflow.execute({ accountId: 1 });

    expect(result.isErr()).toBe(true);
    expect(finalizeImportSession).toHaveBeenCalledOnce();
    expect(finalizeImportSession).toHaveBeenCalledWith(
      1,
      expect.objectContaining({
        status: 'failed',
        errorMessage: 'Import aborted by user',
      })
    );

    if (result.isOk()) {
      return;
    }

    expect(result.error).toBeInstanceOf(AggregateError);
    const aggregateError = result.error as AggregateError;
    expect(aggregateError.message).toBe('Import aborted for bitcoin and failed to finalize import session');
    expect(aggregateError.errors).toHaveLength(2);
    expect((aggregateError.errors[0] as Error).message).toBe('Import aborted by user');
    expect((aggregateError.errors[1] as Error).message).toBe('failed to persist abort state');
  });

  it('returns an aggregate error when import execution fails and failed-session finalization also fails', async () => {
    const state: TestState = {
      accounts: [createAccount()],
      nextAccountId: 2,
    };
    const finalizeImportSession = vi.fn().mockResolvedValue(err(new Error('failed to persist failed session state')));
    const emitMock = vi.fn();
    const ports = buildImportPorts(state);
    ports.finalizeImportSession = finalizeImportSession;

    const workflow = createWorkflow({
      createImporter: vi.fn(() => ({
        async *importStreaming(): AsyncIterableIterator<Result<never, Error>> {
          yield* [];
          throw new Error('provider stream exploded');
        },
      })),
      deriveAddressesFromXpub: vi.fn(),
      eventBus: {
        emit: emitMock,
      } as unknown as EventBus<IngestionEvent>,
      ports,
    });

    const result = await workflow.execute({ accountId: 1 });

    expect(result.isErr()).toBe(true);
    expect(finalizeImportSession).toHaveBeenCalledOnce();

    if (result.isOk()) {
      return;
    }

    expect(result.error).toBeInstanceOf(AggregateError);
    const aggregateError = result.error as AggregateError;
    expect(aggregateError.message).toBe('Import failed for bitcoin and failed to finalize import session');
    expect(aggregateError.errors).toHaveLength(2);
    expect((aggregateError.errors[0] as Error).message).toBe('provider stream exploded');
    expect((aggregateError.errors[1] as Error).message).toBe('failed to persist failed session state');

    const importFailedEvent = emitMock.mock.calls
      .map((call) => call[0] as IngestionEvent)
      .find((event): event is Extract<IngestionEvent, { type: 'import.failed' }> => event.type === 'import.failed');

    expect(importFailedEvent).toMatchObject({
      type: 'import.failed',
      platformKey: 'bitcoin',
      accountId: 1,
      error:
        'provider stream exploded; additionally failed to finalize import session: failed to persist failed session state',
    });
  });
});
