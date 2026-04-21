import type { ITransactionAnnotationProfileDetector } from '../detectors/transaction-annotation-profile-detector.js';

export class TransactionAnnotationProfileDetectorRegistry {
  readonly #detectors = new Map<string, ITransactionAnnotationProfileDetector>();

  register(detector: ITransactionAnnotationProfileDetector): void {
    this.#detectors.set(detector.id, detector);
  }

  get(detectorId: string): ITransactionAnnotationProfileDetector | undefined {
    return this.#detectors.get(detectorId);
  }
}
