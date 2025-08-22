
// ExchangeBalance is still used in some places but should be migrated to UniversalBalance
export interface ExchangeBalance {
  currency: string;
  balance: number; // Available/free amount
  used: number;
  total: number;
}