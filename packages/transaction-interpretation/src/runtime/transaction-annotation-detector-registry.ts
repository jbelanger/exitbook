import type { ITransactionAnnotationDetector } from '../detectors/transaction-annotation-detector.js';

export class TransactionAnnotationDetectorRegistry {
  readonly #byId = new Map<string, ITransactionAnnotationDetector>();

  register(detector: ITransactionAnnotationDetector): void {
    if (this.#byId.has(detector.id)) {
      throw new Error(`Detector '${detector.id}' is already registered`);
    }

    this.#byId.set(detector.id, detector);
  }

  get(detectorId: string): ITransactionAnnotationDetector | undefined {
    return this.#byId.get(detectorId);
  }

  list(): readonly ITransactionAnnotationDetector[] {
    return [...this.#byId.values()];
  }
}
