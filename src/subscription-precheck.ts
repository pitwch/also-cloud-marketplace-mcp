import { resolveAzureOrderContext } from './remote-enums.js';
import { alsoPost } from './tools-helpers.js';

/**
 * Local check of a subscriptionAccount against GetFieldsForService before
 * ValidateFields / CreateSubscription. ALSO answers wrong or missing fields
 * with a generic HTTP 500, so we report the concrete problems ourselves.
 */

type FieldDef = {
  Name?: string;
  DisplayName?: string;
  DisplayType?: string;
  DisplayTemplate?: string;
  Type?: string;
  Validator?: string;
  MinValue?: number;
  MaxValue?: number;
  IsList?: boolean;
  EnumMembers?: Array<{ Value?: unknown; DisplayName?: string }>;
};

export type PrecheckIssue = {
  field: string;
  problem:
    | 'missing_mandatory'
    | 'pattern'
    | 'range'
    | 'not_in_enum'
    | 'unknown_field'
    | 'not_a_number'
    | 'wrong_parent'
    | 'missing_dependency'
    | 'remote_pricing';
  detail: string;
};

export type PrecheckResult = {
  ok: boolean;
  serviceName?: string;
  parentAccountId?: number;
  issues: PrecheckIssue[];
  /** Compact definitions so the caller can fix the payload in one go. */
  fieldDefinitions?: Array<Record<string, unknown>>;
  skipped?: string;
  /** Set when ALSO's Simple API cannot order this service at all (portal only). */
  remotePricingFields?: string[];
};

/** Fallback when GetFieldsForService is unavailable: the products known to use remote pricing. */
const REMOTE_PRICING_NAME_RE = /ReservedInstance|SavingsPlan/i;

/**
 * Remote pricing = a field whose values and price come live from the vendor
 * (DisplayTemplate "AdvancedList", e.g. the SKU of Azure Reserved Instances and
 * Savings Plans). ALSO rejects ValidateFields / CreateSubscription for such
 * services with "SimpleApi doesn't support services with remote pricing fields"
 * (fault code Sender, no support token). Verified live on 2026-11-16 and 2026-11-17.
 */
export function remotePricingFields(defs: FieldDef[]): string[] {
  return defs
    .filter((d) => /advancedlist/i.test(String(d.DisplayTemplate ?? '')))
    .map((d) => String(d.Name ?? d.DisplayName ?? '?'));
}

/** Escape hatch in case ALSO adds remote pricing support to the Simple API later. */
function remotePricingAllowed(): boolean {
  return /^(1|true|yes)$/i.test(process.env.ALSO_CLOUD_ALLOW_REMOTE_PRICING ?? '');
}

function remotePricingResult(serviceName: string, parent: number, fields: string[]): PrecheckResult {
  return {
    ok: false,
    serviceName,
    parentAccountId: parent,
    remotePricingFields: fields,
    issues: [
      {
        field: fields.join(', ') || 'ServiceName',
        problem: 'remote_pricing',
        detail:
          "Service uses remote pricing fields. ALSO's Simple API rejects ValidateFields and CreateSubscription for it (\"SimpleApi doesn't support services with remote pricing fields\").",
      },
    ],
  };
}

function rec(v: unknown): Record<string, unknown> | null {
  return v !== null && typeof v === 'object' && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : null;
}

function get(r: Record<string, unknown>, ...keys: string[]): unknown {
  for (const k of keys) if (r[k] !== undefined) return r[k];
  return undefined;
}

function isEmpty(v: unknown): boolean {
  return v === undefined || v === null || (typeof v === 'string' && v.trim() === '') ||
    (Array.isArray(v) && v.length === 0);
}

/** Values a user may set: Mandatory + Optional (ReadOnly / Hidden are system-set). */
function isUserField(d: FieldDef): boolean {
  const t = String(d.DisplayType ?? '').toLowerCase();
  return t !== 'readonly' && t !== 'hidden';
}

