import { parseDecimal } from '@exitbook/core';
import type { SourceMetadata } from '@exitbook/core';
import { ok, type Result } from 'neverthrow';

import { withValidation, type NormalizationError } from '../../../../core/index.js';
import type { BitcoinChainConfig } from '../../chain-config.interface.js';
import {
  BitcoinTransactionSchema,
  type BitcoinTransaction,
  type BitcoinTransactionInput,
  type BitcoinTransactionOutput,
} from '../../schemas.js';

import { TatumBCashTransactionSchema, type TatumBCashTransaction } from './tatum-bcash.schemas.js';
import { TatumDogecoinTransactionSchema, type TatumDogecoinTransaction } from './tatum-dogecoin.schemas.js';
import { TatumLitecoinTransactionSchema, type TatumLitecoinTransaction } from './tatum-litecoin.schemas.js';
import { TatumBitcoinTransactionSchema, type TatumBitcoinTransaction } from './tatum.schemas.js';

/**
 * Internal pure mapper function (without validation).
 * Maps Tatum transaction to normalized BitcoinTransaction.
 */
function mapTatumTransactionInternal(
  rawData: TatumBitcoinTransaction,
  _sourceContext: SourceMetadata,
  chainConfig: BitcoinChainConfig
): Result<BitcoinTransaction, NormalizationError> {
  const timestamp = rawData.time * 1000;

  const inputs: BitcoinTransactionInput[] = rawData.inputs.map((input, _index) => ({
    address: input.coin?.address,
    txid: input.prevout?.hash,
    value: input.coin?.value?.toString() || '0',
    vout: input.prevout?.index,
  }));

  const outputs: BitcoinTransactionOutput[] = rawData.outputs.map((output, index) => ({
    address: output.address,
    index,
    value: output.value.toString(),
  }));

  const normalized: BitcoinTransaction = {
    currency: chainConfig.nativeCurrency,
    id: rawData.hash,
    inputs,
    outputs,
    providerName: 'tatum',
    status: rawData.blockNumber ? 'success' : 'pending',
    timestamp,
  };

  if (rawData.blockNumber) {
    normalized.blockHeight = rawData.blockNumber;
  }
  if (rawData.block) {
    normalized.blockId = rawData.block;
  }
  if (parseDecimal(rawData.fee).greaterThan(0)) {
    const btcFee = parseDecimal(rawData.fee).div(100000000).toFixed();
    normalized.feeAmount = btcFee;
    normalized.feeCurrency = chainConfig.nativeCurrency;
  }

  return ok(normalized);
}

/**
 * Map Tatum transaction to normalized BitcoinTransaction with validation.
 * Validates both input (TatumBitcoinTransaction) and output (BitcoinTransaction) schemas.
 */
export const mapTatumTransaction = withValidation(
  TatumBitcoinTransactionSchema,
  BitcoinTransactionSchema,
  'TatumBitcoinTransaction'
)(mapTatumTransactionInternal);

/**
 * Internal pure mapper function (without validation).
 * Maps Tatum BCash transaction to normalized BitcoinTransaction.
 * BCash endpoint returns a different structure (vin/vout instead of inputs/outputs).
 */
function mapTatumBCashTransactionInternal(
  rawData: TatumBCashTransaction,
  _sourceContext: SourceMetadata,
  chainConfig: BitcoinChainConfig
): Result<BitcoinTransaction, NormalizationError> {
  const timestamp = rawData.blocktime ? rawData.blocktime * 1000 : rawData.time ? rawData.time * 1000 : Date.now();

  const inputs: BitcoinTransactionInput[] = rawData.vin.map((input) => ({
    address: undefined, // BCash vin doesn't include address, would need to fetch from previous tx
    txid: input.txid,
    value: '0', // Would need to fetch from previous tx output
    vout: input.vout,
  }));

  const outputs: BitcoinTransactionOutput[] = rawData.vout.map((output) => ({
    address:
      output.scriptPubKey.addresses && output.scriptPubKey.addresses.length > 0
        ? output.scriptPubKey.addresses[0]
        : undefined,
    index: output.n,
    value: parseDecimal(output.value.toString()).times(100000000).toFixed(), // Convert BCH to satoshis
  }));

  const normalized: BitcoinTransaction = {
    currency: chainConfig.nativeCurrency,
    id: rawData.txid,
    inputs,
    outputs,
    providerName: 'tatum',
    status: rawData.blockheight ? 'success' : 'pending',
    timestamp,
  };

  if (rawData.blockheight) {
    normalized.blockHeight = rawData.blockheight;
  }
  if (rawData.blockhash) {
    normalized.blockId = rawData.blockhash;
  }

  // BCash API doesn't provide fee directly, would need to calculate from inputs/outputs
  // but inputs don't include values

  return ok(normalized);
}

