import { alsoPost } from './tools-helpers.js';
import { summarizeSubscription } from './summarize.js';

const AZURE_PLAN_RE = /AzurePlan_\d+$|ALSOAzurePlan/i;

type Row = Record<string, unknown>;

/**
 * Azure Reserved Instances / Savings Plans are children of the Azure Plan
 * subscription, not of the company. GetSubscriptions(company) never returns
 * them (not even with activeOnly=false); GetSubscriptionWithAddons(Azure Plan)
 * lists them as Addons, terminated ones included. This appends those addons.
 */
export async function withAzurePlanAddons(
  rawSubs: unknown,
  summarized: unknown[],
  activeOnly: boolean,
): Promise<unknown[]> {
  const raw = (Array.isArray(rawSubs) ? rawSubs : []) as Row[];
  const plans = raw.filter((s) => AZURE_PLAN_RE.test(String(s.ServiceName ?? '')));
  if (!plans.length) return summarized;

  const known = new Set(summarized.map((s) => (s as Row)?.accountId));
  const out = [...summarized];
  for (const plan of plans) {
    try {
      const res = await alsoPost('GetSubscriptionWithAddons', { accountId: plan.AccountId });
      const addons = ((res.body as Row)?.Addons ?? []) as Row[];
      for (const a of Array.isArray(addons) ? addons : []) {
        if (known.has(a.AccountId)) continue;
        if (activeOnly && String(a.AccountState ?? '').toLowerCase() !== 'active') continue;
        known.add(a.AccountId);
        out.push({ ...(summarizeSubscription(a) as Row), addonOf: plan.AccountId });
      }
    } catch {
      // Addons are a best-effort extension; the base list stays valid.
    }
  }
  return out;
}
