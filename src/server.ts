import { McpServer } from '@modelcontextprotocol/server';
import * as z from 'zod/v4';
import {
  requireParentAccountId,
  resolveParentAccountId,
  withParent,
} from './account-context.js';
import { API_CATALOG } from './api-catalog.js';
import { getSharedClient } from './also-client.js';
import { SERVER_INSTRUCTIONS } from './instructions.js';
import { MARKETPLACES } from './marketplaces.js';
import {
  redactSecrets,
  summarizeCompany,
  summarizeSubscription,
  summarizeSubscriptions,
} from './summarize.js';
import {
  alsoPost,
  LOCAL_READ_ONLY,
  READ_ONLY,
  registerAlsoPostTool,
  textResult,
  tryParseJson,
  WRITE_IRREVERSIBLE,
} from './tools-helpers.js';
import { registerRemoteEnumTools } from './remote-enums.js';
import { registerWorkflowTools } from './workflow-tools.js';
import { registerWriteTools } from './write-tools.js';

const accountId = z.number().int().describe('ALSO Cloud Account ID');
const parentAccountId = z
  .number()
  .int()
  .optional()
  .describe(
    'Parent Account ID. Optional: defaults to ALSO_CLOUD_PARENT_ACCOUNT_ID or the auto-detected own account (see get_my_account).',
  );
const resellerContext = z
  .number()
  .int()
  .optional()
  .describe('Optional reseller context Account ID (omit if unused)');
/** Opt-in only — omit or false keeps compact summaries (avoids huge Fields dumps). */
const fullDetailFlag = z
  .boolean()
  .optional()
  .default(false)
  .describe(
    'If true, return the raw API payload (Fields/PriceableItems). Default false = compact summary. Secrets like InitialPassword are redacted.',
  );

/** Endpoints api_read may call: read-only by ALSO naming convention. */
const READ_ENDPOINT_RE = /^(?!GetSessionToken$)(Get|List)[A-Za-z0-9]+$/;

let reportNamesCache: { names: string[]; at: number } | null = null;
const REPORT_CACHE_MS = 10 * 60_000;

/** Report names from GetReports (accepts string[] or objects with a name-like key). */
export function extractReportNames(body: unknown): string[] {
  const arr = Array.isArray(body) ? body : [];
  const names = arr
    .map((r) => {
      if (typeof r === 'string') return r;
      if (r && typeof r === 'object') {
        const o = r as Record<string, unknown>;
        const v = o.ReportName ?? o.Name ?? o.name ?? o.DisplayName;
        return typeof v === 'string' ? v : undefined;
      }
      return undefined;
    })
    .filter((n): n is string => Boolean(n));
  return [...new Set(names)];
}

async function getReportNames(): Promise<string[]> {
  if (reportNamesCache && Date.now() - reportNamesCache.at < REPORT_CACHE_MS) {
    return reportNamesCache.names;
  }
  const res = await alsoPost('GetReports', {});
  const names = extractReportNames(res.body);
  reportNamesCache = { names, at: Date.now() };
  return names;
}

