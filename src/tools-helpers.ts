import type { McpServer } from '@modelcontextprotocol/server';
import * as z from 'zod/v4';
import { getSharedClient } from './also-client.js';

export function textResult(data: unknown, isError = false) {
  const text = typeof data === 'string' ? data : JSON.stringify(data, null, 2);
  return {
    content: [{ type: 'text' as const, text }],
    isError,
  };
}

export function tryParseJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

export async function alsoPost(endpoint: string, body: unknown = {}, timeoutMs?: number) {
  const client = getSharedClient();
  const result = await client.request({
    method: 'POST',
    endpoint,
    body: body ?? {},
    timeoutMs,
  });
  return {
    status: result.status,
    body: tryParseJson(result.body),
  };
}

export type AlsoToolAnnotations = {
  title?: string;
  readOnlyHint?: boolean;
  destructiveHint?: boolean;
  idempotentHint?: boolean;
  openWorldHint?: boolean;
};

/** Read-only call against the ALSO API. */
export const READ_ONLY = { readOnlyHint: true, openWorldHint: true } as const;
/** Read-only, no external call (static data / local session state). */
export const LOCAL_READ_ONLY = { readOnlyHint: true, openWorldHint: false } as const;
/** Creates something new; nothing existing is overwritten. */
export const WRITE_CREATE = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: false,
  openWorldHint: true,
} as const;
/** Overwrites existing values; repeating the same call has no further effect. */
export const WRITE_UPDATE = {
  readOnlyHint: false,
  destructiveHint: true,
  idempotentHint: true,
  openWorldHint: true,
} as const;
/** Triggers an irreversible business action (provisioning, approval, billing). */
export const WRITE_IRREVERSIBLE = {
  readOnlyHint: false,
  destructiveHint: true,
  idempotentHint: false,
  openWorldHint: true,
} as const;

/** Register a typed POST wrapper around an ALSO Simple API endpoint. */
export function registerAlsoPostTool<T extends z.ZodRawShape>(
  server: McpServer,
  name: string,
  config: {
    title: string;
    description: string;
    endpoint: string;
    inputSchema: z.ZodObject<T>;
    mapBody?: (args: z.infer<z.ZodObject<T>>) => unknown | Promise<unknown>;
    /** Required so every tool is flagged read-only / write in MCP clients. */
    annotations: AlsoToolAnnotations;
  },
) {
  server.registerTool(
    name,
    {
      title: config.title,
      description: config.description,
      inputSchema: config.inputSchema,
      annotations: config.annotations,
    },
    async (args) => {
      try {
        const body = config.mapBody
          ? await config.mapBody(args)
          : stripUndefined(args as Record<string, unknown>);
        return textResult(await alsoPost(config.endpoint, body));
      } catch (err) {
        return textResult(err instanceof Error ? err.message : String(err), true);
      }
    },
  );
}

/** Flexible JSON object field for nested ALSO API payloads. */
export const jsonObject = z
  .record(z.string(), z.unknown())
  .describe('JSON object as required by the ALSO Simple API');

export function stripUndefined(obj: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v !== undefined) out[k] = v;
  }
  return out;
}
