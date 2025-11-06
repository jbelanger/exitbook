import { parseDecimal } from '@exitbook/core';
import type { SourceMetadata } from '@exitbook/core';
import { ok, type Result } from 'neverthrow';

import type { NormalizationError } from '../../shared/blockchain/index.ts';

import type { BlockchainComTransaction } from './blockchain-com/blockchain-com.schemas.js';
import type { BlockCypherTransaction } from './blockcypher/blockcypher.schemas.js';
import type { BlockstreamTransaction } from './blockstream/blockstream.schemas.js';
import type { MempoolTransaction } from './mempool-space/mempool-space.schemas.js';
import type { BitcoinTransaction, BitcoinTransactionInput, BitcoinTransactionOutput } from './schemas.js';
import type { TatumBitcoinTransaction } from './tatum/tatum.schemas.js';

/**
 * Pure functions for Bitcoin transaction mapping
 * Following the Functional Core / Imperative Shell pattern
 */

/**
 * Convert satoshis to BTC as a string
 */
export function satoshisToBtcString(satoshis: number): string {
  return parseDecimal(satoshis.toString()).div(100000000).toFixed();
}

/**
 * Map Blockstream transaction to normalized BitcoinTransaction
 */
export function mapBlockstreamTransaction(
  rawData: BlockstreamTransaction,
  _sourceContext: SourceMetadata
): Result<BitcoinTransaction, NormalizationError> {
  const timestamp =
    rawData.status.confirmed && rawData.status.block_time ? rawData.status.block_time.getTime() : Date.now();

  const inputs: BitcoinTransactionInput[] = rawData.vin.map((input) => ({
    address: input.prevout?.scriptpubkey_address,
    txid: input.txid,
    value: input.prevout?.value ? input.prevout.value.toString() : '0',
    vout: input.vout,
  }));

  const outputs: BitcoinTransactionOutput[] = rawData.vout.map((output, index) => ({
    address: output.scriptpubkey_address,
    index,
    value: output.value.toString(),
  }));

  const normalized: BitcoinTransaction = {
    currency: 'BTC',
    id: rawData.txid,
    inputs,
    outputs,
    providerId: 'blockstream.info',
    status: rawData.status.confirmed ? 'success' : 'pending',
    timestamp,
  };

  if (rawData.status.block_height) {
    normalized.blockHeight = rawData.status.block_height;
  }
  if (rawData.status.block_hash) {
    normalized.blockId = rawData.status.block_hash;
  }
  if (rawData.fee > 0) {
    normalized.feeAmount = satoshisToBtcString(rawData.fee);
    normalized.feeCurrency = 'BTC';
  }

  return ok(normalized);
}

/**
 * Map Mempool.space transaction to normalized BitcoinTransaction
 */
export function mapMempoolSpaceTransaction(
  rawData: MempoolTransaction,
  _sourceContext: SourceMetadata
): Result<BitcoinTransaction, NormalizationError> {
  const timestamp =
    rawData.status.confirmed && rawData.status.block_time ? rawData.status.block_time.getTime() : Date.now();

  const inputs: BitcoinTransactionInput[] = rawData.vin.map((input, _index) => ({
    address: input.prevout?.scriptpubkey_address,
    txid: input.txid,
    value: input.prevout?.value ? input.prevout.value.toString() : '0',
    vout: input.vout,
  }));

  const outputs: BitcoinTransactionOutput[] = rawData.vout.map((output, index) => ({
    address: output.scriptpubkey_address,
    index,
    value: output.value.toString(),
  }));

  const normalized: BitcoinTransaction = {
    currency: 'BTC',
    id: rawData.txid,
    inputs,
    outputs,
    providerId: 'mempool.space',
    status: rawData.status.confirmed ? 'success' : 'pending',
    timestamp,
  };

  if (rawData.status.block_height) {
    normalized.blockHeight = rawData.status.block_height;
  }
  if (rawData.status.block_hash) {
    normalized.blockId = rawData.status.block_hash;
  }
  if (rawData.fee > 0) {
    normalized.feeAmount = satoshisToBtcString(rawData.fee);
    normalized.feeCurrency = 'BTC';
  }

  return ok(normalized);
}

/**
 * Map Tatum transaction to normalized BitcoinTransaction
 */
