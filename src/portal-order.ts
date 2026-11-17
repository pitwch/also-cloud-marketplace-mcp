import type { McpServer } from '@modelcontextprotocol/server';
import * as z from 'zod/v4';
import { resolveAzureOrderContext } from './remote-enums.js';
import { provisioningHint } from './summarize.js';
import { alsoPost, portalPost, textResult, WRITE_IRREVERSIBLE } from './tools-helpers.js';

/**
 * Orders services with remote pricing fields (Azure Reserved Instances, Savings
 * Plans) through the ALSO web portal's internal API, because the Simple API
 * rejects them ("SimpleApi doesn't support services with remote pricing fields").
 *
 * The flow mirrors the portal wizard (captured 2026-11-17):
 *   IAccountService/GetDefaultAccountViewsForCreate  → views, QuoteId, ContractId
 *   ICreditValidationService/ValidateCreateOrderBottleneck {viewValues}
 *   IAccountService/CreateAccount {purchaseOrderCommitment, account: {Views}}
 */

type Row = Record<string, unknown>;

type PortalTrigger = {
  Action?: string;
  Value?: unknown;
  Type?: string;
  Actions?: Array<{ FieldName?: string; DisplayType?: string; Type?: string }>;
};

type PortalField = {
  Name?: string;
  DisplayName?: string;
  DisplayTemplate?: string;
  DisplayType?: number | string;
  Type?: string;
  Validator?: string;
  MinValue?: unknown;
  MaxValue?: unknown;
  IsList?: boolean;
  EnumMembers?: Array<{ Value?: unknown }>;
  RemoteDataSource?: boolean;
  Triggers?: PortalTrigger[];
};

type PortalView = { Name: string; FieldDefinition?: PortalField[]; Values?: Row };

export type OrderViews = Record<string, { Name: string; Values: Row }>;

export type OrderIssue = { field: string; problem: string; detail: string };

const DISPLAY_TYPES = ['Optional', 'Mandatory', 'ReadOnly', 'Hidden'];

function displayType(v: unknown): string {
  return typeof v === 'number' ? (DISPLAY_TYPES[v] ?? String(v)) : String(v ?? 'Optional');
}

function isEmpty(v: unknown): boolean {
  return v === undefined || v === null || (typeof v === 'string' && v.trim() === '') ||
    (Array.isArray(v) && v.length === 0);
}

/** The view holding the product's own fields, e.g. "Product_<ServiceName>". */
export function productViewName(serviceName: string): string {
  return `Product_${serviceName}`;
}

/**
 * Builds the CreateAccount views from GetDefaultAccountViewsForCreate plus the
 * user's field values, applying the form triggers like the portal does
 * (e.g. Ordertype=Recommended hides Product/Region and makes Lookbackperioddays
 * mandatory; Scope=Shared hides ScopedSubscriptions).
 */
