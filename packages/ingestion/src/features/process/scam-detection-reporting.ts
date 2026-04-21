import type { IngestionEvent } from '../../events.js';
import type { ScamDetectionResult, ScamDetector } from '../scam-detection/contracts.js';

export interface CreateScamBatchReportingDetectorOptions {
  blockchain: string;
  detector: ScamDetector;
  emit: (event: IngestionEvent) => void;
}

export function createScamBatchReportingDetector(options: CreateScamBatchReportingDetectorOptions): ScamDetector {
  let batchCounter = 0;

  return (movements, metadataMap) => {
    batchCounter += 1;
    const scamDiagnostics = options.detector(movements, metadataMap);

    options.emit({
      type: 'scam.batch.summary',
      blockchain: options.blockchain,
      batchNumber: batchCounter,
      totalScanned: movements.length,
      scamsFound: countDiagnostics(scamDiagnostics),
      exampleSymbols: collectExampleSymbols(scamDiagnostics),
    });

    return scamDiagnostics;
  };
}

function countDiagnostics(scamDiagnostics: ScamDetectionResult): number {
  let total = 0;

  for (const diagnostics of scamDiagnostics.values()) {
    total += diagnostics.length;
  }

  return total;
}

function collectExampleSymbols(scamDiagnostics: ScamDetectionResult): string[] {
  const exampleSymbols: string[] = [];

  for (const diagnostics of scamDiagnostics.values()) {
    for (const diagnostic of diagnostics) {
      const assetSymbol = diagnostic.metadata?.['assetSymbol'];
      if (typeof assetSymbol !== 'string' || exampleSymbols.includes(assetSymbol)) {
        continue;
      }

      exampleSymbols.push(assetSymbol);
      if (exampleSymbols.length === 3) {
        return exampleSymbols;
      }
    }
  }

  return exampleSymbols;
}
