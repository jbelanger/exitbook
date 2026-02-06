import type { OverrideEvent, Scope } from './override.schemas.js';

/**
 * Options for creating an override event
 * Actor and source are hardcoded in the store (always 'user'/'cli')
 */
export interface CreateOverrideEventOptions {
  scope: Scope;
  payload: OverrideEvent['payload'];
  reason?: string | undefined;
}

/**
 * Transaction fingerprint components
 * Simplified version using source_name:external_id pattern
 */
export interface TransactionIdentity {
  source_name: string;
  external_id: string;
}

/**
 * Link fingerprint components
 */
export interface LinkIdentity {
  source_tx: string; // source_name:external_id
  target_tx: string; // source_name:external_id
  asset: string;
}
