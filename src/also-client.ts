import { resolveMarketplace } from './marketplaces.js';

const DEFAULT_API_PREFIX = '/SimpleAPI/SimpleAPIService.svc/rest';
const DEFAULT_LOGIN = 'GetSessionToken';
const USER_AGENT = 'also-cloud-marketplace-mcp/0.1.0';

export type AlsoConfig = {
  marketplace: string;
  username: string;
  password: string;
  apiPrefix?: string;
  timeoutMs?: number;
};

export type ApiRequestOptions = {
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  endpoint: string;
  body?: unknown;
  query?: Record<string, string>;
};

export function loadConfigFromEnv(): AlsoConfig {
  const marketplaceRaw =
    process.env.ALSO_CLOUD_MARKETPLACE ??
    process.env.ALSO_MARKETPLACE ??
    '';
  const username =
    process.env.ALSO_CLOUDUSER ??
    process.env.ALSO_CLOUD_USER ??
    '';
  const password =
    process.env.ALSO_CLOUDPW ??
    process.env.ALSO_CLOUD_PASSWORD ??
    '';

  if (!marketplaceRaw || !username || !password) {
    throw new Error(
      'Missing credentials. Set ALSO_CLOUD_MARKETPLACE, ALSO_CLOUDUSER, and ALSO_CLOUDPW.',
    );
  }

  const timeoutRaw = process.env.ALSO_CLOUD_TIMEOUT_MS;
  return {
    marketplace: resolveMarketplace(marketplaceRaw),
    username,
    password,
    apiPrefix: process.env.ALSO_CLOUD_API_PREFIX || DEFAULT_API_PREFIX,
    timeoutMs: timeoutRaw ? Number(timeoutRaw) : 30_000,
  };
}

export class AlsoCloudClient {
  private sessionToken: string | null = null;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;

  constructor(private readonly config: AlsoConfig) {
    const prefix = (config.apiPrefix ?? DEFAULT_API_PREFIX).replace(/\/+$/, '');
    this.baseUrl = `${config.marketplace.replace(/\/+$/, '')}${prefix}/`;
    this.timeoutMs = config.timeoutMs ?? 30_000;
  }

  clearSession(): void {
    this.sessionToken = null;
  }

  async ensureSession(): Promise<string> {
    if (this.sessionToken) {
      return this.sessionToken;
    }

    const res = await this.fetchRaw(DEFAULT_LOGIN, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': USER_AGENT,
      },
      body: JSON.stringify({
        username: this.config.username,
        password: this.config.password,
      }),
      auth: false,
    });

    const text = (await res.text()).trim().replace(/^"|"$/g, '');
    if (!res.ok) {
      throw new Error(`Login failed (HTTP ${res.status}): ${text}`);
    }
    if (!text) {
      throw new Error('Login succeeded but session token was empty');
    }
    this.sessionToken = text;
    return text;
  }

  async validateSession(): Promise<boolean> {
    try {
      const { status, body } = await this.request({
        method: 'POST',
        endpoint: 'PingPong',
        body: {},
      });
      return status === 200 && body.trim() === 'null';
    } catch {
      this.sessionToken = null;
      return false;
    }
  }

  async request(options: ApiRequestOptions): Promise<{
    status: number;
    headers: Record<string, string>;
    body: string;
  }> {
    await this.ensureSession();

    const headers: Record<string, string> = {
      'User-Agent': USER_AGENT,
      Authenticate: `CCPSessionId ${this.sessionToken}`,
    };

    let body: string | undefined;
    if (options.body !== undefined && options.method !== 'GET') {
      headers['Content-Type'] = 'application/json';
      body = JSON.stringify(options.body ?? {});
    }

    const res = await this.fetchRaw(options.endpoint, {
      method: options.method,
      headers,
      body,
      query: options.query,
      auth: true,
    });

    const text = await res.text();
    if (res.status < 200 || res.status >= 300) {
      throw new Error(`API error (HTTP ${res.status}): ${text}`);
    }

    const responseHeaders: Record<string, string> = {};
    res.headers.forEach((value, key) => {
      responseHeaders[key] = value;
    });

    return { status: res.status, headers: responseHeaders, body: text };
  }

  private async fetchRaw(
    endpoint: string,
    init: {
      method: string;
      headers: Record<string, string>;
      body?: string;
      query?: Record<string, string>;
      auth: boolean;
    },
  ): Promise<Response> {
    const url = new URL(endpoint.replace(/^\//, ''), this.baseUrl);
    if (init.query) {
      for (const [k, v] of Object.entries(init.query)) {
        url.searchParams.set(k, v);
      }
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      return await fetch(url, {
        method: init.method,
        headers: init.headers,
        body: init.body,
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }
  }
}

let sharedClient: AlsoCloudClient | null = null;

export function getSharedClient(): AlsoCloudClient {
  if (!sharedClient) {
    sharedClient = new AlsoCloudClient(loadConfigFromEnv());
  }
  return sharedClient;
}
