import {
  UNATTRIBUTED_STAKING_REWARD_COMPONENT_DIAGNOSTIC_CODE,
  type Transaction,
  type TransactionDiagnostic,
} from '@exitbook/core';
import { type Currency, parseDecimal } from '@exitbook/foundation';
import type { TransactionAnnotation } from '@exitbook/transaction-interpretation';

import { materializeTestTransaction } from '../../__tests__/test-utils.js';
import type { LinkableMovement } from '../matching/linkable-movement.js';
import { createLinkableMovement } from '../shared/test-utils.js';

export function createImpossibleMultiSourceAdaHashPartialScenario() {
  const hash = '0c62fbdfe97c5e94346f0976114b769b45080dc5d9e0c03ca33ad112dc8f25cf';

  const sources = [
    createLinkableMovement({
      id: 1,
      transactionId: 8930,
      accountId: 61,
      platformKey: 'cardano',
      platformKind: 'blockchain',
      assetId: 'blockchain:cardano:native',
      assetSymbol: 'ADA' as Currency,
      amount: parseDecimal('1021.211168'),
      grossAmount: parseDecimal('1021.402541'),
      direction: 'out',
      timestamp: new Date('2024-07-25T20:32:02.000Z'),
      blockchainTxHash: hash,
      toAddress:
        'addr1q95qk0u05drsy3e3qfjzspgc97a3f8ktv23se96sqfw4204c0rqf3wsyvp6zyxwgg0f7p0d8h0d8z6kpf6asuetxeussscaha9',
      movementFingerprint: 'movement:tx:v2:cardano:61:hash:outflow:0',
    }),
    createLinkableMovement({
      id: 2,
      transactionId: 8935,
      accountId: 63,
      platformKey: 'cardano',
      platformKind: 'blockchain',
      assetId: 'blockchain:cardano:native',
      assetSymbol: 'ADA' as Currency,
      amount: parseDecimal('974.843208'),
      grossAmount: parseDecimal('975.034581'),
      direction: 'out',
      timestamp: new Date('2024-07-25T20:32:02.000Z'),
      blockchainTxHash: hash,
      toAddress:
        'addr1q95qk0u05drsy3e3qfjzspgc97a3f8ktv23se96sqfw4204c0rqf3wsyvp6zyxwgg0f7p0d8h0d8z6kpf6asuetxeussscaha9',
      movementFingerprint: 'movement:tx:v2:cardano:63:hash:outflow:0',
    }),
    createLinkableMovement({
      id: 3,
      transactionId: 8937,
      accountId: 65,
      platformKey: 'cardano',
      platformKind: 'blockchain',
      assetId: 'blockchain:cardano:native',
      assetSymbol: 'ADA' as Currency,
      amount: parseDecimal('672.756869'),
      grossAmount: parseDecimal('672.948242'),
      direction: 'out',
      timestamp: new Date('2024-07-25T20:32:02.000Z'),
      blockchainTxHash: hash,
      toAddress:
        'addr1q95qk0u05drsy3e3qfjzspgc97a3f8ktv23se96sqfw4204c0rqf3wsyvp6zyxwgg0f7p0d8h0d8z6kpf6asuetxeussscaha9',
      movementFingerprint: 'movement:tx:v2:cardano:65:hash:outflow:0',
    }),
  ];

  const targets = [
    createLinkableMovement({
      id: 10,
      transactionId: 9021,
      accountId: 90,
      platformKey: 'kucoin',
      platformKind: 'exchange',
      assetId: 'exchange:kucoin:ada',
      assetSymbol: 'ADA' as Currency,
      amount: parseDecimal('2679.718442'),
      direction: 'in',
      timestamp: new Date('2024-07-25T20:35:47.000Z'),
      blockchainTxHash: hash,
      movementFingerprint: 'movement:tx:v2:kucoin:90:hash:inflow:0',
    }),
  ];

  return { sources, targets };
}

