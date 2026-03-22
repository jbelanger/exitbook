import { listRegisteredPriceProviders, type PriceProviderDescriptor } from '../runtime/registry/provider-registry.js';

export type { PriceProviderDescriptor } from '../runtime/registry/provider-registry.js';

export function listPriceProviders(): PriceProviderDescriptor[] {
  return listRegisteredPriceProviders();
}
