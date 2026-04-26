import type { Transaction } from '@exitbook/core';
import { err, ok } from '@exitbook/foundation';
import { parseDecimal, type Currency } from '@exitbook/foundation';
import { assertErr, assertOk } from '@exitbook/foundation/test-utils';
import { describe, expect, it, vi, type Mock } from 'vitest';

import {
  computeAnnotationFingerprint,
  type DerivedFromTxIds,
  type TransactionAnnotation,
} from '../../annotations/index.js';
import type { ITransactionAnnotationDetector } from '../../detectors/transaction-annotation-detector.js';
import type { ITransactionAnnotationProfileDetector } from '../../detectors/transaction-annotation-profile-detector.js';
import type { ITransactionAnnotationStore } from '../../persistence/transaction-annotation-store.js';
import { InterpretationRuntime } from '../interpretation-runtime.js';
import { TransactionAnnotationDetectorRegistry } from '../transaction-annotation-detector-registry.js';
import { TransactionAnnotationProfileDetectorRegistry } from '../transaction-annotation-profile-detector-registry.js';
import type { ITransactionInterpretationSourceReader } from '../transaction-interpretation-source-reader.js';

function buildAnnotation(
  overrides: {
    accountId?: number | undefined;
    derivedFromTxIds?: DerivedFromTxIds | undefined;
    detectorId?: string | undefined;
    transactionId?: number | undefined;
    txFingerprint?: string | undefined;
  } = {}
): TransactionAnnotation {
  const accountId = overrides.accountId ?? 7;
  const transactionId = overrides.transactionId ?? 11;
  const txFingerprint = overrides.txFingerprint ?? 'tx-runtime-test';
  const detectorId = overrides.detectorId ?? 'bridge.detector';
  const derivedFromTxIds = overrides.derivedFromTxIds ?? ([transactionId] as const);
  const annotationFingerprint = assertOk(
    computeAnnotationFingerprint({
      kind: 'bridge_participant',
      tier: 'asserted',
      txFingerprint,
      target: { scope: 'transaction' },
      protocolRef: { id: 'wormhole' },
      role: 'source',
    })
  );

  return {
    annotationFingerprint,
    accountId,
    transactionId,
    txFingerprint,
    kind: 'bridge_participant',
    tier: 'asserted',
    target: { scope: 'transaction' },
    protocolRef: { id: 'wormhole' },
    role: 'source',
    detectorId,
    derivedFromTxIds,
    provenanceInputs: ['processor'],
  };
}

function createAnnotationStoreMock(): ITransactionAnnotationStore & {
  readAnnotations: Mock<ITransactionAnnotationStore['readAnnotations']>;
  replaceForDetectorGroup: Mock<ITransactionAnnotationStore['replaceForDetectorGroup']>;
  replaceForDetectorInputs: Mock<ITransactionAnnotationStore['replaceForDetectorInputs']>;
  replaceForTransaction: Mock<ITransactionAnnotationStore['replaceForTransaction']>;
} {
  return {
    readAnnotations: vi.fn<ITransactionAnnotationStore['readAnnotations']>().mockResolvedValue(ok([])),
    replaceForTransaction: vi
      .fn<ITransactionAnnotationStore['replaceForTransaction']>()
      .mockResolvedValue(ok(undefined)),
    replaceForDetectorInputs: vi
      .fn<ITransactionAnnotationStore['replaceForDetectorInputs']>()
      .mockResolvedValue(ok(undefined)),
    replaceForDetectorGroup: vi
      .fn<ITransactionAnnotationStore['replaceForDetectorGroup']>()
      .mockResolvedValue(ok(undefined)),
  };
}

function buildTransaction(
  overrides: {
    accountId?: number | undefined;
    transactionId?: number | undefined;
    txFingerprint?: string | undefined;
  } = {}
): Transaction {
  const accountId = overrides.accountId ?? 7;
  const transactionId = overrides.transactionId ?? 11;
  const txFingerprint = overrides.txFingerprint ?? 'tx-runtime-test';

  return {
    id: transactionId,
    accountId,
    txFingerprint,
    datetime: '2025-01-01T00:00:00.000Z',
    timestamp: 1_735_689_600_000,
    platformKey: 'ethereum',
    platformKind: 'blockchain',
    status: 'success',
    from: 'source',
    to: 'destination',
    movements: {
      inflows: [],
      outflows: [
        {
          assetId: 'blockchain:ethereum:0xa0b8',
          assetSymbol: 'USDC' as Currency,
          grossAmount: parseDecimal('1'),
          netAmount: parseDecimal('1'),
          movementFingerprint: 'mv-1',
        },
      ],
    },
    fees: [],
    operation: { category: 'transfer', type: 'withdrawal' },
    blockchain: {
      name: 'ethereum',
      transaction_hash: '0xruntime',
      is_confirmed: true,
    },
    diagnostics: [],
    excludedFromAccounting: false,
  };
}

