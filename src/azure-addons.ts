import { alsoPost, mapPool } from './tools-helpers.js';
import { summarizeSubscription } from './summarize.js';

const AZURE_PLAN_RE = /AzurePlan_\d+$|ALSOAzurePlan/i;

type Row = Record<string, unknown>;

/**
 * GetSubscriptionWithAddons returns addons with only AccountId, ParentAccountId,
 * AccountState and ServiceName. GetSubscription per addon adds display name,
 * SKU, reservation name, term and dates, so terminated RIs are recognisable.
 */
async function addonRows(planId: unknown, addons: Row[]): Promise<Row[]> {
  return mapPool(addons, 4, async (a) => {
    try {
      const full = await alsoPost('GetSubscription', { accountId: a.AccountId });
      return { ...(summarizeSubscription(full.body ?? a) as Row), addonOf: planId };
    } catch (err) {
      return {
        ...(summarizeSubscription(a) as Row),
        addonOf: planId,
        detailError: err instanceof Error ? err.message : String(err),
      };
    }
  });
}

async function planAddons(planId: unknown): Promise<Row[]> {
  const res = await alsoPost('GetSubscriptionWithAddons', { accountId: planId });
  const addons = (res.body as Row)?.Addons;
  return Array.isArray(addons) ? (addons as Row[]) : [];
}

/**
 * Azure Reserved Instances / Savings Plans are children of the Azure Plan
 * subscription, not of the company. GetSubscriptions(company) never returns
 * them (not even with activeOnly=false); GetSubscriptionWithAddons(Azure Plan)
 * lists them as Addons, terminated ones included. This appends those addons.
 *
 * If parentAccountId is itself an Azure Plan subscription, GetSubscriptions
 * returns an empty list; pass parentAccountId so its addons are listed instead.
 */
export async function withAzurePlanAddons(
  rawSubs: unknown,
  summarized: unknown[],
  activeOnly: boolean,
  parentAccountId?: number,
): Promise<unknown[]> {
  const raw = (Array.isArray(rawSubs) ? rawSubs : []) as Row[];
  const planIds: unknown[] = raw
    .filter((s) => AZURE_PLAN_RE.test(String(s.ServiceName ?? '')))
    .map((s) => s.AccountId);
  if (!raw.length && parentAccountId != null) planIds.push(parentAccountId);
  if (!planIds.length) return summarized;

  const known = new Set(summarized.map((s) => (s as Row)?.accountId));
  const out = [...summarized];
  for (const planId of planIds) {
    try {
      const addons = (await planAddons(planId)).filter((a) => {
        if (known.has(a.AccountId)) return false;
        if (activeOnly && String(a.AccountState ?? '').toLowerCase() !== 'active') return false;
        known.add(a.AccountId);
        return true;
      });
      out.push(...(await addonRows(planId, addons)));
    } catch {
      // Addons are a best-effort extension; the base list stays valid.
    }
  }
  return out;
}
