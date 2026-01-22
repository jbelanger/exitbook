import { parseDecimal, type TokenMetadataRecord, type TransactionNote, tryParseDecimal } from '@exitbook/core';
import { getLogger } from '@exitbook/logger';
import { Decimal } from 'decimal.js';

const logger = getLogger('scam-detection');

// ============================================================
// MODULE-LEVEL REGEX PATTERNS (for performance)
// ============================================================
const GIFT_EMOJI_REGEX = /[🎁🎉🎊💰💎⭐✨🔥🚀🪂]/u;

// More conservative pattern - only flag obvious scam phrases, not individual words
const TIME_BASED_DROP_REGEX = /\b(202[3-9].*(?:drop|airdrop|claim)|(?:visit|go to).*(?:claim|drop|airdrop))\b/i;

const URL_PATTERN_REGEX = /\b(www\.|\.com|\.net|\.org|\.io|\.app|\.xyz|https?:\/\/|token-|claim-)/i;

const EXPLICIT_SCAM_PHRASES_REGEX =
  /\b(visit.*to.*claim|go.*to.*claim|click.*to.*claim|free.*airdrop.*claim|claim.*your.*reward)\b/i;

const SUSPICIOUS_URL_PATTERNS = [
  /jupiter.*claim/i,
  /solana.*drop/i,
  /crypto.*bonus/i,
  /.*-airdrop.*\.com/i,
  /.*claim.*\.site/i,
  /.*bonus.*\.xyz/i,
];

// Unicode homograph detection (lookalike characters commonly used in scams)
const HOMOGRAPH_CHARS = /[\u0430-\u044f\u0410-\u042f\u0370-\u03ff\u0400-\u04ff]/u; // Cyrillic, Greek

// Zero-width and invisible characters used to obfuscate
// eslint-disable-next-line no-misleading-character-class -- Intended regex
const ZERO_WIDTH_CHARS = /[\u200b\u200c\u200d\u2060\ufeff]/u;

// Unicode obfuscated dots/separators
const UNICODE_DOT_OBFUSCATION = /[\u2024\u2027\u2218\u2219\u22c5\u00b7\u0387\u16eb\u2022\u2981\u0701]/u;

/**
 * Analyzes token metadata to identify potential scam tokens using multi-tier detection.
 * Priority: Professional detection > Pattern matching > Heuristics
 *
 * @param contractAddress - Token contract address
 * @param tokenMetadata - Token metadata from repository (includes professional spam flags)
 * @param transactionContext - Optional context about the transaction (for heuristics)
 * @returns TransactionNote if suspicious patterns detected, undefined otherwise
 */
