import type { Currency, OperationClassification, TransactionNote, TransactionStatus } from '@exitbook/core';

import type { ExchangeProcessingDiagnostic } from './exchange-processing-diagnostic.js';

export interface ExchangeMovementDraft {
  assetId: string;
  assetSymbol: Currency;
  grossAmount: string;
  netAmount?: string | undefined;
}

export interface ExchangeFeeDraft {
  assetId: string;
  assetSymbol: Currency;
  amount: string;
  scope: 'network' | 'platform' | 'spread' | 'tax' | 'other';
  settlement: 'on-chain' | 'balance' | 'external';
}

export interface ConfirmedExchangeTransactionDraft {
  externalId: string;
  source: string;
  timestamp: number;
  status: TransactionStatus;
  operation: OperationClassification['operation'];
  movements: {
    inflows: ExchangeMovementDraft[];
    outflows: ExchangeMovementDraft[];
  };
  fees: ExchangeFeeDraft[];
  notes?: TransactionNote[] | undefined;
  from?: string | undefined;
  to?: string | undefined;
  blockchain?:
    | {
        blockHeight?: number | undefined;
        isConfirmed: boolean;
        name: string;
        transactionHash: string;
      }
    | undefined;
  evidence: {
    interpretationRule: string;
    providerEventIds: string[];
  };
}

export type ExchangeGroupInterpretation =
  | { draft: ConfirmedExchangeTransactionDraft; kind: 'confirmed'; }
  | { diagnostic: ExchangeProcessingDiagnostic; kind: 'ambiguous'; }
  | { diagnostic: ExchangeProcessingDiagnostic; kind: 'unsupported'; };
