import { satoshisToBtcString } from '../../utils.js';

/**
 * Calculate Bitcoin balance from Tatum balance data
 */
export function calculateTatumBalance(
  incomingStr: string,
  outgoingStr: string
): {
  balanceBTC: string;
  balanceSats: number;
} {
  const incomingSats = parseFloat(incomingStr);
  const outgoingSats = parseFloat(outgoingStr);
  const balanceSats = incomingSats - outgoingSats;

  return {
    balanceBTC: satoshisToBtcString(balanceSats),
    balanceSats,
  };
}