export function compactDefinition(d: FieldDef): Record<string, unknown> {
  return {
    name: d.Name,
    displayName: d.DisplayName,
    displayType: d.DisplayType,
    type: d.Type,
    ...(d.Validator ? { pattern: d.Validator } : {}),
    ...(d.MinValue != null ? { min: d.MinValue } : {}),
    ...(d.MaxValue != null ? { max: d.MaxValue } : {}),
    ...(d.IsList ? { isList: true } : {}),
    ...(d.EnumMembers?.length
      ? { allowedValues: d.EnumMembers.map((e) => e.Value) }
      : String(d.DisplayTemplate ?? '').match(/combobox|list/i)
        ? { allowedValues: 'remote (not listed by GetFieldsForService)' }
        : {}),
  };
}

type Given = Map<string, { name: string; value: unknown }>;

export function checkFields(defs: FieldDef[], given: Given): PrecheckIssue[] {
  const issues: PrecheckIssue[] = [];
  const byName = new Map(defs.filter((d) => d.Name).map((d) => [String(d.Name).toLowerCase(), d]));

  // Conditional mandatory fields (verified against the ALSO portal, which validates
  // RIs with Scope "Shared" and ScopedSubscriptions null as valid).
  const scopeDef = byName.get('scope');
  const scope =
    given.get('scope')?.value ??
    (scopeDef?.EnumMembers?.length === 1 ? scopeDef.EnumMembers[0]!.Value : undefined);
  const notRequired = new Set<string>();
  if (String(scope ?? '').toLowerCase() === 'shared') notRequired.add('scopedsubscriptions');

  for (const d of defs) {
    if (!d.Name || String(d.DisplayType).toLowerCase() !== 'mandatory') continue;
    if (notRequired.has(d.Name.toLowerCase())) continue;
    if (isEmpty(given.get(d.Name.toLowerCase())?.value)) {
      issues.push({
        field: d.Name,
        problem: 'missing_mandatory',
        detail: `${d.DisplayName ?? d.Name} is mandatory but missing or empty.`,
      });
    }
  }

  for (const [lname, { name: givenName, value }] of given) {
    const d = byName.get(lname);
    if (!d) {
      issues.push({
        field: givenName,
        problem: 'unknown_field',
        detail: 'Field is not defined for this service (check spelling, names are e.g. "SKU", "QuantityVcores").',
      });
      continue;
    }
    if (isEmpty(value) || !isUserField(d)) continue;
    const name = d.Name!;
    if (d.Validator && typeof value === 'string') {
      try {
        if (!new RegExp(d.Validator).test(value)) {
          issues.push({ field: name, problem: 'pattern', detail: `Value must match ${d.Validator}.` });
        }
      } catch {
        // invalid regex from API: ignore
      }
    }
    if (d.MinValue != null || d.MaxValue != null || /^int|decimal|double/i.test(String(d.Type))) {
      const n = Number(value);
      if (/^int|decimal|double/i.test(String(d.Type)) && !Number.isFinite(n)) {
        issues.push({ field: name, problem: 'not_a_number', detail: `Value must be a number (${d.Type}).` });
      } else if ((d.MinValue != null && n < d.MinValue) || (d.MaxValue != null && n > d.MaxValue)) {
        issues.push({
          field: name,
          problem: 'range',
          detail: `Value must be between ${d.MinValue ?? '-∞'} and ${d.MaxValue ?? '∞'}.`,
        });
      }
    }
    if (d.EnumMembers?.length) {
      const allowed = d.EnumMembers.map((e) => String(e.Value));
      const values = Array.isArray(value) ? value : [value];
      const bad = values.filter((v) => !allowed.includes(String(v)));
      if (bad.length) {
        issues.push({
          field: name,
          problem: 'not_in_enum',
          detail: `Allowed: ${allowed.join(', ')}. Got: ${bad.join(', ')}.`,
        });
      }
    }
  }
  return issues;
}

