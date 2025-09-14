import type { TransactionNote } from '../../types.js';
import { TransactionNoteType } from '../types/types.js';

/**
 * Token metadata from DAS API for scam detection
 */
interface TokenMetadata {
  attributes?: { trait_type: string; value: string }[];
  description?: string;
  external_url?: string;
  image?: string;
  name: string;
  symbol: string;
}

/**
 * Analyzes token metadata to identify potential scam tokens
 * Returns a transaction note if suspicious patterns are detected
 */
export function detectScamToken(
  mintAddress: string,
  tokenMetadata: TokenMetadata,
  transactionContext?: {
    amount: number;
    isAirdrop: boolean;
  },
): TransactionNote | null {
  const suspiciousIndicators: string[] = [];
  let riskLevel: 'warning' | 'error' = 'warning';

  // Analyze token name for gift/reward emojis
  if (tokenMetadata.name && containsGiftEmojis(tokenMetadata.name)) {
    suspiciousIndicators.push('Gift/drop emojis in token name');
    riskLevel = 'error';
  }

  // Check for project impersonation attempts
  const impersonationResult = detectProjectImpersonation(tokenMetadata.symbol, tokenMetadata.name);
  if (impersonationResult.isImpersonation) {
    suspiciousIndicators.push(`Impersonating ${impersonationResult.targetProject}`);
    riskLevel = 'error';
  }

  // Validate external URLs for suspicious patterns
  if (tokenMetadata.external_url && isSuspiciousUrl(tokenMetadata.external_url)) {
    suspiciousIndicators.push('Suspicious external URL');
    riskLevel = 'error';
  }

  // Check for time-sensitive drop language
  if (tokenMetadata.name && hasTimeBasedDropPattern(tokenMetadata.name)) {
    suspiciousIndicators.push('Suspicious year/drop pattern in name');
    riskLevel = 'warning';
  }

  // Detect embedded URLs in token names
  if (tokenMetadata.name && containsUrlPattern(tokenMetadata.name)) {
    suspiciousIndicators.push('Contains suspicious URL/website pattern');
    riskLevel = 'error';
  }

  // Evaluate airdrop context
  if (transactionContext?.isAirdrop && transactionContext.amount > 0) {
    suspiciousIndicators.push('Unsolicited airdrop');
    riskLevel = 'warning';
  }

  // Generate warning note if suspicious patterns found
  if (suspiciousIndicators.length > 0) {
    const noteType =
      riskLevel === 'error'
        ? TransactionNoteType.SCAM_TOKEN
        : TransactionNoteType.SUSPICIOUS_AIRDROP;

    return {
      message: `⚠️ ${riskLevel === 'error' ? 'Scam token detected' : 'Suspicious token'}: ${suspiciousIndicators.join(', ')}`,
      metadata: {
        externalUrl: tokenMetadata.external_url,
        indicators: suspiciousIndicators,
        mintAddress,
        tokenName: tokenMetadata.name,
        tokenSymbol: tokenMetadata.symbol,
      },
      severity: riskLevel,
      type: noteType,
    };
  }

  return null;
}

/**
 * Checks if token name contains gift/reward emojis commonly used in scam tokens
 */
function containsGiftEmojis(name: string): boolean {
  const giftEmojis = /[🎁🎉🎊💰💎⭐✨🔥🚀]/u;
  return giftEmojis.test(name);
}

/**
 * Identifies potential impersonation of legitimate projects
 */
function detectProjectImpersonation(
  symbol: string,
  name: string,
): { isImpersonation: boolean; targetProject?: string } {
  const knownProjects = [
    { names: ['jupiter'], project: 'Jupiter Exchange', symbols: ['jup'] },
    { names: ['solana'], project: 'Solana', symbols: ['sol'] },
    { names: ['raydium'], project: 'Raydium', symbols: ['ray'] },
    { names: ['serum'], project: 'Serum', symbols: ['srm'] },
    { names: ['orca'], project: 'Orca', symbols: ['orca'] },
    { names: ['mango'], project: 'Mango Markets', symbols: ['mngo'] },
  ];

  const lowerSymbol = symbol.toLowerCase();
  const lowerName = name.toLowerCase();

  for (const project of knownProjects) {
    // Check if symbol matches but name suggests it's fake
    if (project.symbols.includes(lowerSymbol)) {
      // If name contains suspicious patterns, it's likely impersonation
      if (hasTimeBasedDropPattern(name) || containsGiftEmojis(name)) {
        return { isImpersonation: true, targetProject: project.project };
      }
    }

    // Check if name contains project name but has suspicious additions
    const hasProjectName = project.names.some((projName) => lowerName.includes(projName));
    if (hasProjectName && (hasTimeBasedDropPattern(name) || containsGiftEmojis(name))) {
      return { isImpersonation: true, targetProject: project.project };
    }
  }

  return { isImpersonation: false };
}

/**
 * Detects time-sensitive language commonly used in scam tokens
 */
function hasTimeBasedDropPattern(name: string): boolean {
  const yearDropPatterns = /\b(202[3-9]|drop|airdrop|claim|bonus|reward|visit|free|prize|win)\b/i;
  return yearDropPatterns.test(name);
}

/**
 * Identifies URL or website patterns embedded in token names
 */
function containsUrlPattern(name: string): boolean {
  const urlPatterns = /\b(www\.|\.com|\.net|\.org|\.io|\.app|\.xyz|token-|claim-|visit |go to )/i;
  return urlPatterns.test(name);
}

/**
 * Detects explicit scam language patterns (conservative approach)
 */
function containsExplicitScamPhrases(name: string): boolean {
  const obviousScamPatterns =
    /\b(visit.*to.*claim|go.*to.*claim|click.*to.*claim|free.*airdrop.*claim|claim.*your.*reward)\b/i;
  return obviousScamPatterns.test(name);
}

/**
 * Check if external URL looks suspicious
 */
function isSuspiciousUrl(url: string): boolean {
  try {
    const parsedUrl = new URL(url);
    const hostname = parsedUrl.hostname.toLowerCase();

    // Check for suspicious domain patterns
    const suspiciousPatterns = [
      /jupiter.*claim/i,
      /solana.*drop/i,
      /crypto.*bonus/i,
      /.*-airdrop.*\.com/i,
      /.*claim.*\.site/i,
      /.*bonus.*\.xyz/i,
    ];

    return suspiciousPatterns.some((pattern) => pattern.test(hostname));
  } catch {
    // Invalid URL is suspicious
    return true;
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

  // Check known specific scam tokens
  const knownScamTokens = ['jup']; // Fake Jupiter from Solana - specific known scam
  if (knownScamTokens.includes(tokenSymbol.toLowerCase())) {
    return { isScam: true, reason: 'Known scam token' };
  }

  return { isScam: false, reason: '' };
}
