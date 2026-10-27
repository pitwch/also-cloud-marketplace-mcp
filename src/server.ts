import { McpServer } from '@modelcontextprotocol/server';
import * as z from 'zod/v4';
import { API_CATALOG } from './api-catalog.js';
import { getSharedClient } from './also-client.js';
import { SERVER_INSTRUCTIONS } from './instructions.js';
import { MARKETPLACES } from './marketplaces.js';
import {
  redactSecrets,
  summarizeSubscription,
  summarizeSubscriptions,
} from './summarize.js';
import { alsoPost, registerAlsoPostTool, textResult, tryParseJson } from './tools-helpers.js';
import { registerWorkflowTools } from './workflow-tools.js';
import { registerWriteTools } from './write-tools.js';

const accountId = z.number().int().describe('ALSO Cloud Account ID');
const parentAccountId = z.number().int().describe('Parent Account ID');
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

export function createServer(): McpServer {
  const server = new McpServer(
    {
      name: 'also-cloud-marketplace',
      version: '0.2.0',
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

  // High-level workflows first in registration order for discovery
  registerWorkflowTools(server);

  server.registerTool(
    'clear_session',
    {
      title: 'Clear session',
      description: 'Drop the cached session token (forces fresh login on next call).',
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
    description: 'GetCompany — company by accountId.',
    endpoint: 'GetCompany',
    inputSchema: z.object({ accountId }),
  });

  registerAlsoPostTool(server, 'get_companies', {
    title: 'Get companies',
    description:
      'GetCompanies — all first-level companies under parentAccountId. To search by name prefer find_companies.',
    endpoint: 'GetCompanies',
    inputSchema: z.object({ parentAccountId }),
  });

  registerAlsoPostTool(server, 'get_company_by_vat_id', {
    title: 'Get company by VAT ID',
    description: 'GetCompanyByVatId.',
    endpoint: 'GetCompanyByVatId',
    inputSchema: z.object({
      vatId: z.string().min(1).describe('VAT / UID number'),
    }),
  });

  registerAlsoPostTool(server, 'get_reseller', {
    title: 'Get reseller',
    description: 'GetReseller — reseller by accountId.',
    endpoint: 'GetReseller',
    inputSchema: z.object({ accountId }),
  });

  registerAlsoPostTool(server, 'get_resellers', {
    title: 'Get resellers',
    description: 'GetResellers — resellers under parentAccountId.',
    endpoint: 'GetResellers',
    inputSchema: z.object({ parentAccountId }),
  });

  registerAlsoPostTool(server, 'get_reseller_by_vat_id', {
    title: 'Get reseller by VAT ID',
    description: 'GetResellerByVatId.',
    endpoint: 'GetResellerByVatId',
    inputSchema: z.object({
      vatId: z.string().min(1).describe('VAT / UID number'),
    }),
  });

  registerAlsoPostTool(server, 'get_department', {
    title: 'Get department',
    description: 'GetDepartment — department by accountId.',
    endpoint: 'GetDepartment',
    inputSchema: z.object({ accountId }),
  });

  registerAlsoPostTool(server, 'get_departments', {
    title: 'Get departments',
    description: 'GetDepartments — departments under parentAccountId.',
    endpoint: 'GetDepartments',
    inputSchema: z.object({ parentAccountId }),
  });

  registerAlsoPostTool(server, 'get_user', {
    title: 'Get user',
    description: 'GetUser — user by accountId.',
    endpoint: 'GetUser',
    inputSchema: z.object({ accountId }),
  });

  registerAlsoPostTool(server, 'get_users', {
    title: 'Get users',
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
        const body: Record<string, unknown> = { parentAccountId: parent };
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
    description: 'GetSubscriptionWithAddons — full detail for one subscription including addons.',
    endpoint: 'GetSubscriptionWithAddons',
    inputSchema: z.object({ accountId, resellerContext }),
  });

  registerAlsoPostTool(server, 'get_possible_services_for_parent', {
    title: 'Get possible services for parent',
    description: 'GetPossibleServicesForParent — services a parent can subscribe to.',
    endpoint: 'GetPossibleServicesForParent',
    inputSchema: z.object({ parentAccountId }),
  });

  // --- Invoices / reports ---

  registerAlsoPostTool(server, 'get_reports', {
    title: 'Get reports',
    description:
      'GetReports — list available report names. Do NOT use this to find companies or subscriptions; use find_companies / list_company_subscriptions.',
    endpoint: 'GetReports',
    inputSchema: z.object({}),
  });

  registerAlsoPostTool(server, 'execute_report', {
    title: 'Execute report',
    description: 'ExecuteReport — run a named report with parameters.',
    endpoint: 'ExecuteReport',
    inputSchema: z.object({
      reportName: z.string().min(1),
      parameters: z.record(z.string(), z.unknown()).default({}),
      columns: z.record(z.string(), z.unknown()).optional(),
    }),
  });

  registerAlsoPostTool(server, 'get_latest_invoices', {
    title: 'Get latest invoices',
    description: 'GetLatestInvoices for the authenticated account.',
    endpoint: 'GetLatestInvoices',
    inputSchema: z.object({
      resellerContext,
      groupByDepartments: z.boolean().optional(),
    }),
  });

  registerAlsoPostTool(server, 'get_latest_invoices_for_period', {
    title: 'Get invoices for period',
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
    description: 'GetPreviewInvoices — current open billing month preview.',
    endpoint: 'GetPreviewInvoices',
    inputSchema: z.object({
      resellerContext,
      groupByDepartments: z.boolean().optional(),
    }),
  });

  registerAlsoPostTool(server, 'get_invoice_aggregation_report', {
    title: 'Get invoice aggregation report',
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
    description: 'GetMarketplaces — marketplaces owned by the company (API).',
    endpoint: 'GetMarketplaces',
    inputSchema: z.object({}),
  });

  registerAlsoPostTool(server, 'list_marketplace_services', {
    title: 'List marketplace services',
    description: 'ListMarketplaceServices for marketplaceId.',
    endpoint: 'ListMarketplaceServices',
    inputSchema: z.object({
      marketplaceId: z.number().int(),
    }),
  });

  registerAlsoPostTool(server, 'get_available_services_for_marketplace', {
    title: 'Get available marketplace services',
    description: 'GetAvailableServicesForMarketplace.',
    endpoint: 'GetAvailableServicesForMarketplace',
    inputSchema: z.object({
      marketplaceId: z.number().int(),
      filters: z.array(z.unknown()).optional(),
    }),
  });

  registerAlsoPostTool(server, 'get_service_information', {
    title: 'Get service information',
    description: 'GetServiceInformation by serviceName.',
    endpoint: 'GetServiceInformation',
    inputSchema: z.object({
      serviceName: z.string().min(1),
    }),
  });

  // --- Credit / security / special deal ---

  registerAlsoPostTool(server, 'get_credit_limit', {
    title: 'Get credit limit',
    description: 'GetCreditLimit for company accountId.',
    endpoint: 'GetCreditLimit',
    inputSchema: z.object({ accountId }),
  });

  registerAlsoPostTool(server, 'get_security_roles', {
    title: 'Get security roles',
    description: 'GetSecurityRoles for company/reseller accountId.',
    endpoint: 'GetSecurityRoles',
    inputSchema: z.object({ accountId: accountId.optional() }),
  });

  registerAlsoPostTool(server, 'get_special_deal', {
    title: 'Get special deal',
    description: 'GetSpecialDeal discounts for accountId.',
    endpoint: 'GetSpecialDeal',
    inputSchema: z.object({ accountId }),
  });

  // --- Targeted writes (Create/Update, subscription, credit, upgrade/renew) ---
  registerWriteTools(server);

  // --- Escape hatch ---

  server.registerTool(
    'api_request',
    {
      title: 'API request',
      description:
        'Generic authenticated Simple API call. Prefer dedicated tools when available. Use this for destructive ops (TerminateAccount, DeleteMarketplace*, DeleteSpecialDeal) and rare endpoints. ALSO Simple API is POST-only for almost all operations.',
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
