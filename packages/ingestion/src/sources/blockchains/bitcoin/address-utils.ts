import { canonicalizeBitcoinAddress, type BitcoinChainConfig } from '@exitbook/blockchain-providers';
import { err, ok, type Result } from 'neverthrow';

export function normalizeBitcoinAddress(address: string, config: BitcoinChainConfig): Result<string, Error> {
  const normalized = canonicalizeBitcoinAddress(address);

  if (/^[xyz]pub/i.test(address)) {
    if (!/^[xyz]pub[a-zA-Z0-9]{79,108}$/.test(normalized)) {
      return err(new Error(`Invalid xpub format: ${address}`));
    }
    return ok(normalized);
  }

  if (normalized.startsWith('bc1') || normalized.startsWith('ltc1') || normalized.startsWith('doge1')) {
    if (!/^(bc1|ltc1|doge1)[a-z0-9]{25,62}$/.test(normalized)) {
      return err(new Error(`Invalid Bech32 address format: ${address}`));
    }
    return ok(normalized);
  }

  if (normalized.startsWith('bitcoincash:')) {
    if (!/^bitcoincash:[qp][a-z0-9]{41}$/.test(normalized)) {
      return err(new Error(`Invalid Bitcoin Cash CashAddr format: ${address}`));
    }
    return ok(normalized);
  }

  if (normalized.startsWith('q') || normalized.startsWith('p')) {
    if (!/^[qp][a-z0-9]{41}$/.test(normalized)) {
      return err(new Error(`Invalid Bitcoin Cash CashAddr short format: ${address}`));
    }
    return ok(normalized);
  }

  const prefixes = config.addressPrefixes ?? [];
  const matchingPrefix = prefixes.find((prefix) => address.startsWith(prefix));

  if (!matchingPrefix) {
    return err(new Error(`Invalid ${config.displayName} address: must start with one of [${prefixes.join(', ')}]`));
  }

  if (!/^[a-km-zA-HJ-NP-Z1-9]{25,34}$/.test(normalized)) {
    return err(new Error(`Invalid ${config.displayName} legacy address format: ${address}`));
  }

  return ok(normalized);
}
