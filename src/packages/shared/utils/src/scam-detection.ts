import { TransactionNote, TransactionNoteType } from '@crypto/core';

/**
 * Token metadata from DAS API for scam detection
 */
interface TokenMetadata {
  symbol: string;
  name: string;
  description?: string;
  image?: string;
  external_url?: string;
  attributes?: Array<{ trait_type: string; value: string }>;
}

/**
 * Detect if a token is likely a scam based on metadata patterns
 */
export function detectScamToken(
  mintAddress: string,
  metadata: TokenMetadata,
  transactionContext?: {
    amount: number;
    isAirdrop: boolean;
  }
): TransactionNote | null {
  const scamIndicators: string[] = [];
  let severity: 'warning' | 'error' = 'warning';

  // Check for emoji/gift indicators in name
  if (metadata.name && hasGiftEmojis(metadata.name)) {
    scamIndicators.push('Gift/drop emojis in token name');
    severity = 'error';
  }

  // Check for impersonation patterns
  const impersonationCheck = detectImpersonation(metadata.symbol, metadata.name);
  if (impersonationCheck.isImpersonation) {
    scamIndicators.push(`Impersonating ${impersonationCheck.targetProject}`);
    severity = 'error';
  }

  // Check for suspicious external URLs
  if (metadata.external_url && isSuspiciousUrl(metadata.external_url)) {
    scamIndicators.push('Suspicious external URL');
    severity = 'error';
  }

  // Check for year/date drop patterns
  if (metadata.name && hasYearDropPattern(metadata.name)) {
    scamIndicators.push('Suspicious year/drop pattern in name');
    severity = 'warning';
  }

  // Check for URLs or website patterns in token names
  if (metadata.name && hasUrlPattern(metadata.name)) {
    scamIndicators.push('Contains suspicious URL/website pattern');
    severity = 'error';
  }

  // Check transaction context for airdrop patterns
  if (transactionContext?.isAirdrop && transactionContext.amount > 0) {
    scamIndicators.push('Unsolicited airdrop');
    severity = 'warning';
  }

  // If we found scam indicators, create a note
  if (scamIndicators.length > 0) {
    const noteType = severity === 'error' ? TransactionNoteType.SCAM_TOKEN : TransactionNoteType.SUSPICIOUS_AIRDROP;
    
    return {
      type: noteType,
      message: `⚠️ ${severity === 'error' ? 'Scam token detected' : 'Suspicious token'}: ${scamIndicators.join(', ')}`,
      severity,
      metadata: {
        mintAddress,
        tokenSymbol: metadata.symbol,
        tokenName: metadata.name,
        indicators: scamIndicators,
        externalUrl: metadata.external_url
      }
    };
  }

  return null;
}

/**
 * Check if token name contains gift/drop emojis commonly used in scams
 */
function hasGiftEmojis(name: string): boolean {
  const giftEmojis = /[🎁🎉🎊💰💎⭐✨🔥🚀]/;
  return giftEmojis.test(name);
}

/**
 * Detect if token is impersonating known projects
 */
function detectImpersonation(symbol: string, name: string): { isImpersonation: boolean; targetProject?: string } {
  const knownProjects = [
    { symbols: ['jup'], names: ['jupiter'], project: 'Jupiter Exchange' },
    { symbols: ['sol'], names: ['solana'], project: 'Solana' },
    { symbols: ['ray'], names: ['raydium'], project: 'Raydium' },
    { symbols: ['srm'], names: ['serum'], project: 'Serum' },
    { symbols: ['orca'], names: ['orca'], project: 'Orca' },
    { symbols: ['mngo'], names: ['mango'], project: 'Mango Markets' },
  ];

  const lowerSymbol = symbol.toLowerCase();
  const lowerName = name.toLowerCase();

  for (const project of knownProjects) {
    // Check if symbol matches but name suggests it's fake
    if (project.symbols.includes(lowerSymbol)) {
      // If name contains suspicious patterns, it's likely impersonation
      if (hasYearDropPattern(name) || hasGiftEmojis(name)) {
        return { isImpersonation: true, targetProject: project.project };
      }
    }

    // Check if name contains project name but has suspicious additions
    const hasProjectName = project.names.some(projName => lowerName.includes(projName));
    if (hasProjectName && (hasYearDropPattern(name) || hasGiftEmojis(name))) {
      return { isImpersonation: true, targetProject: project.project };
    }
  }

  return { isImpersonation: false };
}

/**
 * Check for suspicious year/drop patterns in token names
 */
function hasYearDropPattern(name: string): boolean {
  const yearDropPatterns = /\b(202[3-9]|drop|airdrop|claim|bonus|reward|visit|free|prize|win)\b/i;
  return yearDropPatterns.test(name);
}

/**
 * Check if token name contains URL or website patterns (common in scam tokens)
 */
function hasUrlPattern(name: string): boolean {
  const urlPatterns = /\b(www\.|\.com|\.net|\.org|\.io|\.app|\.xyz|token-|claim-|visit |go to )/i;
  return urlPatterns.test(name);
}

/**
 * Check for very obvious scam phrases (conservative - only extremely obvious ones)
 */
function hasObviousScamPhrases(name: string): boolean {
  const obviousScamPatterns = /\b(visit.*to.*claim|go.*to.*claim|click.*to.*claim|free.*airdrop.*claim|claim.*your.*reward)\b/i;
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

    return suspiciousPatterns.some(pattern => pattern.test(hostname));
  } catch {
    // Invalid URL is suspicious
    return true;
  }
}

/**
 * Check if a transaction appears to be an unsolicited airdrop
 */
export function isUnsolicitedAirdrop(
  transactionType: string,
  amount: number,
  tokenSymbol: string,
  userInitiated: boolean = false
): boolean {
  // If user didn't initiate the transaction and received tokens, it's likely an airdrop
  return (
    !userInitiated &&
    transactionType === 'deposit' &&
    amount > 0 &&
    !isKnownLegitimateToken(tokenSymbol)
  );
}

/**
 * Detect scam patterns directly from token symbol (for cases where we don't have full metadata)
 * CONSERVATIVE approach - only flag extremely obvious scams
 */
export function detectScamFromSymbol(tokenSymbol: string): { isScam: boolean; reason: string } {
  // Check for URL patterns in token symbol (very obvious scam pattern)
  if (hasUrlPattern(tokenSymbol)) {
    return { isScam: true, reason: 'Contains suspicious URL/website pattern' };
  }

  // Check for very obvious scam phrases (not individual words like "claim" but full suspicious phrases)
  if (hasObviousScamPhrases(tokenSymbol)) {
    return { isScam: true, reason: 'Contains obvious scam phrases' };
  }

  // Check for gift emojis (legitimate tokens don't typically have these)
  if (hasGiftEmojis(tokenSymbol)) {
    return { isScam: true, reason: 'Contains gift/reward emojis' };
  }

  // Check known specific scam tokens
  const knownScamTokens = ['jup']; // Fake Jupiter from Solana - specific known scam
  if (knownScamTokens.includes(tokenSymbol.toLowerCase())) {
    return { isScam: true, reason: 'Known scam token' };
  }

  return { isScam: false, reason: '' };
}

/**
 * Check if a token symbol is from a known legitimate project
 */
function isKnownLegitimateToken(symbol: string): boolean {
  const legitimateTokens = [
    'SOL', 'USDC', 'USDT', 'BTC', 'ETH',
    'RAY', 'SRM', 'ORCA', 'MNGO', 'STEP',
    'RENDER', 'HNT', 'BONK', 'JTO', 'PYTH'
  ];
  
  return legitimateTokens.includes(symbol.toUpperCase());
}