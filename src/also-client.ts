import { resolveMarketplace } from './marketplaces.js';

const DEFAULT_API_PREFIX = '/SimpleAPI/SimpleAPIService.svc/rest';
const DEFAULT_LOGIN = 'GetSessionToken';
/** Internal REST API of the ALSO web portal (undocumented); accepts the same CCPSessionId. */
const PORTAL_API_PREFIX = '/DataModel/service.svc/rest';
const USER_AGENT = 'also-cloud-marketplace-mcp/0.5.2';

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
  /** Overrides ALSO_CLOUD_TIMEOUT_MS for slow endpoints (e.g. large remote enum lists). */
  timeoutMs?: number;
  /** Call the portal API (endpoint like "IAccountService/CreateAccount") instead of the Simple API. */
  portal?: boolean;
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

function decodeXml(s: string): string {
  return s
    .replace(/&#xD;|&#13;/gi, '')
    .replace(/&#xA;|&#10;/gi, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

/**
 * Turn ALSO/WCF error bodies (XML <Fault> or JSON) into one readable line:
 * "API error (HTTP 500) on ValidateFields: <reason> [ALSO support token: …]".
 */
export function formatApiError(status: number, endpoint: string, body: string): string {
  let reason = '';
  const xmlText = body.match(/<(?:\w+:)?Text[^>]*>([\s\S]*?)<\/(?:\w+:)?Text>/);
  if (xmlText) reason = decodeXml(xmlText[1]!);
  if (!reason) {
    try {
      const j = JSON.parse(body) as Record<string, unknown>;
      const m = j.Message ?? j.message ?? j.ExceptionMessage ?? j.error;
      if (typeof m === 'string') reason = m;
    } catch {
      // not JSON
    }
  }
  if (!reason) reason = body.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 500);
  reason = reason.replace(/\s+/g, ' ').trim();
  const token =
    reason.match(/token as reference:\s*([0-9a-f-]{36})/i)?.[1] ??
    body.match(/<(?:\w+:)?IssueToken[^>]*>\s*([0-9a-f-]{36})/i)?.[1] ??
    body.match(/"IssueToken"\s*:\s*"([0-9a-f-]{36})"/i)?.[1];
  const generic = /something went wrong/i.test(reason);
  let msg = `API error (HTTP ${status}) on ${endpoint}: `;
  msg += generic
    ? 'ALSO returned a generic server error without details (often caused by missing/invalid input fields).'
    : reason;
  // Always give support something to reference: ALSO's token, or else the exact time.
  msg += token
    ? ` [ALSO support token: ${token}]`
    : ` [ALSO sent no support token; time ${new Date().toISOString()}]`;
  return msg;
}

/**
 * ALSO answers an expired or invalid CCPSessionId inconsistently: HTTP 401
 * "Session expired!" (PingPong, portal API) or HTTP 500 "Invalid SessionToken
 * or your session expired!" (most Simple API calls), with IsSessionExpired
 * often false. Detect it by status and message text.
 */
export function isSessionExpiredResponse(status: number, body: string): boolean {
  if (status === 401) return true;
  if (status < 400) return false;
  return (
    /<(?:\w+:)?IsSessionExpired>\s*true/i.test(body) ||
    /invalid\s*session\s*token|session\s+(?:has\s+)?expired|your session expired|session is not valid/i.test(body)
  );
}

export class AlsoCloudClient {
  private sessionToken: string | null = null;
  /** Shared login so parallel calls after an expiry log in only once. */
  private loginInFlight: Promise<string> | null = null;
  private readonly baseUrl: string;
  private readonly portalBaseUrl: string;
  private readonly timeoutMs: number;

  constructor(private readonly config: AlsoConfig) {
    const prefix = (config.apiPrefix ?? DEFAULT_API_PREFIX).replace(/\/+$/, '');
    this.baseUrl = `${config.marketplace.replace(/\/+$/, '')}${prefix}/`;
    this.portalBaseUrl = `${config.marketplace.replace(/\/+$/, '')}${PORTAL_API_PREFIX}/`;
    this.timeoutMs = config.timeoutMs ?? 30_000;
  }

  clearSession(): void {
    this.sessionToken = null;
  }

  async ensureSession(): Promise<string> {
    if (this.sessionToken) {
      return this.sessionToken;
    }
    this.loginInFlight ??= this.login().finally(() => {
      this.loginInFlight = null;
    });
    return this.loginInFlight;
  }

  private async login(): Promise<string> {
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
    let token = await this.ensureSession();
    let { res, text } = await this.send(options, token);

    // Expired / invalid session: log in again and retry once. Safe for writes too,
    // because ALSO rejects the call before executing it.
    if (isSessionExpiredResponse(res.status, text)) {
      if (this.sessionToken === token) this.sessionToken = null;
      token = await this.ensureSession();
      ({ res, text } = await this.send(options, token));
      if (isSessionExpiredResponse(res.status, text)) {
        this.sessionToken = null;
        throw new Error(
          `${formatApiError(res.status, options.endpoint, text)} (session was renewed automatically and the call retried once; check the API user / 2FA)`,
        );
      }
    }

    if (res.status < 200 || res.status >= 300) {
      throw new Error(formatApiError(res.status, options.endpoint, text));
    }

    const responseHeaders: Record<string, string> = {};
    res.headers.forEach((value, key) => {
      responseHeaders[key] = value;
    });

    return { status: res.status, headers: responseHeaders, body: text };
  }

  private async send(options: ApiRequestOptions, token: string): Promise<{ res: Response; text: string }> {
    const headers: Record<string, string> = {
      'User-Agent': USER_AGENT,
      Authenticate: `CCPSessionId ${token}`,
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
      timeoutMs: options.timeoutMs,
      portal: options.portal,
    });
    return { res, text: await res.text() };
  }

  private async fetchRaw(
    endpoint: string,
    init: {
      method: string;
      headers: Record<string, string>;
      body?: string;
      query?: Record<string, string>;
      auth: boolean;
      timeoutMs?: number;
      portal?: boolean;
    },
  ): Promise<Response> {
    const url = new URL(endpoint.replace(/^\//, ''), init.portal ? this.portalBaseUrl : this.baseUrl);
    if (init.query) {
      for (const [k, v] of Object.entries(init.query)) {
        url.searchParams.set(k, v);
      }
    }

    const controller = new AbortController();
    const timeoutMs = init.timeoutMs ?? this.timeoutMs;
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await fetch(url, {
        method: init.method,
        headers: init.headers,
        body: init.body,
        signal: controller.signal,
      });
    } catch (err) {
      if (controller.signal.aborted) {
        throw new Error(`Timeout after ${timeoutMs} ms on ${endpoint} (ALSO did not answer in time).`);
      }
      throw err;
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
