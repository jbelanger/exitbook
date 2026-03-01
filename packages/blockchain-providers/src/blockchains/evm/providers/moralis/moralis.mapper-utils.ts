import { ok, type Result } from 'neverthrow';

import type { NormalizationError } from '../../../../core/index.js';
import { generateUniqueTransactionEventId, validateOutput } from '../../../../core/index.js';
import { calculateGasFee } from '../../receipt-utils.js';
import { EvmTransactionSchema } from '../../schemas.js';
import type { EvmTransaction } from '../../types.js';
import { extractMethodId, normalizeEvmAddress } from '../../utils.js';

import type { MoralisWalletHistoryTransaction } from './moralis.schemas.js';

/**
 * Maps a Moralis wallet history transaction to one or more normalized EvmTransactions.
 *
 * The wallet history endpoint (`/wallets/{address}/history`) returns a unified view where
 * each top-level item is a parent on-chain transaction containing sub-arrays:
 *   - native_transfers (regular + internal ETH movements)
 *   - erc20_transfers (token movements)
 *   - internal_transactions (raw trace data)
 *
 * This function unpacks a single history item into:
 *   1. The parent transaction (type: 'transfer') — carries the gas fee and main tx value
 *   2. One EvmTransaction per native_transfer flagged as internal_transaction: true (type: 'internal')
 *   3. One EvmTransaction per erc20_transfer (type: 'token_transfer')
 *
 * Internal native transfers that duplicate the parent tx value are already covered by the parent,
 * so we only emit internal txs explicitly flagged `internal_transaction: true`.
 */
export function mapMoralisWalletHistoryTransaction(
  rawData: MoralisWalletHistoryTransaction,
  nativeCurrency: string
): Result<EvmTransaction[], NormalizationError> {
  const timestamp = new Date(rawData.block_timestamp).getTime();
  const blockHeight = parseInt(rawData.block_number);
  const status = rawData.receipt_status === '1' ? 'success' : ('failed' as const);
  const from = normalizeEvmAddress(rawData.from_address) ?? '';
  const to = normalizeEvmAddress(rawData.to_address);

  // The wallet history endpoint returns transaction_fee already in decimal ETH.
  // Convert back to wei for consistency with the rest of the pipeline (processor converts from wei).
  const feeWei = calculateGasFee(rawData.receipt_gas_used || '0', rawData.gas_price || '0').toString();

  const results: EvmTransaction[] = [];

  // 1. Parent transaction (native value transfer + fee carrier)
  const parentTx: EvmTransaction = {
    amount: rawData.value,
    blockHeight,
    blockId: rawData.block_hash,
    currency: nativeCurrency,
    eventId: generateUniqueTransactionEventId({
      amount: rawData.value,
      currency: nativeCurrency,
      from,
      id: rawData.hash,
      timestamp,
      to,
      type: 'transfer',
    }),
    feeAmount: feeWei,
    feeCurrency: nativeCurrency,
    from,
    gasPrice: rawData.gas_price && rawData.gas_price !== '' ? rawData.gas_price : undefined,
    gasUsed: rawData.receipt_gas_used && rawData.receipt_gas_used !== '' ? rawData.receipt_gas_used : undefined,
    id: rawData.hash,
    methodId: extractMethodId(rawData.method_label ? '0x' : undefined), // no raw input in history
    providerName: 'moralis',
    status,
    timestamp,
    to,
    tokenType: 'native',
    type: 'transfer',
  };

  const parentResult = validateOutput(parentTx, EvmTransactionSchema, 'MoralisWalletHistoryParent');
  if (parentResult.isErr()) return parentResult.map(() => []);
  results.push(parentResult.value);

  // 2. Internal native transfers (contract → user ETH movements not in the parent tx value)
  for (let i = 0; i < rawData.native_transfers.length; i++) {
    const nt = rawData.native_transfers[i]!;

    // Skip non-internal transfers — those are already represented by the parent tx
    if (!nt.internal_transaction) continue;

    const ntFrom = normalizeEvmAddress(nt.from_address) ?? '';
    const ntTo = normalizeEvmAddress(nt.to_address);
    const traceId = `moralis-internal-${i}`;

    const internalTx: EvmTransaction = {
      amount: nt.value,
      blockHeight,
      blockId: rawData.block_hash,
      currency: nativeCurrency,
      eventId: generateUniqueTransactionEventId({
        amount: nt.value,
        currency: nativeCurrency,
        from: ntFrom,
        id: rawData.hash,
        timestamp,
        to: ntTo,
        traceId,
        type: 'internal',
      }),
      feeAmount: '0',
      feeCurrency: nativeCurrency,
      from: ntFrom,
      id: rawData.hash,
      providerName: 'moralis',
      status,
      timestamp,
      to: ntTo,
      tokenType: 'native',
      traceId,
      type: 'internal',
    };

    const internalResult = validateOutput(internalTx, EvmTransactionSchema, 'MoralisWalletHistoryInternal');
    if (internalResult.isErr()) return internalResult.map(() => []);
    results.push(internalResult.value);
  }

  // 3. ERC20 token transfers
  for (const erc20 of rawData.erc20_transfers) {
    const tokenAddress = normalizeEvmAddress(erc20.address);
    const currency = tokenAddress ?? erc20.address;
    const tokenDecimals = parseInt(erc20.token_decimals);
    const erc20From = normalizeEvmAddress(erc20.from_address) ?? '';
    const erc20To = normalizeEvmAddress(erc20.to_address);

    const tokenTx: EvmTransaction = {
      amount: erc20.value,
      blockHeight,
      blockId: rawData.block_hash,
      currency,
      eventId: generateUniqueTransactionEventId({
        amount: erc20.value,
        currency,
        from: erc20From,
        id: rawData.hash,
        timestamp,
        to: erc20To,
        tokenAddress,
        type: 'token_transfer',
      }),
      from: erc20From,
      id: rawData.hash,
      logIndex: erc20.log_index,
      providerName: 'moralis',
      status: 'success',
      timestamp,
      to: erc20To,
      tokenAddress,
      tokenDecimals,
      tokenSymbol: erc20.token_symbol || undefined,
      tokenType: 'erc20',
      type: 'token_transfer',
    };

    const tokenResult = validateOutput(tokenTx, EvmTransactionSchema, 'MoralisWalletHistoryToken');
    if (tokenResult.isErr()) return tokenResult.map(() => []);
    results.push(tokenResult.value);
  }

  return ok(results);
}
