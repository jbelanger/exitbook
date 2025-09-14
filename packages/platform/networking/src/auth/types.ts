export interface ApiKeyAuthConfig {
  apiKey: string;
  headerName?: string | undefined; // defaults to 'Authorization'
  prefix?: string | undefined; // defaults to 'Bearer'
}

export type MessageBuilder = (params: {
  body?: string | undefined;
  method: string;
  path: string;
  timestamp: number;
}) => string;

export interface HmacAuthConfig {
  algorithm?: 'sha256' | 'sha512' | undefined; // defaults to 'sha256'
  apiKey: string;
  messageBuilder?: MessageBuilder | undefined;
  secret: string;
}

export interface JwtAuthConfig {
  algorithm?: 'HS256' | 'HS384' | 'HS512' | undefined; // defaults to 'HS256'
  expiresIn?: string | undefined; // defaults to '1h'
  secret: string;
}

export type AuthConfig =
  | { config: ApiKeyAuthConfig; type: 'api-key' }
  | { config: HmacAuthConfig; type: 'hmac' }
  | { config: JwtAuthConfig; type: 'jwt' }
  | { type: 'none' };
