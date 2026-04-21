import type { Transaction } from '@exitbook/core';
import { describe, expect, it } from 'vitest';

import type { TransactionAnnotation } from '../../annotations/annotation-types.js';
import { deriveOperationLabel } from '../derive-operation-label.js';

function createTransaction(operation: Transaction['operation']): Pick<Transaction, 'operation'> {
  return { operation };
}

function createAnnotation(
  overrides: Partial<TransactionAnnotation> & Pick<TransactionAnnotation, 'kind' | 'tier'>
): TransactionAnnotation {
  return {
    annotationFingerprint: 'annotation:test',
    accountId: 1,
    transactionId: 1,
    txFingerprint: 'tx-test',
    kind: overrides.kind,
    tier: overrides.tier,
    target: overrides.target ?? { scope: 'transaction' },
    detectorId: 'detector',
    derivedFromTxIds: [1],
    provenanceInputs: ['diagnostic'],
    ...(overrides.role === undefined ? {} : { role: overrides.role }),
    ...(overrides.groupKey === undefined ? {} : { groupKey: overrides.groupKey }),
    ...(overrides.protocolRef === undefined ? {} : { protocolRef: overrides.protocolRef }),
    ...(overrides.metadata === undefined ? {} : { metadata: overrides.metadata }),
  };
}

describe('deriveOperationLabel', () => {
  it('falls back to the stored operation when no interpretation is present', () => {
    expect(
      deriveOperationLabel(
        createTransaction({
          category: 'trade',
          type: 'buy',
        })
      )
    ).toStrictEqual({
      group: 'trade',
      label: 'trade/buy',
      source: 'operation',
    });
  });

  it('derives bridge send labels from bridge annotations', () => {
    expect(
      deriveOperationLabel(
        createTransaction({
          category: 'transfer',
          type: 'withdrawal',
        }),
        [createAnnotation({ kind: 'bridge_participant', tier: 'asserted', role: 'source' })]
      )
    ).toStrictEqual({
      group: 'transfer',
      label: 'bridge/send',
      source: 'annotation',
    });
  });

  it('derives asset-migration receive labels from migration annotations', () => {
    expect(
      deriveOperationLabel(
        createTransaction({
          category: 'transfer',
          type: 'deposit',
        }),
        [createAnnotation({ kind: 'asset_migration_participant', tier: 'heuristic', role: 'target' })]
      )
    ).toStrictEqual({
      group: 'transfer',
      label: 'asset migration/receive',
      source: 'annotation',
    });
  });

  it('derives staking labels from staking reward annotations', () => {
    expect(
      deriveOperationLabel(
        createTransaction({
          category: 'transfer',
          type: 'deposit',
        }),
        [
          createAnnotation({
            kind: 'staking_reward',
            tier: 'asserted',
            target: { scope: 'movement', movementFingerprint: 'in-0' },
          }),
        ]
      )
    ).toStrictEqual({
      group: 'staking',
      label: 'staking/reward',
      source: 'annotation',
    });
  });

  it('prefers asserted annotations over heuristic ones when choosing a label', () => {
    expect(
      deriveOperationLabel(
        createTransaction({
          category: 'transfer',
          type: 'deposit',
        }),
        [
          createAnnotation({ kind: 'bridge_participant', tier: 'heuristic', role: 'target' }),
          createAnnotation({ kind: 'asset_migration_participant', tier: 'asserted', role: 'target' }),
        ]
      )
    ).toStrictEqual({
      group: 'transfer',
      label: 'asset migration/receive',
      source: 'annotation',
    });
  });

  it('prefers higher-priority asserted kinds when multiple asserted annotations exist', () => {
    expect(
      deriveOperationLabel(
        createTransaction({
          category: 'transfer',
          type: 'deposit',
        }),
        [
          createAnnotation({ kind: 'bridge_participant', tier: 'asserted', role: 'target' }),
          createAnnotation({ kind: 'wrap', tier: 'asserted' }),
        ]
      )
    ).toStrictEqual({
      group: 'transfer',
      label: 'wrap',
      source: 'annotation',
    });
  });
});