export function createImpossibleMultiSourceAdaHashPartialTransactions(): Transaction[] {
  return [
    createTransferTransaction({
      accountId: 61,
      amount: '1021.211168',
      datetime: '2024-07-25T20:32:02.000Z',
      identityReference: 'cardano-8930',
      fees: '0.191373',
      grossAmount: '1021.402541',
      id: 8930,
      platformKey: 'cardano',
      platformKind: 'blockchain',
    }),
    createTransferTransaction({
      accountId: 63,
      amount: '974.843208',
      datetime: '2024-07-25T20:32:02.000Z',
      identityReference: 'cardano-8935',
      fees: '0.191373',
      grossAmount: '975.034581',
      id: 8935,
      platformKey: 'cardano',
      platformKind: 'blockchain',
    }),
    createTransferTransaction({
      accountId: 65,
      amount: '672.756869',
      datetime: '2024-07-25T20:32:02.000Z',
      identityReference: 'cardano-8937',
      fees: '0.191373',
      grossAmount: '672.948242',
      id: 8937,
      platformKey: 'cardano',
      platformKind: 'blockchain',
    }),
    createTransferTransaction({
      accountId: 90,
      amount: '2679.718442',
      datetime: '2024-07-25T20:35:47.000Z',
      identityReference: 'kucoin-9021',
      id: 9021,
      operationType: 'deposit',
      platformKey: 'kucoin',
      platformKind: 'exchange',
    }),
  ];
}

export function createExplainedMultiSourceAdaHashPartialScenario() {
  const hash = '0c62fbdfe97c5e94346f0976114b769b45080dc5d9e0c03ca33ad112dc8f25cf';
  const transactionAnnotations = [createStakingRewardComponentAnnotation('10.524451')];

  const sources = [
    createLinkableMovement({
      id: 1,
      transactionId: 2447,
      accountId: 87,
      platformKey: 'cardano',
      platformKind: 'blockchain',
      assetId: 'blockchain:cardano:native',
      assetSymbol: 'ADA' as Currency,
      amount: parseDecimal('1021.329314829243639698026006'),
      grossAmount: parseDecimal('1021.402541'),
      direction: 'out',
      timestamp: new Date('2024-07-25T20:32:02.000Z'),
      blockchainTxHash: hash,
      toAddress:
        'addr1q95qk0u05drsy3e3qfjzspgc97a3f8ktv23se96sqfw4204c0rqf3wsyvp6zyxwgg0f7p0d8h0d8z6kpf6asuetxeussscaha9',
      movementFingerprint: 'movement:tx:v2:cardano:87:hash:outflow:0',
      transactionAnnotations,
    }),
    createLinkableMovement({
      id: 2,
      transactionId: 2452,
      accountId: 89,
      platformKey: 'cardano',
      platformKind: 'blockchain',
      assetId: 'blockchain:cardano:native',
      assetSymbol: 'ADA' as Currency,
      amount: parseDecimal('974.9646790310350899938477373'),
      grossAmount: parseDecimal('975.034581'),
      direction: 'out',
      timestamp: new Date('2024-07-25T20:32:02.000Z'),
      blockchainTxHash: hash,
      toAddress:
        'addr1q95qk0u05drsy3e3qfjzspgc97a3f8ktv23se96sqfw4204c0rqf3wsyvp6zyxwgg0f7p0d8h0d8z6kpf6asuetxeussscaha9',
      movementFingerprint: 'movement:tx:v2:cardano:89:hash:outflow:0',
      transactionAnnotations,
    }),
    createLinkableMovement({
      id: 3,
      transactionId: 2454,
      accountId: 91,
      platformKey: 'cardano',
      platformKind: 'blockchain',
      assetId: 'blockchain:cardano:native',
      assetSymbol: 'ADA' as Currency,
      amount: parseDecimal('672.8999971397212703081262567'),
      grossAmount: parseDecimal('672.948242'),
      direction: 'out',
      timestamp: new Date('2024-07-25T20:32:02.000Z'),
      blockchainTxHash: hash,
      toAddress:
        'addr1q95qk0u05drsy3e3qfjzspgc97a3f8ktv23se96sqfw4204c0rqf3wsyvp6zyxwgg0f7p0d8h0d8z6kpf6asuetxeussscaha9',
      movementFingerprint: 'movement:tx:v2:cardano:91:hash:outflow:0',
      transactionAnnotations,
    }),
  ];

  const targets = [
    createLinkableMovement({
      id: 10,
      transactionId: 2304,
      accountId: 90,
      platformKey: 'kucoin',
      platformKind: 'exchange',
      assetId: 'exchange:kucoin:ada',
      assetSymbol: 'ADA' as Currency,
      amount: parseDecimal('2679.718442'),
      direction: 'in',
      timestamp: new Date('2024-07-25T20:35:47.000Z'),
      blockchainTxHash: hash,
      movementFingerprint: 'movement:tx:v2:kucoin:90:hash:inflow:0',
    }),
  ];

  return { sources, targets };
}

