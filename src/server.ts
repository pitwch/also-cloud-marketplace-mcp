import { McpServer } from '@modelcontextprotocol/server';
import * as z from 'zod/v4';
import { getSharedClient } from './also-client.js';
import { MARKETPLACES } from './marketplaces.js';

function textResult(data: unknown, isError = false) {
  const text = typeof data === 'string' ? data : JSON.stringify(data, null, 2);
  return {
    content: [{ type: 'text' as const, text }],
    isError,
  };
}

export function createServer(): McpServer {
  const server = new McpServer({
    name: 'also-cloud-marketplace',
    version: '0.1.0',
  });

  server.registerTool(
    'list_marketplaces',
    {
      title: 'List marketplaces',
      description:
        'List known ALSO Cloud Marketplace country keys and base URLs. No credentials required.',
      inputSchema: z.object({}),
    },
    async () => textResult(MARKETPLACES),
  );

  server.registerTool(
    'validate_session',
    {
      title: 'Validate session',
      description:
        'Login if needed and ping the ALSO Cloud API (PingPong) to check whether the session is active.',
      inputSchema: z.object({}),
    },
    async () => {
      try {
        const client = getSharedClient();
        const ok = await client.validateSession();
        return textResult({ valid: ok });
      } catch (err) {
        return textResult(err instanceof Error ? err.message : String(err), true);
      }
    },
  );

  server.registerTool(
    'get_company',
    {
      title: 'Get company',
      description:
        'Call the GetCompany endpoint. Pass parentAccountId (and optional filters) as used by the Simple API.',
      inputSchema: z.object({
        parentAccountId: z
          .number()
          .int()
          .describe('Parent account ID on the ALSO Cloud marketplace'),
        extra: z
          .record(z.string(), z.unknown())
          .optional()
          .describe('Additional JSON fields to merge into the request body'),
      }),
    },
    async ({ parentAccountId, extra }) => {
      try {
        const client = getSharedClient();
        const result = await client.request({
          method: 'POST',
          endpoint: 'GetCompany',
          body: { parentAccountId, ...(extra ?? {}) },
        });
        return textResult({
          status: result.status,
          body: tryParseJson(result.body),
        });
      } catch (err) {
        return textResult(err instanceof Error ? err.message : String(err), true);
      }
    },
  );

  server.registerTool(
    'api_request',
    {
      title: 'API request',
      description:
        'Generic authenticated request against the ALSO Cloud Simple API (e.g. GetUser, GetSubscriptions). Prefer dedicated tools when available.',
      inputSchema: z.object({
        method: z
          .enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE'])
          .describe('HTTP method'),
        endpoint: z
          .string()
          .min(1)
          .describe('API endpoint name, e.g. GetCompany or GetUser'),
        body: z
          .unknown()
          .optional()
          .describe('JSON body for POST/PUT/PATCH/DELETE (object or array)'),
        query: z
          .record(z.string(), z.string())
          .optional()
          .describe('Optional query string parameters (mainly for GET)'),
      }),
    },
    async ({ method, endpoint, body, query }) => {
      try {
        const client = getSharedClient();
        const result = await client.request({
          method,
          endpoint,
          body: body ?? (method === 'GET' ? undefined : {}),
          query,
        });
        return textResult({
          status: result.status,
          body: tryParseJson(result.body),
        });
      } catch (err) {
        return textResult(err instanceof Error ? err.message : String(err), true);
      }
    },
  );

  server.registerTool(
    'clear_session',
    {
      title: 'Clear session',
      description:
        'Drop the cached session token so the next API call performs a fresh login.',
      inputSchema: z.object({}),
    },
    async () => {
      try {
        getSharedClient().clearSession();
        return textResult({ cleared: true });
      } catch (err) {
        return textResult(err instanceof Error ? err.message : String(err), true);
      }
    },
  );

  return server;
}

function tryParseJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}
