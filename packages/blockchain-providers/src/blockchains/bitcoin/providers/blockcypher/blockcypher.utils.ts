import { satoshisToBtcString } from '../../utils.js';

/**
 * Calculate Bitcoin balance from simple final_balance (BlockCypher format)
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