/** Rank valid names by shared lowercase tokens / substring with the query. */
export function suggestNames(query: string, valid: string[], max = 5): string[] {
  const tokens = query.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  return valid
    .map((n) => {
      const l = n.toLowerCase();
      let score = tokens.filter((t) => l.includes(t)).length;
      if (l.includes(query.toLowerCase()) || query.toLowerCase().includes(l)) score += 3;
      return { n, score };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, max)
    .map((x) => x.n);
}

export function createServer(): McpServer {
  const server = new McpServer(
    {
      name: 'also-cloud-marketplace',
      version: '0.3.0',
    },
    { instructions: SERVER_INSTRUCTIONS },
  );

  // --- Meta / session ---

  server.registerTool(
    'list_marketplaces',
    {
      title: 'List country marketplace URLs',
      description:
        'Static country keys → marketplace base URLs (Switzerland, Germany, Debug, …). No credentials required. For API-owned marketplaces use get_owned_marketplaces.',
      annotations: LOCAL_READ_ONLY,
      inputSchema: z.object({}),
    },
    async () => textResult(MARKETPLACES),
  );

  server.registerTool(
    'list_api_endpoints',
    {
      title: 'List Simple API endpoints',
      description:
        'Catalog of MarketplaceSimpleAPI 1.0.0 endpoints with tags, summaries, dedicated MCP tool names (if any), and write/destructive risk flags.',
      annotations: LOCAL_READ_ONLY,
      inputSchema: z.object({
        tag: z.string().optional().describe('Filter by tag, e.g. Company, Subscription'),
        onlyReadable: z
          .boolean()
          .optional()
          .describe('If true, exclude write/destructive endpoints'),
      }),
    },
    async ({ tag, onlyReadable }) => {
      let items = API_CATALOG;
      if (tag) {
        const t = tag.toLowerCase();
        items = items.filter((i) => i.tag.toLowerCase().includes(t));
      }
      if (onlyReadable) {
        items = items.filter((i) => !i.risk);
      }
      return textResult(items);
    },
  );

  server.registerTool(
    'validate_session',
    {
      title: 'Validate session',
      description:
        'Optional health check (PingPong). Login is automatic on other tools — do not call this before every query.',
      annotations: READ_ONLY,
      inputSchema: z.object({}),
    },
    async () => {
      try {
        const ok = await getSharedClient().validateSession();
        return textResult({ valid: ok });
      } catch (err) {
        return textResult(err instanceof Error ? err.message : String(err), true);
      }
    },
  );

  server.registerTool(
    'get_my_account',
    {
      title: 'Get my account (default parent)',
      description:
        'Returns the own account of the API user: the parentAccountId all other tools use by default, its source (env or auto-detected) and the company/reseller name. Use for: "what is my parentAccountId / account?" Call this first if a tool complains about a missing parentAccountId.',
      inputSchema: z.object({}),
      annotations: READ_ONLY,
    },
    async () => {
      try {
        const resolved = await resolveParentAccountId();
        if (!resolved) {
          return textResult(
            {
              accountId: null,
              message:
                'Auto-detection via GetSecurityRoles / GetLatestInvoices found no AccountId. Set ALSO_CLOUD_PARENT_ACCOUNT_ID on the server or pass parentAccountId explicitly.',
            },
            true,
          );
        }
        let account: unknown = null;
        let accountType: 'company' | 'reseller' | 'unknown' = 'unknown';
        for (const [type, endpoint] of [
          ['reseller', 'GetReseller'],
          ['company', 'GetCompany'],
        ] as const) {
          try {
            const res = await alsoPost(endpoint, { accountId: resolved.accountId });
            if (res.body && typeof res.body === 'object') {
              account = summarizeCompany(res.body);
              accountType = type;
              break;
            }
          } catch {
            // try next account type
          }
        }
        return textResult({
          accountId: resolved.accountId,
          source: resolved.source,
          accountType,
          account,
        });
      } catch (err) {
        return textResult(err instanceof Error ? err.message : String(err), true);
      }
    },
  );

  // High-level workflows first in registration order for discovery
  registerWorkflowTools(server);

  server.registerTool(
    'clear_session',
    {
      title: 'Clear session',
      description: 'Drop the cached session token (forces fresh login on next call).',
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
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

  // --- Company / Reseller / Department / User ---

  registerAlsoPostTool(server, 'get_company', {
    title: 'Get company',
    annotations: READ_ONLY,
    description: 'GetCompany — company by accountId.',
    endpoint: 'GetCompany',
    inputSchema: z.object({ accountId }),
  });

  registerAlsoPostTool(server, 'get_companies', {
    title: 'Get companies',
    annotations: READ_ONLY,
    description:
      'GetCompanies — all first-level companies under parentAccountId. To search by name prefer find_companies.',
    endpoint: 'GetCompanies',
    inputSchema: z.object({ parentAccountId }),
    mapBody: withParent,
  });

  registerAlsoPostTool(server, 'get_company_by_vat_id', {
    title: 'Get company by VAT ID',
    annotations: READ_ONLY,
    description: 'GetCompanyByVatId.',
    endpoint: 'GetCompanyByVatId',
    inputSchema: z.object({
      vatId: z.string().min(1).describe('VAT / UID number'),
    }),
  });

  registerAlsoPostTool(server, 'get_reseller', {
    title: 'Get reseller',
    annotations: READ_ONLY,
    description: 'GetReseller — reseller by accountId.',
    endpoint: 'GetReseller',
    inputSchema: z.object({ accountId }),
  });

  registerAlsoPostTool(server, 'get_resellers', {
    title: 'Get resellers',
    annotations: READ_ONLY,
    description: 'GetResellers — resellers under parentAccountId.',
    endpoint: 'GetResellers',
    inputSchema: z.object({ parentAccountId }),
    mapBody: withParent,
  });

  registerAlsoPostTool(server, 'get_reseller_by_vat_id', {
    title: 'Get reseller by VAT ID',
    annotations: READ_ONLY,
    description: 'GetResellerByVatId.',
    endpoint: 'GetResellerByVatId',
    inputSchema: z.object({
      vatId: z.string().min(1).describe('VAT / UID number'),
    }),
  });

  registerAlsoPostTool(server, 'get_department', {
    title: 'Get department',
    annotations: READ_ONLY,
    description: 'GetDepartment — department by accountId.',
    endpoint: 'GetDepartment',
    inputSchema: z.object({ accountId }),
  });

  registerAlsoPostTool(server, 'get_departments', {
    title: 'Get departments',
    annotations: READ_ONLY,
    description: 'GetDepartments — departments under parentAccountId.',
    endpoint: 'GetDepartments',
    inputSchema: z.object({ parentAccountId }),
    mapBody: withParent,
  });

  registerAlsoPostTool(server, 'get_user', {
    title: 'Get user',
    annotations: READ_ONLY,
    description: 'GetUser — user by accountId.',
    endpoint: 'GetUser',
    inputSchema: z.object({ accountId }),
  });

  registerAlsoPostTool(server, 'get_users', {
    title: 'Get users',
    annotations: READ_ONLY,
    description: 'GetUsers — users under companyAccountId.',
    endpoint: 'GetUsers',
    inputSchema: z.object({
      companyAccountId: z.number().int().describe('Company Account ID'),
    }),
  });

  // --- Subscriptions ---

  server.registerTool(
    'get_subscription',
    {
      title: 'Get subscription',
      description:
        'GetSubscription by accountId. Prefer list_company_subscriptions. Always compact unless fullDetail=true.',
      annotations: READ_ONLY,
      inputSchema: z.object({
        accountId,
        resellerContext,
        fullDetail: fullDetailFlag,
      }),
    },
    async ({ accountId: id, resellerContext: rc, fullDetail = false }) => {
      try {
        const body: Record<string, unknown> = { accountId: id };
        if (rc !== undefined) body.resellerContext = rc;
        const res = await alsoPost('GetSubscription', body);
        return textResult({
          status: res.status,
          body: fullDetail
            ? redactSecrets(res.body)
            : summarizeSubscription(res.body),
        });
      } catch (err) {
        return textResult(err instanceof Error ? err.message : String(err), true);
      }
    },
  );

  server.registerTool(
    'get_subscriptions',
    {
      title: 'Get subscriptions',
      description:
        'GetSubscriptions under parentAccountId. Prefer list_company_subscriptions / list_azure_subscriptions. Always compact unless fullDetail=true.',
      annotations: READ_ONLY,
      inputSchema: z.object({
        parentAccountId,
        resellerContext,
        excludeUserLevel: z
          .boolean()
          .optional()
          .describe('If true, exclude user-level subscriptions'),
        fullDetail: fullDetailFlag,
        activeOnly: z
          .boolean()
          .optional()
          .default(true)
          .describe('When compact (default), only include Active subscriptions'),
      }),
    },
    async ({
      parentAccountId: parent,
      resellerContext: rc,
      excludeUserLevel,
      fullDetail = false,
      activeOnly = true,
    }) => {
      try {
        const body: Record<string, unknown> = {
          parentAccountId: await requireParentAccountId(parent),
        };
        if (rc !== undefined) body.resellerContext = rc;
        if (excludeUserLevel !== undefined) body.excludeUserLevel = excludeUserLevel;
        const res = await alsoPost('GetSubscriptions', body);
        return textResult({
          status: res.status,
          body: fullDetail
            ? redactSecrets(res.body)
            : summarizeSubscriptions(res.body, Boolean(activeOnly)),
        });
      } catch (err) {
        return textResult(err instanceof Error ? err.message : String(err), true);
      }
    },
  );

  registerAlsoPostTool(server, 'get_subscription_with_addons', {
    title: 'Get subscription with addons',
    annotations: READ_ONLY,
    description: 'GetSubscriptionWithAddons — full detail for one subscription including addons.',
    endpoint: 'GetSubscriptionWithAddons',
    inputSchema: z.object({ accountId, resellerContext }),
  });

  registerAlsoPostTool(server, 'get_possible_services_for_parent', {
    title: 'Get possible services for parent',
    annotations: READ_ONLY,
    description: 'GetPossibleServicesForParent — services a parent can subscribe to.',
    endpoint: 'GetPossibleServicesForParent',
    inputSchema: z.object({ parentAccountId }),
    mapBody: withParent,
  });

  // --- Invoices / reports ---

  registerAlsoPostTool(server, 'get_reports', {
    title: 'Get reports',
    annotations: READ_ONLY,
    description:
      'GetReports — list the report names valid for execute_report. Not for: finding companies or subscriptions (use find_companies / list_company_subscriptions).',
    endpoint: 'GetReports',
    inputSchema: z.object({}),
  });

  server.registerTool(
    'execute_report',
    {
      title: 'Execute report',
      description:
        'ExecuteReport — run a named report. reportName MUST be one of the names returned by get_reports (exact, case-insensitive match is corrected). An unknown name returns the list of valid names instead of calling the API. Not for: finding companies or subscriptions.',
      annotations: READ_ONLY,
      inputSchema: z.object({
        reportName: z.string().min(1).describe('Exact report name from get_reports'),
        parameters: z.record(z.string(), z.unknown()).default({}),
        columns: z.record(z.string(), z.unknown()).optional(),
      }),
    },
    async ({ reportName, parameters, columns }) => {
      let validNames: string[] = [];
      try {
        validNames = await getReportNames();
      } catch {
        // GetReports failed — fall through and let ExecuteReport decide
      }
      const match = validNames.find((n) => n.toLowerCase() === reportName.trim().toLowerCase());
      if (validNames.length && !match) {
        return textResult(
          {
            error: `Unknown reportName "${reportName}".`,
            suggestions: suggestNames(reportName, validNames),
            validReportNames: validNames,
          },
          true,
        );
      }
      try {
        const body: Record<string, unknown> = { reportName: match ?? reportName, parameters };
        if (columns !== undefined) body.columns = columns;
        return textResult(await alsoPost('ExecuteReport', body));
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return textResult(
          validNames.length
            ? { error: msg, hint: 'Check reportName and parameters.', validReportNames: validNames }
            : msg,
          true,
        );
      }
    },
  );

  registerAlsoPostTool(server, 'get_latest_invoices', {
    title: 'Get latest invoices',
    annotations: READ_ONLY,
    description: 'GetLatestInvoices for the authenticated account.',
    endpoint: 'GetLatestInvoices',
    inputSchema: z.object({
      resellerContext,
      groupByDepartments: z.boolean().optional(),
    }),
  });

  registerAlsoPostTool(server, 'get_latest_invoices_for_period', {
    title: 'Get invoices for period',
    annotations: READ_ONLY,
    description: 'GetLatestInvoicesForPeriod — invoices for year/month.',
    endpoint: 'GetLatestInvoicesForPeriod',
    inputSchema: z.object({
      year: z.number().int(),
      month: z.number().int().min(1).max(12),
      resellerContext,
      groupByDepartments: z.boolean().optional(),
    }),
  });

  registerAlsoPostTool(server, 'get_preview_invoices', {
    title: 'Get preview invoices',
    annotations: READ_ONLY,
    description: 'GetPreviewInvoices — current open billing month preview.',
    endpoint: 'GetPreviewInvoices',
    inputSchema: z.object({
      resellerContext,
      groupByDepartments: z.boolean().optional(),
    }),
  });

  registerAlsoPostTool(server, 'get_invoice_aggregation_report', {
    title: 'Get invoice aggregation report',
    annotations: READ_ONLY,
    description: 'GetInvoiceAggregationReport for year/month.',
    endpoint: 'GetInvoiceAggregationReport',
    inputSchema: z.object({
      year: z.number().int().optional(),
      month: z.number().int().min(1).max(12).optional(),
      resellerContext,
    }),
  });

  // --- Marketplace / catalog ---

  registerAlsoPostTool(server, 'get_owned_marketplaces', {
    title: 'Get owned marketplaces',
    annotations: READ_ONLY,
    description: 'GetMarketplaces — marketplaces owned by the company (API).',
    endpoint: 'GetMarketplaces',
    inputSchema: z.object({}),
  });

  registerAlsoPostTool(server, 'list_marketplace_services', {
    title: 'List marketplace services',
    annotations: READ_ONLY,
    description: 'ListMarketplaceServices for marketplaceId.',
    endpoint: 'ListMarketplaceServices',
    inputSchema: z.object({
      marketplaceId: z.number().int(),
    }),
  });

  registerAlsoPostTool(server, 'get_available_services_for_marketplace', {
    title: 'Get available marketplace services',
    annotations: READ_ONLY,
    description: 'GetAvailableServicesForMarketplace.',
    endpoint: 'GetAvailableServicesForMarketplace',
    inputSchema: z.object({
      marketplaceId: z.number().int(),
      filters: z.array(z.unknown()).optional(),
    }),
  });

  registerAlsoPostTool(server, 'get_service_information', {
    title: 'Get service information',
    annotations: READ_ONLY,
    description: 'GetServiceInformation by serviceName.',
    endpoint: 'GetServiceInformation',
    inputSchema: z.object({
      serviceName: z.string().min(1),
    }),
  });

  // --- Credit / security / special deal ---

  registerAlsoPostTool(server, 'get_credit_limit', {
    title: 'Get credit limit',
    annotations: READ_ONLY,
    description: 'GetCreditLimit — current credit limit (Kreditlimite) of a company.',
    endpoint: 'GetCreditLimit',
    inputSchema: z.object({ accountId }),
  });

  registerAlsoPostTool(server, 'get_security_roles', {
    title: 'Get security roles',
    annotations: READ_ONLY,
    description: 'GetSecurityRoles — security roles and their users for a company/reseller. To find your own account ID use get_my_account.',
    endpoint: 'GetSecurityRoles',
    inputSchema: z.object({ accountId: accountId.optional() }),
  });

  registerAlsoPostTool(server, 'get_special_deal', {
    title: 'Get special deal',
    annotations: READ_ONLY,
    description: 'GetSpecialDeal discounts for accountId.',
    endpoint: 'GetSpecialDeal',
    inputSchema: z.object({ accountId }),
  });

  // --- Targeted writes (Create/Update, subscription, credit, upgrade/renew) ---
  registerWriteTools(server);
  registerRemoteEnumTools(server);

  // --- Escape hatch ---

  server.registerTool(
    'api_read',
    {
      title: 'API read (read-only)',
      description:
        'Read-only generic Simple API call for endpoints WITHOUT a dedicated tool. Only Get*/List* endpoints are allowed (e.g. GetRemoteEnums, GetRemoteEnumValuesForCustomAction, GetSubscriptionDependencies, GetSpecialProductTermsForService, GetMarketplaceServiceCharges); anything else is rejected. For empty SKU / Region choice lists use get_remote_enums. Not for: writes or deletes (use api_request).',
      annotations: READ_ONLY,
      inputSchema: z.object({
        endpoint: z
          .string()
          .regex(READ_ENDPOINT_RE, 'Only Get*/List* endpoints are allowed')
          .describe('Read endpoint name, e.g. GetRemoteEnums'),
        body: z
          .record(z.string(), z.unknown())
          .optional()
          .describe('JSON request body (ALSO read endpoints are called via POST)'),
        method: z
          .enum(['POST', 'GET'])
          .default('POST')
          .describe('POST for almost all ALSO endpoints; GET only if an endpoint requires it'),
        query: z.record(z.string(), z.string()).optional(),
      }),
    },
    async ({ endpoint, body, method, query }) => {
      if (!READ_ENDPOINT_RE.test(endpoint)) {
        return textResult(`Endpoint "${endpoint}" is not a read endpoint (Get*/List*).`, true);
      }
      try {
        const result = await getSharedClient().request({
          method,
          endpoint,
          body: method === 'GET' ? undefined : (body ?? {}),
          query,
        });
        return textResult({ status: result.status, body: tryParseJson(result.body) });
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
        'WRITE / DESTRUCTIVE generic Simple API call. For pure reads use api_read instead. Use this only for destructive ops (TerminateAccount, DeleteMarketplace*, DeleteSpecialDeal) and rare write endpoints, after explicit user confirmation. ALSO Simple API is POST-only for almost all operations.',
      annotations: WRITE_IRREVERSIBLE,
      inputSchema: z.object({
        method: z
          .enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE'])
          .default('POST')
          .describe('HTTP method (almost always POST for ALSO Simple API)'),
        endpoint: z
          .string()
          .min(1)
          .describe('Endpoint name, e.g. CreateCompany or TerminateAccount'),
        body: z.unknown().optional().describe('JSON request body'),
        query: z.record(z.string(), z.string()).optional(),
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

  return server;
}
