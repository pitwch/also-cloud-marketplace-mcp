import type { McpServer } from '@modelcontextprotocol/server';
import * as z from 'zod/v4';
import { alsoPost, READ_ONLY, textResult } from './tools-helpers.js';

const TENANT_SERVICE_RE = /MicrosoftOrganizationtenant/i;
const AZURE_PLAN_SERVICE_RE = /AzurePlan_\d+$|ALSOAzurePlan/i;
/** Products that are ordered UNDER the Azure Plan subscription, not under the company. */
const UNDER_AZURE_PLAN_RE = /ReservedInstance|Reservation|SavingsPlan/i;

type Sub = {
  AccountId?: number;
  ParentAccountId?: number;
  ServiceName?: string;
  AccountState?: string;
  Fields?: unknown;
};

function fieldValue(sub: Sub | undefined, name: string): unknown {
  if (!sub || !Array.isArray(sub.Fields)) return undefined;
  const f = (sub.Fields as Array<{ Name?: string; Value?: unknown }>).find((x) => x.Name === name);
  return f?.Value;
}

function pickActive(subs: Sub[], re: RegExp): Sub | undefined {
  return (
    subs.find((s) => re.test(s.ServiceName ?? '') && s.AccountState === 'Active') ??
    subs.find((s) => re.test(s.ServiceName ?? ''))
  );
}

async function listSubs(parent: number): Promise<Sub[]> {
  const res = await alsoPost('GetSubscriptions', { parentAccountId: parent });
  return (Array.isArray(res.body) ? res.body : []) as Sub[];
}

export type AzureOrderContext = {
  companyAccountId: number;
  /** Parent to use for GetRemoteEnums / CreateSubscription of this product. */
  orderParentAccountId: number;
  azurePlanAccountId?: number;
  tenantSubscriptionAccountId?: number;
  microsoftTenantId?: string;
  notes: string[];
};

/**
 * Resolve where an Azure product is ordered. Verified against the ALSO portal:
 * Reserved Instances / Savings Plans use the customer's Azure Plan subscription
 * as ParentAccountId (with the Microsoft tenant subscription as dependency);
 * with the company as parent the Product lookup fails ("Not Found").
 * Accepts either the company or the Azure Plan subscription as input.
 */
export async function resolveAzureOrderContext(
  parentAccountId: number,
  serviceName: string,
): Promise<AzureOrderContext> {
  const notes: string[] = [];
  let company = parentAccountId;
  let subs = await listSubs(parentAccountId);
  let tenant = pickActive(subs, TENANT_SERVICE_RE);
  let plan = pickActive(subs, AZURE_PLAN_SERVICE_RE);

  if (!tenant && !plan) {
    // Maybe parentAccountId already IS the Azure Plan subscription.
    try {
      const self = (await alsoPost('GetSubscription', { accountId: parentAccountId })).body as Sub;
      if (self && AZURE_PLAN_SERVICE_RE.test(self.ServiceName ?? '') && self.ParentAccountId) {
        plan = self;
        company = self.ParentAccountId;
        subs = await listSubs(company);
        tenant = pickActive(subs, TENANT_SERVICE_RE);
      }
    } catch {
      // not a subscription: keep as company
    }
  }

  let orderParent = company;
  if (UNDER_AZURE_PLAN_RE.test(serviceName)) {
    if (plan?.AccountId) {
      orderParent = plan.AccountId;
      if (parentAccountId !== plan.AccountId) {
        notes.push(
          `ParentAccountId ${parentAccountId} is the company; Reserved Instances / Savings Plans are ordered under its Azure Plan subscription ${plan.AccountId}, which is used instead.`,
        );
      }
    } else {
      notes.push('No Azure Plan subscription found for this company; RI / Savings Plan lookups will likely fail.');
    }
  }

  let tenantId = fieldValue(tenant, 'MicrosoftTenantId');
  if (tenant?.AccountId && tenantId == null) {
    const full = (await alsoPost('GetSubscription', { accountId: tenant.AccountId })).body as Sub;
    tenantId = fieldValue(full, 'MicrosoftTenantId');
  }
  if (!tenant) notes.push('No Microsoft tenant subscription found; Azure fields usually need one.');

  return {
    companyAccountId: company,
    orderParentAccountId: orderParent,
    azurePlanAccountId: plan?.AccountId,
    tenantSubscriptionAccountId: tenant?.AccountId,
    microsoftTenantId: typeof tenantId === 'string' ? tenantId : undefined,
    notes,
  };
}

