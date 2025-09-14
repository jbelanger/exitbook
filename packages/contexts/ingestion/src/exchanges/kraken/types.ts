/**
 * Type definitions for Kraken CSV data formats
 *
 * These types define the structure of CSV exports from Kraken exchange
 * ledger data.
 */

export interface CsvKrakenLedgerRow {
  aclass: string;
  amount: string;
  asset: string;
  balance: string;
  fee: string;
  refid: string;
  subtype: string;
  time: string;
  txid: string;
  type: string;
  wallet: string;
}
