/**
 * Provider Initialization
 *
 * This module provides a clean, explicit way to initialize all blockchain
 * and exchange providers. Call this once during application startup.
 */

import './shared/blockchain/registry/register-apis.js';

let initialized = false;

/**
 * Initialize all blockchain and exchange providers.
 *
 * This function:
 * - Registers all API clients via decorators
 * - Can be called multiple times safely (idempotent)
 *
 * @example
 * ```typescript
 * import { initializeProviders } from '@exitbook/providers';
 *
 * initializeProviders();
 * ```
 */
export function initializeProviders(): void {
  if (initialized) {
    return;
  }

  initialized = true;
}