export function buildOrderViews(
  defaults: PortalView[],
  serviceName: string,
  fields: Row,
  extra: { secondaryParentId?: number; purchaseOrderNumber?: string },
): { views: OrderViews; issues: OrderIssue[]; notes: string[]; productFields: PortalField[] } {
  const issues: OrderIssue[] = [];
  const notes: string[] = [];
  const views: OrderViews = {};
  const pView = productViewName(serviceName);
  let defs: PortalField[] = [];
  let defaultsOfProduct: Row = {};

  for (const v of defaults) {
    const known = new Set((v.FieldDefinition ?? []).map((f) => f.Name));
    const values: Row = {};
    for (const [k, val] of Object.entries(v.Values ?? {})) if (known.has(k)) values[k] = val;
    if (v.Name === pView) {
      defs = v.FieldDefinition ?? [];
      defaultsOfProduct = { ...values };
      for (const f of defs) if (f.Name && !(f.Name in values)) values[f.Name] = null;
    }
    views[v.Name] = { Name: v.Name, Values: values };
  }

  if (views.Default && extra.secondaryParentId != null) {
    views.Default.Values.SecondaryParentId = extra.secondaryParentId;
  }
  if (views.SDP) views.SDP.Values.SendNotification ??= false;
  if (views.Billing && extra.purchaseOrderNumber) {
    views.Billing.Values.InternalPurchaseOrderNumber = extra.purchaseOrderNumber;
  }

  const product = views[pView]?.Values;
  if (!product) {
    issues.push({ field: pView, problem: 'no_product_view', detail: 'ALSO returned no product field view for this service.' });
    return { views, issues, notes, productFields: defs };
  }

  // 1. user values (case-insensitive field names)
  const byLower = new Map(defs.filter((d) => d.Name).map((d) => [d.Name!.toLowerCase(), d]));
  for (const [name, value] of Object.entries(fields)) {
    const d = byLower.get(name.toLowerCase());
    if (!d) {
      issues.push({ field: name, problem: 'unknown_field', detail: `Not a field of ${serviceName}. Known: ${defs.map((x) => x.Name).join(', ')}` });
      continue;
    }
    let v = value;
    if (d.IsList && v != null && !Array.isArray(v)) v = [v];
    if (/^int/i.test(String(d.Type)) && typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))) v = Number(v);
    product[d.Name!] = v;
  }

  // 2. triggers decide which fields are hidden / mandatory
  const types = new Map(defs.map((d) => [d.Name!, displayType(d.DisplayType)]));
  for (const d of defs) {
    for (const t of d.Triggers ?? []) {
      if (t.Type !== 'FieldValue' || (t.Action && t.Action !== 'CREATE')) continue;
      if (String(product[d.Name!]) !== String(t.Value)) continue;
      for (const a of t.Actions ?? []) {
        if (a.Type === 'SetFieldDisplayType' && a.FieldName && a.DisplayType) types.set(a.FieldName, a.DisplayType);
      }
    }
  }

  // 3. hidden / read-only fields keep the portal default (the portal sends them that way)
  for (const d of defs) {
    const name = d.Name!;
    const type = types.get(name);
    if ((type === 'Hidden' || type === 'ReadOnly') && product[name] !== (defaultsOfProduct[name] ?? null)) {
      if (!isEmpty(product[name])) notes.push(`${name} is ${type} for this selection; your value was dropped (portal behaviour).`);
      product[name] = defaultsOfProduct[name] ?? null;
    }
  }

  // Look-back period: the portal requires a choice for Recommended orders; 30 days is its middle option.
  if (types.get('Lookbackperioddays') === 'Mandatory' && isEmpty(product.Lookbackperioddays)) {
    product.Lookbackperioddays = '30 days';
    notes.push('Lookbackperioddays not given; "30 days" used (options: 7 / 30 / 60 days).');
  }

  // 4. local validation
  for (const d of defs) {
    const name = d.Name!;
    const v = product[name];
    if (types.get(name) === 'Mandatory' && isEmpty(v)) {
      issues.push({ field: name, problem: 'missing_mandatory', detail: `${d.DisplayName ?? name} is mandatory for this selection.` });
      continue;
    }
    if (isEmpty(v) || types.get(name) === 'Hidden' || types.get(name) === 'ReadOnly') continue;
    if (d.Validator && typeof v === 'string') {
      try {
        if (!new RegExp(d.Validator).test(v)) issues.push({ field: name, problem: 'pattern', detail: `Must match ${d.Validator}.` });
      } catch {
        // invalid regex from ALSO: ignore
      }
    }
    if (/^int|decimal|double/i.test(String(d.Type))) {
      const n = Number(v);
      if (!Number.isFinite(n)) issues.push({ field: name, problem: 'not_a_number', detail: `Must be a number (${d.Type}).` });
      else if ((d.MinValue != null && n < Number(d.MinValue)) || (d.MaxValue != null && n > Number(d.MaxValue))) {
        issues.push({ field: name, problem: 'range', detail: `Must be between ${d.MinValue} and ${d.MaxValue}.` });
      }
    }
    if (d.EnumMembers?.length && !d.RemoteDataSource) {
      const allowed = d.EnumMembers.map((e) => String(e.Value));
      const bad = (Array.isArray(v) ? v : [v]).filter((x) => !allowed.includes(String(x)));
      if (bad.length) issues.push({ field: name, problem: 'not_in_enum', detail: `Allowed: ${allowed.join(', ')}.` });
    }
  }

  return { views, issues, notes, productFields: defs };
}

