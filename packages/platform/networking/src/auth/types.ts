export interface ApiKeyAuthConfig {
  apiKey: string;
  headerName?: string | undefined; // defaults to 'Authorization'
  prefix?: string | undefined; // defaults to 'Bearer'
}

export interface HmacAuthConfig {
  algorithm?: 'sha256' | 'sha512' | undefined; // defaults to 'sha256'
  apiKey: string;
  secret: string;
}

export interface JwtAuthConfig {
  algorithm?: string | undefined; // defaults to 'HS256'
  expiresIn?: string | undefined; // defaults to '1h'
  secret: string;
}

export type AuthConfig =
  | { config: ApiKeyAuthConfig; type: 'api-key' }
  | { config: HmacAuthConfig; type: 'hmac' }
  | { config: JwtAuthConfig; type: 'jwt' }
  | { type: 'none' };
