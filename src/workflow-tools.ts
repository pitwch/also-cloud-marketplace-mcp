import type { McpServer } from '@modelcontextprotocol/server';
import * as z from 'zod/v4';
import { PARENT_HELP, resolveParentAccountId } from './account-context.js';
import { alsoPost, mapPool, READ_ONLY, textResult } from './tools-helpers.js';
import { withAzurePlanAddons } from './azure-addons.js';
import {
  DUPLICATE_HINT,
  filterCompaniesByName,
  findNameDuplicates,
  isAzureRelatedSubscription,
  isReservationSubscription,
  summarizeCompany,
  summarizeSubscription,
  summarizeSubscriptions,
} from './summarize.js';

const optionalParent = z
  .number()
  .int()
  .optional()
  .describe(
    'Parent (reseller) account that owns the end-customer companies. Optional: defaults to ALSO_CLOUD_PARENT_ACCOUNT_ID or the auto-detected own account (get_my_account).',
  );

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** Adds possibleDuplicates + hint when near-identical company names exist. */
function withDuplicates<T extends Record<string, unknown>>(payload: T, companies: unknown[]) {
  const dups = findNameDuplicates(companies);
  return dups.length
    ? { ...payload, possibleDuplicates: dups, duplicateWarning: DUPLICATE_HINT }
    : payload;
}

type CompanyResolution =
  | { kind: 'ok'; companyAccountId: number; company: unknown }
  | { kind: 'result'; result: ReturnType<typeof textResult> };

/** Resolve a company by accountId or by (unique) name under the parent. */
async function resolveCompany(opts: {
  accountId?: number;
  companyName?: string;
  parentAccountId?: number;
}): Promise<CompanyResolution> {
  if (opts.accountId != null) {
    const c = await alsoPost('GetCompany', { accountId: opts.accountId });
    return { kind: 'ok', companyAccountId: opts.accountId, company: summarizeCompany(c.body) };
  }
  if (!opts.companyName) {
    return { kind: 'result', result: textResult('Provide accountId or companyName.', true) };
  }
  const parent = await resolveParentAccountId(opts.parentAccountId);
  if (!parent) return { kind: 'result', result: textResult(PARENT_HELP, true) };

  const list = await alsoPost('GetCompanies', { parentAccountId: parent.accountId });
  const matches = filterCompaniesByName(list.body, opts.companyName);
  if (matches.length === 0) {
    return {
      kind: 'result',
      result: textResult({
        query: opts.companyName,
        parentAccountId: parent.accountId,
        count: 0,
        companies: [],
        message: 'No company matched. Try a shorter name fragment.',
      }),
    };
  }
  if (matches.length > 1) {
    return {
      kind: 'result',
      result: textResult(
        withDuplicates(
          {
            query: opts.companyName,
            parentAccountId: parent.accountId,
            count: matches.length,
            companies: matches,
            message: 'Multiple companies matched. Re-call with accountId of the correct company.',
          },
          matches,
        ),
      ),
    };
  }
  return {
    kind: 'ok',
    companyAccountId: Number((matches[0] as { accountId?: number }).accountId),
    company: matches[0],
  };
}

// --- Reservation option compaction (response shapes vary per service) ---

function rec(v: unknown): Record<string, unknown> | null {
  return v !== null && typeof v === 'object' && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : null;
}

function pick(r: Record<string, unknown>, keys: string[]): unknown {
  for (const k of keys) if (r[k] != null && r[k] !== '') return r[k];
  return undefined;
}

function asArray(v: unknown): unknown[] {
  if (Array.isArray(v)) return v;
  const r = rec(v);
  if (!r) return [];
  for (const k of ['Actions', 'CustomActions', 'Services', 'Fields', 'Items']) {
    if (Array.isArray(r[k])) return r[k] as unknown[];
  }
  return [r];
}

function compactFields(v: unknown) {
  return asArray(v)
    .map(rec)
    .filter((f): f is Record<string, unknown> => f !== null)
    .map((f) => ({
      name: pick(f, ['Name', 'FieldName', 'name']),
      displayName: pick(f, ['DisplayName', 'Label', 'Caption']),
      mandatory: pick(f, ['IsMandatory', 'Mandatory', 'Required', 'IsRequired']),
      type: pick(f, ['Type', 'FieldType', 'DataType']),
      value: pick(f, ['Value', 'DefaultValue']),
    }));
}

