import { parseDecimal } from '@exitbook/core';
import type { Currency, UniversalTransactionData } from '@exitbook/core';
import type { DataContext } from '@exitbook/data';
import type { EventBus } from '@exitbook/events';
import { ok } from 'neverthrow';
import { vi } from 'vitest';

import type { LinkingRunParams } from '../link-operation.js';
import type { LinkingEvent } from '../linking-events.js';

export const defaultLinkParams: LinkingRunParams = {
  dryRun: false,
  minConfidenceScore: parseDecimal('0.7'),
  autoConfirmThreshold: parseDecimal('0.95'),
};

export function createTransaction(params: {
  accountId?: number | undefined;
  blockchain?: { is_confirmed: boolean; name: string; transaction_hash: string } | undefined;
  datetime: string;
  id: number;
  inflows?: { amount: string; assetSymbol: string }[] | undefined;
  outflows?: { amount: string; assetSymbol: string }[] | undefined;
  source: string;
  sourceType?: 'blockchain' | 'exchange' | undefined;
}): UniversalTransactionData {
  const sourceType = params.sourceType ?? (params.blockchain ? 'blockchain' : 'exchange');
  return {
    id: params.id,
    accountId: params.accountId ?? 1,
    externalId: `${params.source}-${params.id}`,
    datetime: params.datetime,
    timestamp: new Date(params.datetime).getTime(),
    source: params.source,
    sourceType,
    status: 'success',
    movements: {
      inflows: params.inflows
        ? params.inflows.map((movement) => ({
            assetId: `test:${movement.assetSymbol.toLowerCase()}`,
            assetSymbol: movement.assetSymbol as Currency,
            grossAmount: parseDecimal(movement.amount),
          }))
        : [],
      outflows: params.outflows
        ? params.outflows.map((movement) => ({
            assetId: `test:${movement.assetSymbol.toLowerCase()}`,
            assetSymbol: movement.assetSymbol as Currency,
            grossAmount: parseDecimal(movement.amount),
          }))
        : [],
    },
    fees: [],
    operation: {
      category: 'transfer',
      type: 'transfer',
    },
    blockchain: params.blockchain,
  };
}

export function createExchangeToChainTransferPair(): UniversalTransactionData[] {
  return [
    createTransaction({
      id: 1,
      source: 'kraken',
      sourceType: 'exchange',
      datetime: '2026-02-08T00:00:00Z',
      outflows: [{ assetSymbol: 'BTC', amount: '1' }],
    }),
    createTransaction({
      id: 2,
      source: 'blockchain:bitcoin',
      sourceType: 'blockchain',
      datetime: '2026-02-08T01:00:00Z',
      inflows: [{ assetSymbol: 'BTC', amount: '0.999' }],
    }),
  ];
}

export function createMockDb(
  overrides: {
    linkableMovements?: Partial<DataContext['linkableMovements']> | undefined;
    transactionLinks?: Partial<DataContext['transactionLinks']> | undefined;
    transactions?: Partial<DataContext['transactions']> | undefined;
  } = {}
): DataContext {
  let savedMovements: unknown[] = [];

  return {
    transactions: {
      findAll: vi.fn().mockResolvedValue(ok([])),
      ...overrides.transactions,
    },
    transactionLinks: {
      deleteAll: vi.fn().mockResolvedValue(ok(0)),
      createBatch: vi.fn().mockResolvedValue(ok(0)),
      ...overrides.transactionLinks,
    },
    linkableMovements: {
      deleteAll: vi.fn().mockImplementation(() => {
        savedMovements = [];
        return Promise.resolve(ok(undefined));
      }),
      createBatch: vi.fn().mockImplementation((movements: unknown[]) => {
        savedMovements = movements.map((movement, index) => ({ ...(movement as object), id: index + 1 }));
        return Promise.resolve(ok(movements.length));
      }),
      findAll: vi.fn().mockImplementation(() => Promise.resolve(ok(savedMovements))),
      ...overrides.linkableMovements,
    },
  } as unknown as DataContext;
}

export function createMockEventBus(events: LinkingEvent[]): EventBus<LinkingEvent> {
  return {
    emit: vi.fn().mockImplementation((event: LinkingEvent) => {
      events.push(event);
    }),
    subscribe: vi.fn(),
  } as unknown as EventBus<LinkingEvent>;
}