function createSourceReaderMock(transaction: Transaction): ITransactionInterpretationSourceReader & {
  loadProfileInterpretationScope: ReturnType<typeof vi.fn>;
  loadTransactionForInterpretation: ReturnType<typeof vi.fn>;
} {
  return {
    loadTransactionForInterpretation: vi.fn().mockResolvedValue(ok(transaction)),
    loadProfileInterpretationScope: vi.fn().mockResolvedValue(
      ok({
        accounts: [
          {
            accountId: transaction.accountId,
            identifier: transaction.from ?? 'source',
            profileId: 1,
          },
        ],
        transactions: [transaction],
      })
    ),
  };
}

function createDetector(annotation: TransactionAnnotation): ITransactionAnnotationDetector {
  return {
    id: 'bridge.detector',
    kinds: ['bridge_participant'],
    run: vi.fn().mockResolvedValue(ok({ annotations: [annotation] })),
  };
}

function createProfileDetector(annotations: readonly TransactionAnnotation[]): ITransactionAnnotationProfileDetector {
  return {
    id: 'heuristic-bridge.detector',
    kinds: ['bridge_participant'],
    run: vi.fn().mockResolvedValue(ok({ annotations })),
  };
}

describe('InterpretationRuntime', () => {
  it('replaces only the requested detector output for the requested transaction', async () => {
    const annotation = buildAnnotation();
    const detector = createDetector(annotation);
    const registry = new TransactionAnnotationDetectorRegistry();
    registry.register(detector);
    const annotationStore = createAnnotationStoreMock();
    const sourceReader = createSourceReaderMock(buildTransaction());
    const runtime = new InterpretationRuntime({ registry, annotationStore, sourceReader });

    const result = await runtime.runForTransaction({
      detectorId: detector.id,
      accountId: annotation.accountId,
      transactionId: annotation.transactionId,
      txFingerprint: annotation.txFingerprint,
    });

    expect(assertOk(result)).toBeUndefined();
    expect(annotationStore.replaceForDetectorInputs).toHaveBeenCalledWith({
      detectorId: detector.id,
      derivedFromTxIds: [annotation.transactionId],
      annotations: [annotation],
    });
    expect(annotationStore.replaceForTransaction).not.toHaveBeenCalled();
    expect(sourceReader.loadTransactionForInterpretation).toHaveBeenCalledWith({
      accountId: annotation.accountId,
      transactionId: annotation.transactionId,
    });
  });

  it('rejects detector output for a different txFingerprint', async () => {
    const detector = createDetector(buildAnnotation({ txFingerprint: 'tx-other' }));
    const registry = new TransactionAnnotationDetectorRegistry();
    registry.register(detector);
    const annotationStore = createAnnotationStoreMock();
    const sourceReader = createSourceReaderMock(buildTransaction());
    const runtime = new InterpretationRuntime({ registry, annotationStore, sourceReader });

    const result = await runtime.runForTransaction({
      detectorId: detector.id,
      accountId: 7,
      transactionId: 11,
      txFingerprint: 'tx-runtime-test',
    });

    const error = assertErr(result);
    expect(error.message).toContain('expected tx-runtime-test');
    expect(annotationStore.replaceForTransaction).not.toHaveBeenCalled();
  });

  it('rejects detector output whose derivedFromTxIds do not match the runtime replacement key', async () => {
    const detector = createDetector(
      buildAnnotation({
        derivedFromTxIds: [11, 12] as const,
      })
    );
    const registry = new TransactionAnnotationDetectorRegistry();
    registry.register(detector);
    const annotationStore = createAnnotationStoreMock();
    const sourceReader = createSourceReaderMock(buildTransaction());
    const runtime = new InterpretationRuntime({ registry, annotationStore, sourceReader });

    const result = await runtime.runForTransaction({
      detectorId: detector.id,
      accountId: 7,
      transactionId: 11,
      txFingerprint: 'tx-runtime-test',
    });

    const error = assertErr(result);
    expect(error.message).toContain('expected exactly [11]');
    expect(annotationStore.replaceForTransaction).not.toHaveBeenCalled();
  });

  it('rejects detector output for a different accountId', async () => {
    const detector = createDetector(buildAnnotation({ accountId: 99 }));
    const registry = new TransactionAnnotationDetectorRegistry();
    registry.register(detector);
    const annotationStore = createAnnotationStoreMock();
    const sourceReader = createSourceReaderMock(buildTransaction());
    const runtime = new InterpretationRuntime({ registry, annotationStore, sourceReader });

    const result = await runtime.runForTransaction({
      detectorId: detector.id,
      accountId: 7,
      transactionId: 11,
      txFingerprint: 'tx-runtime-test',
    });

    const error = assertErr(result);
    expect(error.message).toContain('expected 7');
    expect(annotationStore.replaceForTransaction).not.toHaveBeenCalled();
  });

  it('surfaces detector failures without attempting replacement', async () => {
    const detector: ITransactionAnnotationDetector = {
      id: 'bridge.detector',
      kinds: ['bridge_participant'],
      run: vi.fn().mockResolvedValue(err(new Error('boom'))),
    };
    const registry = new TransactionAnnotationDetectorRegistry();
    registry.register(detector);
    const annotationStore = createAnnotationStoreMock();
    const sourceReader = createSourceReaderMock(buildTransaction());
    const runtime = new InterpretationRuntime({ registry, annotationStore, sourceReader });

    const result = await runtime.runForTransaction({
      detectorId: detector.id,
      accountId: 7,
      transactionId: 11,
      txFingerprint: 'tx-runtime-test',
    });

    expect(assertErr(result).message).toBe('boom');
    expect(annotationStore.replaceForTransaction).not.toHaveBeenCalled();
  });

  it('fails when the source reader cannot find the transaction', async () => {
    const detector = createDetector(buildAnnotation());
    const registry = new TransactionAnnotationDetectorRegistry();
    registry.register(detector);
    const annotationStore = createAnnotationStoreMock();
    const sourceReader: ITransactionInterpretationSourceReader = {
      loadTransactionForInterpretation: vi.fn().mockResolvedValue(ok(undefined)),
      loadProfileInterpretationScope: vi.fn().mockResolvedValue(
        ok({
          accounts: [],
          transactions: [],
        })
      ),
    };
    const runtime = new InterpretationRuntime({ registry, annotationStore, sourceReader });

    const result = await runtime.runForTransaction({
      detectorId: detector.id,
      accountId: 7,
      transactionId: 11,
      txFingerprint: 'tx-runtime-test',
    });

    expect(assertErr(result).message).toContain('was not found');
    expect(annotationStore.replaceForTransaction).not.toHaveBeenCalled();
  });

  it('replaces profile detector annotations by derivedFromTxIds and clears stale groups', async () => {
    const sourceTransaction = buildTransaction({
      accountId: 7,
      transactionId: 11,
      txFingerprint: 'tx-runtime-source',
    });
    sourceTransaction.movements = {
      inflows: [],
      outflows: [
        {
          assetId: 'blockchain:ethereum:native',
          assetSymbol: 'ETH' as Currency,
          grossAmount: parseDecimal('1'),
          netAmount: parseDecimal('1'),
          movementFingerprint: 'mv-1',
        },
      ],
    };

    const targetTransaction = buildTransaction({
      accountId: 8,
      transactionId: 12,
      txFingerprint: 'tx-runtime-target',
    });
    targetTransaction.platformKey = 'arbitrum';
    targetTransaction.blockchain = {
      name: 'arbitrum',
      transaction_hash: '0xruntime-target',
      is_confirmed: true,
    };
    targetTransaction.operation = { category: 'transfer', type: 'deposit' };
    targetTransaction.movements = {
      inflows: [
        {
          assetId: 'blockchain:arbitrum:native',
          assetSymbol: 'ETH' as Currency,
          grossAmount: parseDecimal('0.99'),
          netAmount: parseDecimal('0.99'),
          movementFingerprint: 'mv-2',
        },
      ],
      outflows: [],
    };

    const emittedDerivedFromTxIds = [11, 12] as const;
    const profileDetector = createProfileDetector([
      {
        annotationFingerprint: assertOk(
          computeAnnotationFingerprint({
            kind: 'bridge_participant',
            tier: 'heuristic',
            txFingerprint: sourceTransaction.txFingerprint,
            target: { scope: 'transaction' },
            role: 'source',
            groupKey: 'heuristic-bridge:tx-runtime-source:tx-runtime-target',
          })
        ),
        accountId: 7,
        transactionId: 11,
        txFingerprint: sourceTransaction.txFingerprint,
        kind: 'bridge_participant',
        tier: 'heuristic',
        target: { scope: 'transaction' },
        role: 'source',
        groupKey: 'heuristic-bridge:tx-runtime-source:tx-runtime-target',
        detectorId: 'heuristic-bridge.detector',
        derivedFromTxIds: emittedDerivedFromTxIds,
        provenanceInputs: ['timing', 'address_pattern', 'counterparty'],
      },
      {
        annotationFingerprint: assertOk(
          computeAnnotationFingerprint({
            kind: 'bridge_participant',
            tier: 'heuristic',
            txFingerprint: targetTransaction.txFingerprint,
            target: { scope: 'transaction' },
            role: 'target',
            groupKey: 'heuristic-bridge:tx-runtime-source:tx-runtime-target',
          })
        ),
        accountId: 8,
        transactionId: 12,
        txFingerprint: targetTransaction.txFingerprint,
        kind: 'bridge_participant',
        tier: 'heuristic',
        target: { scope: 'transaction' },
        role: 'target',
        groupKey: 'heuristic-bridge:tx-runtime-source:tx-runtime-target',
        detectorId: 'heuristic-bridge.detector',
        derivedFromTxIds: emittedDerivedFromTxIds,
        provenanceInputs: ['timing', 'address_pattern', 'counterparty'],
      },
    ]);
    const staleAnnotation: TransactionAnnotation = {
      ...buildAnnotation({
        detectorId: 'heuristic-bridge.detector',
        derivedFromTxIds: [3, 4] as const,
        transactionId: 3,
        txFingerprint: 'tx-stale',
      }),
      accountId: 7,
      kind: 'bridge_participant',
      tier: 'heuristic',
      role: 'source',
      groupKey: 'heuristic-bridge:stale',
      provenanceInputs: ['timing', 'address_pattern', 'counterparty'],
    };

    const profileRegistry = new TransactionAnnotationProfileDetectorRegistry();
    profileRegistry.register(profileDetector);
    const annotationStore = createAnnotationStoreMock();
    annotationStore.readAnnotations.mockResolvedValue(ok([staleAnnotation]));
    const sourceReader: ITransactionInterpretationSourceReader = {
      loadTransactionForInterpretation: vi.fn().mockResolvedValue(ok(sourceTransaction)),
      loadProfileInterpretationScope: vi.fn().mockResolvedValue(
        ok({
          accounts: [
            { accountId: 7, identifier: 'source', profileId: 1 },
            { accountId: 8, identifier: 'destination', profileId: 1 },
          ],
          transactions: [sourceTransaction, targetTransaction],
        })
      ),
    };
    const runtime = new InterpretationRuntime({
      registry: new TransactionAnnotationDetectorRegistry(),
      profileRegistry,
      annotationStore,
      sourceReader,
    });

    const result = await runtime.runForProfile({
      detectorId: profileDetector.id,
      profileId: 1,
    });

    expect(assertOk(result)).toBeUndefined();
    expect(annotationStore.readAnnotations).toHaveBeenCalledWith({
      accountIds: [7, 8],
      kinds: ['bridge_participant'],
      tiers: ['asserted', 'heuristic'],
    });
    const firstReplaceCall = annotationStore.replaceForDetectorInputs.mock.calls[0];
    expect(firstReplaceCall).toBeDefined();
    const firstReplaceInput = firstReplaceCall?.[0];
    expect(firstReplaceInput).toBeDefined();
    expect(firstReplaceInput?.detectorId).toBe(profileDetector.id);
    expect(firstReplaceInput?.derivedFromTxIds).toEqual([11, 12]);
    expect(firstReplaceInput?.annotations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ transactionId: 11, role: 'source', tier: 'heuristic' }),
        expect.objectContaining({ transactionId: 12, role: 'target', tier: 'heuristic' }),
      ])
    );
    expect(annotationStore.replaceForDetectorInputs).toHaveBeenNthCalledWith(2, {
      detectorId: profileDetector.id,
      derivedFromTxIds: [3, 4],
      annotations: [],
    });
  });
});
