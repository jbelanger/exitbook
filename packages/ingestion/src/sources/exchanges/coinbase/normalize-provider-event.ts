import { parseCurrency, parseDecimal } from '@exitbook/core';
import { err, ok, type Result } from '@exitbook/core';
import type { RawCoinbaseLedgerEntry } from '@exitbook/exchange-providers';

import type { ExchangeProviderEvent } from '../shared-v2/index.js';

import type { CoinbaseCorrelationSource } from './coinbase-utils.js';
import { extractCorrelationEvidence, mapCoinbaseStatus } from './coinbase-utils.js';

type CoinbaseFeeSettlementHint = 'balance' | 'on-chain' | 'none';

interface CoinbaseProviderMetadata extends Record<string, unknown> {
  correlationKey: string;
  correlationSource: CoinbaseCorrelationSource;
  entryType: string;
  feeEmbeddedInAmount: boolean;
  feeSettlementHint: CoinbaseFeeSettlementHint;
  networkName?: string | undefined;
  networkStatus?: string | undefined;
  rawStatus?: string | undefined;
}

function getDirectionHint(amount: string): 'credit' | 'debit' | 'unknown' {
  const value = parseDecimal(amount);

  if (value.isNegative()) {
    return 'debit';
  }

  if (value.isPositive()) {
    return 'credit';
  }

  return 'unknown';
}

function extractCoinbaseFee(raw: RawCoinbaseLedgerEntry): {
  amount?: string | undefined;
  currency?: string | undefined;
  settlementHint: CoinbaseFeeSettlementHint;
} {
  if (raw.type === 'advanced_trade_fill') {
    const commission = raw.advanced_trade_fill?.commission;
    if (!commission || parseDecimal(commission).isZero()) {
      return { settlementHint: 'balance' };
    }

    const productId = raw.advanced_trade_fill?.product_id;
    const quoteCurrency = productId?.split('-').pop();
    return {
      amount: parseDecimal(commission).toFixed(),
      currency: quoteCurrency,
      settlementHint: 'balance',
    };
  }

  if (raw.type === 'buy' || raw.type === 'sell') {
    const fee = raw.buy?.fee ?? raw.sell?.fee;
    if (!fee || parseDecimal(fee.amount).isZero()) {
      return { settlementHint: 'on-chain' };
    }

    return {
      amount: parseDecimal(fee.amount).toFixed(),
      currency: fee.currency,
      settlementHint: 'on-chain',
    };
  }

  if (raw.type === 'fiat_withdrawal' || raw.type === 'send' || raw.type === 'transaction') {
    const transactionFee = raw.network?.transaction_fee;
    if (!transactionFee || parseDecimal(transactionFee.amount).isZero()) {
      return { settlementHint: 'on-chain' };
    }

    return {
      amount: parseDecimal(transactionFee.amount).toFixed(),
      currency: transactionFee.currency,
      settlementHint: 'on-chain',
    };
  }

  return { settlementHint: 'none' };
}

export function normalizeCoinbaseProviderEvent(
  raw: RawCoinbaseLedgerEntry,
  eventId: string
): Result<ExchangeProviderEvent, Error> {
  const currencyResult = parseCurrency(raw.amount.currency);
  if (currencyResult.isErr()) {
    return err(new Error(`Invalid Coinbase currency "${raw.amount.currency}": ${currencyResult.error.message}`));
  }

  const statusResult = mapCoinbaseStatus(raw.status);
  if (statusResult.isErr()) {
    return err(statusResult.error);
  }

  const fee = extractCoinbaseFee(raw);
  let feeCurrency = currencyResult.value;

  if (fee.currency) {
    const feeCurrencyResult = parseCurrency(fee.currency);
    if (feeCurrencyResult.isErr()) {
      return err(new Error(`Invalid Coinbase fee currency "${fee.currency}": ${feeCurrencyResult.error.message}`));
    }
    feeCurrency = feeCurrencyResult.value;
  }

  const correlationEvidence = extractCorrelationEvidence(raw);
  const occurredAt = new Date(raw.created_at).getTime();
  const metadata: CoinbaseProviderMetadata = {
    correlationKey: correlationEvidence.correlationKey,
    correlationSource: correlationEvidence.correlationSource,
    entryType: raw.type,
    feeEmbeddedInAmount: raw.type === 'buy' || raw.type === 'sell',
    feeSettlementHint: fee.settlementHint,
    ...(raw.network?.network_name ? { networkName: raw.network.network_name } : {}),
    ...(raw.network?.status ? { networkStatus: raw.network.status } : {}),
    ...(raw.status ? { rawStatus: raw.status } : {}),
  };

  return ok({
    providerEventId: eventId,
    providerName: 'coinbase',
    providerType: raw.type,
    occurredAt,
    status: statusResult.value,
    assetSymbol: currencyResult.value,
    rawAmount: raw.amount.amount,
    ...(fee.amount ? { rawFee: fee.amount, rawFeeCurrency: feeCurrency } : {}),
    providerHints: {
      correlationKeys: [correlationEvidence.correlationKey],
      directionHint: getDirectionHint(raw.amount.amount),
      ...(raw.network?.network_name ? { networkHint: raw.network.network_name } : {}),
      ...(raw.to?.address ? { addressHint: raw.to.address } : {}),
      ...(raw.network?.hash ? { hashHint: raw.network.hash } : {}),
    },
    providerMetadata: metadata,
  });
}
