/**
 * Provider registry - manages registered price providers
 *
 * This is part of the imperative shell - manages mutable state
 * and coordinates provider instantiation.
 */

import type { IPriceProvider, ProviderMetadata } from '../types/index.js';

interface RegisteredProvider {
  ProviderClass: new (...args: unknown[]) => IPriceProvider;
  metadata: ProviderMetadata;
}

/**
 * Global registry for price providers
 *
 * Singleton pattern - manages state across the application
 */
export class PriceProviderRegistry {
  private static providers = new Map<string, RegisteredProvider>();

  /**
   * Register a provider class with metadata
   */
  static register(ProviderClass: new (...args: unknown[]) => IPriceProvider, metadata: ProviderMetadata): void {
    if (this.providers.has(metadata.name)) {
      throw new Error(`Provider "${metadata.name}" is already registered. Each provider must have a unique name.`);
    }

    this.providers.set(metadata.name, { ProviderClass, metadata });
  }

  /**
   * Get all registered providers (sorted by priority)
   */
  static getAll(): RegisteredProvider[] {
    return Array.from(this.providers.values()).sort((a, b) => a.metadata.priority - b.metadata.priority);
  }

  /**
   * Get a specific provider by name
   */
  static get(name: string): RegisteredProvider | undefined {
    return this.providers.get(name);
  }

  /**
   * Get all provider names
   */
  static getNames(): string[] {
    return Array.from(this.providers.keys());
  }

  /**
   * Check if a provider is registered
   */
  static has(name: string): boolean {
    return this.providers.has(name);
  }

  /**
   * Get count of registered providers
   */
  static count(): number {
    return this.providers.size;
  }

  /**
   * Clear all registered providers (mainly for testing)
   */
  static clear(): void {
    this.providers.clear();
  }

  /**
   * Get providers that support a specific currency
   */
  static getByCurrency(currency: string): RegisteredProvider[] {
    return this.getAll().filter((provider) =>
      provider.metadata.capabilities.supportedCurrencies.includes(currency.toUpperCase())
    );
  }

  /**
   * Get providers that don't require API keys
   */
  static getPublicProviders(): RegisteredProvider[] {
    return this.getAll().filter((provider) => !provider.metadata.requiresApiKey);
  }
}
