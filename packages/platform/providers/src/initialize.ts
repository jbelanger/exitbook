/**
 * Provider Initialization
 *
 * This module provides a clean, explicit way to initialize all blockchain
 * and exchange providers. Call this once during application startup.
 */

// Import registration modules to trigger decorator side-effects immediately
// These imports MUST use .js extension for ESM compatibility
import './core/blockchain/registry/register-apis.js';
import './core/blockchain/registry/register-mappers.js';

let initialized = false;

/**
 * Initialize all blockchain and exchange providers.
 *
 * This function:
 * - Registers all API clients via decorators
 * - Registers all data mappers
 * - Can be called multiple times safely (idempotent)
 *
 * @example
 * ```typescript
 * import { initializeProviders } from '@exitbook/providers';
 *
 * // Call once at application startup
 * initializeProviders();
 * ```
 */
export function initializeProviders(): void {
  if (initialized) {
    return;
  }

  // Registrations happen via the imports at the top of this file
  // This function just marks initialization as complete
  initialized = true;
}
