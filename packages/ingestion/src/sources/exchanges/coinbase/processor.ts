import { parseDecimal, parseCurrency, type OperationClassification } from '@exitbook/core';
import type { RawCoinbaseLedgerEntry } from '@exitbook/exchange-providers';
import { err, type Result } from 'neverthrow';

import { classifyExchangeOperationFromFundFlow } from '../shared/correlating-exchange-processor-utils.js';
import { CorrelatingExchangeProcessor } from '../shared/correlating-exchange-processor.js';
import type { ExchangeLedgerEntry } from '../shared/schemas.js';
import { byCorrelationId, type LedgerEntryWithRaw } from '../shared/strategies/index.js';
import type { ExchangeFundFlow } from '../shared/types.js';

import { coinbaseGrossAmounts } from './coinbase-interpretation.js';
import { extractCorrelationId, mapCoinbaseStatus } from './coinbase-utils.js';

/**
 * Coinbase processor: normalizes raw Coinbase API v2 data and uses
 * correlation + gross amount semantics.
 *
 * Amount/fee rules per type (see interpretation.ts for the full reference table):
 * - buy/sell (v2 simple): amount = TOTAL wallet change (fee INCLUDED).
 *     Fee is extracted here for record-keeping but marked 'on-chain' in the
 *     interpretation strategy so the balance calculator doesn't subtract it again.
 * - advanced_trade_fill: amount = qty × fill_price. Commission is NOT included
 *     and is intentionally stripped here to avoid double-counting (#264).
 * - fiat_withdrawal / send: amount = TOTAL (fee included). Fee carved from gross.
 * - fiat_deposit / interest / trade / etc.: amount = wallet change, no fee.
 *
 * Correlation: swaps create 2 entries (one per asset), grouped by correlation ID.
 */
export class CoinbaseProcessor extends CorrelatingExchangeProcessor<RawCoinbaseLedgerEntry> {
  constructor() {
    super('coinbase', byCorrelationId, coinbaseGrossAmounts);
  }

  protected normalizeEntry(raw: RawCoinbaseLedgerEntry, _eventId: string): Result<ExchangeLedgerEntry, Error> {
    // Amount is already signed in Coinbase API v2 (negative for outflows)
    const rawAmount = raw.amount.amount;
    const rawCurrency = raw.amount.currency;

    const currencyResult = parseCurrency(rawCurrency);
    if (currencyResult.isErr()) {
      return err(new Error(`Invalid Coinbase currency "${rawCurrency}": ${currencyResult.error.message}`));
    }
    const assetSymbol = currencyResult.value;

    // Timestamp from ISO 8601 string
    const timestamp = new Date(raw.created_at).getTime();

    // Correlation ID from type-specific nested objects
    const correlationId = extractCorrelationId(raw);

    // Fee extraction per entry type:
    //
    // advanced_trade_fill: commission = qty × fill_price × rate. It is NOT
    //   included in `amount` (amount = qty × fill_price exactly). Recording
    //   it as a fee causes double-counting because the balance impact is just
    //   `amount` — the commission is a separate Coinbase charge that doesn't
    //   appear as a wallet debit in the API. Stripped entirely (#264).
    //
    // buy/sell (v2 simple): buy.fee / sell.fee is a real fee, but it's
    //   ALREADY INCLUDED in `amount`:
    //     buy:  amount = -(subtotal + fee), i.e. amount = -buy.total
    //     sell: amount = +(subtotal - fee), i.e. amount = +sell.total
    //   We extract it here for record-keeping (cost basis, reporting), but
    //   the interpretation strategy marks it settlement='on-chain' so the
    //   balance calculator won't subtract it again.
    //
    // other types (send, fiat_withdrawal, etc.): fee from network info, if
    //   any, is handled by the interpretation strategy's withdrawal path.
    let feeAmount: string | undefined;
    let feeCurrency: string | undefined;

    if (raw.type !== 'advanced_trade_fill') {
      // For buy/sell types, extract fee from nested object
      const typeData = raw.buy ?? raw.sell;
      if (typeData?.fee) {
        const feeValue = parseDecimal(typeData.fee.amount);
        if (!feeValue.isZero()) {
          feeAmount = feeValue.toFixed();
          const feeCurrencyResult = parseCurrency(typeData.fee.currency);
          feeCurrency = feeCurrencyResult.isOk() ? feeCurrencyResult.value : undefined;
        }
      }
    }

    // Blockchain metadata
    const hash = typeof raw.network?.hash === 'string' ? raw.network.hash : undefined;
    const address = typeof raw.to?.address === 'string' ? raw.to.address : undefined;
    const network = typeof raw.network?.network_name === 'string' ? raw.network.network_name : undefined;

    const statusResult = mapCoinbaseStatus(raw.status);
    if (statusResult.isErr()) return err(statusResult.error);

    return this.validateNormalized({
      id: raw.id,
      correlationId,
      timestamp,
      type: raw.type,
      assetSymbol,
      amount: rawAmount,
      fee: feeAmount,
      feeCurrency,
      status: statusResult.value,
      hash,
      address,
      network,
    });
  }

  /**
   * Override to handle Coinbase-specific transaction types like "interest" rewards.
   */
  protected override determineOperationFromFundFlow(
    fundFlow: ExchangeFundFlow,
    entryGroup: LedgerEntryWithRaw<RawCoinbaseLedgerEntry>[]
  ): OperationClassification {
    const primaryEntry = entryGroup[0];

    if (primaryEntry?.normalized.type === 'interest') {
      return {
        operation: {
          category: 'staking',
          type: 'reward',
        },
      };
    }

    return classifyExchangeOperationFromFundFlow(fundFlow);
  }
}