/** Form defaults like the portal pre-fills them: DefaultValue, or the only enum value. */
type FormInfo = { defaults: Record<string, unknown>; options: Record<string, unknown[]> };

async function fieldDefaults(parent: number, product: string): Promise<FormInfo> {
  const options: Record<string, unknown[]> = {};
  try {
    const res = await alsoPost('GetFieldsForService', { parentAccountId: parent, productName: product });
    const fields = (res.body as { Fields?: unknown })?.Fields;
    const out: Record<string, unknown> = {};
    if (!Array.isArray(fields)) return { defaults: out, options };
    for (const f of fields as Array<Record<string, unknown>>) {
      const name = f.Name;
      if (typeof name !== 'string') continue;
      const enums = Array.isArray(f.EnumMembers) ? (f.EnumMembers as Array<{ Value?: unknown }>) : [];
      if (enums.length) options[name] = enums.map((e) => e.Value);
      if (f.DefaultValue != null && f.DefaultValue !== '') {
        out[name] = /^int/i.test(String(f.Type)) ? Number(f.DefaultValue) : f.DefaultValue;
      } else if (enums.length === 1 && String(f.DisplayType).toLowerCase() !== 'hidden') {
        out[name] = enums[0]!.Value;
      } else {
        // The portal sends every form field; empty ones as null. Some backends
        // (e.g. RI recommendations for SKU) fail if the keys are missing.
        out[name] = null;
      }
    }
    return { defaults: out, options };
  } catch {
    return { defaults: {}, options };
  }
}

/** Ordertype=Recommended needs Lookbackperioddays (hidden field; portal default "30 days"). */
function recommendedDefaults(context: Record<string, unknown>, options: Record<string, unknown[]>) {
  if (context.Ordertype !== 'Recommended' || context.Lookbackperioddays != null) return;
  const opts = options.Lookbackperioddays ?? [];
  context.Lookbackperioddays = opts.find((o) => /^30 /.test(String(o))) ?? opts[0] ?? '30 days';
}

function money(list: unknown): string | undefined {
  if (!Array.isArray(list) || !list.length) return undefined;
  return (list as Array<{ Charge?: number; Currency?: string }>)
    .map((p) => `${p.Charge} ${p.Currency ?? ''}`.trim())
    .join(' / ');
}

/** Compact one enum entry incl. price details (EnumItemDetails) when ALSO sends them. */
function compactValue(v: unknown) {
  const r = (v ?? {}) as Record<string, unknown>;
  const d = (r.EnumItemDetails ?? null) as Record<string, unknown> | null;
  const hint = typeof r.Hint === 'string' ? r.Hint : '';
  const saved = hint.match(/Percentage Saved\*\*:\s*([\d.,]+%)/)?.[1];
  const suggestedQty = String(r.DisplayName ?? '').match(/Suggested Quantity:\s*(\d+)/)?.[1];
  const monthly = String(r.DisplayName ?? '').match(/Monthly payment per unit:\s*([\d.,]+)/)?.[1];
  const savedNum = saved ? Number(saved.replace('%', '').replace(',', '')) : undefined;
  return {
    value: r.Value,
    ...(r.DisplayName != null && r.DisplayName !== r.Value ? { displayName: r.DisplayName } : {}),
    ...(!d && hint && hint !== r.Value && hint !== r.DisplayName && !/\*\*Title\*\*/.test(hint) ? { hint } : {}),
    ...(monthly
      ? {
          // "Monthly payment per unit" in the ALSO list = SalesPrice of the resulting
          // subscription (verified: B2s_v2 3Y 25.61 = SalesPrice, PurchasePrice 24.82).
          // ALSO does not expose the purchase price per SKU before ordering.
          salesPricePerUnitMonthly: Number(monthly.replace(',', '')),
          purchasePricePerUnitMonthly: null,
        }
      : {}),
    ...(suggestedQty ? { suggestedQuantity: Number(suggestedQty) } : {}),
    ...(saved
      ? {
          savingsAsReportedByAlso: saved,
          ...(savedNum != null && savedNum > 100
            ? {
                savingsWarning:
                  'Implausible: savings above 100 % are impossible. ALSO passes this value through unchecked (likely an amount, not a percentage). Do not quote it as a percentage.',
              }
            : {}),
        }
      : {}),
    ...(d
      ? {
          tags: d.Tags,
          stablePrice: d.StaticRate,
          prices: {
            purchase: money(d.CostPrice) ?? null,
            sales: money(d.EndCustomerPrice) ?? null,
            ...(d.ResellerPrice ? { resellerList: money(d.ResellerPrice) } : {}),
          },
        }
      : {}),
  };
}