function compactActions(v: unknown) {
  return asArray(v)
    .map(rec)
    .filter((a): a is Record<string, unknown> => a !== null)
    .map((a) => ({
      action: pick(a, ['Name', 'ActionName', 'Action', 'name']),
      displayName: pick(a, ['DisplayName', 'Label', 'Caption', 'Description']),
      fields: compactFields(a.Fields ?? a.FieldDefinitions ?? []),
    }));
}

function compactTargets(v: unknown) {
  return asArray(v)
    .map(rec)
    .filter((t): t is Record<string, unknown> => t !== null)
    .map((t) => ({
      targetProductName: pick(t, ['ProductName', 'ServiceName', 'Name', 'TechnicalName']),
      displayName: pick(t, ['DisplayName', 'ServiceDisplayName', 'FriendlyName']),
    }));
}

const CHANGE_ACTION_RE = /exchange|tausch|swap|change|modify|scope|cancel|return|refund|upgrade/i;

async function reservationOptions(sub: Record<string, unknown>) {
  const accountId = Number(sub.accountId);
  const [actions, upgrades, renew] = await Promise.allSettled([
    alsoPost('GetAccountCustomActionsWithFields', { accountId }),
    alsoPost('GetPossibleServicesForUpgrade', { accountId }),
    alsoPost('GetSubscriptionFieldsForRenew', { accountId }),
  ]);
  const errors: Record<string, string> = {};
  const customActions =
    actions.status === 'fulfilled'
      ? compactActions(actions.value.body)
      : ((errors.customActions = errMsg(actions.reason)), []);
  const upgradeTargets =
    upgrades.status === 'fulfilled'
      ? compactTargets(upgrades.value.body)
      : ((errors.upgradeTargets = errMsg(upgrades.reason)), []);
  const renewFields =
    renew.status === 'fulfilled'
      ? compactFields(renew.value.body)
      : ((errors.renewFields = errMsg(renew.reason)), []);

  const changeActions = customActions.filter((a) =>
    CHANGE_ACTION_RE.test(`${a.action ?? ''} ${a.displayName ?? ''}`),
  );
  const fields = rec(sub.fields) ?? {};
  const currentSku = pick(fields, ['SKU', 'Sku']);
  const upgradeHttp500 = /HTTP 5\d\d/.test(errors.upgradeTargets ?? '');
  const nextStep: string[] = [];
  if (upgradeHttp500) {
    nextStep.push(
      'GetPossibleServicesForUpgrade fails with HTTP 5xx for this reservation (known ALSO behaviour for monthly-billed RIs). The upgrade path is not usable here; keep the error token from errors.upgradeTargets for an ALSO support ticket.',
    );
  }
  if (currentSku != null) {
    nextStep.push(
      `The reservation size is stored in the SKU field (current: ${String(currentSku)}), not in the product name. An upgrade to another product is therefore NOT an exchange of size/SKU.`,
    );
  }
  if (changeActions.length) {
    nextStep.push(
      `Custom action(s) ${changeActions.map((a) => `"${a.action}"`).join(', ')} available → execute_account_custom_action(action, subscriptionAccount={AccountId:${accountId}, Fields:[…]}) after user confirmation.`,
    );
  }
  if (upgradeTargets.length) {
    nextStep.push(
      `Upgrade/switch possible → get_subscription_fields_for_upgrade(accountId=${accountId}, targetProductName) then execute_subscription_upgrade after user confirmation.`,
    );
  }
  if (renewFields.length) {
    nextStep.push(
      `Renewal terms can be changed for the end of term → configure_subscription_renew(accountId=${accountId}, fieldValues).`,
    );
  }
  const apiExchangeAvailable = changeActions.length > 0;
  if (!apiExchangeAvailable) {
    nextStep.push(
      'No exchange (Tausch) operation is exposed by the ALSO Simple API for this subscription (no matching custom action). Exchanges of Reserved Instances / Savings Plans must be done in the ALSO Cloud Marketplace web portal. New RIs / Savings Plans: get_remote_enums → validate_subscription_fields → create_subscription.',
    );
  }

  return {
    subscription: sub,
    currentSku: currentSku ?? null,
    apiExchangeAvailable,
    customActions,
    upgradeTargets,
    renewFields,
    nextStep,
    ...(Object.keys(errors).length ? { errors } : {}),
  };
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
        'PREFERRED to locate an end-customer company (Kunde/Firma) by name. Calls GetCompanies under the parent and filters by CompanyName (case-, umlaut- and legal-form-insensitive). Flags near-identical names as possibleDuplicates. Not for: reports, invoices, subscriptions (use list_company_subscriptions).',
      inputSchema: z.object({
        name: z
          .string()
          .min(1)
          .describe('Company name fragment, e.g. "Demo" or "Demo AG"'),
        parentAccountId: optionalParent,
      }),
      annotations: READ_ONLY,
    },
    async ({ name, parentAccountId }) => {
      try {
        const parent = await resolveParentAccountId(parentAccountId);
        if (!parent) return textResult(PARENT_HELP, true);
        const res = await alsoPost('GetCompanies', { parentAccountId: parent.accountId });
        const matches = filterCompaniesByName(res.body, name);
        return textResult(
          withDuplicates(
            {
              parentAccountId: parent.accountId,
              query: name,
              count: matches.length,
              companies: matches,
            },
            matches,
          ),
        );
      } catch (err) {
        return textResult(errMsg(err), true);
      }
    },
  );

  server.registerTool(
    'list_company_subscriptions',
    {
      title: 'List company subscriptions (compact)',
      description:
        'PREFERRED for "which subscriptions/licences does company X have?". Resolves the company by accountId or name, then GetSubscriptions. Compact summary (no huge Fields arrays). Azure Reserved Instances / Savings Plans (addons of the Azure Plan subscription, field addonOf) are included. activeOnly=true (default) returns active services only; activeOnly=false also lists terminated ones. Not for: cross-customer Azure overview (use list_azure_subscriptions).',
      inputSchema: z.object({
        accountId: z.number().int().optional().describe('Company Account ID if already known'),
        companyName: z
          .string()
          .min(1)
          .optional()
          .describe('Company name to search when accountId is unknown'),
        parentAccountId: optionalParent,
        activeOnly: z
          .boolean()
          .optional()
          .default(true)
          .describe('Only return subscriptions with AccountState Active'),
        excludeUserLevel: z.boolean().optional(),
      }),
      annotations: READ_ONLY,
    },
    async ({ accountId, companyName, parentAccountId, activeOnly = true, excludeUserLevel }) => {
      try {
        const resolved = await resolveCompany({ accountId, companyName, parentAccountId });
        if (resolved.kind === 'result') return resolved.result;

        const body: Record<string, unknown> = { parentAccountId: resolved.companyAccountId };
        if (excludeUserLevel !== undefined) body.excludeUserLevel = excludeUserLevel;

        const subs = await alsoPost('GetSubscriptions', body);
        const subscriptions = await withAzurePlanAddons(
          subs.body,
          summarizeSubscriptions(subs.body, activeOnly),
          activeOnly,
        );

        return textResult({
          company: resolved.company,
          activeOnly,
          count: subscriptions.length,
          subscriptions,
        });
      } catch (err) {
        return textResult(errMsg(err), true);
      }
    },
  );

  server.registerTool(
    'list_azure_subscriptions',
    {
      title: 'List Azure / RI / Savings Plan portfolio',
      description:
        'PREFERRED for an Azure Plan, Reserved Instance and Savings Plan overview across all end customers under the parent. Returns compact rows (company + subscription). Do NOT loop get_subscriptions per company manually. To exchange or change a reservation use get_reservation_options.',
      inputSchema: z.object({
        parentAccountId: optionalParent,
        activeOnly: z.boolean().optional().default(true).describe('Only Active subscriptions'),
        companyName: z
          .string()
          .optional()
          .describe('Optional filter: only companies whose name contains this'),
      }),
      annotations: READ_ONLY,
    },
    async ({ parentAccountId, activeOnly = true, companyName }) => {
      try {
        const parent = await resolveParentAccountId(parentAccountId);
        if (!parent) return textResult(PARENT_HELP, true);
        const list = await alsoPost('GetCompanies', { parentAccountId: parent.accountId });
        const rawCompanies = Array.isArray(list.body) ? list.body : [];
        type CompanyRow = {
          accountId?: number;
          companyName?: string;
          customerId?: string;
        };
        const rows: CompanyRow[] = (
          companyName?.trim()
            ? filterCompaniesByName(rawCompanies, companyName)
            : rawCompanies.map(summarizeCompany)
        ) as CompanyRow[];

        const perCompany = await mapPool(rows, 5, async (co) => {
          const id = Number(co.accountId);
          if (!Number.isFinite(id)) {
            return { company: co, subscriptions: [] as unknown[], error: 'bad id' };
          }
          try {
            const subs = await alsoPost('GetSubscriptions', { parentAccountId: id });
            const all = await withAzurePlanAddons(
              subs.body,
              summarizeSubscriptions(subs.body, activeOnly),
              activeOnly,
            );
            return { company: co, subscriptions: all.filter(isAzureRelatedSubscription) };
          } catch (err) {
            return { company: co, subscriptions: [] as unknown[], error: errMsg(err) };
          }
        });

        const flat = perCompany.flatMap((entry) =>
          entry.subscriptions.map((sub) => ({
            companyAccountId: entry.company.accountId,
            companyName: entry.company.companyName,
            customerId: entry.company.customerId,
            ...(typeof sub === 'object' && sub !== null ? sub : { subscription: sub }),
          })),
        );

        const withAzure = perCompany
          .filter((e) => e.subscriptions.length > 0)
          .map((e) => e.company);

        return textResult(
          withDuplicates(
            {
              parentAccountId: parent.accountId,
              companyCount: rows.length,
              azureSubscriptionCount: flat.length,
              companiesWithErrors: perCompany
                .filter((e) => 'error' in e && e.error)
                .map((e) => ({
                  companyAccountId: e.company.accountId,
                  companyName: e.company.companyName,
                  error: (e as { error?: string }).error,
                })),
              subscriptions: flat,
            },
            withAzure,
          ),
        );
      } catch (err) {
        return textResult(errMsg(err), true);
      }
    },
  );

  server.registerTool(
    'get_reservation_options',
    {
      title: 'Reservation / Savings Plan exchange & change options',
      description:
        'READ-ONLY. Use for: "Reservation tauschen / ändern", exchange, swap, modify, scope change, cancel or renew of Azure Reserved Instances (RI) and Savings Plans. For each RI/SP subscription it lists the available custom actions, upgrade/switch targets and renew fields, plus the concrete next tool to call (or states that only the web portal can do it). Pass a subscription accountId, or a company (accountId/name) to check all its RIs/SPs. Not for: credit checks (Bonitätsprüfung) or ordering new services.',
      inputSchema: z.object({
        subscriptionAccountId: z
          .number()
          .int()
          .optional()
          .describe('Account ID of one RI / Savings Plan subscription'),
        companyAccountId: z
          .number()
          .int()
          .optional()
          .describe('Company Account ID: checks all its active RIs / Savings Plans'),
        companyName: z
          .string()
          .min(1)
          .optional()
          .describe('Company name if no Account ID is known'),
        parentAccountId: optionalParent,
      }),
      annotations: READ_ONLY,
    },
    async ({ subscriptionAccountId, companyAccountId, companyName, parentAccountId }) => {
      try {
        let company: unknown;
        let subs: Record<string, unknown>[];

        if (subscriptionAccountId != null) {
          const res = await alsoPost('GetSubscription', { accountId: subscriptionAccountId });
          subs = [summarizeSubscription(res.body) as Record<string, unknown>];
        } else {
          const resolved = await resolveCompany({
            accountId: companyAccountId,
            companyName,
            parentAccountId,
          });
          if (resolved.kind === 'result') return resolved.result;
          company = resolved.company;
          const res = await alsoPost('GetSubscriptions', {
            parentAccountId: resolved.companyAccountId,
          });
          subs = (
            await withAzurePlanAddons(res.body, summarizeSubscriptions(res.body, true), true)
          ).filter(
            isReservationSubscription,
          ) as Record<string, unknown>[];
          if (subs.length === 0) {
            return textResult({
              company,
              count: 0,
              reservations: [],
              message: 'No active Reserved Instance or Savings Plan subscriptions for this company.',
            });
          }
        }

        const reservations = await mapPool(subs, 3, reservationOptions);
        return textResult({
          ...(company ? { company } : {}),
          count: reservations.length,
          reservations,
          note: 'All write steps require explicit user confirmation.',
        });
      } catch (err) {
        return textResult(errMsg(err), true);
      }
    },
  );
}
