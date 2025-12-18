import type {
  BitcoinTransaction,
  CosmosTransaction,
  EvmTransaction,
  SolanaTransaction,
} from '@exitbook/blockchain-providers';
import type { ExchangeLedgerEntry } from '@exitbook/exchanges-providers';

import type { RawTransactionWithMetadata } from '../../sources/exchanges/shared/strategies/grouping.js';

import { TEST_TIMESTAMPS } from './test-constants.js';

/**
 * Fluent builder for creating ExchangeLedgerEntry test data.
 *
 * @example
 * const entry = new ExchangeEntryBuilder()
 *   .withId('E1')
 *   .withCorrelationId('SWAP001')
 *   .withAmount('-1000')
 *   .withAsset('USD')
 *   .withFee('2.5')
 *   .build();
 */
export class ExchangeEntryBuilder {
  private entry: ExchangeLedgerEntry = {
    id: 'ENTRY001',
    correlationId: 'REF001',
    timestamp: TEST_TIMESTAMPS.jan2024,
    type: 'test',
    asset: 'USD',
    amount: '0',
    status: 'success',
  };

  withId(id: string): this {
    this.entry.id = id;
    return this;
  }

  withCorrelationId(correlationId: string): this {
    this.entry.correlationId = correlationId;
    return this;
  }

  withTimestamp(timestamp: number): this {
    this.entry.timestamp = timestamp;
    return this;
  }

  withType(type: string): this {
    this.entry.type = type;
    return this;
  }

  withAsset(asset: string): this {
    this.entry.asset = asset;
    return this;
  }

  withAmount(amount: string): this {
    this.entry.amount = amount;
    return this;
  }

  withFee(fee: string): this {
    this.entry.fee = fee;
    return this;
  }

  withFeeCurrency(feeCurrency: string): this {
    this.entry.feeCurrency = feeCurrency;
    return this;
  }

  withStatus(status: 'pending' | 'open' | 'closed' | 'canceled' | 'failed' | 'success'): this {
    this.entry.status = status;
    return this;
  }

  build(): ExchangeLedgerEntry {
    return { ...this.entry };
  }
}

/**
 * Wraps an ExchangeLedgerEntry in RawTransactionWithMetadata format.
 * Useful for exchange processor tests that expect this wrapper format.
 */
export function wrapEntry(entry: ExchangeLedgerEntry): RawTransactionWithMetadata<ExchangeLedgerEntry> {
  return {
    raw: entry,
    normalized: entry,
    eventId: entry.id,
    cursor: {},
  };
}

/**
 * Creates a RawTransactionWithMetadata wrapper for any type of data.
 * Generic version for custom test data types.
 */
export function createRawTransactionWithMetadata<T>(
  raw: T,
  normalized: ExchangeLedgerEntry,
  eventId?: string,
  cursor?: Record<string, number>
): RawTransactionWithMetadata<T> {
  return {
    raw,
    normalized,
    eventId: eventId ?? normalized.id,
    cursor: cursor ?? {},
  };
}

/**
 * Fluent builder for creating BitcoinTransaction test data.
 */
export class BitcoinTransactionBuilder {
  private tx: BitcoinTransaction = {
    id: 'tx1abc',
    blockHeight: 800000,
    timestamp: TEST_TIMESTAMPS.now,
    currency: 'BTC',
    feeAmount: '0.0001',
    feeCurrency: 'BTC',
    inputs: [],
    outputs: [],
    providerName: 'blockstream.info',
    status: 'success',
  };

  withId(id: string): this {
    this.tx.id = id;
    return this;
  }

  withBlockHeight(blockHeight: number): this {
    this.tx.blockHeight = blockHeight;
    return this;
  }

  withTimestamp(timestamp: number): this {
    this.tx.timestamp = timestamp;
    return this;
  }

  withFee(feeAmount: string, feeCurrency = 'BTC'): this {
    this.tx.feeAmount = feeAmount;
    this.tx.feeCurrency = feeCurrency;
    return this;
  }

  addInput(address: string, value: string, txid = 'prev1', vout = 0): this {
    this.tx.inputs.push({ address, value, txid, vout });
    return this;
  }

  addOutput(address: string, value: string, index?: number): this {
    this.tx.outputs.push({ address, value, index: index ?? this.tx.outputs.length });
    return this;
  }

  withProviderId(providerName: string): this {
    this.tx.providerName = providerName;
    return this;
  }

  withStatus(status: 'pending' | 'success' | 'failed'): this {
    this.tx.status = status;
    return this;
  }

  build(): BitcoinTransaction {
    return { ...this.tx, inputs: [...this.tx.inputs], outputs: [...this.tx.outputs] };
  }
}

/**
 * Fluent builder for creating CosmosTransaction test data.
 */
export class CosmosTransactionBuilder {
  private tx: CosmosTransaction = {
    id: 'tx123',
    blockHeight: 100,
    timestamp: TEST_TIMESTAMPS.now,
    from: 'inj1user000000000000000000000000000000000',
    to: 'inj1external0000000000000000000000000000',
    amount: '1000000000000000000',
    currency: 'INJ',
    feeAmount: '500000000000000',
    feeCurrency: 'INJ',
    messageType: '/cosmos.bank.v1beta1.MsgSend',
    tokenType: 'native',
    providerName: 'injective-explorer',
    status: 'success',
  };