export function createExplainedMultiSourceAdaHashPartialTransactions(): Transaction[] {
  const diagnostics = [createUnattributedStakingRewardDiagnostic('10.524451')];

  return [
    createTransferTransaction({
      accountId: 87,
      amount: '1021.329314829243639698026006',
      datetime: '2024-07-25T20:32:02.000Z',
      diagnostics,
      fees: '0.073226170756360301973994',
      grossAmount: '1021.402541',
      id: 2447,
      identityReference: '0c62fbdfe97c5e94346f0976114b769b45080dc5d9e0c03ca33ad112dc8f25cf',
      platformKey: 'cardano',
      platformKind: 'blockchain',
      to: 'addr1q95qk0u05drsy3e3qfjzspgc97a3f8ktv23se96sqfw4204c0rqf3wsyvp6zyxwgg0f7p0d8h0d8z6kpf6asuetxeussscaha9',
    }),
    createTransferTransaction({
      accountId: 89,
      amount: '974.9646790310350899938477373',
      datetime: '2024-07-25T20:32:02.000Z',
      diagnostics,
      fees: '0.0699019689649100061522627',
      grossAmount: '975.034581',
      id: 2452,
      identityReference: '0c62fbdfe97c5e94346f0976114b769b45080dc5d9e0c03ca33ad112dc8f25cf',
      platformKey: 'cardano',
      platformKind: 'blockchain',
      to: 'addr1q95qk0u05drsy3e3qfjzspgc97a3f8ktv23se96sqfw4204c0rqf3wsyvp6zyxwgg0f7p0d8h0d8z6kpf6asuetxeussscaha9',
    }),
    createTransferTransaction({
      accountId: 91,
      amount: '672.8999971397212703081262567',
      datetime: '2024-07-25T20:32:02.000Z',
      diagnostics,
      fees: '0.0482448602787296918737433',
      grossAmount: '672.948242',
      id: 2454,
      identityReference: '0c62fbdfe97c5e94346f0976114b769b45080dc5d9e0c03ca33ad112dc8f25cf',
      platformKey: 'cardano',
      platformKind: 'blockchain',
      to: 'addr1q95qk0u05drsy3e3qfjzspgc97a3f8ktv23se96sqfw4204c0rqf3wsyvp6zyxwgg0f7p0d8h0d8z6kpf6asuetxeussscaha9',
    }),
    createTransferTransaction({
      accountId: 90,
      amount: '2679.718442',
      blockchain: {
        name: 'cardano',
        transaction_hash: '0c62fbdfe97c5e94346f0976114b769b45080dc5d9e0c03ca33ad112dc8f25cf',
        is_confirmed: true,
      },
      datetime: '2024-07-25T20:35:47.000Z',
      identityReference: '0c62fbdfe97c5e94346f0976114b769b45080dc5d9e0c03ca33ad112dc8f25cf',
      id: 2304,
      operationType: 'deposit',
      platformKey: 'kucoin',
      platformKind: 'exchange',
    }),
  ];
}

export function createLinkableMovementsFromTransactions(transactions: Transaction[]): LinkableMovement[] {
  let nextCandidateId = 1;
  const linkableMovements: LinkableMovement[] = [];

  for (const tx of transactions) {
    for (const inflow of tx.movements.inflows ?? []) {
      linkableMovements.push(
        createLinkableMovement({
          id: nextCandidateId++,
          transactionId: tx.id,
          accountId: tx.accountId,
          platformKey: tx.platformKey,
          platformKind: tx.platformKind,
          assetId: inflow.assetId,
          assetSymbol: inflow.assetSymbol,
          direction: 'in',
          amount: inflow.netAmount ?? inflow.grossAmount,
          grossAmount: inflow.netAmount && !inflow.netAmount.eq(inflow.grossAmount) ? inflow.grossAmount : undefined,
          timestamp: new Date(tx.datetime),
          blockchainTxHash: tx.blockchain?.transaction_hash,
          fromAddress: tx.from,
          toAddress: tx.to,
          movementFingerprint: inflow.movementFingerprint,
        })
      );
    }

    for (const outflow of tx.movements.outflows ?? []) {
      linkableMovements.push(
        createLinkableMovement({
          id: nextCandidateId++,
          transactionId: tx.id,
          accountId: tx.accountId,
          platformKey: tx.platformKey,
          platformKind: tx.platformKind,
          assetId: outflow.assetId,
          assetSymbol: outflow.assetSymbol,
          direction: 'out',
          amount: outflow.netAmount ?? outflow.grossAmount,
          grossAmount:
            outflow.netAmount && !outflow.netAmount.eq(outflow.grossAmount) ? outflow.grossAmount : undefined,
          timestamp: new Date(tx.datetime),
          blockchainTxHash: tx.blockchain?.transaction_hash,
          fromAddress: tx.from,
          toAddress: tx.to,
          movementFingerprint: outflow.movementFingerprint,
        })
      );
    }
  }

  return linkableMovements;
}

