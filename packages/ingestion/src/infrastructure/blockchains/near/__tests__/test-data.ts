/**
 * Test data helpers for NEAR processor tests
 * Provides clean numbers to avoid floating-point precision issues with 24-decimal yoctoNEAR
 */

/**
 * Convert NEAR to yoctoNEAR (24 decimals)
 * Uses string arithmetic to avoid floating-point precision issues
 */
export function nearToYocto(near: string): string {
  const [whole = '0', fraction = ''] = near.split('.');
  const paddedFraction = fraction.padEnd(24, '0').slice(0, 24);
  return whole + paddedFraction;
}

/**
 * Calculate balance changes for clean test data
 */
export function calculateBalanceChange(
  initialNear: string,
  sentNear: string,
  feeNear: string
): {
  amountSent: string;
  feeAmount: string;
  postBalance: string;
  preBalance: string;
} {
  const pre = nearToYocto(initialNear);
  const sent = nearToYocto(sentNear);
  const fee = nearToYocto(feeNear);

  // Post balance = pre - sent - fee
  const preBig = BigInt(pre);
  const sentBig = BigInt(sent);
  const feeBig = BigInt(fee);
  const postBig = preBig - sentBig - feeBig;

  return {
    amountSent: sent,
    feeAmount: feeNear,
    postBalance: postBig.toString(),
    preBalance: pre,
  };
}
