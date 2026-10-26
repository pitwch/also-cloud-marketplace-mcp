import type { McpServer } from '@modelcontextprotocol/server';
import * as z from 'zod/v4';
import { alsoPost, textResult } from './tools-helpers.js';
import {
  filterCompaniesByName,
  summarizeCompany,
  summarizeSubscriptions,
} from './summarize.js';

function defaultParentAccountId(): number | undefined {
  const raw =
    process.env.ALSO_CLOUD_PARENT_ACCOUNT_ID ??
    process.env.ALSO_PARENT_ACCOUNT_ID ??
    '';
  if (!raw) return undefined;
  const n = Number(raw);
  return Number.isFinite(n) ? n : undefined;
}

/**
 * High-level tools that encode the usual ALSO workflows so models
 * do not wander through reports / marketplaces / raw Field dumps.
 */
export function registerWorkflowTools(server: McpServer): void {
  server.registerTool(
    'find_companies',
    {
      title: 'Find companies by name',
      description:
        'PREFERRED for locating a company by name. Calls GetCompanies under parentAccountId (or ALSO_CLOUD_PARENT_ACCOUNT_ID) and filters by CompanyName. Do NOT use get_reports / execute_report to search companies.',
      inputSchema: z.object({
        name: z
          .string()
          .min(1)
          .describe('Company name fragment, e.g. "Hosch" or "Hosch AG"'),
        parentAccountId: z
          .number()
          .int()
          .optional()
          .describe(
            'Parent account that owns the companies. Defaults to ALSO_CLOUD_PARENT_ACCOUNT_ID env.',
          ),
      }),
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async ({ name, parentAccountId }) => {
      try {
        const parent = parentAccountId ?? defaultParentAccountId();
        if (parent == null) {
          return textResult(
            'parentAccountId is required (or set ALSO_CLOUD_PARENT_ACCOUNT_ID). This is usually your reseller/company parent account that lists end-customer companies.',
            true,
          );
        }
        const res = await alsoPost('GetCompanies', { parentAccountId: parent });
        const matches = filterCompaniesByName(res.body, name);
        return textResult({
          parentAccountId: parent,
          query: name,
          count: matches.length,
          companies: matches,
        });
      } catch (err) {
        return textResult(err instanceof Error ? err.message : String(err), true);
      }
    },
  );

  server.registerTool(
    'list_company_subscriptions',
    {
      title: 'List company subscriptions (compact)',
      description:
        'PREFERRED for "which subscriptions does company X have?". Resolves company by accountId or name (via find_companies), then GetSubscriptions. Returns a compact summary (no huge Fields arrays). Use activeOnly=true (default) for active services only.',
      inputSchema: z.object({
        accountId: z
          .number()
          .int()
          .optional()
          .describe('Company Account ID if already known'),
        companyName: z
          .string()
          .min(1)
          .optional()
          .describe('Company name to search when accountId is unknown'),
        parentAccountId: z
          .number()
          .int()
          .optional()
          .describe('Parent for name search; defaults to ALSO_CLOUD_PARENT_ACCOUNT_ID'),
        activeOnly: z
          .boolean()
          .optional()
          .default(true)
          .describe('Only return subscriptions with AccountState Active'),
        excludeUserLevel: z.boolean().optional(),
      }),
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async ({
      accountId,
      companyName,
      parentAccountId,
      activeOnly = true,
      excludeUserLevel,
    }) => {
      try {
        let companyAccountId = accountId;
        let company: unknown;

        if (companyAccountId == null) {
          if (!companyName) {
            return textResult('Provide accountId or companyName.', true);
          }
          const parent = parentAccountId ?? defaultParentAccountId();
          if (parent == null) {
            return textResult(
              'parentAccountId is required for name search (or set ALSO_CLOUD_PARENT_ACCOUNT_ID).',
              true,
            );
          }
          const list = await alsoPost('GetCompanies', { parentAccountId: parent });
          const matches = filterCompaniesByName(list.body, companyName);
          if (matches.length === 0) {
            return textResult({
              query: companyName,
              parentAccountId: parent,
              count: 0,
              companies: [],
              message: 'No company matched. Try a shorter name fragment.',
            });
          }
          if (matches.length > 1) {
            return textResult({
              query: companyName,
              parentAccountId: parent,
              count: matches.length,
              companies: matches,
              message:
                'Multiple companies matched. Re-call with accountId of the correct company.',
            });
          }
          company = matches[0];
          companyAccountId = Number(
            (matches[0] as { accountId?: number }).accountId,
          );
        } else {
          const c = await alsoPost('GetCompany', { accountId: companyAccountId });
          company = summarizeCompany(c.body);
        }

        const body: Record<string, unknown> = {
          parentAccountId: companyAccountId,
        };
        if (excludeUserLevel !== undefined) body.excludeUserLevel = excludeUserLevel;

        const subs = await alsoPost('GetSubscriptions', body);
        const subscriptions = summarizeSubscriptions(subs.body, activeOnly);

        return textResult({
          company,
          activeOnly,
          count: subscriptions.length,
          subscriptions,
        });
      } catch (err) {
        return textResult(err instanceof Error ? err.message : String(err), true);
      }
    },
  );
}