export function detectScamToken(
  contractAddress: string,
  tokenMetadata: TokenMetadataRecord,
  transactionContext?: {
    amount: Decimal;
    isAirdrop: boolean;
  }
): TransactionNote | undefined {
  const suspiciousIndicators: string[] = [];
  let riskLevel: 'warning' | 'error' = 'warning';
  let detectionSource: 'professional' | 'pattern' | 'heuristic' = 'pattern';

  // ============================================================
  // TIER 1: PROFESSIONAL SPAM DETECTION (Highest Confidence)
  // ============================================================
  if (tokenMetadata.possibleSpam === true) {
    suspiciousIndicators.push('Flagged by provider spam detection');
    riskLevel = 'error';
    detectionSource = 'professional';

    // Return immediately - trust professional detection
    return {
      type: 'SCAM_TOKEN',
      message: `⚠️ Scam token detected by ${tokenMetadata.source}: ${contractAddress.slice(0, 8)}...`,
      severity: 'error',
      metadata: {
        contractAddress,
        detectionSource: 'professional',
        indicators: suspiciousIndicators,
        provider: tokenMetadata.source,
        tokenName: tokenMetadata.name,
        tokenSymbol: tokenMetadata.symbol,
        verifiedContract: tokenMetadata.verifiedContract,
      },
    };
  }

  // ============================================================
  // TIER 2: PATTERN MATCHING (Fallback for non-spam providers)
  // ============================================================

  // Analyze token name for gift/reward emojis
  if (tokenMetadata.name && containsGiftEmojis(tokenMetadata.name)) {
    suspiciousIndicators.push('Gift/drop emojis in token name');
    // riskLevel is 'warning' by default, no need to set it again
  }

  // Check for homograph attacks (unicode lookalikes)
  if (tokenMetadata.name && containsHomographChars(tokenMetadata.name)) {
    suspiciousIndicators.push('Contains lookalike unicode characters (possible spoofing)');
    riskLevel = 'error';
  }

  // Check for zero-width character obfuscation
  if (tokenMetadata.name && containsZeroWidthChars(tokenMetadata.name)) {
    suspiciousIndicators.push('Contains invisible unicode characters (obfuscation)');
    riskLevel = 'error';
  }

  // Check for unicode dot obfuscation in URLs
  if (
    (tokenMetadata.name && containsUnicodeDotObfuscation(tokenMetadata.name)) ||
    (tokenMetadata.externalUrl && containsUnicodeDotObfuscation(tokenMetadata.externalUrl))
  ) {
    suspiciousIndicators.push('Contains obfuscated URL characters');
    riskLevel = 'error';
  }

  // Validate external URLs for suspicious patterns
  if (tokenMetadata.externalUrl && isSuspiciousUrl(tokenMetadata.externalUrl)) {
    suspiciousIndicators.push('Suspicious external URL');
    riskLevel = 'error';
  }

  // Check for time-sensitive drop language
  if (tokenMetadata.name && hasTimeBasedDropPattern(tokenMetadata.name)) {
    suspiciousIndicators.push('Suspicious year/drop pattern in name');
    if (riskLevel !== 'error') {
      riskLevel = 'warning';
    }
  }

  // Detect embedded URLs in token names
  if (tokenMetadata.name && containsUrlPattern(tokenMetadata.name)) {
    suspiciousIndicators.push('Contains suspicious URL/website pattern');
    riskLevel = 'error';
  }

  // Check description for scam phrases (Solana-specific rich metadata)
  if (tokenMetadata.description && containsExplicitScamPhrases(tokenMetadata.description)) {
    suspiciousIndicators.push('Scam phrases in description');
    riskLevel = 'error';
  }

  // Check total supply for ridiculous values (common in scam tokens)
  // Skip this check for verified contracts as they may legitimately have high supplies
  if (
    tokenMetadata.totalSupply &&
    !tokenMetadata.verifiedContract &&
    hasRidiculousTotalSupply(tokenMetadata.totalSupply, tokenMetadata.decimals)
  ) {
    suspiciousIndicators.push('Extremely high total supply (likely worthless)');
    if (riskLevel !== 'error') {
      riskLevel = 'warning';
    }
  }

  // Check token age if createdAt available (very new + airdrop = suspicious)
  if (tokenMetadata.createdAt && transactionContext?.isAirdrop) {
    const tokenAgeResult = analyzeTokenAge(tokenMetadata.createdAt);
    if (tokenAgeResult.isVeryRecent) {
      suspiciousIndicators.push(`Token created ${tokenAgeResult.ageDescription}`);
      // Only flag as error if combined with other indicators
      if (suspiciousIndicators.length > 1) {
        riskLevel = 'error';
      }
    }
  }

  // ============================================================
  // TIER 3: HEURISTICS (Context-based signals)
  // ============================================================
  if (transactionContext?.isAirdrop && transactionContext.amount.greaterThan(0)) {
    // Add airdrop warning based on context:
    // 1. If there are already other suspicious indicators, add as additional signal
    // 2. If explicitly unverified (false), escalate to error
    // 3. If unknown verification status (undefined), add warning to verify
    // 4. If verified (true) with no other indicators, don't flag anything
    if (suspiciousIndicators.length > 0) {
      suspiciousIndicators.push('Unsolicited airdrop');
    } else if (tokenMetadata.verifiedContract === false) {
      // Explicitly unverified contract + airdrop = highly suspicious (legitimate projects verify contracts)
      detectionSource = 'heuristic';
      riskLevel = 'error';
      suspiciousIndicators.push('Unverified contract with unsolicited airdrop');
    } else if (tokenMetadata.verifiedContract === undefined) {
      // Unknown verification status + airdrop = warning to verify
      detectionSource = 'heuristic';
      // Keep riskLevel as 'warning' (default)
      suspiciousIndicators.push('Unsolicited airdrop (verify legitimacy)');
    }
    // If verified contract with no other indicators, don't flag anything
  }

  // Generate warning note if suspicious patterns found
  if (suspiciousIndicators.length > 0) {
    const noteType = riskLevel === 'error' ? 'SCAM_TOKEN' : 'SUSPICIOUS_AIRDROP';

    return {
      message: `⚠️ ${riskLevel === 'error' ? 'Scam token detected' : 'Suspicious token'}: ${suspiciousIndicators.join(', ')}`,
      metadata: {
        contractAddress,
        detectionSource,
        externalUrl: tokenMetadata.externalUrl,
        indicators: suspiciousIndicators,
        tokenName: tokenMetadata.name,
        tokenSymbol: tokenMetadata.symbol,
        verifiedContract: tokenMetadata.verifiedContract,
      },
      severity: riskLevel,
      type: noteType,
    };
  }

  return undefined;
}