  withId(id: string): this {
    this.tx.id = id;
    return this;
  }

  withBlockHeight(blockHeight: number): this {
    this.tx.blockHeight = blockHeight;
    return this;
  }

  withTimestamp(timestamp: number): this {
    this.tx.timestamp = timestamp;
    return this;
  }

  withFrom(from: string): this {
    this.tx.from = from;
    return this;
  }

  withTo(to: string): this {
    this.tx.to = to;
    return this;
  }

  withAmount(amount: string, currency: string): this {
    this.tx.amount = amount;
    this.tx.currency = currency;
    return this;
  }

  withFee(feeAmount: string, feeCurrency: string): this {
    this.tx.feeAmount = feeAmount;
    this.tx.feeCurrency = feeCurrency;
    return this;
  }

  withMessageType(messageType: string): this {
    this.tx.messageType = messageType;
    return this;
  }

  withTokenType(tokenType: 'native' | 'cw20' | 'ibc'): this {
    this.tx.tokenType = tokenType;
    return this;
  }

  withProviderId(providerName: string): this {
    this.tx.providerName = providerName;
    return this;
  }

  withStatus(status: 'pending' | 'success' | 'failed'): this {
    this.tx.status = status;
    return this;
  }

  build(): CosmosTransaction {
    return { ...this.tx };
  }
}

/**
 * Fluent builder for creating EvmTransaction test data.
 */
export class EvmTransactionBuilder {
  private tx: EvmTransaction = {
    id: '0x123',
    type: 'transfer',
    blockHeight: 1000000,
    timestamp: TEST_TIMESTAMPS.now,
    from: '0xabc',
    to: '0xdef',
    amount: '1000000000000000000',
    currency: 'ETH',
    gasUsed: '21000',
    gasPrice: '50000000000',
    providerName: 'alchemy',
    status: 'success',
  };

  withId(id: string): this {
    this.tx.id = id;
    return this;
  }

  withBlockHeight(blockHeight: number): this {
    this.tx.blockHeight = blockHeight;
    return this;
  }

  withTimestamp(timestamp: number): this {
    this.tx.timestamp = timestamp;
    return this;
  }

  withFrom(from: string): this {
    this.tx.from = from;
    return this;
  }

  withTo(to: string): this {
    this.tx.to = to;
    return this;
  }

  withAmount(amount: string, currency = 'ETH'): this {
    this.tx.amount = amount;
    this.tx.currency = currency;
    return this;
  }

  withGas(gasUsed: string, gasPrice: string): this {
    this.tx.gasUsed = gasUsed;
    this.tx.gasPrice = gasPrice;
    return this;
  }

  withProviderId(providerName: string): this {
    this.tx.providerName = providerName;
    return this;
  }

  withStatus(status: 'pending' | 'success' | 'failed'): this {
    this.tx.status = status;
    return this;
  }

  build(): EvmTransaction {
    return { ...this.tx };
  }
}

/**
 * Fluent builder for creating SolanaTransaction test data.
 */
export class SolanaTransactionBuilder {
  private tx: SolanaTransaction = {
    id: 'sig1abc',
    slot: 100000,
    timestamp: TEST_TIMESTAMPS.now,
    from: 'user1111111111111111111111111111111111111111',
    to: 'external222222222222222222222222222222222222',
    amount: '1000000000',
    currency: 'SOL',
    feeAmount: '5000',
    feeCurrency: 'SOL',
    accountChanges: [],
    providerName: 'helius',
    status: 'success',
  };

  withId(id: string): this {
    this.tx.id = id;
    return this;
  }

  withSlot(slot: number): this {
    this.tx.slot = slot;
    return this;
  }

  withTimestamp(timestamp: number): this {
    this.tx.timestamp = timestamp;
    return this;
  }

  withFrom(from: string): this {
    this.tx.from = from;
    return this;
  }

  withTo(to: string): this {
    this.tx.to = to;
    return this;
  }

  withAmount(amount: string, currency = 'SOL'): this {
    this.tx.amount = amount;
    this.tx.currency = currency;
    return this;
  }

  withFee(feeAmount: string, feeCurrency = 'SOL'): this {
    this.tx.feeAmount = feeAmount;
    this.tx.feeCurrency = feeCurrency;
    return this;
  }

  addAccountChange(account: string, preBalance: string, postBalance: string): this {
    if (!this.tx.accountChanges) {
      this.tx.accountChanges = [];
    }
    this.tx.accountChanges.push({ account, preBalance, postBalance });
    return this;
  }

  withProviderId(providerName: string): this {
    this.tx.providerName = providerName;
    return this;
  }

  withStatus(status: 'pending' | 'success' | 'failed'): this {
    this.tx.status = status;
    return this;
  }

  build(): SolanaTransaction {
    return {
      ...this.tx,
      accountChanges: this.tx.accountChanges ? [...this.tx.accountChanges] : undefined,
    };
  }
}