export function mapTatumTransaction(
  rawData: TatumBitcoinTransaction,
  _sourceContext: SourceMetadata
): Result<BitcoinTransaction, NormalizationError> {
  const timestamp = rawData.time * 1000;

  const inputs: BitcoinTransactionInput[] = rawData.inputs.map((input, _index) => ({
    address: input.coin.address,
    txid: input.prevout.hash,
    value: input.coin.value.toString(),
    vout: input.prevout.index,
  }));

  const outputs: BitcoinTransactionOutput[] = rawData.outputs.map((output, index) => ({
    address: output.address,
    index,
    value: output.value.toString(),
  }));

  const normalized: BitcoinTransaction = {
    currency: 'BTC',
    id: rawData.hash,
    inputs,
    outputs,
    providerId: 'tatum',
    status: rawData.blockNumber ? 'success' : 'pending',
    timestamp,
  };

  if (rawData.blockNumber) {
    normalized.blockHeight = rawData.blockNumber;
  }
  if (rawData.block) {
    normalized.blockId = rawData.block;
  }
  if (rawData.fee > 0) {
    const btcFee = parseDecimal(rawData.fee.toFixed()).div(100000000).toFixed();
    normalized.feeAmount = btcFee;
    normalized.feeCurrency = 'BTC';
  }

  return ok(normalized);
}

/**
 * Map Blockchain.com transaction to normalized BitcoinTransaction
 */
export function mapBlockchainComTransaction(
  rawData: BlockchainComTransaction,
  _sourceContext: SourceMetadata
): Result<BitcoinTransaction, NormalizationError> {
  const timestamp = rawData.time * 1000;

  const inputs: BitcoinTransactionInput[] = rawData.inputs.map((input, _index) => ({
    address: input.prev_out?.addr,
    txid: '',
    value: input.prev_out?.value ? input.prev_out.value.toString() : '0',
    vout: input.prev_out?.n,
  }));

  const outputs: BitcoinTransactionOutput[] = rawData.out.map((output, _index) => ({
    address: output.addr,
    index: output.n,
    value: output.value.toString(),
  }));

  const normalized: BitcoinTransaction = {
    currency: 'BTC',
    id: rawData.hash,
    inputs,
    outputs,
    providerId: 'blockchain.com',
    status: rawData.block_height ? 'success' : 'pending',
    timestamp,
  };

  if (rawData.block_height) {
    normalized.blockHeight = rawData.block_height;
  }
  if (rawData.fee > 0) {
    normalized.feeAmount = satoshisToBtcString(rawData.fee);
    normalized.feeCurrency = 'BTC';
  }

  return ok(normalized);
}

/**
 * Map BlockCypher transaction to normalized BitcoinTransaction
 */
export function mapBlockCypherTransaction(
  rawData: BlockCypherTransaction,
  _sourceContext: SourceMetadata
): Result<BitcoinTransaction, NormalizationError> {
  const timestamp = rawData.confirmed ? new Date(rawData.confirmed).getTime() : Date.now();

  const inputs: BitcoinTransactionInput[] = rawData.inputs.map((input) => ({
    address: input.addresses && input.addresses.length > 0 ? input.addresses[0] : undefined,
    txid: input.prev_hash,
    value: input.output_value ? input.output_value.toString() : '0',
    vout: input.output_index,
  }));

  const outputs: BitcoinTransactionOutput[] = rawData.outputs.map((output, index) => ({
    address: output.addresses && output.addresses.length > 0 ? output.addresses[0] : undefined,
    index,
    value: output.value.toString(),
  }));

  const normalized: BitcoinTransaction = {
    currency: 'BTC',
    id: rawData.hash,
    inputs,
    outputs,
    providerId: 'blockcypher',
    status: rawData.confirmations > 0 ? 'success' : 'pending',
    timestamp,
  };

  if (rawData.block_height) {
    normalized.blockHeight = rawData.block_height;
  }
  if (rawData.block_hash) {
    normalized.blockId = rawData.block_hash;
  }
  if (rawData.fees > 0) {
    normalized.feeAmount = satoshisToBtcString(rawData.fees);
    normalized.feeCurrency = 'BTC';
  }

  return ok(normalized);
}