/**
 * Checks if token name contains gift/reward emojis commonly used in scam tokens
 */
function containsGiftEmojis(name: string): boolean {
  return GIFT_EMOJI_REGEX.test(name);
}

/**
 * Detects homograph attacks using lookalike unicode characters (e.g., Cyrillic 'а' vs Latin 'a')
 */
function containsHomographChars(text: string): boolean {
  return HOMOGRAPH_CHARS.test(text);
}

/**
 * Detects zero-width and invisible unicode characters used for obfuscation
 */
function containsZeroWidthChars(text: string): boolean {
  return ZERO_WIDTH_CHARS.test(text);
}

/**
 * Detects unicode dot obfuscation (e.g., 'claim․com' using unicode dot instead of period)
 */
function containsUnicodeDotObfuscation(text: string): boolean {
  return UNICODE_DOT_OBFUSCATION.test(text);
}

/**
 * Detects time-sensitive language commonly used in scam tokens (more conservative)
 * Now requires combination of year/action rather than single keywords
 */
function hasTimeBasedDropPattern(name: string): boolean {
  return TIME_BASED_DROP_REGEX.test(name);
}

/**
 * Identifies URL or website patterns embedded in token names
 */
function containsUrlPattern(name: string): boolean {
  return URL_PATTERN_REGEX.test(name);
}

/**
 * Detects explicit scam language patterns (conservative approach)
 */
function containsExplicitScamPhrases(name: string): boolean {
  return EXPLICIT_SCAM_PHRASES_REGEX.test(name);
}

/**
 * Check if external URL looks suspicious
 */
function isSuspiciousUrl(url: string): boolean {
  try {
    const parsedUrl = new URL(url);
    const hostname = parsedUrl.hostname.toLowerCase();

    return SUSPICIOUS_URL_PATTERNS.some((pattern) => pattern.test(hostname));
  } catch (error) {
    logger.warn({ error, url }, 'Invalid URL format in token metadata - skipping URL validation');
    return false;
  }
}

/**
 * Check if total supply is ridiculously high (common scam pattern)
 * Scam tokens often have supplies like 1 quadrillion to make recipients feel wealthy
 *
 * Uses Decimal.js for precise arithmetic without floating-point precision loss
 *
 * @param totalSupply - Raw total supply (may include decimals)
 * @param decimals - Optional token decimals to convert to human-readable supply
 */
