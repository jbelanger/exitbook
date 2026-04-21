import { normalizeIdentifierForMatching } from '@exitbook/foundation';

import type { ProtocolDeployment } from './protocol-deployment.js';
import { protocolRefsEqual, type ProtocolRef } from './protocol-ref.js';

export interface ProtocolCatalogEntry {
  protocol: ProtocolRef;
  displayName?: string | undefined;
  deployments?: readonly ProtocolDeployment[] | undefined;
}

export interface IProtocolCatalog {
  list(): readonly ProtocolCatalogEntry[];
  findByRef(ref: ProtocolRef): ProtocolCatalogEntry | undefined;
  findByAddress(chain: string, address: string): ProtocolCatalogEntry | undefined;
}

export class InMemoryProtocolCatalog implements IProtocolCatalog {
  readonly #entries: readonly ProtocolCatalogEntry[];

  constructor(entries: readonly ProtocolCatalogEntry[]) {
    this.#entries = entries;
  }

  list(): readonly ProtocolCatalogEntry[] {
    return this.#entries;
  }

  findByRef(ref: ProtocolRef): ProtocolCatalogEntry | undefined {
    return this.#entries.find((entry) => protocolRefsEqual(entry.protocol, ref));
  }

  findByAddress(chain: string, address: string): ProtocolCatalogEntry | undefined {
    const normalizedChain = chain.trim();
    const normalizedAddress = normalizeIdentifierForMatching(address);

    for (const entry of this.#entries) {
      for (const deployment of entry.deployments ?? []) {
        if (deployment.chain !== normalizedChain) continue;
        for (const candidate of deployment.addresses ?? []) {
          if (normalizeIdentifierForMatching(candidate) === normalizedAddress) {
            return entry;
          }
        }
      }
    }

    return undefined;
  }
}