/** ALSO wraps provider failures as a pseudo value {Value:"", DisplayName:"Error", Hint:"…"}. */
function extractBackendError(raw: unknown[]): { technical?: string; operationId?: string } | null {
  const entry = raw.find((v) => {
    const r = (v ?? {}) as Record<string, unknown>;
    return r.DisplayName === 'Error' || /An error occurred/i.test(String(r.Hint ?? ''));
  }) as Record<string, unknown> | undefined;
  if (!entry) return null;
  const hint = String(entry.Hint ?? '').replace(/\\u0022/g, '"').replace(/\\r\\n|\\n|\r\n/g, ' ');
  return {
    technical: hint.match(/TechnicalError\\?"?:\s*\\?"([^"\\]+)/)?.[1],
    operationId: hint.match(/Operation Id:\s*([0-9a-f]+)/i)?.[1],
  };
}

/**
 * GetRemoteEnums per MarketplaceSimpleAPI 1.0.0:
 * { remoteEnumRequest: { FieldName, AccountViewName: "Product_<ServiceName>", ParentAccountId,
 *   DependencyAccountId?, AccountId?, ContextValues? } }
 */
export function registerRemoteEnumTools(server: McpServer): void {
  server.registerTool(
    'get_remote_enums',
    {
      title: 'Get remote choice values for a field',
      description:
        'GetRemoteEnums — allowed values of a choice field whose list is empty in get_fields_for_service (e.g. ProductCatalogue → ProductSegment → Product → Region → SKU, Ordertype, ScopedSubscriptions for Azure Reserved Instances). Lists are cascading: pass the values chosen so far in contextValues. With Ordertype="Recommended" the SKU list contains Microsoft usage-based suggestions (suggestedQuantity, savingsAsReportedByAlso: ALSO value, flagged when implausible); Lookbackperioddays = "7 days" | "30 days" (default) | "60 days". SKU entries include salesPricePerUnitMonthly (Verkaufspreis); the purchase price (Einkaufspreis) is only filled when ALSO sends it (prices.purchase), otherwise null. Pass the company Account ID: for RI / Savings Plan products the Azure Plan subscription is used as parent automatically, and the Microsoft tenant subscription + tenant ID are added. Read-only.',
      annotations: READ_ONLY,
      inputSchema: z.object({
        serviceName: z
          .string()
          .min(1)
          .describe('Technical product name, exactly as returned by get_possible_services_for_parent (ProductName); "Product_" prefix optional'),
        parentAccountId: z
          .number()
          .int()
          .describe('Company Account ID (or the Azure Plan subscription ID) the product will be ordered for'),
        fieldName: z.string().min(1).describe('Field to resolve, e.g. "ProductSegment"'),
        contextValues: z
          .record(z.string(), z.unknown())
          .optional()
          .describe('Values chosen for earlier fields, e.g. {"ProductCatalogue":"Azure Reservations","ProductSegment":"AzureReservationsVM"}'),
        dependencyAccountId: z
          .number()
          .int()
          .optional()
          .describe('Dependency subscription (Microsoft tenant). Auto-detected if omitted.'),
        accountId: z
          .number()
          .int()
          .optional()
          .describe('Existing subscription Account ID when resolving values for an update'),
        timeoutSeconds: z
          .number()
          .int()
          .min(5)
          .max(300)
          .optional()
          .default(120)
          .describe('Some lists (e.g. SKU) take >30 s at ALSO'),
      }),
    },
    async ({
      serviceName,
      parentAccountId,
      fieldName,
      contextValues,
      dependencyAccountId,
      accountId,
      timeoutSeconds = 120,
    }) => {
      try {
        const product = serviceName.replace(/^Product_/, '');
        const az = await resolveAzureOrderContext(parentAccountId, product);
        const dependency = dependencyAccountId ?? az.tenantSubscriptionAccountId;
        const visibleContext = { ...(contextValues ?? {}) };
        const form = await fieldDefaults(az.orderParentAccountId, product);
        // Mirror what the ALSO portal sends (ResolveRemoteEnum): form defaults such as
        // Billingcycle / Scope / QuantityVcores are required e.g. for the SKU list.
        const context: Record<string, unknown> = {
          ...form.defaults,
          AccountType: 'Product',
          ContextAction: accountId != null ? 'ACCOUNT_UPDATE' : 'ACCOUNT_CREATE',
          ParentAccountId: az.orderParentAccountId,
          ProductName: product,
          ...(az.microsoftTenantId ? { MicrosoftTenantId: az.microsoftTenantId } : {}),
          ...visibleContext,
        };
        recommendedDefaults(context, form.options);

        const request: Record<string, unknown> = {
          FieldName: fieldName,
          AccountViewName: `Product_${product}`,
          ParentAccountId: az.orderParentAccountId,
          ...(dependency != null ? { DependencyAccountId: dependency } : {}),
          ...(accountId != null ? { AccountId: accountId } : {}),
          ContextValues: context,
        };

        const res = await alsoPost('GetRemoteEnums', { remoteEnumRequest: request }, timeoutSeconds * 1000);
        const raw = Array.isArray(res.body) ? res.body : [];
        const resolved = {
          companyAccountId: az.companyAccountId,
          orderParentAccountId: az.orderParentAccountId,
          dependencyAccountId: dependency ?? null,
          tenantIdUsed: Boolean(az.microsoftTenantId),
        };

        const backendError = extractBackendError(raw);
        if (backendError) {
          return textResult(
            {
              error: `ALSO backend returned an error for ${fieldName} instead of values${backendError.technical ? `: ${backendError.technical}` : ''}.`,
              operationId: backendError.operationId ?? null,
              fieldName,
              contextValues: visibleContext,
              ...resolved,
              hint: 'Provider-side failure. Check the earlier contextValues; if they are correct, report the operationId to ALSO support.',
              ...(az.notes.length ? { notes: az.notes } : {}),
            },
            true,
          );
        }

        const values = raw.map(compactValue);
        const onlyEmpty = values.length > 0 && values.every((v) => v.value === '' || v.value == null);

        return textResult({
          fieldName,
          count: values.length,
          values,
          contextValues: visibleContext,
          ...(context.Lookbackperioddays && !visibleContext.Lookbackperioddays
            ? { lookbackperioddaysUsed: context.Lookbackperioddays }
            : {}),
          ...resolved,
          ...(az.notes.length ? { notes: az.notes } : {}),
          ...(onlyEmpty
            ? { note: 'Only an empty value is offered: leave this field empty for the chosen context.' }
            : values.length === 0
              ? { note: 'No values. Set the earlier cascading fields in contextValues first (ProductCatalogue → ProductSegment → Product → Region → SKU).' }
              : {}),
        });
      } catch (err) {
        return textResult(err instanceof Error ? err.message : String(err), true);
      }
    },
  );
}