export function hasRemotePricing(defs: PortalField[]): boolean {
  return defs.some((d) => /advancedlist/i.test(String(d.DisplayTemplate ?? '')));
}

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export function registerPortalOrderTools(server: McpServer): void {
  server.registerTool(
    'order_azure_reservation',
    {
      title: 'Order Azure Reserved Instance / Savings Plan',
      description:
        'WRITE (cost!): orders an Azure Reserved Instance or Savings Plan (services with remote pricing fields, which the Simple API create_subscription cannot order). Uses the ALSO web portal API (undocumented by ALSO, same login). ' +
        'Default confirmOrder=false = dry run: builds the exact portal payload, applies the form rules (Ordertype Recommended hides Product/Region; Scope Shared hides ScopedSubscriptions), checks mandatory fields and runs ALSO\'s order validation. Nothing is ordered. ' +
        'confirmOrder=true places the real order (1 or 3 year commitment) — only after the user explicitly confirmed product, SKU, quantity, term and price. ' +
        'Get field values first with get_remote_enums (ProductCatalogue → ProductSegment → Ordertype → SKU; Ownerpermissions optional). Pass the company Account ID; the Azure Plan subscription and Microsoft tenant are resolved automatically.',
      annotations: WRITE_IRREVERSIBLE,
      inputSchema: z.object({
        parentAccountId: z
          .number()
          .int()
          .describe('Company Account ID (or the Azure Plan subscription ID)'),
        serviceName: z
          .string()
          .min(1)
          .describe('Technical product name, e.g. 123456_AzureReservedInstanceforAzurePlanMonthlyBilled_12345'),
        fields: z
          .record(z.string(), z.unknown())
          .describe(
            'Field name → value, e.g. {"ProductCatalogue":"Azure Reservations","ProductSegment":"AzureReservationsVM","Ordertype":"Recommended","Lookbackperioddays":"30 days","SKU":"<exact value from get_remote_enums>","QuantityVcores":1,"ReservationName":"MyReservation"}',
          ),
        purchaseOrderNumber: z.string().max(50).optional().describe('Optional own purchase order number (billing reports)'),
        confirmOrder: z
          .boolean()
          .optional()
          .default(false)
          .describe('false (default) = dry run, nothing ordered. true = place the real, chargeable order.'),
      }),
    },
    async ({ parentAccountId, serviceName, fields, purchaseOrderNumber, confirmOrder = false }) => {
      try {
        const ctx = await resolveAzureOrderContext(parentAccountId, serviceName);
        const parent = ctx.orderParentAccountId;
        const defaults = await portalPost('IAccountService/GetDefaultAccountViewsForCreate', {
          accountType: 'Product',
          parentAccountId: parent,
          productName: serviceName,
          ...(ctx.tenantSubscriptionAccountId ? { secondaryParentId: ctx.tenantSubscriptionAccountId } : {}),
        });
        const defaultViews = (Array.isArray(defaults.body) ? defaults.body : []) as PortalView[];
        const built = buildOrderViews(defaultViews, serviceName, fields as Row, {
          secondaryParentId: ctx.tenantSubscriptionAccountId,
          purchaseOrderNumber,
        });

        if (built.productFields.length && !hasRemotePricing(built.productFields)) {
          return textResult(
            { error: `${serviceName} has no remote pricing fields: order it with create_subscription (Simple API).` },
            true,
          );
        }

        const product = built.views[productViewName(serviceName)]?.Values ?? {};
        const summary = {
          serviceName,
          orderParentAccountId: parent,
          companyAccountId: ctx.companyAccountId,
          dependencyAccountId: ctx.tenantSubscriptionAccountId,
          SKU: product.SKU,
          QuantityVcores: product.QuantityVcores,
          ReservationName: product.ReservationName,
          Ordertype: product.Ordertype,
          Scope: product.Scope,
          Billingcycle: product.Billingcycle,
          quoteId: built.views.ExtendedView?.Values.QuoteId,
        };
        const notes = [...ctx.notes, ...built.notes];

        if (built.issues.length) {
          return textResult(
            {
              error: 'Order payload incomplete or invalid — nothing was sent to ALSO.',
              issues: built.issues,
              notes,
              summary,
              fieldDefinitions: built.productFields.map((d) => ({
                name: d.Name,
                displayName: d.DisplayName,
                displayType: displayType(d.DisplayType),
                remoteValues: d.RemoteDataSource ? 'get_remote_enums' : undefined,
              })),
            },
            true,
          );
        }

        let validation: unknown;
        try {
          validation = (await portalPost('ICreditValidationService/ValidateCreateOrderBottleneck', { viewValues: built.views })).body;
        } catch (err) {
          validation = { error: errMsg(err) };
        }
        const valid = (validation as Row | null)?.Valid;
        if (valid === false) {
          return textResult({ error: 'ALSO order validation failed — nothing was ordered.', validation, summary, notes }, true);
        }

        if (!confirmOrder) {
          return textResult({
            dryRun: true,
            ordered: false,
            summary,
            validation,
            notes,
            nextStep:
              'Show the user SKU, quantity, term and monthly price (SKU list of get_remote_enums) and ask for explicit confirmation. Then call again with the same values and confirmOrder=true.',
          });
        }

        let created: Row;
        try {
          created = (await portalPost(
            'IAccountService/CreateAccount',
            { purchaseOrderCommitment: false, account: { Views: built.views } },
            120_000,
          )).body as Row;
        } catch (err) {
          const msg = errMsg(err);
          return textResult(
            {
              error: `CreateAccount failed: ${msg}`,
              ...(/AebApiException/i.test(msg)
                ? {
                    hint:
                      'ALSO compliance screening (AEB) failed on ALSO\'s side. This was seen as a temporary error: the identical order succeeded on the second attempt in the portal. Do NOT retry blindly: first check with list_company_subscriptions (activeOnly=false) that no new reservation was created, then retry once with confirmOrder=true.',
                  }
                : {}),
              summary,
            },
            true,
          );
        }

        const accountId = created?.AccountId;
        let provisioning: unknown;
        if (accountId != null) {
          try {
            const sub = (await alsoPost('GetSubscription', { accountId })).body as Row;
            const err = typeof sub?.ErrorDetails === 'string' ? sub.ErrorDetails : '';
            provisioning = {
              accountState: sub?.AccountState,
              provisioningStatus: sub?.ProvisioningStatus,
              ...(err ? { error: err, hint: provisioningHint(err) } : {}),
            };
          } catch {
            // status check is optional
          }
        }
        return textResult({
          ordered: created?.Result === 'OK',
          accountId,
          displayName: created?.DisplayName,
          result: created?.Result,
          message: created?.PostCreationMessage,
          ...(Number(created?.CreditCheckRequestId) > 0
            ? { creditCheckRequestId: created.CreditCheckRequestId, creditCheckNote: 'Order waits for credit check approval (list_credit_check_orders_for_approval).' }
            : {}),
          provisioning,
          summary,
          nextStep:
            'Microsoft completes the order within about an hour. Check with get_subscription(accountId): provisioningStatus Completed = done; Failed = see provisioningError / hint.',
        });
      } catch (err) {
        return textResult(errMsg(err), true);
      }
    },
  );
}
