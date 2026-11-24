import { resolveMarketplace } from './marketplaces.js';
import { VERSION } from './version.js';

const DEFAULT_API_PREFIX = '/SimpleAPI/SimpleAPIService.svc/rest';
const DEFAULT_LOGIN = 'GetSessionToken';
/** Internal REST API of the ALSO web portal (undocumented); accepts the same CCPSessionId. */
const PORTAL_API_PREFIX = '/DataModel/service.svc/rest';
const USER_AGENT = `also-cloud-marketplace-mcp/${VERSION}`;

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

/** Context of one failed call, for the support details in the error message. */
export type ApiErrorContext = {
  /** ID the MCP generated and sent as X-Request-ID (ALSO does not return one of its own). */
  requestId?: string;
  /** ALSO's Date response header (server time of the failure). */
  serverDate?: string | null;
  /** Request body; only AccountId, ServiceName and field names are taken from it. */
  requestBody?: unknown;
};

function swissTime(d: Date): string {
  try {
    return d.toLocaleString('de-CH', { timeZone: 'Europe/Zurich', hour12: false });
  } catch {
    return d.toISOString();
  }
}

/** Non-sensitive identifiers of the request (no field values, no passwords). */
function requestRefs(body: unknown): string[] {
  if (!body || typeof body !== 'object') return [];
  const refs: string[] = [];
  const seen = new Set<string>();
  const visit = (o: Record<string, unknown>, depth: number) => {
    for (const [k, v] of Object.entries(o)) {
      const key = k.toLowerCase();
      if ((key === 'accountid' || key === 'parentaccountid') && (typeof v === 'number' || typeof v === 'string')) {
        const s = `${k}: ${v}`;
        if (!seen.has(s)) refs.push(s), seen.add(s);
      } else if (key === 'servicename' && typeof v === 'string') {
        const s = `ServiceName: ${v}`;
        if (!seen.has(s)) refs.push(s), seen.add(s);
      } else if (key === 'fields' && v) {
        const names = Array.isArray(v)
          ? v.map((f) => (f && typeof f === 'object' ? (f as Record<string, unknown>).name ?? (f as Record<string, unknown>).Name : undefined)).filter((n) => typeof n === 'string')
          : typeof v === 'object' ? Object.keys(v) : [];
        if (names.length) refs.push(`fields: ${names.join(', ')}`);
      } else if (v && typeof v === 'object' && !Array.isArray(v) && depth < 2) {
        visit(v as Record<string, unknown>, depth + 1);
      }
    }
  };
  visit(body as Record<string, unknown>, 0);
  return refs;
}

/** Get…, Search… and List… calls only read; everything else may change data. */
function isReadEndpoint(endpoint: string): boolean {
  return /^(Get|Search|List|PingPong)/i.test(endpoint.split('/').pop() ?? endpoint);
}

/** What the user can do next, for ALSO-side failures the MCP cannot fix itself. */
function errorHint(status: number, endpoint: string, reason: string): string | undefined {
  if (status < 500) return undefined;
  const write = !isReadEndpoint(endpoint);
  if (/couldn'?t validate fields/i.test(reason) && /unhandled exception/i.test(reason)) {
    return 'ALSO failed internally while validating the fields, so the request was not executed (nothing changed or ordered). This is an ALSO-side error, often transient: retry once in a few minutes; if it recurs, make the change in the ALSO portal or send the support details that follow to ALSO support.';
  }
  if (/unhandled exception|please contact support|internal server error/i.test(reason)) {
    return write
      ? 'ALSO-side error. Before retrying, check with get_subscription / get_company whether the change was applied anyway. If it recurs, use the ALSO portal or send the support details that follow to ALSO support.'
      : 'ALSO-side error, often transient: retry once in a few minutes; if it recurs, send the support details that follow to ALSO support.';
  }
  return undefined;
}

