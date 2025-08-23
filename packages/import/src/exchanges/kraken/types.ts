/**
 * Type definitions for Kraken CSV data formats
 * 
 * These types define the structure of CSV exports from Kraken exchange
 * ledger data.
 */

export interface CsvKrakenLedgerRow {
  txid: string;
  refid: string;
  time: string;
  type: string;
  subtype: string;
  aclass: string;
  asset: string;
  wallet: string;
  amount: string;
  fee: string;
  balance: string;
}