import type { IBlockchainProviderRuntime } from '@exitbook/blockchain-providers';
import type { Account, ImportSession } from '@exitbook/core';
import type { EventBus } from '@exitbook/events';
import { err, ok, type Result } from '@exitbook/foundation';
import { describe, expect, it, vi } from 'vitest';

import type { IngestionEvent } from '../../../events.js';
import type { ImportPorts } from '../../../ports/import-ports.js';
import { AdapterRegistry } from '../../../shared/types/adapter-registry.js';
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
  deriveAddressesFromXpub: ReturnType<typeof vi.fn>;
  eventBus?: EventBus<IngestionEvent> | undefined;
  ports: ImportPorts;
}): ImportWorkflow {
  const adapter = {
    blockchain: 'bitcoin',
    chainModel: 'utxo',
    normalizeAddress: (address: string) => ok(address),
    createImporter: vi.fn(() => ({
      async *importStreaming(): AsyncIterableIterator<Result<never, Error>> {
        yield* [];
        return;
      },
    })),
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