/**
 * Map Tatum BCash transaction to normalized BitcoinTransaction with validation.
 * Validates both input (TatumBCashTransaction) and output (BitcoinTransaction) schemas.
 */
export const mapTatumBCashTransaction = withValidation(
  TatumBCashTransactionSchema,
  BitcoinTransactionSchema,
  'TatumBCashTransaction'
)(mapTatumBCashTransactionInternal);

/**
 * Internal pure mapper function (without validation).
 * Maps Tatum Dogecoin transaction to normalized BitcoinTransaction.
 * Dogecoin endpoint returns values as strings in DOGE (not satoshis).
 */
function mapTatumDogecoinTransactionInternal(
  rawData: TatumDogecoinTransaction,
  _sourceContext: SourceMetadata,
  chainConfig: BitcoinChainConfig
): Result<BitcoinTransaction, NormalizationError> {
  const timestamp = rawData.time * 1000;

  const inputs: BitcoinTransactionInput[] = rawData.inputs.map((input) => ({
    address: input.coin?.address,
    txid: input.prevout?.hash,
    value: input.coin?.value ? parseDecimal(input.coin.value).times(100000000).toFixed() : '0', // Convert DOGE to satoshis
    vout: input.prevout?.index,
  }));

  const outputs: BitcoinTransactionOutput[] = rawData.outputs.map((output, index) => ({
    address: output.address,
    index,
    value: parseDecimal(output.value).times(100000000).toFixed(), // Convert DOGE to satoshis
  }));

  const normalized: BitcoinTransaction = {
    currency: chainConfig.nativeCurrency,
    id: rawData.hash,
    inputs,
    outputs,
    providerName: 'tatum',
    status: rawData.blockNumber ? 'success' : 'pending',
    timestamp,
  };

  if (rawData.blockNumber) {
    normalized.blockHeight = rawData.blockNumber;
  }
  if (rawData.block) {
    normalized.blockId = rawData.block;
  }
  if (parseDecimal(rawData.fee).greaterThan(0)) {
    normalized.feeAmount = rawData.fee; // Fee is already in DOGE
    normalized.feeCurrency = chainConfig.nativeCurrency;
  }

  return ok(normalized);
}

/**
 * Map Tatum Dogecoin transaction to normalized BitcoinTransaction with validation.
 * Validates both input (TatumDogecoinTransaction) and output (BitcoinTransaction) schemas.
 */
export const mapTatumDogecoinTransaction = withValidation(
  TatumDogecoinTransactionSchema,
  BitcoinTransactionSchema,
  'TatumDogecoinTransaction'
)(mapTatumDogecoinTransactionInternal);

/**
 * Internal pure mapper function (without validation).
 * Maps Tatum Litecoin transaction to normalized BitcoinTransaction.
 * Litecoin endpoint returns values as strings in LTC (not satoshis).
 */
function mapTatumLitecoinTransactionInternal(
  rawData: TatumLitecoinTransaction,
  _sourceContext: SourceMetadata,
  chainConfig: BitcoinChainConfig
): Result<BitcoinTransaction, NormalizationError> {
  const timestamp = rawData.time * 1000;

  const inputs: BitcoinTransactionInput[] = rawData.inputs.map((input) => ({
    address: input.coin?.address,
    txid: input.prevout?.hash,
    value: input.coin?.value ? parseDecimal(input.coin.value).times(100000000).toFixed() : '0', // Convert LTC to satoshis
    vout: input.prevout?.index,
  }));

  const outputs: BitcoinTransactionOutput[] = rawData.outputs.map((output, index) => ({
    address: output.address,
    index,
    value: parseDecimal(output.value).times(100000000).toFixed(), // Convert LTC to satoshis
  }));

  const normalized: BitcoinTransaction = {
    currency: chainConfig.nativeCurrency,
    id: rawData.hash,
    inputs,
    outputs,
    providerName: 'tatum',
    status: rawData.blockNumber ? 'success' : 'pending',
    timestamp,
  };

  if (rawData.blockNumber) {
    normalized.blockHeight = rawData.blockNumber;
  }
  if (rawData.block) {
    normalized.blockId = rawData.block;
  }
  if (parseDecimal(rawData.fee).greaterThan(0)) {
    normalized.feeAmount = rawData.fee; // Fee is already in LTC
    normalized.feeCurrency = chainConfig.nativeCurrency;
  }

  return ok(normalized);
}

/**
 * Map Tatum Litecoin transaction to normalized BitcoinTransaction with validation.
 * Validates both input (TatumLitecoinTransaction) and output (BitcoinTransaction) schemas.
 */
export const mapTatumLitecoinTransaction = withValidation(
  TatumLitecoinTransactionSchema,
  BitcoinTransactionSchema,
  'TatumLitecoinTransaction'
)(mapTatumLitecoinTransactionInternal);