/**
 * Turn ALSO/WCF error bodies (XML <Fault> or JSON) into one readable line:
 * "API error (HTTP 500) on ValidateFields: <reason> [ALSO support token: …]".
 * Without an ALSO token it adds support details (server time, request refs,
 * the MCP request ID) so ALSO support can find the call in their logs.
 */
export function formatApiError(status: number, endpoint: string, body: string, ctx: ApiErrorContext = {}): string {
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
  const hint = errorHint(status, endpoint, reason);
  if (hint) msg += ` Hint: ${hint}`;

  // Always give support something to reference: ALSO's token, or else the call details.
  const parsedDate = ctx.serverDate ? new Date(ctx.serverDate) : null;
  const when = parsedDate && !Number.isNaN(parsedDate.getTime()) ? parsedDate : new Date();
  const faultCode = body.match(/<(?:\w+:)?Code>\s*<(?:\w+:)?Value>([^<]+)</)?.[1]?.trim();
  const details = [
    token ? `ALSO support token: ${token}` : 'ALSO returned no support token',
    `endpoint: ${endpoint}`,
    `HTTP ${status}${faultCode ? ` (fault code ${faultCode})` : ''}`,
    `${ctx.serverDate ? 'ALSO server time' : 'time'}: ${when.toISOString().replace('T', ' ').replace(/\.\d+Z$/, ' UTC')} (${swissTime(when)} Swiss time)`,
    ...requestRefs(ctx.requestBody),
    ...(ctx.requestId ? [`MCP request ID: ${ctx.requestId} (sent to ALSO as X-Request-ID)`] : []),
  ];
  msg += ` [Support details — ${details.join(' | ')}]`;
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
    // ALSO returns no request ID of its own, so tag every call with one for support / logs.
    const requestId = crypto.randomUUID();
    const errorCtx = (r: Response): ApiErrorContext => ({
      requestId,
      serverDate: r.headers.get('date'),
      requestBody: options.body,
    });
    const logFailure = (r: Response) =>
      console.error(`[also] ${options.endpoint} HTTP ${r.status} request ${requestId} at ${new Date().toISOString()}`);

    let token = await this.ensureSession();
    let { res, text } = await this.send(options, token, requestId);

    // Expired / invalid session: log in again and retry once. Safe for writes too,
    // because ALSO rejects the call before executing it.
    if (isSessionExpiredResponse(res.status, text)) {
      if (this.sessionToken === token) this.sessionToken = null;
      token = await this.ensureSession();
      ({ res, text } = await this.send(options, token, requestId));
      if (isSessionExpiredResponse(res.status, text)) {
        this.sessionToken = null;
        logFailure(res);
        throw new Error(
          `${formatApiError(res.status, options.endpoint, text, errorCtx(res))} (session was renewed automatically and the call retried once; check the API user / 2FA)`,
        );
      }
    }

    if (res.status < 200 || res.status >= 300) {
      logFailure(res);
      throw new Error(formatApiError(res.status, options.endpoint, text, errorCtx(res)));
    }

    const responseHeaders: Record<string, string> = {};
    res.headers.forEach((value, key) => {
      responseHeaders[key] = value;
    });

    return { status: res.status, headers: responseHeaders, body: text };
  }

  private async send(
    options: ApiRequestOptions,
    token: string,
    requestId: string,
  ): Promise<{ res: Response; text: string }> {
    const headers: Record<string, string> = {
      'User-Agent': USER_AGENT,
      Authenticate: `CCPSessionId ${token}`,
      'X-Request-ID': requestId,
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
        const write = init.method !== 'GET' && !isReadEndpoint(endpoint);
        throw new Error(
          `Timeout after ${timeoutMs} ms on ${endpoint} (ALSO did not answer in time; time ${new Date().toISOString()}` +
            `${init.headers['X-Request-ID'] ? `, MCP request ID ${init.headers['X-Request-ID']}` : ''}).` +
            (write ? ' ALSO may still have processed the request: check the current state before retrying.' : ''),
        );
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
