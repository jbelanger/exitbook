import { satoshisToBtcString } from '../../utils.js';

/**
 * Calculate Bitcoin balance from simple final_balance (Blockchain.com format)
 */
export function calculateSimpleBalance(finalBalance: number): {
  balanceBTC: string;
  balanceSats: number;
} {
  return {
    balanceBTC: satoshisToBtcString(finalBalance),
    balanceSats: finalBalance,
  };
}
