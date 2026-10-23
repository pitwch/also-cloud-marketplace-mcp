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

export async function alsoPost(endpoint: string, body: unknown = {}) {
  const client = getSharedClient();
  const result = await client.request({
    method: 'POST',
    endpoint,
    body: body ?? {},
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

/** Register a typed POST wrapper around an ALSO Simple API endpoint. */
export function registerAlsoPostTool<T extends z.ZodRawShape>(
  server: McpServer,
  name: string,
  config: {
    title: string;
    description: string;
    endpoint: string;
    inputSchema: z.ZodObject<T>;
    mapBody?: (args: z.infer<z.ZodObject<T>>) => unknown;
    annotations?: AlsoToolAnnotations;
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
          ? config.mapBody(args)
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

function stripUndefined(obj: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v !== undefined) out[k] = v;
  }
  return out;
}