function createTransferTransaction(params: {
  accountId: number;
  amount: string;
  blockchain?: Transaction['blockchain'] | undefined;
  datetime: string;
  diagnostics?: Transaction['diagnostics'] | undefined;
  fees?: string | undefined;
  from?: string | undefined;
  grossAmount?: string | undefined;
  id: number;
  identityReference: string;
  operationType?: 'withdrawal' | 'deposit' | undefined;
  platformKey: string;
  platformKind: 'blockchain' | 'exchange';
  to?: string | undefined;
}): Transaction {
  const grossAmount = parseDecimal(params.grossAmount ?? params.amount);
  const netAmount = parseDecimal(params.amount);
  const feeAmount = params.fees ? parseDecimal(params.fees) : undefined;

  return materializeTestTransaction({
    id: params.id,
    accountId: params.accountId,
    identityReference: params.identityReference,
    platformKey: params.platformKey,
    platformKind: params.platformKind,
    datetime: params.datetime,
    timestamp: Date.parse(params.datetime),
    status: 'success',
    from: params.from,
    movements: {
      inflows:
        params.operationType === 'deposit'
          ? [
              {
                assetId:
                  params.platformKind === 'exchange'
                    ? `exchange:${params.platformKey}:ada`
                    : `blockchain:${params.platformKey}:native`,
                assetSymbol: 'ADA' as Currency,
                grossAmount,
                netAmount,
              },
            ]
          : [],
      outflows:
        params.operationType === 'deposit'
          ? []
          : [
              {
                assetId:
                  params.platformKind === 'exchange'
                    ? `exchange:${params.platformKey}:ada`
                    : `blockchain:${params.platformKey}:native`,
                assetSymbol: 'ADA' as Currency,
                grossAmount,
                netAmount,
              },
            ],
    },
    fees:
      feeAmount !== undefined
        ? [
            {
              assetId: 'blockchain:cardano:native',
              assetSymbol: 'ADA' as Currency,
              amount: feeAmount,
              scope: 'network',
              settlement: 'on-chain',
            },
          ]
        : [],
    operation: {
      category: 'transfer',
      type: params.operationType ?? 'withdrawal',
    },
    blockchain: params.blockchain,
    diagnostics: params.diagnostics,
    to: params.to,
  });
}

function createUnattributedStakingRewardDiagnostic(amount: string): TransactionDiagnostic {
  return {
    code: UNATTRIBUTED_STAKING_REWARD_COMPONENT_DIAGNOSTIC_CODE,
    message: `Includes wallet-scoped staking reward component of ${amount} ADA that cannot be attributed to a single derived address in the current projection.`,
    severity: 'info',
    metadata: {
      amount,
      assetSymbol: 'ADA',
      movementRole: 'staking_reward',
    },
  };
}

function createStakingRewardComponentAnnotation(amount: string): TransactionAnnotation {
  return {
    annotationFingerprint: `annotation:staking-reward-component:${amount}`,
    accountId: 87,
    transactionId: 2447,
    txFingerprint: `tx:staking-reward-component:${amount}`,
    kind: 'staking_reward_component',
    tier: 'asserted',
    target: { scope: 'transaction' },
    detectorId: 'staking-reward-component',
    derivedFromTxIds: [2447],
    provenanceInputs: ['diagnostic'],
    metadata: {
      amount,
      assetSymbol: 'ADA',
      componentKey: `unattributed_staking_reward_component:ADA:${amount}`,
    },
  };
}
