import { alsoPost } from './tools-helpers.js';

export type ParentSource = 'argument' | 'env' | 'auto:GetSecurityRoles' | 'auto:GetLatestInvoices';

export type ResolvedParent = { accountId: number; source: ParentSource };

const ACCOUNT_ID_KEYS = [
  'AccountId',
  'CompanyAccountId',
  'ResellerAccountId',
  'OwnerAccountId',
  'accountId',
];

let cached: ResolvedParent | null = null;
let pending: Promise<ResolvedParent | null> | null = null;

export const PARENT_HELP =
  'Could not determine parentAccountId. Pass parentAccountId explicitly, set ALSO_CLOUD_PARENT_ACCOUNT_ID on the server, or call get_my_account to see why auto-detection failed.';

function envParent(): number | undefined {
  const raw =
    process.env.ALSO_CLOUD_PARENT_ACCOUNT_ID ?? process.env.ALSO_PARENT_ACCOUNT_ID ?? '';
  if (!raw.trim()) return undefined;
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : undefined;
}

/** Find the first positive integer under a known AccountId-like key (shallow + one level deep). */
export function extractAccountId(body: unknown): number | undefined {
  const candidates: unknown[] = Array.isArray(body) ? body.slice(0, 5) : [body];
  for (const c of candidates) {
    if (c === null || typeof c !== 'object') continue;
    const rec = c as Record<string, unknown>;
    for (const key of ACCOUNT_ID_KEYS) {
      const n = Number(rec[key]);
      if (Number.isInteger(n) && n > 0) return n;
    }
    for (const v of Object.values(rec)) {
      if (v && typeof v === 'object' && !Array.isArray(v)) {
        const inner = v as Record<string, unknown>;
        for (const key of ACCOUNT_ID_KEYS) {
          const n = Number(inner[key]);
          if (Number.isInteger(n) && n > 0) return n;
        }
      }
    }
  }
  return undefined;
}

async function autoDetect(): Promise<ResolvedParent | null> {
  const probes: Array<[ParentSource, string]> = [
    ['auto:GetSecurityRoles', 'GetSecurityRoles'],
    ['auto:GetLatestInvoices', 'GetLatestInvoices'],
  ];
  for (const [source, endpoint] of probes) {
    try {
      const res = await alsoPost(endpoint, {});
      const id = extractAccountId(res.body);
      if (id != null) return { accountId: id, source };
    } catch {
      // try next probe
    }
  }
  return null;
}

/** Explicit argument → env → cached auto-detection (own account of the API user). */
export async function resolveParentAccountId(explicit?: number): Promise<ResolvedParent | null> {
  if (explicit != null) return { accountId: explicit, source: 'argument' };
  const env = envParent();
  if (env != null) return { accountId: env, source: 'env' };
  if (cached) return cached;
  pending ??= autoDetect().finally(() => {
    pending = null;
  });
  const found = await pending;
  if (found) cached = found;
  return found;
}

/** Like resolveParentAccountId but throws a helpful error when nothing is found. */
export async function requireParentAccountId(explicit?: number): Promise<number> {
  const r = await resolveParentAccountId(explicit);
  if (!r) throw new Error(PARENT_HELP);
  return r.accountId;
}

/** mapBody helper: fills a missing parentAccountId and drops undefined keys. */
export async function withParent<A extends { parentAccountId?: number }>(
  args: A,
): Promise<Record<string, unknown>> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(args)) if (v !== undefined) out[k] = v;
  out.parentAccountId = await requireParentAccountId(args.parentAccountId);
  return out;
}

export function resetAccountContextCache(): void {
  cached = null;
}
