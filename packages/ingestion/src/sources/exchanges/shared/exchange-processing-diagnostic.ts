export interface ExchangeProcessingDiagnostic {
  code:
    | 'ambiguous_same_asset_opposing_pair'
    | 'missing_direction_evidence'
    | 'contradictory_provider_rows'
    | 'internal_balance_move'
    | 'provider_reversal_pair'
    | 'unsupported_multi_leg_pattern'
    | 'provider_event_validation_failed';
  severity: 'info' | 'warning' | 'error';
  providerName: string;
  correlationKey: string;
  providerEventIds: string[];
  message: string;
  evidence: Record<string, unknown>;
}
