import * as crypto from 'node:crypto';

import jwt from 'jsonwebtoken';

import type { ApiKeyAuthConfig, HmacAuthConfig, JwtAuthConfig } from './types.js';

export class AuthHelpers {
  static createApiKeyHeaders(config: ApiKeyAuthConfig): Record<string, string> {
    const headerName = config.headerName || 'Authorization';
    const prefix = config.prefix || 'Bearer';
    return {
      [headerName]: `${prefix} ${config.apiKey}`,
    };
  }

  static createHmacSignature(
    config: HmacAuthConfig,
    method: string,
    path: string,
    body?: string,
    timestamp?: number,
  ): { headers: Record<string, string>; signature: string } {
    const ts = timestamp || Date.now();
    const algorithm = config.algorithm || 'sha256';

    const message = `${method.toUpperCase()}${path}${body || ''}${ts}`;
    const signature = crypto.createHmac(algorithm, config.secret).update(message).digest('hex');

    return {
      headers: {
        'X-API-KEY': config.apiKey,
        'X-SIGNATURE': signature,
        'X-TIMESTAMP': ts.toString(),
      },
      signature,
    };
  }

  static createJwtToken(config: JwtAuthConfig, payload: Record<string, unknown>): string {
    const options: jwt.SignOptions = {
      algorithm: (config.algorithm || 'HS256') as jwt.Algorithm,
      expiresIn: (config.expiresIn || '1h') as jwt.SignOptions['expiresIn'],
    };

    return jwt.sign(payload, config.secret, options);
  }

  static verifyJwtToken(token: string, secret: string): Record<string, unknown> | null {
    try {
      return jwt.verify(token, secret) as Record<string, unknown>;
    } catch {
      return null;
    }
  }

  static sanitizeUrl(url: string): string {
    const urlObj = new URL(url);

    // Remove sensitive query parameters from logs
    const sensitiveParams = ['token', 'key', 'apikey', 'api_key', 'secret', 'password'];

    for (const param of sensitiveParams) {
      if (urlObj.searchParams.has(param)) {
        urlObj.searchParams.set(param, '***');
      }
    }

    return urlObj.toString();
  }
}