/** Reads Fields from a subscriptionAccount payload into lowercase name → value. */
export function givenFields(account: Record<string, unknown>): Given {
  const out: Given = new Map();
  const fields = get(account, 'Fields', 'fields');
  const map = rec(fields);
  if (map) {
    for (const [n, v] of Object.entries(map)) out.set(n.toLowerCase(), { name: n, value: v });
  } else if (Array.isArray(fields)) {
    for (const f of fields) {
      const r = rec(f);
      const n = r ? get(r, 'Name', 'name') : undefined;
      if (n != null) out.set(String(n).toLowerCase(), { name: String(n), value: get(r!, 'Value', 'value') });
    }
  }
  return out;
}

export async function precheckSubscription(account: Record<string, unknown>): Promise<PrecheckResult> {
  const serviceName = get(account, 'ServiceName', 'serviceName', 'ProductName', 'productName');
  const parent = Number(get(account, 'ParentAccountId', 'parentAccountId'));
  if (typeof serviceName !== 'string' || !serviceName || !Number.isInteger(parent) || parent <= 0) {
    return {
      ok: false,
      issues: [
        {
          field: 'ServiceName/ParentAccountId',
          problem: 'missing_mandatory',
          detail: 'subscriptionAccount needs ServiceName (technical product name) and ParentAccountId (company).',
        },
      ],
    };
  }

  let defs: FieldDef[];
  try {
    const res = await alsoPost('GetFieldsForService', { parentAccountId: parent, productName: serviceName });
    const body = rec(res.body);
    defs = Array.isArray(body?.Fields) ? (body!.Fields as FieldDef[]) : [];
  } catch (err) {
    if (!remotePricingAllowed() && REMOTE_PRICING_NAME_RE.test(serviceName)) {
      return remotePricingResult(serviceName, parent, []);
    }
    // Precheck is best-effort: never block the real call because of it.
    return {
      ok: true,
      serviceName,
      parentAccountId: parent,
      issues: [],
      skipped: `GetFieldsForService failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
  if (!defs.length) {
    return { ok: true, serviceName, parentAccountId: parent, issues: [], skipped: 'No field definitions returned.' };
  }

  const remote = remotePricingFields(defs);
  if (remote.length && !remotePricingAllowed()) return remotePricingResult(serviceName, parent, remote);

  const issues = checkFields(defs, givenFields(account));

  // RI / Savings Plan: must be ordered under the Azure Plan subscription with the tenant as dependency.
  if (/ReservedInstance|Reservation|SavingsPlan/i.test(serviceName)) {
    try {
      const az = await resolveAzureOrderContext(parent, serviceName);
      if (az.azurePlanAccountId && parent !== az.azurePlanAccountId) {
        issues.unshift({
          field: 'ParentAccountId',
          problem: 'wrong_parent',
          detail: `Use the Azure Plan subscription ${az.azurePlanAccountId} as ParentAccountId (not the company ${parent}); with the company ALSO fails with HTTP 500.`,
        });
      }
      const dep = get(account, 'DependencyAccountId', 'dependencyAccountId');
      if (dep == null && az.tenantSubscriptionAccountId) {
        issues.unshift({
          field: 'DependencyAccountId',
          problem: 'missing_dependency',
          detail: `Set DependencyAccountId to the Microsoft tenant subscription ${az.tenantSubscriptionAccountId}.`,
        });
      }
    } catch {
      // best effort
    }
  }
  // Unknown fields are reported but do not block (ALSO may accept extra fields).
  const blocking = issues.filter((i) => i.problem !== 'unknown_field');
  return {
    ok: blocking.length === 0,
    serviceName,
    parentAccountId: parent,
    issues,
    ...(issues.length ? { fieldDefinitions: defs.filter(isUserField).map(compactDefinition) } : {}),
  };
}