function hasRidiculousTotalSupply(totalSupply: string, decimals?: number): boolean {
  try {
    // Remove common formatting (commas, spaces) before parsing
    const cleaned = totalSupply.replace(/[,\s]/g, '');

    // Parse using Decimal.js to avoid precision loss on large numbers
    const parsed = { value: parseDecimal('0') };
    if (!tryParseDecimal(cleaned, parsed)) {
      logger.warn({ totalSupply, cleaned }, 'Invalid total supply value - failed to parse');
      return false;
    }

    // Validate parsed value (check for NaN or infinite)
    if (!parsed.value.isFinite()) {
      logger.warn({ totalSupply, cleaned }, 'Invalid total supply value - not finite');
      return false;
    }

    // Convert to human-readable supply if decimals are provided
    // e.g., 1e27 with 18 decimals = 1e9 (1 billion tokens)
    let humanReadableSupply = parsed.value;
    if (decimals !== undefined && decimals > 0) {
      const divisor = new Decimal(10).pow(decimals);
      humanReadableSupply = parsed.value.dividedBy(divisor);
    }

    // Flag if human-readable supply > 100 trillion
    // This is an extremely conservative threshold to catch only the most absurd scam tokens
    // (e.g., tokens with quadrillions or quintillions in circulation)
    const RIDICULOUS_THRESHOLD = parseDecimal('1e14'); // 100 trillion
    return humanReadableSupply.greaterThan(RIDICULOUS_THRESHOLD);
  } catch (error) {
    logger.warn({ error, totalSupply }, 'Failed to parse total supply value');
    return false;
  }
}

/**
 * Analyze token age from createdAt timestamp
 * Very recently created tokens (< 7 days) that are airdropped are often scams
 */
function analyzeTokenAge(createdAt: string): {
  ageDescription: string;
  isVeryRecent: boolean;
} {
  try {
    const createdDate = new Date(createdAt);
    const now = new Date();
    const ageMs = now.getTime() - createdDate.getTime();
    const ageDays = Math.floor(ageMs / (1000 * 60 * 60 * 24));
    const ageHours = Math.floor(ageMs / (1000 * 60 * 60));

    if (ageDays < 1) {
      return {
        ageDescription: ageHours < 1 ? 'less than 1 hour ago' : `${ageHours} hours ago`,
        isVeryRecent: true,
      };
    } else if (ageDays < 7) {
      return {
        ageDescription: `${ageDays} days ago`,
        isVeryRecent: true,
      };
    }

    return {
      ageDescription: `${ageDays} days ago`,
      isVeryRecent: false,
    };
  } catch (error) {
    logger.warn({ error, createdAt }, 'Failed to parse token createdAt timestamp');
    return { ageDescription: 'unknown', isVeryRecent: false };
  }
}

/**
 * Detect scam patterns directly from token symbol (for cases where we don't have full metadata)
 * CONSERVATIVE approach - only flag extremely obvious scams
 */
export function detectScamFromSymbol(tokenSymbol: string): {
  isScam: boolean;
  reason: string;
} {
  // Check for URL patterns in token symbol (very obvious scam pattern)
  if (containsUrlPattern(tokenSymbol)) {
    return { isScam: true, reason: 'Contains suspicious URL/website pattern' };
  }

  // Check for very obvious scam phrases (not individual words like "claim" but full suspicious phrases)
  if (containsExplicitScamPhrases(tokenSymbol)) {
    return { isScam: true, reason: 'Contains obvious scam phrases' };
  }

  // Check for gift emojis (legitimate tokens don't typically have these)
  if (containsGiftEmojis(tokenSymbol)) {
    return { isScam: true, reason: 'Contains gift/reward emojis' };
  }

  return { isScam: false, reason: '' };
}
