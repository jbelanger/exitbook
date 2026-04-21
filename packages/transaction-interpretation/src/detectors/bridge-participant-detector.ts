import { transactionHasDiagnosticCode, type Transaction } from '@exitbook/core';
import { err, ok, type Result } from '@exitbook/foundation';
import type { IProtocolCatalog, ProtocolRef } from '@exitbook/protocol-catalog';

import { computeAnnotationFingerprint, type AnnotationRole, type TransactionAnnotation } from '../annotations/index.js';

import type {
  DetectorInput,
  DetectorOutput,
  ITransactionAnnotationDetector,
} from './transaction-annotation-detector.js';

const BRIDGE_DIAGNOSTIC_CODE = 'bridge_transfer';
const DETECTOR_ID = 'bridge-participant';

const BRIDGE_PROTOCOL_HINTS: Readonly<Record<string, ProtocolRef>> = {
  across: { id: 'across' },
  gravity: { id: 'gravity' },
  hop: { id: 'hop' },
  ibc: { id: 'ibc' },
  injective_peggy: { id: 'peggy' },
  layerzero: { id: 'layerzero' },
  peggy: { id: 'peggy' },
  stargate: { id: 'stargate' },
  wormhole: { id: 'wormhole' },
};

type BridgeAnnotationMetadata = Record<string, string>;

function getBridgeRole(transaction: Transaction): AnnotationRole | undefined {
  const inflowCount = transaction.movements.inflows?.length ?? 0;
  const outflowCount = transaction.movements.outflows?.length ?? 0;

  if (inflowCount > 0 && outflowCount === 0) {
    return 'target';
  }

  if (outflowCount > 0 && inflowCount === 0) {
    return 'source';
  }

  return undefined;
}

function getBridgeDiagnostic(transaction: Transaction): NonNullable<Transaction['diagnostics']>[number] | undefined {
  return transaction.diagnostics?.find((diagnostic) => diagnostic.code === BRIDGE_DIAGNOSTIC_CODE);
}

function normalizeProtocolHint(raw: unknown): string | undefined {
  if (typeof raw !== 'string') {
    return undefined;
  }

  const normalized = raw.trim().toLowerCase();
  return normalized.length === 0 ? undefined : normalized;
}

function buildBridgeMetadata(
  diagnostic: NonNullable<Transaction['diagnostics']>[number]
): BridgeAnnotationMetadata | undefined {
  const sourceChain = normalizeProtocolHint(diagnostic.metadata?.['sourceChain']);
  const destinationChain = normalizeProtocolHint(diagnostic.metadata?.['destinationChain']);

  if (sourceChain === undefined && destinationChain === undefined) {
    return undefined;
  }

  return {
    ...(sourceChain === undefined ? {} : { sourceChain }),
    ...(destinationChain === undefined ? {} : { destinationChain }),
  };
}

function resolveBridgeProtocolRef(
  diagnostic: NonNullable<Transaction['diagnostics']>[number],
  protocolCatalog: IProtocolCatalog
): ProtocolRef | undefined {
  const metadata = diagnostic.metadata;
  const normalizedHint =
    normalizeProtocolHint(metadata?.['bridgeFamily']) ?? normalizeProtocolHint(metadata?.['bridgeType']);
  if (normalizedHint === undefined) {
    return undefined;
  }

  const protocolRef = BRIDGE_PROTOCOL_HINTS[normalizedHint];
  if (protocolRef === undefined) {
    return undefined;
  }

  return protocolCatalog.findByRef(protocolRef)?.protocol;
}

function buildBridgeAnnotation(
  input: DetectorInput,
  protocolCatalog: IProtocolCatalog
): Result<TransactionAnnotation | undefined, Error> {
  if (input.transaction.platformKind !== 'blockchain') {
    return ok(undefined);
  }

  if (!transactionHasDiagnosticCode(input.transaction, BRIDGE_DIAGNOSTIC_CODE)) {
    return ok(undefined);
  }

  const role = getBridgeRole(input.transaction);
  if (role === undefined) {
    return ok(undefined);
  }

  const diagnostic = getBridgeDiagnostic(input.transaction);
  if (diagnostic === undefined) {
    return ok(undefined);
  }

  const protocolRef = resolveBridgeProtocolRef(diagnostic, protocolCatalog);
  if (protocolRef === undefined) {
    return ok(undefined);
  }

  const metadata = buildBridgeMetadata(diagnostic);
  const annotationFingerprintResult = computeAnnotationFingerprint({
    kind: 'bridge_participant',
    tier: 'asserted',
    txFingerprint: input.txFingerprint,
    target: { scope: 'transaction' },
    protocolRef,
    role,
    ...(metadata === undefined ? {} : { metadata }),
  });
  if (annotationFingerprintResult.isErr()) {
    return err(annotationFingerprintResult.error);
  }

  return ok({
    annotationFingerprint: annotationFingerprintResult.value,
    accountId: input.accountId,
    transactionId: input.transactionId,
    txFingerprint: input.txFingerprint,
    kind: 'bridge_participant',
    tier: 'asserted',
    target: { scope: 'transaction' },
    protocolRef,
    role,
    detectorId: DETECTOR_ID,
    derivedFromTxIds: [input.transactionId],
    provenanceInputs: ['processor', 'diagnostic'],
    ...(metadata === undefined ? {} : { metadata }),
  });
}

export class BridgeParticipantDetector implements ITransactionAnnotationDetector {
  readonly id = DETECTOR_ID;
  readonly kinds = ['bridge_participant'] as const;

  readonly #protocolCatalog: IProtocolCatalog;

  constructor(protocolCatalog: IProtocolCatalog) {
    this.#protocolCatalog = protocolCatalog;
  }

  async run(input: DetectorInput): Promise<Result<DetectorOutput, Error>> {
    const annotationResult = buildBridgeAnnotation(input, this.#protocolCatalog);
    if (annotationResult.isErr()) {
      return err(annotationResult.error);
    }

    return ok({
      annotations: annotationResult.value === undefined ? [] : [annotationResult.value],
    });
  }
}
